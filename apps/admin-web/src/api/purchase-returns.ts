import type {
  ApiPageResponse,
  PurchaseOrderData,
  PurchaseReturnData,
  PurchaseReturnableData,
  PurchaseReturnStatus,
} from '@caicang/api-contract';
import type { CatalogClient, CatalogScope } from './catalog';
import { ApiFailure } from './client';
import { checkPaging } from './inventory';
import type { ReturnInput } from './return-form';
export function createPurchaseReturns(client: CatalogClient, scope: () => CatalogScope | null) {
  function capture(permission: 'purchase:read' | 'purchase:write' | 'inventory:write') {
    const current = scope();
    if (!current?.permissions.includes(permission))
      throw new ApiFailure(403, 'FORBIDDEN', '当前角色没有此退货操作权限');
    return { ...current };
  }
  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
    permission: 'purchase:read' | 'purchase:write' | 'inventory:write' = 'purchase:read',
  ) {
    const captured = capture(permission);
    const result = await client.request<T>(path, { ...init, tenantId: captured.tenantId });
    const current = scope();
    if (
      !current ||
      current.userId !== captured.userId ||
      current.tenantId !== captured.tenantId ||
      current.sessionKey !== captured.sessionKey
    )
      throw new ApiFailure(409, 'SCOPE_CHANGED', '工作空间已切换，请重新打开页面');
    return result;
  }
  return {
    async list(query: {
      page: number;
      pageSize: number;
      search?: string;
      status?: PurchaseReturnStatus | '';
      from?: string;
      to?: string;
      purchaseOrderId?: string;
    }) {
      checkPaging(query.page, query.pageSize);
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      for (const key of ['search', 'status', 'from', 'to', 'purchaseOrderId'] as const)
        if (query[key]?.trim()) params.set(key, query[key]!.trim());
      return (await request<PurchaseReturnData[]>(
        '/purchase-returns?' + params,
      )) as ApiPageResponse<PurchaseReturnData>;
    },
    async purchases(search: string, page: number) {
      const params = new URLSearchParams({ page: String(page), pageSize: '10' });
      if (search.trim()) params.set('search', search.trim());
      return (await request<PurchaseOrderData[]>(
        '/purchase-orders?' + params,
      )) as ApiPageResponse<PurchaseOrderData>;
    },
    async returnable(id: string) {
      return (
        await request<PurchaseReturnableData>(
          '/purchase-orders/' + encodeURIComponent(id) + '/returnable',
        )
      ).data;
    },
    async detail(id: string) {
      return (await request<PurchaseReturnData>('/purchase-returns/' + encodeURIComponent(id)))
        .data;
    },
    async create(input: ReturnInput) {
      // Never send estimated totals, inventory balances, costs, tenant or actor supplied by the UI.
      const body = {
        purchaseOrderId: input.purchaseOrderId,
        reason: input.reason.trim(),
        returnDate: input.returnDate,
        refundAmount: input.refundAmount,
        remark: input.remark.trim() || null,
        items: input.items.map((i) => ({
          purchaseOrderItemId: i.purchaseOrderItemId,
          quantity: i.quantity,
        })),
      };
      return (
        await request<PurchaseReturnData>(
          '/purchase-returns',
          { method: 'POST', body },
          'purchase:write',
        )
      ).data;
    },
    async confirm(id: string, clientOperationId: string) {
      return (
        await request<PurchaseReturnData>(
          '/purchase-returns/' + encodeURIComponent(id) + '/confirm',
          { method: 'POST', body: { clientOperationId } },
          'inventory:write',
        )
      ).data;
    },
    async cancel(id: string) {
      return (
        await request<PurchaseReturnData>(
          '/purchase-returns/' + encodeURIComponent(id) + '/cancel',
          { method: 'POST', body: {} },
          'purchase:write',
        )
      ).data;
    },
  };
}
