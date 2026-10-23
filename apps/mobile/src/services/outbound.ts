import type { InventoryBalanceData, OutboundOrderData } from '@caicang/api-contract';
import { ApiFailure, type ApiClient, type MobileStorage } from '../api/client';
// 复用入库流程已经验证过的 UUID 兜底：App 的 WebView 里不保证有 crypto.randomUUID。
import { newOperationId } from './receiving';

/** 与后端 CreateOutboundOrderDto / ShipOutboundOrderDto 的限制保持一致。 */
export const MAX_LINES = 100;
export const MAX_QUANTITY = 2147483647;
export const MAX_NAME_LENGTH = 100;
export const MAX_PHONE_LENGTH = 50;
export const MAX_ADDRESS_LENGTH = 500;
export const MAX_CARRIER_LENGTH = 40;
export const MAX_TRACKING_LENGTH = 128;
export const MAX_REMARK_LENGTH = 2000;
export const OUTBOUND_PENDING_KEY = 'caicang.mobile.outbound-pending.v1';

export type OutboundInputCode =
  | 'NO_WAREHOUSE'
  | 'NO_LINES'
  | 'INVALID_QUANTITY'
  | 'TOO_MANY_LINES'
  | 'MISSING_RECIPIENT'
  | 'INVALID_PHONE'
  | 'TOO_LONG';

export class OutboundInputError extends Error {
  readonly code: OutboundInputCode;
  readonly field?: string;

  constructor(code: OutboundInputCode, message: string, field?: string) {
    super(message);
    this.name = 'OutboundInputError';
    this.code = code;
    this.field = field;
  }
}

/** 待出库的一行：数量只是"这次想发多少"，可用数量是服务端上一次告诉我们的值。 */
export interface OutboundLine {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  availableQuantity: number;
}

export interface OutboundRecipient {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
}

export interface OutboundDraft {
  warehouseId: string;
  items: { productId: string; quantity: number }[];
  recipient: OutboundRecipient;
  carrierCode: string | null;
  trackingNo: string | null;
  remark: string | null;
}

/** 数量必须是 1 起的整数：小数、负号、科学计数法在这里就挡下。 */
export function parseQuantity(raw: string | number | null | undefined): number {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 1 || raw > MAX_QUANTITY)
      throw new OutboundInputError(
        'INVALID_QUANTITY',
        '发货数量须为 1 到 ' + MAX_QUANTITY + ' 的整数',
      );
    return raw;
  }
  const text = String(raw ?? '').trim();
  if (!text) throw new OutboundInputError('INVALID_QUANTITY', '请填写发货数量');
  if (!/^\d+$/.test(text))
    throw new OutboundInputError('INVALID_QUANTITY', '发货数量只能填整数，不能带小数点或负号');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_QUANTITY)
    throw new OutboundInputError('INVALID_QUANTITY', '发货数量超出可录入范围');
  return value;
}

/**
 * 扫到同一个商品就累加待发数量，而不是新增一行 —— 但累加只发生在内存里，
 * 数据库库存只有在确认发货的事务里才会减少。
 */
export function addOrIncrementLine(
  lines: readonly OutboundLine[],
  row: InventoryBalanceData,
): OutboundLine[] {
  const existing = lines.find((line) => line.productId === row.productId);
  if (existing) {
    const next = Math.min(existing.quantity + 1, MAX_QUANTITY);
    return lines.map((line) =>
      line.productId === row.productId
        ? { ...line, quantity: next, availableQuantity: row.quantityOnHand }
        : line,
    );
  }
  if (lines.length >= MAX_LINES)
    throw new OutboundInputError('TOO_MANY_LINES', '一张出库单最多 ' + MAX_LINES + ' 个商品');
  return [
    ...lines,
    {
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      unit: row.unit,
      quantity: 1,
      availableQuantity: row.quantityOnHand,
    },
  ];
}

export function setLineQuantity(
  lines: readonly OutboundLine[],
  productId: string,
  raw: string | number,
): OutboundLine[] {
  const quantity = parseQuantity(raw);
  return lines.map((line) => (line.productId === productId ? { ...line, quantity } : line));
}

export function stepLineQuantity(
  lines: readonly OutboundLine[],
  productId: string,
  delta: number,
): OutboundLine[] {
  return lines.map((line) => {
    if (line.productId !== productId) return line;
    const next = Math.max(1, Math.min(line.quantity + delta, MAX_QUANTITY));
    return { ...line, quantity: next };
  });
}

export function removeLine(lines: readonly OutboundLine[], productId: string): OutboundLine[] {
  return lines.filter((line) => line.productId !== productId);
}

export function linesTotalQuantity(lines: readonly OutboundLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/** 超过"上次查到的可用库存"的行；只用于提示，最终以发货事务为准。 */
export function overStockLines(lines: readonly OutboundLine[]): OutboundLine[] {
  return lines.filter((line) => line.quantity > line.availableQuantity);
}

/** 用手输搜索的结果补一行：可用数量取该仓库的余额行。 */
export function lineFromBalance(row: InventoryBalanceData, quantity: number = 1): OutboundLine {
  return {
    productId: row.productId,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    quantity: parseQuantity(quantity),
    availableQuantity: row.quantityOnHand,
  };
}

export function canShip(lines: readonly OutboundLine[]): boolean {
  return (
    lines.length > 0 && lines.every((line) => line.quantity >= 1 && line.quantity <= MAX_QUANTITY)
  );
}

export function recipientMissing(recipient: Partial<OutboundRecipient>): string[] {
  const missing: string[] = [];
  if (!String(recipient.customerName ?? '').trim()) missing.push('收件人');
  if (!String(recipient.customerPhone ?? '').trim()) missing.push('联系电话');
  if (!String(recipient.customerAddress ?? '').trim()) missing.push('收件地址');
  return missing;
}

/** 与服务端 DTO 同一套宽松校验：允许区号、空格、连字符，但必须含数字。 */
export function phoneProblem(phone: string): string | null {
  const text = phone.trim();
  if (!text) return null;
  if (text.length > MAX_PHONE_LENGTH) return '联系电话不能超过 ' + MAX_PHONE_LENGTH + ' 个字符';
  if (!/^[0-9+\-() ]+$/.test(text)) return '联系电话只能包含数字、空格、+、- 与括号';
  if (!/\d/.test(text)) return '联系电话至少要有一个数字';
  return null;
}

/**
 * 组装提交给 POST /outbound-orders 的内容。
 * 数量、成本、单号一律由服务端生成，这里只放"要发什么、发给谁"。
 */
export function buildOutboundDraft(input: {
  warehouseId: string;
  lines: readonly OutboundLine[];
  recipient: Partial<OutboundRecipient>;
  carrierCode?: string | null;
  trackingNo?: string | null;
  remark?: string | null;
  /** 草稿阶段允许没有收件信息；确认发货前必须补齐。 */
  requireRecipient?: boolean;
}): OutboundDraft {
  const warehouseId = String(input.warehouseId ?? '').trim();
  if (!warehouseId) throw new OutboundInputError('NO_WAREHOUSE', '请先选择发货仓库', 'warehouseId');
  if (input.lines.length === 0)
    throw new OutboundInputError('NO_LINES', '请至少扫描或搜索一个商品', 'lines');
  if (input.lines.length > MAX_LINES)
    throw new OutboundInputError('TOO_MANY_LINES', '一张出库单最多 ' + MAX_LINES + ' 个商品');

  const seen = new Set<string>();
  const items = input.lines.map((line) => {
    const key = line.productId.toLowerCase();
    if (seen.has(key))
      throw new OutboundInputError('NO_LINES', '同一商品出现了两行，请合并数量', 'lines');
    seen.add(key);
    return { productId: line.productId, quantity: parseQuantity(line.quantity) };
  });
  // 稳定排序：同样的商品与数量，无论扫码顺序如何，都得到同一份请求内容。
  items.sort((left, right) => left.productId.localeCompare(right.productId));

  const recipient: OutboundRecipient = {
    customerName: String(input.recipient.customerName ?? '').trim(),
    customerPhone: String(input.recipient.customerPhone ?? '').trim(),
    customerAddress: String(input.recipient.customerAddress ?? '').trim(),
  };
  if (input.requireRecipient) {
    const missing = recipientMissing(recipient);
    if (missing.length)
      throw new OutboundInputError(
        'MISSING_RECIPIENT',
        '请先填写' + missing.join('、'),
        missing[0],
      );
  }
  const phone = phoneProblem(recipient.customerPhone);
  if (phone) throw new OutboundInputError('INVALID_PHONE', phone, 'customerPhone');
  if (recipient.customerName.length > MAX_NAME_LENGTH)
    throw new OutboundInputError('TOO_LONG', '收件人不能超过 ' + MAX_NAME_LENGTH + ' 个字');
  if (recipient.customerAddress.length > MAX_ADDRESS_LENGTH)
    throw new OutboundInputError('TOO_LONG', '收件地址不能超过 ' + MAX_ADDRESS_LENGTH + ' 个字');

  const carrierCode = String(input.carrierCode ?? '').trim();
  if (carrierCode.length > MAX_CARRIER_LENGTH)
    throw new OutboundInputError('TOO_LONG', '快递公司不能超过 ' + MAX_CARRIER_LENGTH + ' 个字');
  const trackingNo = String(input.trackingNo ?? '').trim();
  if (trackingNo.length > MAX_TRACKING_LENGTH)
    throw new OutboundInputError('TOO_LONG', '运单号不能超过 ' + MAX_TRACKING_LENGTH + ' 个字符');
  const remark = String(input.remark ?? '').trim();
  if (remark.length > MAX_REMARK_LENGTH)
    throw new OutboundInputError('TOO_LONG', '备注不能超过 ' + MAX_REMARK_LENGTH + ' 个字');

  return {
    warehouseId,
    items,
    recipient,
    carrierCode: carrierCode || null,
    trackingNo: trackingNo || null,
    remark: remark || null,
  };
}

export function createDraftBody(draft: OutboundDraft): Record<string, unknown> {
  return {
    warehouseId: draft.warehouseId,
    items: draft.items,
    ...(draft.recipient.customerName ? { customerName: draft.recipient.customerName } : {}),
    ...(draft.recipient.customerPhone ? { customerPhone: draft.recipient.customerPhone } : {}),
    ...(draft.recipient.customerAddress
      ? { customerAddress: draft.recipient.customerAddress }
      : {}),
    ...(draft.carrierCode ? { carrierCode: draft.carrierCode } : {}),
    ...(draft.trackingNo ? { trackingNo: draft.trackingNo } : {}),
    ...(draft.remark ? { remark: draft.remark } : {}),
  };
}

export async function saveOutboundDraft(
  api: ApiClient,
  draft: OutboundDraft,
  options: { orderId?: string; tenantId?: string } = {},
): Promise<OutboundOrderData> {
  const body = createDraftBody(draft);
  const path = options.orderId
    ? '/outbound-orders/' + encodeURIComponent(options.orderId)
    : '/outbound-orders';
  const response = await api.request<OutboundOrderData>(path, {
    method: options.orderId ? 'PATCH' : 'POST',
    tenantId: options.tenantId,
    body,
  });
  return response.data;
}

export interface ShipPayload {
  carrierCode?: string;
  trackingNo?: string;
  remark?: string;
}

/**
 * 发货指纹：单号 + 快递公司 + 运单号 + 备注。
 * 只要这四项没变，就说明是"同一次发货的重试"，必须复用同一个 clientOperationId。
 */
export function shipFingerprint(orderId: string, payload: ShipPayload): string {
  return JSON.stringify([
    orderId.toLowerCase(),
    payload.carrierCode?.trim() || null,
    payload.trackingNo?.trim() || null,
    payload.remark?.trim() || null,
  ]);
}

export interface PendingShipment {
  operationId: string;
  fingerprint: string;
  orderId: string;
  attempts: number;
  updatedAt: number;
  lastError?: string;
}

interface PendingState {
  ops: Record<string, PendingShipment>;
}

export interface ShipOutcome {
  order: OutboundOrderData;
  operationId: string;
  /** true 表示复用了上一次未确认的 UUID（网络重试 / 上次其实已成功）。 */
  reused: boolean;
  attempts: number;
}

/**
 * 发货一次性闸门：
 * - 同单同物流信息 → 复用原 UUID，网络失败重试不会二次扣库存；
 * - 服务端明确拒绝（库存不足、状态冲突）→ 丢掉 UUID，改完数量重新发就是新操作；
 * - 记录写进本地存储，App 被杀掉重开后仍能复用，不会把"结果未知"变成"重复扣减"。
 */
export class OutboundShipSubmitting {
  private readonly api: ApiClient;
  private readonly storage: MobileStorage;
  private readonly now: () => number;
  private readonly uuid: () => string;

  constructor(
    api: ApiClient,
    storage: MobileStorage,
    options: { now?: () => number; uuid?: () => string } = {},
  ) {
    this.api = api;
    this.storage = storage;
    this.now = options.now ?? (() => Date.now());
    this.uuid = options.uuid ?? newOperationId;
  }

  pendingFor(orderId: string): PendingShipment | null {
    return this.readState().ops[orderId] ?? null;
  }

  discard(orderId: string): void {
    const state = this.readState();
    if (!(orderId in state.ops)) return;
    delete state.ops[orderId];
    this.writeState(state);
  }

  async submit(orderId: string, payload: ShipPayload, tenantId?: string): Promise<ShipOutcome> {
    const fingerprint = shipFingerprint(orderId, payload);
    const state = this.readState();
    const previous = state.ops[orderId];
    const reused = previous !== undefined && previous.fingerprint === fingerprint;
    const operationId = reused ? previous.operationId : this.uuid();
    const attempts = reused ? previous.attempts + 1 : 1;
    // 先落盘再发请求：请求途中进程被杀，下次也用同一个 UUID 继续。
    state.ops[orderId] = {
      operationId,
      fingerprint,
      orderId,
      attempts,
      updatedAt: this.now(),
    };
    this.writeState(state);

    try {
      const response = await this.api.request<OutboundOrderData>(
        '/outbound-orders/' + encodeURIComponent(orderId) + '/ship',
        {
          method: 'POST',
          tenantId,
          body: { clientOperationId: operationId, ...payload },
        },
      );
      this.discard(orderId);
      return { order: response.data, operationId, reused, attempts };
    } catch (error) {
      const info = describeShipFailure(error);
      if (info.rejected) this.discard(orderId);
      else {
        const latest = this.readState();
        const record = latest.ops[orderId];
        if (record) {
          record.lastError = info.message;
          record.updatedAt = this.now();
          latest.ops[orderId] = record;
          this.writeState(latest);
        }
      }
      throw error;
    }
  }

  private readState(): PendingState {
    try {
      const parsed: unknown = JSON.parse(this.storage.getItem(OUTBOUND_PENDING_KEY) ?? 'null');
      if (parsed && typeof parsed === 'object') {
        const ops = (parsed as PendingState).ops;
        if (ops && typeof ops === 'object') return { ops };
      }
    } catch {
      /* 本地记录损坏时按空处理：重新生成 UUID 比让用户卡住更安全。 */
    }
    return { ops: {} };
  }

  private writeState(state: PendingState): void {
    this.storage.setItem(OUTBOUND_PENDING_KEY, JSON.stringify(state));
  }
}

export interface ShipFailureInfo {
  code: string;
  status: number;
  title: string;
  message: string;
  /** 服务端明确没有扣库存（4xx 业务拒绝）。 */
  rejected: boolean;
  /** 网络中断或结果未知：可能已经扣了，必须复用 UUID 重试。 */
  unconfirmed: boolean;
  retryable: boolean;
  /** 需要用户改数量/补资料，改完再发是另一次操作。 */
  needsEdit: boolean;
  shortages: {
    productId: string;
    sku: string;
    requestedQuantity: number;
    availableQuantity: number;
  }[];
}

function readShortages(details: Record<string, unknown> | undefined) {
  const raw = details?.shortages;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (row): row is Record<string, unknown> =>
        !!row &&
        typeof row === 'object' &&
        typeof (row as Record<string, unknown>).sku === 'string',
    )
    .map((row) => ({
      productId: String(row.productId ?? ''),
      sku: String(row.sku),
      requestedQuantity: Number(row.requestedQuantity ?? 0),
      availableQuantity: Number(row.availableQuantity ?? 0),
    }));
}

/** 把服务端错误翻成仓库同事看得懂的一句话，并说清"库存到底有没有变"。 */
export function describeShipFailure(error: unknown): ShipFailureInfo {
  const base = {
    code: 'UNKNOWN',
    status: 0,
    title: '发货失败',
    message: '未知错误，请重试',
    rejected: false,
    unconfirmed: true,
    retryable: true,
    needsEdit: false,
    shortages: [] as ShipFailureInfo['shortages'],
  };
  if (!(error instanceof ApiFailure))
    return {
      ...base,
      message: error instanceof Error ? error.message : '未知错误，请重试',
    };

  const details = (error.details ?? {}) as Record<string, unknown>;
  const code = error.code;
  if (error.status === 0 || code === 'NETWORK_ERROR')
    return {
      ...base,
      code,
      title: '未确认发货结果',
      message:
        '网络中断，本次发货结果未知。App 不会提前扣库存；恢复网络后点「重试发货」会复用同一操作号，服务端只会扣一次。',
      unconfirmed: true,
    };
  if (code === 'OUT_OF_STOCK') {
    const shortages = readShortages(details);
    const detail = shortages
      .map(
        (row) =>
          row.sku + ' 需要 ' + row.requestedQuantity + ' 件、可用 ' + row.availableQuantity + ' 件',
      )
      .join('；');
    return {
      ...base,
      code,
      status: error.status,
      title: '库存不足，未发货',
      message:
        '库存不足，本次没有扣减任何库存' +
        (detail ? '：' + detail : '') +
        '。请补货或减少发货数量后重新发货。',
      rejected: true,
      unconfirmed: false,
      retryable: true,
      needsEdit: true,
      shortages,
    };
  }
  if (code === 'STATUS_CONFLICT')
    return {
      ...base,
      code,
      status: error.status,
      title: '单据状态已变化',
      message:
        details.status === 'SHIPPED'
          ? '这张出库单已经发货，不能再次发货；库存没有被重复扣减。'
          : '这张出库单已取消或状态不允许发货，本次没有扣库存。',
      rejected: true,
      unconfirmed: false,
      retryable: false,
    };
  if (code === 'IDEMPOTENCY_CONFLICT')
    return {
      ...base,
      code,
      status: error.status,
      title: '操作号与内容不一致',
      message: '同一次发货的操作号被用在了不同的物流信息上，本次未扣库存。请重新确认发货。',
      rejected: true,
      unconfirmed: false,
      retryable: false,
      needsEdit: true,
    };
  if (error.status === 403 || code === 'FORBIDDEN')
    return {
      ...base,
      code,
      status: error.status,
      title: '没有出库权限',
      message: '当前账号在当前商家没有「扫码出库」权限，请联系管理员。',
      rejected: true,
      unconfirmed: false,
      retryable: false,
    };
  if (code === 'NOT_FOUND')
    return {
      ...base,
      code,
      status: error.status,
      title: '出库单不存在',
      message: '这张出库单不存在或不属于当前商家，本次未扣库存。',
      rejected: true,
      unconfirmed: false,
      retryable: false,
    };
  if (
    error.status === 422 ||
    error.status === 400 ||
    code === 'BUSINESS_VALIDATION_FAILED' ||
    code === 'VALIDATION_ERROR'
  )
    return {
      ...base,
      code,
      status: error.status,
      title: '提交内容不符合要求',
      message: error.message + '。本次未扣库存，请检查后重试。',
      rejected: true,
      unconfirmed: false,
      retryable: false,
      needsEdit: true,
    };
  return {
    ...base,
    code,
    status: error.status,
    title: '发货失败',
    message: error.message + '（错误码 ' + code + '）。本次未确认是否扣减，请重试。',
    rejected: error.status > 0 && error.status < 500,
    unconfirmed: error.status >= 500 || error.status === 0,
  };
}

/** 常用快递公司；服务端只按字符串保存 carrierCode，所以这里只是选项，不是白名单。 */
export const CARRIERS = [
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
  return CARRIERS.find((row) => row.code === code)?.name ?? code;
}

/** 出库单在页面上的一句话状态。 */
export function outboundStatusText(status: string): string {
  if (status === 'SHIPPED') return '已发货';
  if (status === 'CANCELLED') return '已取消';
  return '待发货';
}
