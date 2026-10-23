import type {
  PackageReceivableData,
  PackageReceivableLineData,
  ReceiptData,
} from '@caicang/api-contract';
import { ApiFailure, type ApiClient, type MobileStorage } from '../api/client';

/** 与后端 CreateReceiptDto 的约束保持一致。 */
export const MAX_REMARK_LENGTH = 2000;
export const MAX_RECEIVED_QTY = 2147483647;
export const PENDING_KEY = 'caicang.mobile.receipt-pending.v1';

export type ReceiptInputCode =
  'INVALID_PACKAGE' | 'INVALID_QTY' | 'EMPTY' | 'DUPLICATE_LINE' | 'REMARK_TOO_LONG';

export class ReceiptInputError extends Error {
  readonly code: ReceiptInputCode;
  readonly purchaseOrderItemId?: string;

  constructor(code: ReceiptInputCode, message: string, purchaseOrderItemId?: string) {
    super(message);
    this.name = 'ReceiptInputError';
    this.code = code;
    this.purchaseOrderItemId = purchaseOrderItemId;
  }
}

export interface DraftLine {
  purchaseOrderItemId: string;
  receivedQty: number;
}

export interface ReceiptDraft {
  packageId: string;
  items: DraftLine[];
  remark: string | null;
}

export interface DraftLineInput {
  purchaseOrderItemId: string;
  /** 输入框原值：空串表示这件商品本次没到货。 */
  quantity: string | number | null | undefined;
}

/**
 * 数量只接受非负整数：小数、负号、科学计数法都在这里挡下，避免服务端 422 才暴露。
 * 空值按 0 处理——"这一件没到"是正常业务，不是输入错误。
 */
export function parseQuantity(raw: string | number | null | undefined): number {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0 || raw > MAX_RECEIVED_QTY)
      throw new ReceiptInputError('INVALID_QTY', '数量只能是 0 到 ' + MAX_RECEIVED_QTY + ' 的整数');
    return raw;
  }
  const text = String(raw ?? '').trim();
  if (!text) return 0;
  if (!/^\d+$/.test(text))
    throw new ReceiptInputError('INVALID_QTY', '数量只能填写整数，不能带小数点或负号');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > MAX_RECEIVED_QTY)
    throw new ReceiptInputError('INVALID_QTY', '数量超出可录入范围');
  return value;
}

export function buildReceiptDraft(input: {
  packageId: string;
  lines: readonly DraftLineInput[];
  remark?: string | null;
}): ReceiptDraft {
  const packageId = String(input.packageId ?? '').trim();
  if (!packageId) throw new ReceiptInputError('INVALID_PACKAGE', '缺少包裹编号，请重新扫码');

  const seen = new Set<string>();
  const items: DraftLine[] = [];
  for (const line of input.lines) {
    const quantity = parseQuantity(line.quantity);
    if (quantity === 0) continue;
    const key = line.purchaseOrderItemId.toLowerCase();
    if (seen.has(key))
      throw new ReceiptInputError('DUPLICATE_LINE', '同一商品出现了两次，请刷新后重试', key);
    seen.add(key);
    items.push({ purchaseOrderItemId: line.purchaseOrderItemId, receivedQty: quantity });
  }
  if (items.length === 0) throw new ReceiptInputError('EMPTY', '请至少填写一个商品的本次到货数量');
  // 稳定排序：同样的数量组合无论输入顺序如何，都得到同一份请求内容。
  items.sort((left, right) =>
    left.purchaseOrderItemId.toLowerCase().localeCompare(right.purchaseOrderItemId.toLowerCase()),
  );

  const remark = String(input.remark ?? '').trim();
  if (remark.length > MAX_REMARK_LENGTH)
    throw new ReceiptInputError('REMARK_TOO_LONG', '备注不能超过 ' + MAX_REMARK_LENGTH + ' 个字');

  return { packageId, items, remark: remark || null };
}

/**
 * 与服务端 requestHash 完全相同的规范化口径：小写 ID、按 ID 排序、备注 trim。
 * 只要这份字符串不变，就说明"请求内容相同"，重试必须复用原 clientOperationId。
 */
export function draftFingerprint(draft: ReceiptDraft): string {
  return JSON.stringify({
    packageId: draft.packageId.toLowerCase(),
    items: draft.items
      .map((item) => ({
        purchaseOrderItemId: item.purchaseOrderItemId.toLowerCase(),
        receivedQty: item.receivedQty,
      }))
      .sort((left, right) => left.purchaseOrderItemId.localeCompare(right.purchaseOrderItemId)),
    remark: draft.remark?.trim() || null,
  });
}

/** App 端可能没有 crypto.randomUUID，兜底也要生成合法的 v4 UUID（后端 @IsUUID 会校验）。 */
export function newOperationId(): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function')
    return cryptoObject.randomUUID();
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20)
  );
}

export interface PendingOperation {
  operationId: string;
  fingerprint: string;
  payload: ReceiptDraft;
  attempts: number;
  updatedAt: number;
  lastError?: string;
}

interface PendingState {
  ops: Record<string, PendingOperation>;
}

export interface SubmitResult {
  receipt: ReceiptData;
  operationId: string;
  /** true 表示这次提交复用了上一次未完成的 UUID（幂等重试）。 */
  reused: boolean;
  attempts: number;
}

/**
 * 一次"收货提交"的幂等闸门：
 * - 同样的包裹 + 同样的数量 + 同样的备注 → 复用原 UUID，网络重试不会重复入库；
 * - 只要数量或备注变了 → 换新 UUID，服务端按新请求处理（改完再提交是另一次操作）；
 * - 待提交记录写进本地存储，App 被杀掉后重开仍能复用，不会把"结果未知"变成"重复入库"。
 */
export class ReceiptSubmitting {
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

  pendingFor(packageId: string): PendingOperation | null {
    return this.readState().ops[packageId] ?? null;
  }

  discard(packageId: string): void {
    const state = this.readState();
    if (!(packageId in state.ops)) return;
    delete state.ops[packageId];
    this.writeState(state);
  }

  async submit(draft: ReceiptDraft, tenantId?: string): Promise<SubmitResult> {
    const fingerprint = draftFingerprint(draft);
    const state = this.readState();
    const previous = state.ops[draft.packageId];
    const reused = previous !== undefined && previous.fingerprint === fingerprint;
    const operationId = reused ? previous.operationId : this.uuid();
    const attempts = reused ? previous.attempts + 1 : 1;
    // 先落盘再发请求：哪怕请求中途进程被杀，下次也用同一个 UUID 继续。
    state.ops[draft.packageId] = {
      operationId,
      fingerprint,
      payload: draft,
      attempts,
      updatedAt: this.now(),
    };
    this.writeState(state);

    try {
      const result = await this.api.request<ReceiptData>('/receipts', {
        method: 'POST',
        tenantId,
        body: {
          packageId: draft.packageId,
          clientOperationId: operationId,
          items: draft.items.map((item) => ({
            purchaseOrderItemId: item.purchaseOrderItemId,
            receivedQty: item.receivedQty,
          })),
          ...(draft.remark ? { remark: draft.remark } : {}),
        },
      });
      this.discard(draft.packageId);
      return { receipt: result.data, operationId, reused, attempts };
    } catch (error) {
      const info = describeReceiptFailure(error);
      if (info.rejected) {
        // 服务端明确拒绝（数量超限、状态冲突…）说明这次没有产生入库单，
        // 丢掉操作号，避免下次提交被误当成"未完成重试"。
        this.discard(draft.packageId);
      } else {
        const latest = this.readState();
        const record = latest.ops[draft.packageId];
        if (record) {
          record.lastError = info.message;
          record.updatedAt = this.now();
          latest.ops[draft.packageId] = record;
          this.writeState(latest);
        }
      }
      throw error;
    }
  }

  private readState(): PendingState {
    try {
      const parsed: unknown = JSON.parse(this.storage.getItem(PENDING_KEY) ?? 'null');
      if (parsed && typeof parsed === 'object') {
        const ops = (parsed as PendingState).ops;
        if (ops && typeof ops === 'object') return { ops };
      }
    } catch {
      /* 本地记录损坏时按空处理，重新生成 UUID 比卡住用户更安全。 */
    }
    return { ops: {} };
  }

  private writeState(state: PendingState): void {
    this.storage.setItem(PENDING_KEY, JSON.stringify(state));
  }
}

export interface ReceiptFailureInfo {
  code: string;
  status: number;
  title: string;
  message: string;
  /** 服务端明确没有写库存（4xx 业务拒绝 / 校验失败）。 */
  rejected: boolean;
  /** 网络中断或结果未知：可能已入库，必须复用 UUID 重试。 */
  unconfirmed: boolean;
  retryable: boolean;
  needsEdit: boolean;
}

const PURCHASE_STATUS_NAMES: Record<string, string> = {
  DRAFT: '草稿',
  PLACED: '已下单',
  PARTIAL_RECEIVED: '部分入库',
  RECEIVED: '已入库',
  CANCELLED: '已取消',
};

/** 把服务端错误码翻译成仓库同事看得懂的一句话，同时说清"库存有没有变"。 */
export function describeReceiptFailure(error: unknown): ReceiptFailureInfo {
  if (error instanceof ApiFailure) {
    const details = (error.details ?? {}) as Record<string, unknown>;
    const code = error.code;
    if (error.status === 0 || code === 'NETWORK_ERROR')
      return {
        code,
        status: 0,
        title: '未提交',
        message:
          '网络中断，本次收货没有确认成功。App 不会提前增加库存；恢复网络后点「重试」，会复用同一操作号，不会重复入库。',
        rejected: false,
        unconfirmed: true,
        retryable: true,
        needsEdit: false,
      };
    if (code === 'RECEIPT_QTY_EXCEEDED') {
      const max = details.maxReceivableQuantity;
      const scope = details.scope === 'PACKAGE' ? '本包裹' : '整张采购单';
      return {
        code,
        status: error.status,
        title: '数量超过可收上限',
        message:
          typeof max === 'number'
            ? '按' +
              scope +
              '剩余数量，这一项最多还能收 ' +
              max +
              ' 件。本次未入库，请调整数量后重试。'
            : '有商品超过可收数量，本次未入库。请刷新页面核对剩余数量后重试。',
        rejected: true,
        unconfirmed: false,
        retryable: false,
        needsEdit: true,
      };
    }
    if (code === 'STATUS_CONFLICT') {
      if (details.receivingClosed === true)
        return {
          code,
          status: error.status,
          title: '包裹已验收完成',
          message: '这个包裹已经关闭验收，不能再入库。本次未写入任何库存。',
          rejected: true,
          unconfirmed: false,
          retryable: false,
          needsEdit: false,
        };
      const status = typeof details.purchaseStatus === 'string' ? details.purchaseStatus : '';
      return {
        code,
        status: error.status,
        title: '采购单状态不允许收货',
        message: status
          ? '采购单当前状态为「' + (PURCHASE_STATUS_NAMES[status] ?? status) + '」，不能入库。'
          : '当前状态不允许此操作，本次未写入任何库存。',
        rejected: true,
        unconfirmed: false,
        retryable: false,
        needsEdit: false,
      };
    }
    if (code === 'IDEMPOTENCY_CONFLICT')
      return {
        code,
        status: error.status,
        title: '操作号与请求内容不一致',
        message: '同一次提交的操作号被用在了不同的数量上，本次未入库。请返回重新填写后再提交。',
        rejected: true,
        unconfirmed: false,
        retryable: false,
        needsEdit: true,
      };
    if (code === 'NOT_FOUND')
      return {
        code,
        status: error.status,
        title: '包裹不存在',
        message: '这个包裹不存在或不属于当前商家，本次未入库。',
        rejected: true,
        unconfirmed: false,
        retryable: false,
        needsEdit: false,
      };
    if (error.status === 403 || code === 'FORBIDDEN')
      return {
        code,
        status: error.status,
        title: '没有收货权限',
        message: '当前账号在当前商家没有「确认收货」权限，请联系管理员。',
        rejected: true,
        unconfirmed: false,
        retryable: false,
        needsEdit: false,
      };
    if (
      error.status === 422 ||
      code === 'BUSINESS_VALIDATION_FAILED' ||
      code === 'VALIDATION_FAILED'
    )
      return {
        code,
        status: error.status,
        title: '提交内容不符合要求',
        message: error.message + '。本次未入库，请检查数量后重试。',
        rejected: true,
        unconfirmed: false,
        retryable: false,
        needsEdit: true,
      };
    return {
      code,
      status: error.status,
      title: '提交失败',
      message: error.message + '（错误码 ' + code + '）。本次未确认入库，请重试。',
      rejected: error.status > 0 && error.status < 500,
      unconfirmed: error.status >= 500,
      retryable: true,
      needsEdit: false,
    };
  }
  return {
    code: 'UNKNOWN',
    status: 0,
    title: '提交失败',
    message: error instanceof Error ? error.message : '未知错误，请重试',
    rejected: false,
    unconfirmed: true,
    retryable: true,
    needsEdit: false,
  };
}

export interface ReceivableRow {
  purchaseOrderItemId: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  orderedQuantity: number;
  receivedQuantity: number;
  orderRemainingQuantity: number;
  inPackagePlan: boolean;
  expectedQuantity: number | null;
  packageReceivedQuantity: number;
  packageRemainingQuantity: number | null;
  maxReceivableQuantity: number;
  /** 输入框默认值：能收多少就带多少，仓库同事改成实际到货数即可。 */
  suggestedQuantity: number;
}

/** 把可收明细拍平成页面要渲染的行，并算好默认数量。 */
export function toReceivableRows(data: PackageReceivableData): ReceivableRow[] {
  return data.lines.map((line: PackageReceivableLineData) => ({
    purchaseOrderItemId: line.purchaseOrderItemId,
    productId: line.productId,
    sku: line.sku,
    name: line.name,
    unit: line.unit,
    orderedQuantity: line.orderedQuantity,
    receivedQuantity: line.receivedQuantity,
    orderRemainingQuantity: line.orderRemainingQuantity,
    inPackagePlan: line.inPackagePlan,
    expectedQuantity: line.expectedQuantity,
    packageReceivedQuantity: line.packageReceivedQuantity,
    packageRemainingQuantity: line.packageRemainingQuantity,
    maxReceivableQuantity: line.maxReceivableQuantity,
    suggestedQuantity: line.maxReceivableQuantity,
  }));
}

/** 包裹或采购单已经不能收货时，页面直接给结论，而不是让用户填完才报错。 */
export function receivingBlockedReason(data: PackageReceivableData): string | null {
  if (
    data.receivingClosed ||
    data.receivingStatus === 'RECEIVED' ||
    data.packageStatus === 'RECEIVED'
  )
    return '这个包裹已经完成验收，不能再入库。';
  if (data.purchaseStatus !== 'PLACED' && data.purchaseStatus !== 'PARTIAL_RECEIVED')
    return (
      '采购单当前状态为「' +
      (PURCHASE_STATUS_NAMES[data.purchaseStatus] ?? data.purchaseStatus) +
      '」，不能收货。'
    );
  if (data.lines.length === 0) return '这个包裹没有可收货的商品。';
  if (data.lines.every((line) => line.maxReceivableQuantity <= 0))
    return '所有商品都已经达到采购或包裹上限，没有可收数量。';
  return null;
}
