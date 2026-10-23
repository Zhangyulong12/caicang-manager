import type { ProductData } from '@caicang/api-contract';
export interface ProductForm {
  articleNo: string;
  color: string;
  size: string;
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
    articleNo: '',
    color: '',
    size: '',
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
// 与服务端 product-name.ts 保持一致，仅用于表单里展示"留空会叫什么名字"。
export function previewProductName(
  form: Pick<ProductForm, 'articleNo' | 'color' | 'size' | 'sku'>,
): string {
  const segments = [form.articleNo, form.color, form.size]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return segments.join(' ') || form.sku.trim();
}
export function productForm(product: ProductData): ProductForm {
  return {
    articleNo: product.articleNo ?? '',
    color: product.color ?? '',
    size: product.size ?? '',
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
  for (const key of ['articleNo', 'color', 'size'] as const)
    if (length(form[key].trim()) > 80 || /[\p{Cc}\p{Cs}]/u.test(form[key].trim()))
      errors[key] = '最多 80 字，不能包含控制字符';
  // 只有 SKU 是硬性必填：同商家内唯一，是所有单据的识别依据。
  const sku = requiredText(form.sku, 80, 'SKU 编码');
  if (sku) errors.sku = sku;
  const unit = requiredText(form.unit, 20, '单位');
  if (unit) errors.unit = unit;
  // 名称与条码都可以留空：名称为空时服务端按 货号/颜色/尺码 生成。
  if (length(form.name.trim()) > 200 || /[\p{Cc}\p{Cs}]/u.test(form.name.trim()))
    errors.name = '商品名称最多 200 个字符，不能包含控制字符';
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
    articleNo: form.articleNo.trim() || null,
    color: form.color.trim() || null,
    size: form.size.trim() || null,
    // 空字符串表示交给服务端按 货号/颜色/尺码 生成。
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
