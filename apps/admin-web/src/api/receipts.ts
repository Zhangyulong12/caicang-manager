import type {
  ApiPageResponse,
  ApiResponse,
  PurchasePlatform,
  PurchaseStatus,
  ReceiptData,
} from '@caicang/api-contract';
import type { CatalogClient, CatalogScope } from './catalog';
import { ApiFailure } from './client';
import { checkPaging } from './inventory';

/** 入库单查询。入库单由手机端扫码收货产生，Web 端只读。 */
export interface ReceiptListQuery {
  page: number;
  pageSize: number;
  search?: string;
  packageId?: string;
  purchaseOrderId?: string;
  from?: string;
  to?: string;
}

export function createReceipts(client: CatalogClient, scope: () => CatalogScope | null) {
  function capture() {
    const current = scope();
    if (!current || !current.permissions.includes('packages:read'))
      throw new ApiFailure(403, 'FORBIDDEN', '当前角色没有查看入库记录的权限');
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
    async list(query: ReceiptListQuery) {
      checkPaging(query.page, query.pageSize);
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      if (query.search?.trim()) params.set('search', query.search.trim());
      for (const key of ['packageId', 'purchaseOrderId', 'from', 'to'] as const) {
        const value = query[key];
        if (value) params.set(key, value);
      }
      const result = (await request<ReceiptData[]>(
        '/receipts?' + params,
      )) as ApiPageResponse<ReceiptData>;
      return result as ApiPageResponse<ReceiptData>;
    },
    async detail(id: string) {
      const result = (await request<ReceiptData>(
        '/receipts/' + encodeURIComponent(id),
      )) as ApiResponse<ReceiptData>;
      return result.data;
    },
  };
}

export const purchaseStatusNames: Record<PurchaseStatus, string> = {
  DRAFT: '草稿',
  PLACED: '已下单',
  PARTIAL_RECEIVED: '部分收货',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};
export function platformLabel(value: string): string {
  return platformNames[value as PurchasePlatform] ?? value;
}
export function purchaseStatusLabel(value: string): string {
  return purchaseStatusNames[value as PurchaseStatus] ?? value;
}
export const platformNames: Record<PurchasePlatform, string> = {
  JD: '京东',
  TAOBAO: '淘宝',
  PDD: '拼多多',
  OTHER: '其他',
};
