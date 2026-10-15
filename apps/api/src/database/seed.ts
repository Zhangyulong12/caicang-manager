import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export const seedTenants = [
  { id: '03000000-0000-4000-8000-000000000001', name: '测试商家甲' },
  { id: '03000000-0000-4000-8000-000000000002', name: '测试商家乙' },
] as const;

const seedUsers = [
  {
    id: '03000000-0000-4000-8000-000000000011',
    email: 'owner-a@caicang.invalid',
    displayName: '甲商家负责人',
  },
  {
    id: '03000000-0000-4000-8000-000000000012',
    email: 'owner-b@caicang.invalid',
    displayName: '乙商家负责人',
  },
  {
    id: '03000000-0000-4000-8000-000000000013',
    email: 'buyer@caicang.invalid',
    displayName: '采购测试用户',
  },
  {
    id: '03000000-0000-4000-8000-000000000014',
    email: 'warehouse@caicang.invalid',
    displayName: '仓管测试用户',
  },
  {
    id: '03000000-0000-4000-8000-000000000015',
    email: 'viewer@caicang.invalid',
    displayName: '跨商家只读测试用户',
  },
  {
    id: '03000000-0000-4000-8000-000000000016',
    email: 'admin@caicang.invalid',
    displayName: '管理员测试用户',
  },
] as const;

export function assertLocalSeedTarget(connectionString: string): void {
  const url = new URL(connectionString);
  if (
    process.env.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/(caicang|caicang_test_[a-f0-9]+)$/.test(url.pathname)
  ) {
    throw new Error('Demo seed requires the local caicang development/test database.');
  }
}

export async function seedDatabase(connectionString: string): Promise<void> {
  assertLocalSeedTarget(connectionString);
  const password = process.env.SEED_PASSWORD ?? randomBytes(32).toString('hex');
  if (Buffer.byteLength(password) < 12 || Buffer.byteLength(password) > 72) {
    throw new Error('SEED_PASSWORD must be 12–72 bytes.');
  }
  const passwordHash = await hash(password, 12);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await prisma.$transaction(
      async (tx) => {
        // Serialize simultaneous seed runs; natural unique keys remain the final safeguard.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(303030)`;
        for (const tenant of seedTenants) {
          await tx.tenant.upsert({ where: { id: tenant.id }, create: tenant, update: {} });
        }
        for (const user of seedUsers) {
          const record = await tx.user.upsert({
            where: { email: user.email },
            create: { ...user, passwordHash, isActive: false },
            update: {},
          });
          if (record.id !== user.id)
            throw new Error('Demo email collision; existing account preserved.');
        }
        const memberships = [
          [0, 0, 'OWNER'],
          [1, 1, 'OWNER'],
          [0, 2, 'BUYER'],
          [0, 3, 'WAREHOUSE'],
          [0, 4, 'VIEWER'],
          [1, 4, 'VIEWER'],
          [0, 5, 'ADMIN'],
        ] as const;
        for (const [tenantIndex, userIndex, role] of memberships) {
          const tenantId = seedTenants[tenantIndex].id;
          const userId = seedUsers[userIndex].id;
          await tx.tenantMembership.upsert({
            where: { tenantId_userId: { tenantId, userId } },
            create: { tenantId, userId, role },
            update: {},
          });
        }
        for (const tenant of seedTenants) {
          for (const code of ['MAIN', 'BACKUP']) {
            await tx.warehouse.upsert({
              where: { tenantId_code: { tenantId: tenant.id, code } },
              create: {
                tenantId: tenant.id,
                code,
                name: `${tenant.name}${code === 'MAIN' ? '主仓' : '备用仓'}`,
              },
              update: {},
            });
          }
          for (const [sku, name, barcode] of [
            ['DEMO-CUP', '测试水杯', 'DEMO-690000000001'],
            ['DEMO-BAG', '测试收纳袋', null],
            ['DEMO-BOX', '测试包装盒', null],
          ] as const) {
            await tx.product.upsert({
              where: { tenantId_sku: { tenantId: tenant.id, sku } },
              create: { tenantId: tenant.id, sku, name, barcode },
              update: {},
            });
          }
        }
      },
      { timeout: 30000 },
    );
    console.log(
      'Seed complete: 2 tenants, 6 users, 7 memberships, 4 warehouses, 6 products (existing records preserved).',
    );
  } finally {
    await prisma.$disconnect();
  }
}
