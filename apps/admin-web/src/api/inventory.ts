import type {
  ApiPageResponse,
  InventoryBalanceData,
  InventoryMovementData,
  InventoryPendingData,
  InventorySummaryData,
  StockMovementType,
} from '@caicang/api-contract';
import type { CatalogClient, CatalogScope } from './catalog';
import { ApiFailure } from './client';

/**
 * 库存查询客户端。整个模块只有 GET——库存数量只能由服务端收货事务改变，
 * 页面不做任何写操作，也不在本地推算数量或金额。
 */
export interface BalanceListQuery {
  page: number;
  pageSize: number;
  warehouseId?: string;
  productId?: string;
  sku?: string;
  barcode?: string;
  search?: string;
  updatedFrom?: string;
  updatedTo?: string;
}
export interface MovementListQuery {
  page: number;
  pageSize: number;
  warehouseId?: string;
  productId?: string;
  sku?: string;
  barcode?: string;
  search?: string;
  type?: StockMovementType;
  from?: string;
  to?: string;
}
export interface PendingListQuery {
  page: number;
  pageSize: number;
  warehouseId?: string;
  productId?: string;
  sku?: string;
  barcode?: string;
  search?: string;
  from?: string;
  to?: string;
}
/** 统一校验 page/pageSize，避免把 0 或超大页码发给服务端。 */
export function checkPaging(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize > 100)
    throw new ApiFailure(400, 'VALIDATION_ERROR', '分页参数不合法');
}
/** 空字符串代表"不筛选"，不要发成 `?warehouseId=`。 */
function params(
  query: { page: number; pageSize: number } & Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  for (const [key, value] of Object.entries(query)) {
    if (key === 'page' || key === 'pageSize') continue;
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

export function createInventory(client: CatalogClient, scope: () => CatalogScope | null) {
  function capture() {
    const current = scope();
    if (!current || !current.permissions.includes('products:read'))
      throw new ApiFailure(403, 'FORBIDDEN', '当前角色没有查看库存的权限');
    return { ...current };
  }
  function check(expected: CatalogScope) {
    const current = scope();
    if (
      !current ||
      current.userId !== expected.userId ||
      current.sessionKey !== expected.sessionKey ||
      current.tenantId !== expected.tenantId
    )
      throw new ApiFailure(409, 'SCOPE_CHANGED', '工作空间已切换，请重新打开页面');
  }
  async function request<T>(path: string) {
    const current = capture();
    const result = await client.request<T>(path, { tenantId: current.tenantId });
    check(current);
    return result;
  }
  return {
    async summary() {
      return (await request<InventorySummaryData>('/inventory/summary')).data;
    },
    async balances(query: BalanceListQuery) {
      checkPaging(query.page, query.pageSize);
      const result = (await request<InventoryBalanceData[]>(
        '/inventory/balances?' + params({ ...query }),
      )) as ApiPageResponse<InventoryBalanceData>;
      return result;
    },
    async movements(query: MovementListQuery) {
      checkPaging(query.page, query.pageSize);
      const result = (await request<InventoryMovementData[]>(
        '/inventory/movements?' + params({ ...query }),
      )) as ApiPageResponse<InventoryMovementData>;
      return result;
    },
    async pending(query: PendingListQuery) {
      checkPaging(query.page, query.pageSize);
      const result = (await request<InventoryPendingData[]>(
        '/inventory/pending?' + params({ ...query }),
      )) as ApiPageResponse<InventoryPendingData>;
      return result;
    },
  };
}
