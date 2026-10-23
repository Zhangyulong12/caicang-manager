import { Injectable } from '@nestjs/common';
import type { PurchaseAccountData, PurchasePlatform } from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';
import { PageResult } from '../../common/response.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import type {
  CreatePurchaseAccountDto,
  PurchaseAccountQueryDto,
  UpdatePurchaseAccountDto,
} from './purchase-account.dto.js';

// 只统计采购单引用数，不读取任何订单内容：删除与改平台都靠它判断。
const include = { _count: { select: { orders: true } } } satisfies Prisma.PurchaseAccountInclude;
type Account = Prisma.PurchaseAccountGetPayload<{ include: typeof include }>;

const map = (row: Account): PurchaseAccountData => ({
  id: row.id,
  tenantId: row.tenantId,
  platform: row.platform as PurchasePlatform,
  alias: row.alias,
  remark: row.remark,
  isActive: row.isActive,
  hasOrders: row._count.orders > 0,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const snapshot = (row: Account) => ({
  platform: row.platform,
  alias: row.alias,
  remark: row.remark,
  isActive: row.isActive,
});

@Injectable()
export class PurchaseAccountsService {
  constructor(private readonly contexts: TenantContextService) {}

  async list(context: TenantContext, query: PurchaseAccountQueryDto) {
    const skip = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(skip) || skip > 2147483647)
      throw new BusinessException('BAD_REQUEST');
    return this.contexts.run(context, 'purchase:read', false, async (tx, current) => {
      const where: Prisma.PurchaseAccountWhereInput = { tenantId: current.tenantId };
      if (query.platform) where.platform = query.platform;
      if (query.isActive !== undefined) where.isActive = query.isActive;
      // 别名按字面子串匹配，% 与 _ 不当通配符。
      if (query.search) {
        where.alias = { contains: query.search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' };
      }
      const total = await tx.purchaseAccount.count({ where });
      const rows = await tx.purchaseAccount.findMany({
        where,
        include,
        skip,
        take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return new PageResult(rows.map(map), {
        page: query.page,
        pageSize: query.pageSize,
        total,
      });
    });
  }

  async save(
    context: TenantContext,
    dto: CreatePurchaseAccountDto | UpdatePurchaseAccountDto,
    requestId: string,
    id?: string,
  ) {
    const editable = ['platform', 'alias', 'remark', 'isActive'] as const;
    if (!editable.some((key) => dto[key] !== undefined)) {
      throw new BusinessException('BAD_REQUEST');
    }
    try {
      return await this.contexts.run(context, 'purchase:write', true, async (tx, current) => {
        const before = id
          ? await tx.purchaseAccount.findUnique({
              where: { tenantId_id: { tenantId: current.tenantId, id } },
              include,
            })
          : null;
        if (id && !before) throw new BusinessException('NOT_FOUND');
        // 平台是历史的归属依据：已有采购单引用后再改平台会让旧记录对不上账。
        if (
          before?._count.orders &&
          dto.platform !== undefined &&
          dto.platform !== before.platform
        ) {
          throw new BusinessException('PURCHASE_ACCOUNT_PLATFORM_LOCKED');
        }
        const data = {
          platform: dto.platform ?? before?.platform ?? 'TAOBAO',
          alias: dto.alias ?? before?.alias ?? '',
          remark: dto.remark === undefined ? (before?.remark ?? null) : dto.remark || null,
          isActive: dto.isActive ?? before?.isActive ?? true,
        };
        if (
          before &&
          Object.entries(data).every(([key, value]) => before[key as keyof typeof data] === value)
        ) {
          return map(before);
        }
        const row = before
          ? await tx.purchaseAccount.update({
              where: { tenantId_id: { tenantId: current.tenantId, id: before.id } },
              data,
              include,
            })
          : await tx.purchaseAccount.create({
              data: { ...data, tenantId: current.tenantId },
              include,
            });
        await tx.auditLog.create({
          data: {
            tenantId: current.tenantId,
            actorId: current.userId,
            action: before ? 'PURCHASE_ACCOUNT_UPDATED' : 'PURCHASE_ACCOUNT_CREATED',
            objectType: 'purchase_account',
            objectId: row.id,
            metadata: {
              requestId,
              ...(before ? { before: snapshot(before) } : {}),
              after: snapshot(row),
            },
          },
        });
        return map(row);
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BusinessException('PURCHASE_ACCOUNT_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  /**
   * 只允许删除从未被采购单引用的账号。
   * 有历史的账号一律 409：删除会让采购记录的账号列悬空，历史只能靠停用保留。
   */
  async remove(context: TenantContext, id: string, requestId: string) {
    try {
      return await this.contexts.run(context, 'purchase:write', true, async (tx, current) => {
        const row = await tx.purchaseAccount.findUnique({
          where: { tenantId_id: { tenantId: current.tenantId, id } },
          include,
        });
        if (!row) throw new BusinessException('NOT_FOUND');
        if (row._count.orders > 0) throw new BusinessException('PURCHASE_ACCOUNT_HAS_ORDERS');
        await tx.purchaseAccount.delete({
          where: { tenantId_id: { tenantId: current.tenantId, id: row.id } },
        });
        await tx.auditLog.create({
          data: {
            tenantId: current.tenantId,
            actorId: current.userId,
            action: 'PURCHASE_ACCOUNT_DELETED',
            objectType: 'purchase_account',
            objectId: row.id,
            metadata: { requestId, before: snapshot(row) },
          },
        });
        return { id: row.id, deleted: true };
      });
    } catch (error: unknown) {
      // 并发建单恰好引用该账号时由外键兜底，仍然按"有历史不能删"回答。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new BusinessException('PURCHASE_ACCOUNT_HAS_ORDERS');
      }
      throw error;
    }
  }
}
