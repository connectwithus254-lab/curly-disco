/**
 * Shop + onboarding wizard routes (docs/08-first-slice.md §wizard).
 *
 * The wizard is just a sequence of PATCHes with an explicit step counter; nothing about the
 * questionnaire is hardcoded in the database, so admins can change the flow later.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ERRORS, slugify } from '@botshop/shared';
import { SUPPORTED_LOCALES } from '@botshop/telegram';
import * as repo from '@botshop/db/repos';
import { authorize, requireActor, type RequestWithActor } from '../auth.ts';
import type { RouteDeps } from './types.ts';

const localeSchema = z.enum(SUPPORTED_LOCALES);

const createShopSchema = z.object({
  name: z.string().min(2).max(80),
  category: z.string().max(80).optional(),
  country: z.string().max(2).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO code')
    .optional(),
  timezone: z.string().max(64).optional(),
  contactEmail: z.string().email().max(160).optional(),
  contactPhone: z.string().max(32).optional(),
});

const patchShopSchema = createShopSchema.partial().extend({
  description: z.string().max(600).nullish(),
  defaultLocale: localeSchema.optional(),
  supportedLocales: z.array(localeSchema).min(1).max(3).optional(),
  supportHours: z.string().max(120).nullish(),
  supportChatId: z.union([z.string().regex(/^-?\d{1,20}$/), z.number().int()]).nullish(),
  rulesMd: z.string().max(4000).nullish(),
  refundPolicyMd: z.string().max(4000).nullish(),
  deliveryPolicyMd: z.string().max(4000).nullish(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  onboardingStep: z.number().int().min(1).max(6).optional(),
});

function toShopPatch(input: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, string> = {
    contactEmail: 'contact_email',
    contactPhone: 'contact_phone',
    defaultLocale: 'default_locale',
    supportedLocales: 'supported_locales',
    supportHours: 'support_hours',
    supportChatId: 'support_chat_id',
    rulesMd: 'rules_md',
    refundPolicyMd: 'refund_policy_md',
    deliveryPolicyMd: 'delivery_policy_md',
    brandColor: 'brand_color',
    onboardingStep: 'onboarding_step',
  };
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const column = map[key] ?? key;
    patch[column] = typeof value === 'number' ? String(value) : value;
  }
  return patch;
}

export function publicShop(shop: repo.ShopRow) {
  return {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    description: shop.description,
    category: shop.category,
    country: shop.country,
    currency: shop.currency,
    timezone: shop.timezone,
    defaultLocale: shop.default_locale,
    supportedLocales: shop.supported_locales,
    contactEmail: shop.contact_email,
    contactPhone: shop.contact_phone,
    supportHours: shop.support_hours,
    supportChatId: shop.support_chat_id,
    rulesMd: shop.rules_md,
    refundPolicyMd: shop.refund_policy_md,
    deliveryPolicyMd: shop.delivery_policy_md,
    brandColor: shop.brand_color,
    onboardingStep: shop.onboarding_step,
    onboardingCompletedAt: shop.onboarding_completed_at,
    status: shop.status,
  };
}

export async function registerShopRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db } = deps;

  app.post('/api/v1/shops', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'write');
    const body = createShopSchema.parse(request.body ?? {});

    const shop = await db.withTenant(
      actor.tenantId,
      async (tx) => {
        const existing = await tx.queryOne<{ id: string }>('select id from shops limit 1');
        if (existing) throw ERRORS.conflict('This workspace already has a shop');
        const created = await repo.createShop(tx, {
          slug: slugify(body.name),
          name: body.name,
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.country !== undefined ? { country: body.country } : {}),
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
          ...(body.contactEmail !== undefined ? { contact_email: body.contactEmail } : {}),
          ...(body.contactPhone !== undefined ? { contact_phone: body.contactPhone } : {}),
        });
        await repo.writeAudit(tx, {
          tenantId: actor.tenantId,
          actorType: 'user',
          actorId: actor.userId,
          action: 'shop.created',
          entityType: 'shop',
          entityId: created.id,
          after: { name: created.name },
          ip: request.ip,
        });
        await repo.emitEvent(tx, {
          tenantId: actor.tenantId,
          aggregateType: 'shop',
          aggregateId: created.id,
          eventType: 'shop.created',
          payload: { name: created.name },
        });
        return created;
      },
      { actorRole: actor.role },
    );

    return reply.code(201).send({ shop: publicShop(shop) });
  });

  app.get('/api/v1/shops', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'read');
    const shops = await db.withTenant(actor.tenantId, (tx) => repo.listShops(tx), { actorRole: actor.role });
    return reply.send({ shops: shops.map(publicShop) });
  });

  app.get('/api/v1/shops/:shopId', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'read');
    const { shopId } = request.params as { shopId: string };
    const shop = await db.withTenant(actor.tenantId, (tx) => repo.getShop(tx, shopId), { actorRole: actor.role });
    if (!shop) throw ERRORS.notFound('Shop not found');
    return reply.send({ shop: publicShop(shop) });
  });

  app.patch('/api/v1/shops/:shopId', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'write');
    const { shopId } = request.params as { shopId: string };
    const body = patchShopSchema.parse(request.body ?? {});
    const patch = toShopPatch(body);
    if (Object.keys(patch).length === 0) throw ERRORS.validation('Nothing to update');

    const { before, after } = await db.withTenant(
      actor.tenantId,
      async (tx) => {
        const before = await repo.getShop(tx, shopId);
        if (!before) throw ERRORS.notFound('Shop not found');
        const after = await repo.updateShop(tx, shopId, patch);
        await repo.writeAudit(tx, {
          tenantId: actor.tenantId,
          actorType: 'user',
          actorId: actor.userId,
          action: 'shop.updated',
          entityType: 'shop',
          entityId: shopId,
          before: { name: before.name, onboardingStep: before.onboarding_step },
          after: patch,
          ip: request.ip,
        });
        return { before, after: after! };
      },
      { actorRole: actor.role },
    );
    void before;
    return reply.send({ shop: publicShop(after) });
  });

  /** Launch = the wizard's final step. Runs explicit, user-visible checks. */
  app.post('/api/v1/shops/:shopId/launch', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'write');
    const { shopId } = request.params as { shopId: string };

    const result = await db.withTenant(
      actor.tenantId,
      async (tx) => {
        const shop = await repo.getShop(tx, shopId);
        if (!shop) throw ERRORS.notFound('Shop not found');
        const bots = (await repo.listBots(tx)).filter((b) => b.shop_id === shopId && b.status === 'active');

        const problems: string[] = [];
        if (shop.name.trim().length < 2) problems.push('Business name is required');
        if (!/^[A-Z]{3}$/.test(shop.currency)) problems.push('Currency must be a 3-letter code');
        if (shop.supported_locales.length === 0) problems.push('At least one language is required');
        if (!shop.supported_locales.includes(shop.default_locale)) {
          problems.push('Default language must be one of the enabled languages');
        }
        if (bots.length === 0) problems.push('Connect a Telegram bot before launching');
        if (problems.length > 0) {
          throw ERRORS.validation('Shop is not ready to launch', { problems });
        }

        const launched = await repo.completeOnboarding(tx, shopId);
        await repo.writeAudit(tx, {
          tenantId: actor.tenantId,
          actorType: 'user',
          actorId: actor.userId,
          action: 'shop.launched',
          entityType: 'shop',
          entityId: shopId,
          after: { status: 'active', botUsername: bots[0]?.username },
          ip: request.ip,
        });
        await repo.emitEvent(tx, {
          tenantId: actor.tenantId,
          aggregateType: 'shop',
          aggregateId: shopId,
          eventType: 'shop.launched',
          payload: { botUsername: bots[0]?.username ?? null },
        });
        return { shop: launched!, botUsername: bots[0]?.username ?? null };
      },
      { actorRole: actor.role },
    );

    return reply.send({ shop: publicShop(result.shop), botUsername: result.botUsername });
  });
}
