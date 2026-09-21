/**
 * The single most important test in the product: one tenant must never be able to read or
 * modify another tenant's data, even if application code forgets a WHERE clause.
 * RLS is the mechanism; this test proves it is actually on.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@botshop/core';
import type { Db } from '@botshop/db';
import * as repo from '@botshop/db/repos';
import { testEnv, type TestEnv } from '../setup/test-db.ts';

let env: TestEnv;
let db: Db;
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  env = await testEnv();
  db = env.db;

  // Tenant B is created the same way signup does it.
  const created = await db.withPlatform(async (tx) => {
    const tenant = await repo.createTenant(tx, 'Other Seller', 'other-seller');
    await repo.createUser(tx, {
      tenantId: tenant.id,
      email: 'other@test.local',
      passwordHash: hashPassword('test-password-123'),
      name: 'Other',
      role: 'owner',
    });
    await repo.createShop(tx, { tenantId: tenant.id, slug: 'other-shop', name: 'Other Shop', currency: 'USD' });
    return tenant;
  });
  tenantA = env.tenantId;
  tenantB = created.id;
});

describe('row-level security', () => {
  it('hides tenant A data from tenant B', async () => {
    const seenByB = await db.withTenant(tenantB, (tx) => repo.listShops(tx));
    expect(seenByB.map((s) => s.name)).toEqual(['Other Shop']);

    const seenByA = await db.withTenant(tenantA, (tx) => repo.listShops(tx));
    expect(seenByA.map((s) => s.name)).toEqual(['Kesi Crafts']);
    expect(seenByA.some((s) => s.name === 'Other Shop')).toBe(false);
  });

  it('returns zero rows (not an error) when a query simply forgets the tenant filter', async () => {
    const rows = await db.withTenant(tenantB, (tx) => tx.query('select * from shops'));
    expect(rows).toHaveLength(1);
    expect((rows[0] as { slug: string }).slug).toBe('other-shop');
  });

  it('rejects writes that target another tenant, via WITH CHECK', async () => {
    await expect(
      db.withTenant(tenantB, (tx) =>
        tx.execute("insert into shops (tenant_id, slug, name) values ($1, 'smuggled', 'Smuggled')", [tenantA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('rejects updates that would move a row into another tenant', async () => {
    const shopB = (await db.withTenant(tenantB, (tx) => repo.listShops(tx)))[0]!;
    await expect(
      db.withTenant(tenantB, async (tx) => {
        await tx.execute('update shops set tenant_id = $1 where id = $2', [tenantA, shopB.id]);
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot read another tenant’s customers or secrets', async () => {
    const shopA = (await db.withTenant(tenantA, (tx) => repo.listShops(tx)))[0]!;
    const botA = await db.withTenant(tenantA, (tx) =>
      repo.createBot(tx, {
        shopId: shopA.id,
        tokenCiphertext: env.keyRing.encrypt('111:fake-token-for-isolation-test-aaaa'),
        tokenKeyId: 'test',
        tokenLast4: 'aaaa',
        webhookSecret: 'secret-a',
        mode: 'webhook',
      }),
    );

    const invisible = await db.withTenant(tenantB, (tx) => repo.getBot(tx, botA.id));
    expect(invisible).toBeNull();

    const selectAll = await db.withTenant(tenantB, (tx) => tx.query('select token_ciphertext from bots'));
    expect(selectAll).toHaveLength(0);
  });

  it('lets platform operations see across tenants (explicit, audited door)', async () => {
    const all = await db.withPlatform((tx) => repo.listShops(tx));
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('does not leak rows when no tenant context is set at all', async () => {
    const rows = await db.raw('select * from shops');
    expect(rows).toHaveLength(0);
  });
});
