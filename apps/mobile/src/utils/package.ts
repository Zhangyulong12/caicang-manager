import type { PackageReceivingStatus, PackageStatus, PurchaseStatus } from '@caicang/api-contract';

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

export const purchaseStatusNames: Record<PurchaseStatus, string> = {
  DRAFT: '草稿',
  PLACED: '已下单',
  PARTIAL_RECEIVED: '部分入库',
  RECEIVED: '已入库',
  CANCELLED: '已取消',
};

/** 手机端只做展示，时间按设备本地时区渲染。 */
export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (input: number) => String(input).padStart(2, '0');
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  );
}

export function packageTone(status: PackageStatus): string {
  if (status === 'RECEIVED') return 'ok';
  if (status === 'PARTIAL_RECEIVED' || status === 'ARRIVED') return 'warn';
  if (status === 'EXCEPTION') return 'danger';
  return 'info';
}
