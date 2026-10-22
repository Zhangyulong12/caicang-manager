import type {
  ApiPageResponse,
  PurchaseOrderData,
  PurchasePlatform,
  PurchaseStatus,
  WarehouseData,
} from '@caicang/api-contract';
import type { CatalogClient, CatalogScope } from './catalog';
import { ApiFailure } from './client';
import { purchaseErrors, purchasePayload, type PurchaseForm } from './purchase-form';
export function createPurchases(client: CatalogClient, scope: () => CatalogScope | null) {
  function capture(write = false) {
    const value = scope();
    if (!value || !value.permissions.includes(write ? 'purchase:write' : 'purchase:read'))
      throw new ApiFailure(403, 'FORBIDDEN', '当前角色没有此采购操作权限');
    return { ...value };
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
    async list(query: {
      page: number;
      pageSize: number;
      search?: string;
      status?: PurchaseStatus;
      platform?: PurchasePlatform;
    }) {
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      for (const key of ['search', 'status', 'platform'] as const)
        if (query[key]?.trim()) params.set(key, query[key]!.trim());
      return (await request<PurchaseOrderData[]>(
        '/purchase-orders?' + params,
      )) as ApiPageResponse<PurchaseOrderData>;
    },
    async detail(id: string) {
      return (await request<PurchaseOrderData>('/purchase-orders/' + encodeURIComponent(id))).data;
    },
    async save(form: PurchaseForm, id?: string) {
      if (Object.keys(purchaseErrors(form)).length)
        throw new ApiFailure(400, 'VALIDATION_ERROR', '请修正采购表单');
      return (
        await request<PurchaseOrderData>(
          id ? '/purchase-orders/' + encodeURIComponent(id) : '/purchase-orders',
          { method: id ? 'PATCH' : 'POST', body: purchasePayload(form) },
          true,
        )
      ).data;
    },
    async action(id: string, action: 'place' | 'cancel') {
      return (
        await request<PurchaseOrderData>(
          '/purchase-orders/' + encodeURIComponent(id) + '/' + action,
          { method: 'POST', body: {} },
          true,
        )
      ).data;
    },
    async warehouses() {
      const current = capture();
      const rows: WarehouseData[] = [];
      for (let page = 1; ; page++) {
        const response = (await request<WarehouseData[]>(
          `/warehouses?page=${page}&pageSize=100`,
        )) as ApiPageResponse<WarehouseData>;
        check(current);
        if (response.data.some((row) => row.tenantId !== current.tenantId))
          throw new ApiFailure(502, 'INVALID_RESPONSE', '仓库范围异常');
        rows.push(...response.data);
        if (page * 100 >= response.pagination.total) return rows;
        if (!response.data.length) throw new ApiFailure(502, 'INVALID_RESPONSE', '仓库分页异常');
      }
    },
  };
}
