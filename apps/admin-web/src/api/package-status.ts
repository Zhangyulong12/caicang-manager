import type {
  PackageData,
  PackageExpectedItemData,
  PackageReceivingStatus,
  PackageStatus,
} from '@caicang/api-contract';
export const packageStatusNames: Record<PackageStatus, string> = {
  CREATED: '待发货',
  IN_TRANSIT: '运输中',
  ARRIVED: '已到达',
  PARTIAL_RECEIVED: '部分验收',
  RECEIVED: '已验收',
  EXCEPTION: '物流异常',
};
export const receivingStatusNames: Record<PackageReceivingStatus, string> = {
  NOT_RECEIVED: '未收货',
  PARTIAL_RECEIVED: '部分收货',
  RECEIVED: '已收货',
};
export function packageStatusTone(
  status: PackageStatus,
): 'success' | 'warning' | 'danger' | 'info' | 'primary' {
  if (status === 'RECEIVED') return 'success';
  if (status === 'PARTIAL_RECEIVED' || status === 'ARRIVED') return 'warning';
  if (status === 'EXCEPTION') return 'danger';
  if (status === 'IN_TRANSIT') return 'primary';
  return 'info';
}
export function receivingStatusTone(
  status: PackageReceivingStatus,
): 'success' | 'warning' | 'info' {
  if (status === 'RECEIVED') return 'success';
  if (status === 'PARTIAL_RECEIVED') return 'warning';
  return 'info';
}
/** Sum of planned quantities for the package; plans may be empty when the box content is unknown. */
export function expectedTotal(items: readonly PackageExpectedItemData[]): number {
  return items.reduce((total, item) => total + item.expectedQuantity, 0);
}
/** Received quantity as a 0–100 percentage of the plan; 0 when nothing was planned. */
export function receivingPercent(row: Pick<PackageData, 'expectedItems' | 'receivedQuantity'>) {
  const planned = expectedTotal(row.expectedItems);
  if (planned <= 0) return 0;
  return Math.min(100, Math.round((row.receivedQuantity / planned) * 100));
}
export function itemSummary(items: readonly PackageExpectedItemData[], max = 2) {
  if (!items.length) return '未指定预计商品';
  const shown = items.slice(0, max).map((item) => `${item.sku}×${item.expectedQuantity}`);
  return items.length > max ? `${shown.join('、')} 等 ${items.length} 项` : shown.join('、');
}
/** Local display time; timestamps are stored in UTC and rendered in the browser time zone. */
export function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN');
}
