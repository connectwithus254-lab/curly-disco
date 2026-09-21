/**
 * Seed data for local/demo environments.
 *
 * Everything here is intentionally editable from the UI afterwards — the seed exists so you can
 * log in immediately, not to encode product defaults. Prices, plans, referral rates and crypto
 * assets are NOT seeded as fixed constants anywhere (see docs/00-overview.md §4).
 */
import { KeyRing } from '@botshop/core';
import type { Db } from './index.ts';
import * as repo from './repos.ts';
import { hashPassword } from '@botshop/core';

export interface SeedResult {
  tenantId: string;
  shopId: string;
  ownerEmail: string;
  ownerPassword: string;
  platformAdminEmail: string;
  platformAdminPassword: string;
}

export interface SeedOptions {
  ownerEmail?: string;
  ownerPassword?: string;
  platformAdminEmail?: string;
  platformAdminPassword?: string;
  keyRing?: KeyRing;
  botToken?: string;
}

export async function seed(db: Db, options: SeedOptions = {}): Promise<SeedResult> {
  const ownerEmail = options.ownerEmail ?? process.env.SEED_OWNER_EMAIL ?? 'owner@kesi.test';
  const ownerPassword = options.ownerPassword ?? process.env.SEED_OWNER_PASSWORD ?? 'demo-password-123';
  const platformAdminEmail = options.platformAdminEmail ?? process.env.SEED_ADMIN_EMAIL ?? 'admin@botshop.test';
  const platformAdminPassword = options.platformAdminPassword ?? process.env.SEED_ADMIN_PASSWORD ?? 'demo-password-123';

  // Platform admin lives outside tenant RLS (platform_admins is platform-only).
  const existingAdmin = await db.raw('select id from platform_admins where lower(email) = lower($1)', [platformAdminEmail]);
  if (existingAdmin.length === 0) {
    await db.withPlatform(async (tx) => {
      await tx.execute(
        `insert into platform_admins (email, password_hash, name, role) values ($1, $2, $3, 'admin')`,
        [platformAdminEmail, hashPassword(platformAdminPassword), 'Platform Admin'],
      );
    });
  }

  const existingTenant = await db.withPlatform(async (tx) => repo.findTenantBySlug(tx, 'kesi-crafts'));
  let tenantId: string;
  let shopId: string;

  if (existingTenant) {
    tenantId = existingTenant.id;
    const shop = await db.withTenant(tenantId, async (tx) => (await repo.listShops(tx))[0]);
    shopId = shop!.id;
  } else {
    const created = await db.withPlatform(async (tx) => {
      const tenant = await repo.createTenant(tx, 'Kesi Crafts', 'kesi-crafts');
      await repo.createUser(tx, {
        tenantId: tenant.id,
        email: ownerEmail,
        passwordHash: hashPassword(ownerPassword),
        name: 'Kesi Owner',
        role: 'owner',
      });
      return tenant;
    });
    tenantId = created.id;

    const shop = await db.withTenant(tenantId, async (tx) => {
      const created = await repo.createShop(tx, {
        slug: 'kesi-crafts',
        name: 'Kesi Crafts',
        description: 'Handmade beaded jewellery and leather goods, made in Nairobi and shipped worldwide.',
        category: 'Handmade & Accessories',
        country: 'KE',
        currency: 'KES',
        timezone: 'Africa/Nairobi',
        default_locale: 'en',
        supported_locales: ['en', 'sw'],
        contact_email: 'hello@kesi.test',
        contact_phone: '+254700000000',
        support_hours: 'Mon–Sat, 09:00–18:00 (EAT)',
        rules_md:
          'We ship within 3 working days.\nReturns accepted within 7 days of delivery for unused items.',
        refund_policy_md: 'Refunds are processed within 5 working days after we receive the returned item.',
        delivery_policy_md: 'Nairobi same-day delivery. Rest of Kenya 1–2 days. International 7–14 days.',
        brand_color: '#1f7a5a',
      });
      await repo.writeAudit(tx, {
        tenantId,
        actorType: 'system',
        action: 'shop.seeded',
        entityType: 'shop',
        entityId: created.id,
        after: { name: created.name, slug: created.slug },
      });
      return created;
    });
    shopId = shop.id;
  }

  // Optional: attach a real bot token during seed (handy for CI or a demo environment).
  const botToken = options.botToken ?? process.env.SEED_BOT_TOKEN;
  const keyRing = options.keyRing ?? (process.env.ENCRYPTION_KEYS ? KeyRing.fromEnv() : null);
  if (botToken && keyRing) {
    const hasBot = await db.withTenant(tenantId, async (tx) => (await repo.listBots(tx)).length > 0);
    if (!hasBot) {
      await db.withTenant(tenantId, async (tx) => {
        await repo.createBot(tx, {
          shopId,
          tokenCiphertext: keyRing.encrypt(botToken),
          tokenKeyId: keyRing.activeKeyId,
          tokenLast4: botToken.slice(-4),
          webhookSecret: 'seeded-secret-token-change-me',
          mode: 'polling',
        });
      });
    }
  }

  return {
    tenantId,
    shopId,
    ownerEmail,
    ownerPassword,
    platformAdminEmail,
    platformAdminPassword,
  };
}
