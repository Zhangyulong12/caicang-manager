import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_DIRECTION,
  type AdjustmentReason,
} from '@caicang/api-contract';
import { ApiFailure } from './client';

export interface AdjustmentForm {
  warehouseId: string;
  productId: string;
  quantityDelta: string;
  reason: AdjustmentReason;
  remark: string;
}
export interface AdjustmentPayload {
  warehouseId: string;
  productId: string;
  quantityDelta: number;
  reason: AdjustmentReason;
  remark?: string;
  clientOperationId: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const blankAdjustment = (): AdjustmentForm => ({
  warehouseId: '',
  productId: '',
  quantityDelta: '',
  reason: 'STOCKTAKE_LOSS',
  remark: '',
});
export function adjustmentAttemptKey(
  userId: string | undefined,
  tenantId: string | undefined,
): string {
  if (!userId || !tenantId) throw new ApiFailure(403, 'FORBIDDEN', '请先选择有效的商家工作空间');
  return `caicang.adjustment.pending.${userId}.${tenantId}`;
}
export function adjustmentErrors(form: AdjustmentForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!uuid.test(form.warehouseId)) errors.warehouseId = '请选择仓库';
  if (!uuid.test(form.productId)) errors.productId = '请选择商品';
  if (!ADJUSTMENT_REASONS.includes(form.reason)) errors.reason = '请选择调整原因';
  if (
    !/^[+-]?[1-9]\d{0,9}$/.test(form.quantityDelta.trim()) ||
    !Number.isInteger(Number(form.quantityDelta)) ||
    Math.abs(Number(form.quantityDelta)) > 2147483647
  )
    errors.quantityDelta = '请输入非零整数，正数增加、负数减少，绝对值不超过 2147483647';
  else if (
    !errors.reason &&
    ADJUSTMENT_REASON_DIRECTION[form.reason] !== 0 &&
    Math.sign(Number(form.quantityDelta)) !== ADJUSTMENT_REASON_DIRECTION[form.reason]
  )
    errors.quantityDelta =
      form.reason === 'STOCKTAKE_GAIN' ? '盘点盘盈必须填写正数' : '盘亏、损坏或丢失必须填写负数';
  if (form.reason === 'OTHER' && !form.remark.trim()) errors.remark = '其他原因必须填写备注';
  else if ([...form.remark.trim()].length > 500 || form.remark.includes('\u0000'))
    errors.remark = '备注最多 500 字，不能包含空字符';
  return errors;
}
export function adjustmentInput(
  form: AdjustmentForm,
): Omit<AdjustmentPayload, 'clientOperationId'> {
  if (Object.keys(adjustmentErrors(form)).length)
    throw new ApiFailure(400, 'VALIDATION_ERROR', '请修正库存调整表单');
  return {
    warehouseId: form.warehouseId,
    productId: form.productId,
    quantityDelta: Number(form.quantityDelta.trim()),
    reason: form.reason,
    ...(form.remark.trim() ? { remark: form.remark.trim() } : {}),
  };
}
export function pendingForm(payload: AdjustmentPayload): AdjustmentForm {
  return {
    warehouseId: payload.warehouseId,
    productId: payload.productId,
    quantityDelta: String(payload.quantityDelta),
    reason: payload.reason,
    remark: payload.remark ?? '',
  };
}
/** Persist BEFORE sending. A lost HTTP response must never create a second operation on reload. */
export function createAdjustmentAttempt(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  key: string,
) {
  function read(): AdjustmentPayload | null {
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const payload = JSON.parse(raw) as AdjustmentPayload;
      if (
        !payload ||
        !uuid.test(payload.clientOperationId) ||
        !Number.isInteger(payload.quantityDelta) ||
        (payload.remark !== undefined && typeof payload.remark !== 'string') ||
        typeof payload.warehouseId !== 'string' ||
        typeof payload.productId !== 'string' ||
        Object.keys(adjustmentErrors(pendingForm(payload))).length
      )
        throw new Error('Invalid saved operation');
      return {
        ...adjustmentInput(pendingForm(payload)),
        clientOperationId: payload.clientOperationId,
      };
    } catch {
      throw new ApiFailure(
        409,
        'PENDING_ADJUSTMENT_UNREADABLE',
        '未完成调整信息无法读取，请先核对调整列表，勿重复创建相同调整',
      );
    }
  }
  function begin(form: AdjustmentForm): AdjustmentPayload {
    const input = adjustmentInput(form),
      old = read();
    if (old) {
      const { clientOperationId, ...previous } = old;
      if (JSON.stringify(previous) !== JSON.stringify(input))
        throw new ApiFailure(409, 'PENDING_ADJUSTMENT', '上次调整结果未确认，请先用原内容重试');
      return { ...previous, clientOperationId };
    }
    const payload = { ...input, clientOperationId: crypto.randomUUID() };
    try {
      storage.setItem(key, JSON.stringify(payload));
    } catch {
      throw new ApiFailure(
        0,
        'PENDING_STORAGE_UNAVAILABLE',
        '无法保存安全重试信息，本次未提交，请检查浏览器存储',
      );
    }
    return payload;
  }
  function clear() {
    storage.removeItem(key);
  }
  return { read, begin, clear };
}
export function adjustmentDefinitelyRejected(error: unknown): boolean {
  return (
    error instanceof ApiFailure &&
    error.status >= 400 &&
    error.status < 500 &&
    [
      'VALIDATION_ERROR',
      'BAD_REQUEST',
      'FORBIDDEN',
      'NOT_FOUND',
      'OUT_OF_STOCK',
      'ADJUSTMENT_REASON_MISMATCH',
    ].includes(error.code)
  );
}
export const adjustmentCostLabels = {
  AVERAGE: '移动加权平均成本',
  REFERENCE: '零库存使用商品参考价',
  ZERO: '无成本依据，按零记录',
};
