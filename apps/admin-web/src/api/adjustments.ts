import type {
  ApiPageResponse,
  StockAdjustmentData,
  AdjustmentReason,
  WarehouseData,
} from '@caicang/api-contract';
import type { CatalogClient, CatalogScope } from './catalog';
import { ApiFailure } from './client';
import { checkPaging } from './inventory';
import type { AdjustmentPayload } from './adjustment-form';
export interface AdjustmentListQuery {
  page: number;
  pageSize: number;
  warehouseId?: string;
  productId?: string;
  search?: string;
  reason?: AdjustmentReason;
  from?: string;
  to?: string;
}
export function createAdjustments(client: CatalogClient, scope: () => CatalogScope | null) {
  function capture(write = false) {
    const current = scope();
    if (!current || !current.permissions.includes(write ? 'inventory:write' : 'products:read'))
      throw new ApiFailure(
        403,
        'FORBIDDEN',
        write ? '当前角色没有库存调整权限' : '当前角色没有查看库存的权限',
      );
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
  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
    write = false,
  ) {
    const current = capture(write);
    const result = await client.request<T>(path, { ...init, tenantId: current.tenantId });
    check(current);
    return result;
  }
  return {
    async list(query: AdjustmentListQuery) {
      checkPaging(query.page, query.pageSize);
      if (query.pageSize < 1) throw new ApiFailure(400, 'VALIDATION_ERROR', '分页参数不合法');
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      for (const key of ['warehouseId', 'productId', 'search', 'reason', 'from', 'to'] as const)
        if (query[key]?.trim()) params.set(key, query[key]!.trim());
      return (await request<StockAdjustmentData[]>(
        '/inventory/adjustments?' + params,
      )) as ApiPageResponse<StockAdjustmentData>;
    },
    async detail(id: string) {
      return (
        await request<StockAdjustmentData>('/inventory/adjustments/' + encodeURIComponent(id))
      ).data;
    },
    async create(payload: AdjustmentPayload) {
      // Explicit whitelist: never send a locally computed balance, cost or display field.
      const body = {
        warehouseId: payload.warehouseId,
        productId: payload.productId,
        quantityDelta: payload.quantityDelta,
        reason: payload.reason,
        ...(payload.remark?.trim() ? { remark: payload.remark.trim() } : {}),
        clientOperationId: payload.clientOperationId,
      };
      return (
        await request<StockAdjustmentData>('/inventory/adjustments', { method: 'POST', body }, true)
      ).data;
    },
    async warehouses() {
      const current = capture(),
        rows: WarehouseData[] = [];
      for (let page = 1; ; page++) {
        const response = (await request<WarehouseData[]>(
          `/warehouses?page=${page}&pageSize=100`,
        )) as ApiPageResponse<WarehouseData>;
        check(current);
        if (response.data.some((row) => row.tenantId !== current.tenantId))
          throw new ApiFailure(502, 'INVALID_RESPONSE', '仓库数据范围异常');
        rows.push(...response.data);
        if (page * 100 >= response.pagination.total) return rows;
        if (!response.data.length) throw new ApiFailure(502, 'INVALID_RESPONSE', '仓库分页异常');
      }
    },
  };
}
