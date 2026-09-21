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
import { pathId } from './params.ts';

const localeSchema = z.enum(SUPPORTED_LOCALES);

/**
 * Optional fields accept BOTH "omitted" and "null": a form that submits an empty text box sends
 * `null` (and JSON.stringify drops `undefined`), and both must mean "not set". Rejecting null here
 * used to make step 1 impossible to save whenever the contact email or phone was left blank.
 */
const optionalText = (max: number) => z.string().max(max).nullish();
const optionalCountry = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'Use the 2-letter country code, for example KE')
  .nullish();
const optionalCurrency = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'Use the 3-letter currency code, for example KES')
  .nullish();
const optionalEmail = z
  .string()
  .email('Enter a valid email address, or leave this field empty')
  .max(160)
  .nullish();

const createShopSchema = z.object({
  name: z.string().min(2, 'Business name needs at least 2 characters, for example Kesi Crafts').max(80, 'Business name is too long (80 characters max)'),
  category: optionalText(80),
  country: optionalCountry,
  currency: optionalCurrency,
  timezone: optionalText(64),
  contactEmail: optionalEmail,
  contactPhone: optionalText(32),
});

const patchShopSchema = z.object({
  name: z.string().min(2, 'Business name needs at least 2 characters, for example Kesi Crafts').max(80, 'Business name is too long (80 characters max)').optional(),
  description: optionalText(600),
  category: optionalText(80),
  country: optionalCountry,
  currency: optionalCurrency,
  timezone: optionalText(64),
  contactEmail: optionalEmail,
  contactPhone: optionalText(32),
  defaultLocale: localeSchema.optional(),
  supportedLocales: z.array(localeSchema).min(1).max(3).optional(),
  supportHours: optionalText(120),
  supportChatId: z.union([z.string().regex(/^-?\d{1,20}$/, 'Chat id must be numeric, e.g. -1001234567890'), z.number().int()]).nullish(),
  rulesMd: z.string().max(4000).nullish(),
  refundPolicyMd: z.string().max(4000).nullish(),
  deliveryPolicyMd: z.string().max(4000).nullish(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must look like #1f7a5a')
    .nullish(),
  onboardingStep: z.number().int().min(1).max(6).optional(),
});

const UPPERCASE_FIELDS = new Set(['country', 'currency']);

/**
 * Fields where a blank form input (or nothing but spaces) means "not set" rather than a value.
 * `name` is deliberately absent: an empty business name is an error we explain, not a field to clear.
 */
const BLANK_MEANS_UNSET = new Set([
  'description',
  'category',
  'country',
  'currency',
  'timezone',
  'contactEmail',
  'contactPhone',
  'supportHours',
  'supportChatId',
  'rulesMd',
  'refundPolicyMd',
  'deliveryPolicyMd',
  'brandColor',
]);

/**
 * Trim every string in the payload and turn whitespace-only values into `null` for the fields above.
 * Without this, a name of "   " passed the 2-character rule and was stored verbatim, and a contact
 * email of "   " was reported as an invalid address instead of an empty field.
 */
function normalizeShopInput(input: unknown): Record<string, unknown> {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      out[key] = trimmed.length === 0 && BLANK_MEANS_UNSET.has(key) ? null : trimmed;
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) => (typeof item === 'string' ? item.trim() : item));
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Columns that must always hold a value. An empty form field arrives as `null`, which for these
 * means "leave it as it is" — clearing them would violate NOT NULL and, worse, silently break the
 * shop (no currency, no language). Nullable columns (description, policies, contact details,
 * brand colour) are genuinely clearable.
 */
const NON_NULLABLE_COLUMNS = new Set([
  'name',
  'currency',
  'timezone',
  'default_locale',
  'supported_locales',
  'onboarding_step',
  'status',
]);

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
    if (value === null && NON_NULLABLE_COLUMNS.has(column)) continue;
    let stored = typeof value === 'number' ? String(value) : value;
    if (typeof stored === 'string' && UPPERCASE_FIELDS.has(column)) stored = stored.toUpperCase();
    patch[column] = stored;
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
    const body = createShopSchema.parse(normalizeShopInput(request.body));

    const shop = await db.withTenant(
      actor.tenantId,
      async (tx) => {
        const existing = await tx.queryOne<{ id: string }>('select id from shops limit 1');
        if (existing) throw ERRORS.conflict('This workspace already has a shop');
        const created = await repo.createShop(tx, {
          slug: slugify(body.name),
          name: body.name,
          ...(body.category ? { category: body.category } : {}),
          ...(body.country ? { country: body.country.toUpperCase() } : {}),
          ...(body.currency ? { currency: body.currency.toUpperCase() } : {}),
          ...(body.timezone ? { timezone: body.timezone } : {}),
          ...(body.contactEmail ? { contact_email: body.contactEmail } : {}),
          ...(body.contactPhone ? { contact_phone: body.contactPhone } : {}),
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
    const shopId = pathId(request, 'shopId');
    const shop = await db.withTenant(actor.tenantId, (tx) => repo.getShop(tx, shopId), { actorRole: actor.role });
    if (!shop) throw ERRORS.notFound('Shop not found');
    return reply.send({ shop: publicShop(shop) });
  });

  app.patch('/api/v1/shops/:shopId', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'write');
    const shopId = pathId(request, 'shopId');
    const body = patchShopSchema.parse(normalizeShopInput(request.body));
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
    const shopId = pathId(request, 'shopId');

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
