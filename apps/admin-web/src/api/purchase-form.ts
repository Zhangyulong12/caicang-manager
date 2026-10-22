import type { PurchaseOrderData, PurchasePlatform, ProductData } from '@caicang/api-contract';
export interface PurchaseLineForm {
  key: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
}
export interface PurchaseForm {
  orderNo: string;
  platform: PurchasePlatform;
  platformOrderNo: string;
  supplierName: string;
  purchaseDate: string;
  warehouseId: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  freightAmount: string;
  remark: string;
  items: PurchaseLineForm[];
}
export const platformNames = { TAOBAO: '淘宝', JD: '京东', PDD: '拼多多', OTHER: '其他平台' };
export const statusNames = {
  DRAFT: '草稿',
  PLACED: '已下单',
  PARTIAL_RECEIVED: '部分收货',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};
const moneyPattern = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const cap = 999999999999999999n;
export function cents(value: string): bigint | null {
  if (!moneyPattern.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function money(value: bigint) {
  return (value / 100n).toString() + '.' + (value % 100n).toString().padStart(2, '0');
}
export function preview(form: PurchaseForm) {
  let goods = 0n,
    discount = 0n;
  const freight = cents(form.freightAmount);
  const rows: (string | null)[] = [];
  let valid = freight !== null && form.items.length > 0;
  for (const row of form.items) {
    const q = /^[1-9]\d{0,9}$/.test(row.quantity) ? BigInt(row.quantity) : 0n;
    const price = cents(row.unitPrice),
      off = cents(row.discountAmount);
    if (q < 1n || q > 2147483647n || price === null || off === null || off > q * (price ?? 0n)) {
      valid = false;
      rows.push(null);
      continue;
    }
    goods += q * price;
    discount += off;
    rows.push(money(q * price - off));
  }
  const total = goods - discount + (freight ?? 0n);
  if (goods > cap || discount > cap || total > cap) valid = false;
  return {
    valid,
    goodsAmount: valid ? money(goods) : null,
    discountAmount: valid ? money(discount) : null,
    totalCost: valid ? money(total) : null,
    rows,
  };
}
export function blankPurchase(): PurchaseForm {
  const today = new Date();
  const date = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  return {
    orderNo: 'PO-' + crypto.randomUUID().replaceAll('-', ''),
    platform: 'TAOBAO',
    platformOrderNo: '',
    supplierName: '',
    purchaseDate: date,
    warehouseId: '',
    recipientName: '',
    recipientPhone: '',
    recipientAddress: '',
    freightAmount: '0.00',
    remark: '',
    items: [],
  };
}
export function newPurchaseLine(product: ProductData): PurchaseLineForm {
  return {
    key: crypto.randomUUID(),
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unit: product.unit,
    quantity: '1',
    unitPrice: product.referencePurchasePrice ?? '',
    discountAmount: '0.00',
  };
}
export function purchaseForm(order: PurchaseOrderData): PurchaseForm {
  return {
    orderNo: order.orderNo,
    platform: order.platform,
    platformOrderNo: order.platformOrderNo ?? '',
    supplierName: order.supplierName ?? '',
    purchaseDate: order.purchaseDate ?? '',
    warehouseId: order.warehouseId,
    recipientName: order.recipient.name ?? '',
    recipientPhone: order.recipient.phone ?? '',
    recipientAddress: order.recipient.address ?? '',
    freightAmount: order.freightAmount,
    remark: order.remark ?? '',
    items: order.items.map((row) => ({
      key: row.id,
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      unit: row.unit,
      quantity: String(row.quantity),
      unitPrice: row.unitPrice,
      discountAmount: row.discountAmount,
    })),
  };
}
export function purchaseErrors(form: PurchaseForm): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, label, max, required] of [
    ['orderNo', '采购单号', 50, true],
    ['platformOrderNo', '平台订单号', 100, false],
    ['supplierName', '店铺名称', 200, false],
    ['recipientName', '收货人', 100, true],
    ['recipientPhone', '收货电话', 50, true],
    ['recipientAddress', '收货地址', 1000, true],
    ['remark', '备注', 2000, false],
  ] as const) {
    const value = form[key].trim();
    if (required && !value) errors[key] = `请填写${label}`;
    else if (
      [...value].length > max ||
      value.includes('\u0000') ||
      (!['recipientAddress', 'remark'].includes(key) && /[\p{Cc}\p{Cs}]/u.test(value))
    )
      errors[key] = `${label}最多 ${max} 字，不能包含非法字符`;
  }
  if (!['JD', 'TAOBAO', 'PDD', 'OTHER'].includes(form.platform)) errors.platform = '请选择采购平台';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(form.warehouseId))
    errors.warehouseId = '请选择目标仓库';
  if (form.recipientPhone.trim() && !/^(?=.*\d)[+\d() -]+$/.test(form.recipientPhone.trim()))
    errors.recipientPhone = '请输入有效电话，可含国际区号';
  if (
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(form.purchaseDate) ||
    !Number.isFinite(Date.parse(form.purchaseDate + 'T00:00:00Z')) ||
    new Date(form.purchaseDate + 'T00:00:00Z').toISOString().slice(0, 10) !== form.purchaseDate
  )
    errors.purchaseDate = '请选择有效采购日期';
  if (cents(form.freightAmount) === null) errors.freightAmount = '运费须为非负金额，最多两位小数';
  if (!form.items.length || form.items.length > 100) errors.items = '请添加 1–100 行 SKU';
  const seen = new Set<string>();
  form.items.forEach((row, index) => {
    const prefix = `items.${index}.`;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.productId) ||
      seen.has(row.productId.toLowerCase())
    )
      errors[prefix + 'productId'] = '请选择不同的有效 SKU';
    seen.add(row.productId.toLowerCase());
    if (!/^[1-9]\d{0,9}$/.test(row.quantity) || BigInt(row.quantity) > 2147483647n)
      errors[prefix + 'quantity'] = '数量须为 1–2147483647 的整数';
    const price = cents(row.unitPrice),
      off = cents(row.discountAmount);
    if (price === null) errors[prefix + 'unitPrice'] = '请填写非负单价，最多两位小数';
    if (off === null) errors[prefix + 'discountAmount'] = '优惠须为非负金额，最多两位小数';
    else if (price !== null && !errors[prefix + 'quantity'] && off > BigInt(row.quantity) * price)
      errors[prefix + 'discountAmount'] = '行优惠不能超过该行商品金额';
  });
  if (!Object.keys(errors).length && !preview(form).valid)
    errors.total = '商品原价、优惠或总成本超出金额上限';
  return errors;
}
export function purchasePayload(form: PurchaseForm) {
  return {
    orderNo: form.orderNo.trim(),
    platform: form.platform,
    platformOrderNo: form.platformOrderNo.trim() || null,
    supplierName: form.supplierName.trim() || null,
    purchaseDate: form.purchaseDate,
    warehouseId: form.warehouseId,
    recipient: {
      name: form.recipientName.trim(),
      phone: form.recipientPhone.trim(),
      address: form.recipientAddress.trim(),
    },
    freightAmount: form.freightAmount,
    remark: form.remark.trim() || null,
    items: form.items.map((row) => ({
      productId: row.productId,
      quantity: Number(row.quantity),
      unitPrice: row.unitPrice,
      discountAmount: row.discountAmount,
    })),
  };
}
export function mayCancel(order: PurchaseOrderData) {
  return (
    ['DRAFT', 'PLACED'].includes(order.status) &&
    order.items.every((row) => row.receivedQuantity === 0)
  );
}
