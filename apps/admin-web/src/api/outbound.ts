import type {
  ApiPageResponse,
  ApiResponse,
  InventoryBalanceData,
  OutboundItemData,
  OutboundOrderData,
  OutboundStatus,
} from '@caicang/api-contract';
import type { CatalogClient, CatalogScope } from './catalog';
import { ApiFailure } from './client';
import { checkPaging } from './inventory';

/** 出库单查询与写入。库存数量永远由服务端的发货事务改，这里不做任何本地扣减。 */
export interface OutboundListQuery {
  page: number;
  pageSize: number;
  warehouseId?: string;
  status?: OutboundStatus;
  search?: string;
  from?: string;
  to?: string;
  productId?: string;
}
export interface OutboundLinePayload {
  productId: string;
  quantity: number;
}
export interface OutboundPayload {
  warehouseId: string;
  items: OutboundLinePayload[];
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  carrierCode?: string;
  trackingNo?: string;
  remark?: string;
}
export interface ShipPayload {
  clientOperationId: string;
  carrierCode?: string;
  trackingNo?: string;
  remark?: string;
}

export function createOutbound(client: CatalogClient, scope: () => CatalogScope | null) {
  function capture(permission: 'products:read' | 'outbound:write') {
    const current = scope();
    if (!current || !current.permissions.includes(permission))
      throw new ApiFailure(
        403,
        'FORBIDDEN',
        permission === 'outbound:write'
          ? '当前角色没有发货与出库权限'
          : '当前角色没有查看出库单的权限',
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
    permission: 'products:read' | 'outbound:write',
    init: { method?: string; body?: unknown } = {},
  ) {
    const current = capture(permission);
    const result = await client.request<T>(path, { ...init, tenantId: current.tenantId });
    check(current);
    return result;
  }
  return {
    async list(query: OutboundListQuery) {
      checkPaging(query.page, query.pageSize);
      const search = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      for (const key of ['warehouseId', 'status', 'search', 'from', 'to', 'productId'] as const) {
        const value = query[key];
        if (typeof value === 'string' && value.trim()) search.set(key, value.trim());
      }
      return (await request<OutboundOrderData[]>(
        '/outbound-orders?' + search,
        'products:read',
      )) as ApiPageResponse<OutboundOrderData>;
    },
    async detail(id: string) {
      const result = (await request<OutboundOrderData>(
        '/outbound-orders/' + encodeURIComponent(id),
        'products:read',
      )) as ApiResponse<OutboundOrderData>;
      return result.data;
    },
    async create(payload: OutboundPayload) {
      const result = (await request<OutboundOrderData>('/outbound-orders', 'outbound:write', {
        method: 'POST',
        body: payload,
      })) as ApiResponse<OutboundOrderData>;
      return result.data;
    },
    async update(id: string, payload: OutboundPayload) {
      const result = (await request<OutboundOrderData>(
        '/outbound-orders/' + encodeURIComponent(id),
        'outbound:write',
        { method: 'PATCH', body: payload },
      )) as ApiResponse<OutboundOrderData>;
      return result.data;
    },
    async ship(id: string, payload: ShipPayload) {
      // 201 首次发货、200 幂等重放，两种都是成功；库存是否真的变了以返回的单据为准。
      const result = (await request<OutboundOrderData>(
        '/outbound-orders/' + encodeURIComponent(id) + '/ship',
        'outbound:write',
        { method: 'POST', body: payload },
      )) as ApiResponse<OutboundOrderData>;
      return result.data;
    },
    async cancel(id: string) {
      const result = (await request<{ cancelled: boolean; order: OutboundOrderData }>(
        '/outbound-orders/' + encodeURIComponent(id) + '/cancel',
        'outbound:write',
        { method: 'POST' },
      )) as ApiResponse<{ cancelled: boolean; order: OutboundOrderData }>;
      return result.data;
    },
  };
}

export const outboundStatusNames: Record<OutboundStatus, string> = {
  DRAFT: '待发货',
  SHIPPED: '已发货',
  CANCELLED: '已取消',
};
export function outboundStatusLabel(value: string): string {
  return outboundStatusNames[value as OutboundStatus] ?? value;
}
export function outboundStatusTone(value: string): 'warning' | 'success' | 'info' {
  if (value === 'SHIPPED') return 'success';
  if (value === 'CANCELLED') return 'info';
  return 'warning';
}

/** 常见快递公司；选择器只决定 carrierCode，服务端按字符串原样保存。 */
export const outboundCarriers = [
  { code: 'SF', name: '顺丰速运' },
  { code: 'YTO', name: '圆通速递' },
  { code: 'ZTO', name: '中通快递' },
  { code: 'STO', name: '申通快递' },
  { code: 'YD', name: '韵达速递' },
  { code: 'JD', name: '京东物流' },
  { code: 'EMS', name: '中国邮政 EMS' },
  { code: 'JTSD', name: '极兔速递' },
  { code: 'DBL', name: '德邦快递' },
  { code: 'OTHER', name: '其他 / 自送' },
] as const;
export function carrierName(code: string | null | undefined): string {
  if (!code) return '未填写';
  return outboundCarriers.find((row) => row.code === code)?.name ?? code;
}

/** 表单行：可用库存来自服务端，仅用于提示与先手拦截，最终以发货事务为准。 */
export interface OutboundLineForm {
  key: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  availableQuantity: number;
}
export interface OutboundForm {
  warehouseId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  carrierCode: string;
  trackingNo: string;
  remark: string;
  items: OutboundLineForm[];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\p{Cc}\p{Cs}]/u;

export function blankOutbound(): OutboundForm {
  return {
    warehouseId: '',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    carrierCode: 'SF',
    trackingNo: '',
    remark: '',
    items: [],
  };
}
/** 从库存余额行生成明细行：可用数量读服务端字段，不在前端推算。 */
export function outboundLineFromBalance(row: InventoryBalanceData): OutboundLineForm {
  return {
    key: crypto.randomUUID(),
    productId: row.productId,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    quantity: '1',
    availableQuantity: row.quantityOnHand,
  };
}
export function outboundForm(order: OutboundOrderData): OutboundForm {
  return {
    warehouseId: order.warehouseId,
    customerName: order.customerName ?? '',
    customerPhone: order.customerPhone ?? '',
    customerAddress: order.customerAddress ?? '',
    carrierCode: order.carrierCode ?? '',
    trackingNo: order.trackingNo ?? '',
    remark: order.remark ?? '',
    items: order.items.map((row: OutboundItemData) => ({
      key: row.id,
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      unit: row.unit,
      quantity: String(row.quantity),
      availableQuantity: row.availableQuantity,
    })),
  };
}

function textProblem(value: string, label: string, max: number, allowNewlines = false): string {
  if ([...value].length > max) return `${label}最多 ${max} 字`;
  if (value.includes('\u0000')) return `${label}不能包含空字符`;
  if (!allowNewlines && CONTROL.test(value)) return `${label}不能包含控制字符`;
  return '';
}

/** 本地校验只挡明显的输入错误；能不能发货由服务端在事务里判定。 */
export function outboundErrors(form: OutboundForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!UUID.test(form.warehouseId)) errors.warehouseId = '请选择发货仓库';
  const name = textProblem(form.customerName.trim(), '收件人', 100);
  if (name) errors.customerName = name;
  const phone = form.customerPhone.trim();
  if (phone && (!/^(?=.*\d)[0-9+\-() ]+$/.test(phone) || phone.length > 50))
    errors.customerPhone = '请输入有效联系电话，可含区号、空格与连字符';
  const address = textProblem(form.customerAddress.trim(), '收件地址', 500, true);
  if (address) errors.customerAddress = address;
  const carrier = textProblem(form.carrierCode.trim(), '快递公司', 40);
  if (carrier) errors.carrierCode = carrier;
  const tracking = textProblem(form.trackingNo.trim(), '发货运单号', 128);
  if (tracking) errors.trackingNo = tracking;
  const remark = textProblem(form.remark.trim(), '备注', 2000, true);
  if (remark) errors.remark = remark;
  if (!form.items.length || form.items.length > 100) errors.items = '请添加 1–100 个商品 SKU';
  const seen = new Set<string>();
  form.items.forEach((row, index) => {
    const prefix = `items.${index}.`;
    if (!UUID.test(row.productId) || seen.has(row.productId.toLowerCase()))
      errors[prefix + 'productId'] = '请选择不同的有效商品';
    seen.add(row.productId.toLowerCase());
    if (!/^[1-9]\d{0,9}$/.test(row.quantity) || BigInt(row.quantity) > 2147483647n)
      errors[prefix + 'quantity'] = '数量须为 1–2147483647 的整数';
  });
  return errors;
}

/** 只提交用户填写的业务字段；空字符串不发，避免把"未填"写成空串。 */
export function outboundPayload(form: OutboundForm): OutboundPayload {
  const optional = (value: string) => {
    const text = value.trim();
    return text ? text : undefined;
  };
  const payload: OutboundPayload = {
    warehouseId: form.warehouseId,
    items: form.items.map((row) => ({
      productId: row.productId,
      quantity: Number(row.quantity),
    })),
  };
  for (const [key, value] of [
    ['customerName', form.customerName],
    ['customerPhone', form.customerPhone],
    ['customerAddress', form.customerAddress],
    ['carrierCode', form.carrierCode],
    ['trackingNo', form.trackingNo],
    ['remark', form.remark],
  ] as const) {
    const text = optional(value);
    if (text) payload[key] = text;
  }
  return payload;
}

/** 收件信息不全时不允许发货——服务端也会拒绝，这里提前说明原因。 */
export function recipientMissing(form: {
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
}): string[] {
  const missing: string[] = [];
  if (!form.customerName?.trim()) missing.push('收件人');
  if (!form.customerPhone?.trim()) missing.push('联系电话');
  if (!form.customerAddress?.trim()) missing.push('收件地址');
  return missing;
}

export interface OutboundShortage {
  productId: string;
  sku: string;
  requestedQuantity: number;
  availableQuantity: number;
}
function isShortage(value: unknown): value is OutboundShortage {
  const row = value as OutboundShortage | null;
  return (
    !!row &&
    typeof row.sku === 'string' &&
    Number.isInteger(row.requestedQuantity) &&
    Number.isInteger(row.availableQuantity)
  );
}
/** 服务端 409 OUT_OF_STOCK 的结构化原因；其他错误返回空数组。 */
export function shortagesOf(error: unknown): OutboundShortage[] {
  if (!(error instanceof ApiFailure) || error.code !== 'OUT_OF_STOCK') return [];
  const raw = error.details.shortages;
  return Array.isArray(raw) ? raw.filter(isShortage) : [];
}
/** 把服务端错误翻译成页面能直接展示的一句话，库存不足时逐 SKU 说明差多少。 */
export function outboundFailureText(error: unknown): string {
  if (!(error instanceof ApiFailure)) return '操作未完成，请稍后重试';
  const requestId = error.requestId ? `（请求编号 ${error.requestId}）` : '';
  const shortages = shortagesOf(error);
  if (shortages.length) {
    const detail = shortages
      .map((row) => `${row.sku} 需要 ${row.requestedQuantity} 件、可用 ${row.availableQuantity} 件`)
      .join('；');
    return `库存不足，未扣减任何库存：${detail}。请调整数量或先补货。${requestId}`;
  }
  if (error.code === 'STATUS_CONFLICT') return `单据状态已变化，请刷新后再操作。${requestId}`;
  if (error.code === 'IDEMPOTENCY_CONFLICT')
    return `本次发货的操作号与之前不一致，请刷新页面后重新确认。${requestId}`;
  return error.message + requestId;
}

/** 发货请求的指纹：内容变了就要换新的操作号，否则会被判成幂等冲突。 */
export function shipFingerprint(orderId: string, body: Omit<ShipPayload, 'clientOperationId'>) {
  return JSON.stringify([
    orderId.toLowerCase(),
    body.carrierCode?.trim() ?? null,
    body.trackingNo?.trim() ?? null,
    body.remark?.trim() ?? null,
  ]);
}

/** 页面提示用：本次要发多少、还差多少。不参与任何库存计算。 */
export function lineShortage(row: OutboundLineForm): boolean {
  const quantity = /^[1-9]\d{0,9}$/.test(row.quantity) ? Number(row.quantity) : 0;
  return quantity > row.availableQuantity;
}
