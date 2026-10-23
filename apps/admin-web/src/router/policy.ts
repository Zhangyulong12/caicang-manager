import type { TenantPermission } from '@caicang/api-contract';
export const navigation: {
  path: string;
  title: string;
  permission: TenantPermission;
  soon?: boolean;
  icon: string;
  description: string;
}[] = [
  {
    path: '/',
    title: '首页',
    permission: 'tenant:read',
    icon: 'House',
    description: '查看你的工作空间与服务状态',
  },
  {
    path: '/products',
    title: '商品管理',
    permission: 'products:read',
    icon: 'Goods',
    description: '集中管理 SKU、条码与商品资料',
  },
  {
    path: '/warehouses',
    title: '仓库管理',
    permission: 'warehouses:read',
    icon: 'OfficeBuilding',
    description: '管理仓库与默认业务仓库',
  },
  {
    path: '/purchases',
    title: '采购管理',
    permission: 'purchase:read',
    icon: 'ShoppingCart',
    description: '记录采购订单与到仓成本',
  },
  {
    path: '/packages',
    title: '快递包裹',
    permission: 'packages:read',
    icon: 'Box',
    description: '跟踪采购包裹与运单',
  },
  {
    path: '/receipts',
    title: '入库记录',
    permission: 'packages:read',
    icon: 'Download',
    description: '追溯每一次验收入库',
  },
  {
    path: '/inventory',
    title: '库存管理',
    permission: 'products:read',
    icon: 'Coin',
    description: '按仓库与 SKU 查看库存',
  },
  {
    path: '/outbound',
    title: '出库管理',
    permission: 'tenant:read',
    icon: 'Upload',
    soon: true,
    description: '管理发货订单与出库',
  },
  {
    path: '/reports',
    title: '数据统计',
    permission: 'tenant:read',
    icon: 'DataAnalysis',
    soon: true,
    description: '掌握采购与仓储运营数据',
  },
  {
    path: '/settings',
    title: '系统设置',
    permission: 'members:read',
    icon: 'Setting',
    description: '查看当前商家、仓库与账号权限',
  },
];
export const roleNames = {
  OWNER: '商家所有者',
  ADMIN: '管理员',
  BUYER: '采购员',
  WAREHOUSE: '仓库人员',
  VIEWER: '只读成员',
};
export function safeRedirect(value: unknown): string {
  if (
    typeof value === 'string' &&
    (productDetailPath(value) || purchasePath(value) || inventoryPath(value) || receiptPath(value))
  )
    return value;
  return typeof value === 'string' &&
    [...navigation.map((item) => item.path), '/select-tenant'].includes(value)
    ? value
    : '/';
}
export function allowed(path: string, permissions: readonly TenantPermission[]): boolean {
  if (path === '/purchases/new' || (purchasePath(path) && path.endsWith('/edit')))
    return permissions.includes('purchase:write');
  if (purchasePath(path)) return permissions.includes('purchase:read');
  if (path.startsWith('/products/')) return permissions.includes('products:read');
  if (inventoryPath(path)) return permissions.includes('products:read');
  if (receiptPath(path)) return permissions.includes('packages:read');
  const item = navigation.find((item) => item.path === path);
  return item ? permissions.includes(item.permission) : false;
}
export function productDetailPath(path: string): boolean {
  return /^\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path);
}

export function purchasePath(path: string): boolean {
  return (
    path === '/purchases/new' ||
    /^\/purchases\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/edit)?$/i.test(
      path,
    )
  );
}

const inventoryPages = [
  '/inventory',
  '/inventory/balances',
  '/inventory/movements',
  '/inventory/pending',
];

/** 库存子页面：固定四个列表页 + SKU 详情。 */
export function inventoryPath(path: string): boolean {
  return (
    inventoryPages.includes(path) ||
    /^\/inventory\/sku\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)
  );
}

/** 入库记录详情。 */
export function receiptPath(path: string): boolean {
  return (
    path === '/receipts' ||
    /^\/receipts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)
  );
}
