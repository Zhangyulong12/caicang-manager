import type {
  ApiPageResponse,
  PackageData,
  PackageLookupData,
  PackageStatus,
} from '@caicang/api-contract';
import type { CatalogClient, CatalogScope } from './catalog';
import { ApiFailure } from './client';
export interface PackageListQuery {
  page: number;
  pageSize: number;
  search?: string;
  purchaseOrderId?: string;
  carrierCode?: string;
  status?: PackageStatus;
  hasReceipts?: boolean;
}
export function createPackages(client: CatalogClient, scope: () => CatalogScope | null) {
  function capture(permission: 'packages:read' | 'packages:lookup') {
    const current = scope();
    if (!current || !current.permissions.includes(permission))
      throw new ApiFailure(403, 'FORBIDDEN', '当前角色没有此包裹操作权限');
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
    permission: 'packages:read' | 'packages:lookup',
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) {
    const current = capture(permission);
    const result = await client.request<T>(path, { ...init, tenantId: current.tenantId });
    check(current);
    return result;
  }
  function guarded(rows: PackageData[], tenantId: string) {
    if (rows.some((row) => row.tenantId !== tenantId))
      throw new ApiFailure(502, 'INVALID_RESPONSE', '包裹范围异常，请刷新后重试');
    return rows;
  }
  return {
    async list(query: PackageListQuery) {
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      if (query.search?.trim()) params.set('search', query.search.trim());
      if (query.purchaseOrderId) params.set('purchaseOrderId', query.purchaseOrderId);
      if (query.carrierCode?.trim()) params.set('carrierCode', query.carrierCode.trim());
      if (query.status) params.set('status', query.status);
      if (query.hasReceipts !== undefined) params.set('hasReceipts', String(query.hasReceipts));
      const current = capture('packages:read');
      const result = (await request<PackageData[]>(
        'packages:read',
        '/packages?' + params,
      )) as ApiPageResponse<PackageData>;
      guarded(result.data, current.tenantId);
      return result;
    },
    async detail(id: string) {
      return (await request<PackageData>('packages:read', '/packages/' + encodeURIComponent(id)))
        .data;
    },
    async lookup(trackingNo: string) {
      const value = trackingNo.trim();
      if (!value || value.length > 128)
        throw new ApiFailure(400, 'VALIDATION_ERROR', '请输入 1–128 位运单号');
      const result = await request<PackageLookupData[]>(
        'packages:lookup',
        '/packages/lookup?trackingNo=' + encodeURIComponent(value),
      );
      return result.data;
    },
  };
}
