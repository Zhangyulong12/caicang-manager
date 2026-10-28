import type {
  ReportDataset,
  ReportOverviewData,
  ReportTableData,
  ReportExportData,
  TenantPermission,
} from '@caicang/api-contract';
import type { CatalogClient, CatalogScope } from './catalog';
import { ApiFailure } from './client';
export interface ReportFilters {
  from?: string;
  to?: string;
  warehouseId?: string;
  purchaseAccountId?: string;
  platform?: string;
  sku?: string;
  articleNo?: string;
}
export function reportParams(filters: ReportFilters, dataset?: ReportDataset) {
  const params = new URLSearchParams();
  for (const key of [
    'from',
    'to',
    'warehouseId',
    'purchaseAccountId',
    'platform',
    'sku',
    'articleNo',
  ] as const) {
    if (dataset === 'inventory' && (key === 'from' || key === 'to')) continue;
    if (
      dataset &&
      ['inventory', 'outbound', 'adjustments'].includes(dataset) &&
      (key === 'purchaseAccountId' || key === 'platform')
    )
      continue;
    if (
      dataset &&
      ['accounts', 'platforms', 'daily', 'returns'].includes(dataset) &&
      (key === 'sku' || key === 'articleNo')
    )
      continue;
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  if (dataset) params.set('dataset', dataset);
  return params;
}
export function reportSource(
  row: Record<string, string | null>,
  dataset: ReportDataset,
): string | null {
  const id =
    dataset === 'receipts'
      ? row.receiptId
      : dataset === 'outbound'
        ? row.outboundId
        : dataset === 'returns'
          ? row.key
          : dataset === 'adjustments'
            ? row.adjustmentId
            : row.orderId;
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return null;
  const prefix =
    dataset === 'receipts'
      ? '/receipts/'
      : dataset === 'outbound'
        ? '/outbound/'
        : dataset === 'returns'
          ? '/purchase-returns/'
          : dataset === 'adjustments'
            ? '/inventory/adjustments/'
            : '/purchases/';
  return prefix + encodeURIComponent(id);
}
export function createReports(client: CatalogClient, scope: () => CatalogScope | null) {
  async function request<T>(path: string, permission: TenantPermission = 'reports:read') {
    const captured = scope();
    if (!captured?.permissions.includes(permission))
      throw new ApiFailure(403, 'FORBIDDEN', '当前角色没有统计操作权限');
    const result = await client.request<T>(path, { tenantId: captured.tenantId });
    const current = scope();
    if (
      !current ||
      current.tenantId !== captured.tenantId ||
      current.userId !== captured.userId ||
      current.sessionKey !== captured.sessionKey
    )
      throw new ApiFailure(409, 'SCOPE_CHANGED', '工作空间已切换，请重新查询');
    return result.data;
  }
  return {
    overview: (q: ReportFilters) =>
      request<ReportOverviewData>('/reports/overview?' + reportParams(q)),
    table: (dataset: ReportDataset, q: ReportFilters, page = 1, pageSize = 20) => {
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 100
      )
        throw new ApiFailure(400, 'BAD_REQUEST', '分页参数不正确');
      const params = reportParams(q, dataset);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      return request<ReportTableData>('/reports/table?' + params);
    },
    export: (dataset: ReportDataset, q: ReportFilters) =>
      request<ReportExportData>('/reports/export?' + reportParams(q, dataset), 'reports:export'),
  };
}
