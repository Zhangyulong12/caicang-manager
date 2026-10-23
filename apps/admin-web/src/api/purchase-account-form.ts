import {
  PURCHASE_PLATFORMS,
  type PurchaseAccountData,
  type PurchasePlatform,
} from '@caicang/api-contract';
export interface PurchaseAccountForm {
  platform: PurchasePlatform;
  alias: string;
  remark: string;
  isActive: boolean;
}
export const blankAccount = (): PurchaseAccountForm => ({
  platform: 'TAOBAO',
  alias: '',
  remark: '',
  isActive: true,
});
export const accountForm = (row: PurchaseAccountData): PurchaseAccountForm => ({
  platform: row.platform,
  alias: row.alias,
  remark: row.remark ?? '',
  isActive: row.isActive,
});
export function accountErrors(form: PurchaseAccountForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!PURCHASE_PLATFORMS.includes(form.platform)) errors.platform = '请选择采购平台';
  if (
    !form.alias.trim() ||
    [...form.alias.trim()].length > 100 ||
    /[\p{Cc}\p{Cs}]/u.test(form.alias.trim())
  )
    errors.alias = '账号别名必填，最多 100 字，不能包含控制字符';
  if ([...form.remark.trim()].length > 2000 || form.remark.includes('\u0000'))
    errors.remark = '备注最多 2000 字，不能包含空字符';
  return errors;
}
export const accountPayload = (form: PurchaseAccountForm) => ({
  ...form,
  alias: form.alias.trim(),
  remark: form.remark.trim() || null,
});
