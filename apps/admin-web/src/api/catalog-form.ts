import type { ProductData } from '@caicang/api-contract';
export interface ProductForm {
  name: string;
  sku: string;
  specification: string;
  unit: string;
  barcode: string;
  referencePurchasePrice: string;
  isActive: boolean;
  remark: string;
}
export interface WarehouseForm {
  name: string;
  code: string;
  remark: string;
}
export function blankProduct(): ProductForm {
  return {
    name: '',
    sku: '',
    specification: '',
    unit: '件',
    barcode: '',
    referencePurchasePrice: '',
    isActive: true,
    remark: '',
  };
}
export function productForm(product: ProductData): ProductForm {
  return {
    name: product.name,
    sku: product.sku,
    specification: product.specification ?? '',
    unit: product.unit,
    barcode: product.barcode ?? '',
    referencePurchasePrice: product.referencePurchasePrice ?? '',
    isActive: product.isActive,
    remark: product.remark ?? '',
  };
}
const length = (value: string) => [...value].length;
function requiredText(value: string, max: number, label: string): string {
  return !value.trim()
    ? `请输入${label}`
    : length(value.trim()) > max
      ? `${label}最多 ${max} 个字符`
      : /[\p{Cc}\p{Cs}]/u.test(value.trim())
        ? `${label}不能包含控制字符`
        : '';
}
export function productErrors(form: ProductForm): Partial<Record<keyof ProductForm, string>> {
  const errors: Partial<Record<keyof ProductForm, string>> = {};
  for (const [key, max, label] of [
    ['name', 200, '商品名称'],
    ['sku', 80, 'SKU 编码'],
    ['unit', 20, '单位'],
  ] as const) {
    const error = requiredText(form[key], max, label);
    if (error) errors[key] = error;
  }
  if (
    form.barcode.trim() &&
    (length(form.barcode.trim()) > 128 || /[\p{Cc}\p{Cs}]/u.test(form.barcode.trim()))
  )
    errors.barcode = '条码最多 128 个字符，不能包含控制字符';
  if (
    form.referencePurchasePrice !== '' &&
    !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(form.referencePurchasePrice)
  )
    errors.referencePurchasePrice = '请输入非负金额，最多 16 位整数和 2 位小数';
  for (const [key, max, label] of [
    ['specification', 200, '规格'],
    ['remark', 2000, '备注'],
  ] as const)
    if (length(form[key].trim()) > max || form[key].includes('\u0000'))
      errors[key] = `${label}最多 ${max} 个字符，不能包含空字符`;
  return errors;
}
export function warehouseErrors(form: WarehouseForm): Partial<Record<keyof WarehouseForm, string>> {
  const errors: Partial<Record<keyof WarehouseForm, string>> = {};
  for (const [key, max, label] of [
    ['name', 100, '仓库名称'],
    ['code', 40, '仓库编码'],
  ] as const) {
    const error = requiredText(form[key], max, label);
    if (error) errors[key] = error;
  }
  if (length(form.remark.trim()) > 2000 || form.remark.includes('\u0000'))
    errors.remark = '备注最多 2000 个字符，不能包含空字符';
  return errors;
}
export function productPayload(form: ProductForm) {
  return {
    name: form.name.trim(),
    sku: form.sku.trim(),
    specification: form.specification.trim() || null,
    unit: form.unit.trim(),
    barcode: form.barcode.trim() || null,
    referencePurchasePrice: form.referencePurchasePrice || null,
    isActive: form.isActive,
    remark: form.remark.trim() || null,
  };
}
export function warehousePayload(form: WarehouseForm) {
  return { name: form.name.trim(), code: form.code.trim(), remark: form.remark.trim() || null };
}
