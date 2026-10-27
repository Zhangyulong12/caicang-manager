import type { PurchaseReturnableData } from '@caicang/api-contract';
import { ApiFailure } from './client';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const returnStatusNames = { DRAFT: '草稿', CONFIRMED: '已确认退货', CANCELLED: '已取消' };
export interface ReturnForm {
  purchaseOrderId: string;
  reason: string;
  returnDate: string;
  refundAmount: string;
  remark: string;
  quantities: Record<string, string>;
}
export interface ReturnInput {
  purchaseOrderId: string;
  reason: string;
  returnDate: string;
  refundAmount: string;
  remark: string;
  items: { purchaseOrderItemId: string; quantity: number }[];
}
export const blankReturn = (): ReturnForm => ({
  purchaseOrderId: '',
  reason: '',
  returnDate: new Date().toLocaleDateString('sv-SE'),
  refundAmount: '0.00',
  remark: '',
  quantities: {},
});
const cents = (s: string) => {
  const [a, b = ''] = s.split('.');
  return BigInt(a!) * 100n + BigInt(b.padEnd(2, '0'));
};
const money = (n: bigint) => `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
/** Same positive HALF_UP line rounding as server Decimal; never submitted as final money. */
export function returnEstimate(form: ReturnForm, source: PurchaseReturnableData | null) {
  if (!source || source.purchaseOrderId !== form.purchaseOrderId) return '0.00';
  let total = 0n;
  for (const line of source.items) {
    const qty = form.quantities[line.purchaseOrderItemId]?.trim() ?? '';
    if (!/^[1-9]\d{0,9}$/.test(qty) || Number(qty) > 2147483647) continue;
    const divisor = BigInt(line.orderedQuantity),
      numerator = cents(line.purchaseNetAmount) * BigInt(qty);
    total += (numerator * 2n + divisor) / (divisor * 2n);
  }
  return money(total);
}
export function returnErrors(
  form: ReturnForm,
  source: PurchaseReturnableData | null,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (
    !uuid.test(form.purchaseOrderId) ||
    !source ||
    source.purchaseOrderId !== form.purchaseOrderId
  )
    errors.purchaseOrderId = '请选择并加载原采购记录';
  if (!form.reason.trim() || form.reason.trim().length > 500 || form.reason.includes('\0'))
    errors.reason = '退货原因必填，最多 500 字';
  const date = new Date(form.returnDate + 'T00:00:00Z');
  if (
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(form.returnDate) ||
    !Number.isFinite(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== form.returnDate
  )
    errors.returnDate = '请选择有效退货日期';
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(form.refundAmount.trim()))
    errors.refundAmount = '实际退款请输入非负金额，最多两位小数';
  if (form.remark.trim().length > 2000 || form.remark.includes('\0'))
    errors.remark = '备注最多 2000 字';
  let selected = 0;
  for (const [id, raw] of Object.entries(form.quantities)) {
    if (!raw.trim() || raw.trim() === '0') continue;
    selected++;
    const line = source?.items.find((i) => i.purchaseOrderItemId === id);
    if (!line || !/^[1-9]\d{0,9}$/.test(raw.trim()) || Number(raw) > 2147483647)
      errors[id] = '请输入正整数退货数量';
    else if (Number(raw) > line.availableQuantity)
      errors[id] = `最多可退 ${line.availableQuantity}；确认时服务器会重新检查`;
  }
  if (!selected || selected > 100) errors.items = '请选择 1—100 条可退商品并输入数量';
  return errors;
}
export function returnInput(form: ReturnForm, source: PurchaseReturnableData | null): ReturnInput {
  if (Object.keys(returnErrors(form, source)).length)
    throw new ApiFailure(400, 'VALIDATION_ERROR', '请修正退货表单');
  return {
    purchaseOrderId: form.purchaseOrderId,
    reason: form.reason.trim(),
    returnDate: form.returnDate,
    refundAmount: form.refundAmount.trim(),
    remark: form.remark.trim(),
    items: Object.entries(form.quantities)
      .filter(([, qty]) => qty.trim() && qty.trim() !== '0')
      .map(([purchaseOrderItemId, qty]) => ({ purchaseOrderItemId, quantity: Number(qty) })),
  };
}
/** Confirmation key survives reload, is scoped by user/tenant/document, and is saved before HTTP. */
export function returnConfirmation(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  user: string | undefined,
  tenant: string | undefined,
  id: string,
) {
  if (!user || !tenant || !uuid.test(id))
    throw new ApiFailure(403, 'FORBIDDEN', '请先选择有效商家');
  const key = `caicang.return.confirm.${user}.${tenant}.${id}`;
  return () => {
    try {
      const old = storage.getItem(key);
      if (old) {
        if (!uuid.test(old)) throw new Error('invalid');
        return old;
      }
      const op = crypto.randomUUID();
      storage.setItem(key, op);
      return op;
    } catch {
      throw new ApiFailure(
        0,
        'CONFIRM_STORAGE_UNAVAILABLE',
        '确认号无法安全保存，本次未提交；请检查浏览器存储',
      );
    }
  };
}
