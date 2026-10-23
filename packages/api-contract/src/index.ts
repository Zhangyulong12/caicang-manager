/** JSON-only health contract; never import server runtime into clients. */
export interface HealthData {
  status: 'ok';
  service: 'caicang-api';
  database: 'reachable';
  timestamp: string;
}

export interface ApiResponse<T> {
  data: T;
  requestId: string;
}

export type HealthResponse = ApiResponse<HealthData>;

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}
export interface ApiPageResponse<T> extends ApiResponse<T[]> {
  pagination: Pagination;
}
export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'RESOURCE_CONFLICT',
  'BUSINESS_VALIDATION_FAILED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL_ERROR',
  'DATABASE_UNAVAILABLE',
  'SERVICE_UNAVAILABLE',
  'OUT_OF_STOCK',
  'IDEMPOTENCY_CONFLICT',
  'RECEIPT_QTY_EXCEEDED',
  'STATUS_CONFLICT',
  'EMAIL_ALREADY_EXISTS',
  'INVALID_CREDENTIALS',
  'INVALID_ACCESS_TOKEN',
  'INVALID_REFRESH_TOKEN',
  'INVALID_TENANT_HEADER',
  'MEMBER_ALREADY_EXISTS',
  'PRODUCT_SKU_ALREADY_EXISTS',
  'PRODUCT_BARCODE_ALREADY_EXISTS',
  'WAREHOUSE_CODE_ALREADY_EXISTS',
  'PURCHASE_ORDER_NO_ALREADY_EXISTS',
  'PURCHASE_ACCOUNT_ALREADY_EXISTS',
  'PURCHASE_ACCOUNT_INACTIVE',
  'PURCHASE_ACCOUNT_PLATFORM_MISMATCH',
  'PURCHASE_ACCOUNT_PLATFORM_LOCKED',
  'PURCHASE_ACCOUNT_HAS_ORDERS',
  'PACKAGE_TRACKING_ALREADY_EXISTS',
  'PACKAGE_EXPECTED_QTY_EXCEEDED',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export interface ApiErrorResponse {
  error: { code: ApiErrorCode; message: string; details: Record<string, unknown> };
  requestId: string;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface RegisterData {
  user: PublicUser;
}
export interface LoginData {
  accessToken: string;
  refreshToken: string;
  refreshExpiresIn: number;
  tokenType: 'Bearer';
  expiresIn: number;
  user: PublicUser;
}
export type RefreshData = LoginData;
export interface LogoutData {
  loggedOut: true;
}

export const TENANT_ROLES = ['OWNER', 'ADMIN', 'BUYER', 'WAREHOUSE', 'VIEWER'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];
export const TENANT_PERMISSIONS = [
  'tenant:read',
  'products:read',
  'products:write',
  'warehouses:read',
  'warehouses:write',
  'members:read',
  'members:manage',
  'purchase:write',
  'purchase:read',
  'packages:read',
  'packages:write',
  'packages:lookup',
  'receiving:confirm',
  'outbound:write',
] as const;
export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];
export interface TenantData {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
export interface MembershipData {
  id: string;
  tenantId: string;
  userId: string;
  role: TenantRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface MemberData extends MembershipData {
  user: Pick<PublicUser, 'id' | 'email' | 'displayName' | 'isActive'>;
}
export interface CreatedTenantData {
  tenant: TenantData;
  membership: MembershipData;
  defaultWarehouse: {
    id: string;
    tenantId: string;
    code: string;
    name: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
}
export interface CurrentTenantData {
  tenant: TenantData;
  membership: MembershipData;
  permissions: TenantPermission[];
}

export interface TenantChoiceData {
  tenant: TenantData;
  membership: MembershipData;
}

export interface ProductData {
  articleNo: string | null;
  color: string | null;
  size: string | null;
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  specification: string | null;
  unit: string;
  barcode: string | null;
  referencePurchasePrice: string | null;
  isActive: boolean;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseData {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  remark: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const PURCHASE_PLATFORMS = ['JD', 'TAOBAO', 'PDD', 'OTHER'] as const;
export const PURCHASE_STATUSES = [
  'DRAFT',
  'PLACED',
  'PARTIAL_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type PurchasePlatform = (typeof PURCHASE_PLATFORMS)[number];
export interface PurchaseAccountData {
  id: string;
  tenantId: string;
  platform: PurchasePlatform;
  alias: string;
  remark: string | null;
  isActive: boolean;
  hasOrders: boolean;
  createdAt: string;
  updatedAt: string;
}
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export interface PurchaseItemData {
  articleNo: string | null;
  color: string | null;
  size: string | null;
  id: string;
  productId: string;
  lineNo: number | null;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  receivedQuantity: number;
  unitPrice: string;
  discountAmount: string;
  lineNet: string;
  freightAllocated: string | null;
  landedUnitCost: string | null;
}
export interface PurchaseOrderData {
  purchaseAccountId: string | null;
  purchaseAccountAlias: string | null;
  id: string;
  tenantId: string;
  orderNo: string;
  warehouseId: string;
  platform: PurchasePlatform;
  platformOrderNo: string | null;
  supplierName: string | null;
  purchaseDate: string | null;
  status: PurchaseStatus;
  recipient: { name: string | null; phone: string | null; address: string | null };
  recipientMasked: boolean;
  freightAmount: string;
  goodsAmount: string;
  discountAmount: string;
  totalCost: string;
  remark: string | null;
  createdBy: string;
  placedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseItemData[];
}

export const PACKAGE_STATUSES = [
  'CREATED',
  'IN_TRANSIT',
  'ARRIVED',
  'PARTIAL_RECEIVED',
  'RECEIVED',
  'EXCEPTION',
] as const;
export const PACKAGE_LOGISTICS_STATUSES = [
  'CREATED',
  'IN_TRANSIT',
  'ARRIVED',
  'EXCEPTION',
] as const;
export const PACKAGE_RECEIVING_STATUSES = ['NOT_RECEIVED', 'PARTIAL_RECEIVED', 'RECEIVED'] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];
export type PackageLogisticsStatus = (typeof PACKAGE_LOGISTICS_STATUSES)[number];
export type PackageReceivingStatus = (typeof PACKAGE_RECEIVING_STATUSES)[number];
export interface PackageExpectedItemData {
  id: string;
  purchaseOrderItemId: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  orderedQuantity: number;
  expectedQuantity: number;
  receivedQuantity: number;
}
export interface PackageData {
  id: string;
  tenantId: string;
  purchaseOrderId: string;
  purchaseOrderNo: string;
  purchaseStatus: PurchaseStatus;
  warehouseId: string;
  carrierCode: string | null;
  trackingNo: string | null;
  status: PackageStatus;
  receivingStatus: PackageReceivingStatus;
  hasReceipts: boolean;
  receivedQuantity: number;
  receivingClosedAt: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  expectedItems: PackageExpectedItemData[];
}
export interface PackageLookupData {
  packageId: string;
  carrierCode: string | null;
  trackingNo: string | null;
  purchaseOrderId: string;
  purchaseOrderNo: string;
  packageStatus: PackageStatus;
  receivingStatus: PackageReceivingStatus;
  hasReceipts: boolean;
  receivedQuantity: number;
}
export interface PackageReceivableLineData {
  purchaseOrderItemId: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  orderedQuantity: number;
  /** Sum of confirmed receipts for this purchase line across every package. */
  receivedQuantity: number;
  orderRemainingQuantity: number;
  /** True when this line belongs to the package plan; false for manual selection. */
  inPackagePlan: boolean;
  expectedQuantity: number | null;
  packageReceivedQuantity: number;
  packageRemainingQuantity: number | null;
  /** Remaining quantity that may be received in this package right now. */
  maxReceivableQuantity: number;
}
export interface PackageReceivableData {
  packageId: string;
  purchaseOrderId: string;
  purchaseOrderNo: string;
  purchaseStatus: PurchaseStatus;
  packageStatus: PackageStatus;
  receivingStatus: PackageReceivingStatus;
  hasPlan: boolean;
  receivingClosed: boolean;
  receivedQuantity: number;
  lines: PackageReceivableLineData[];
}
export interface ReceiptItemData {
  id: string;
  purchaseOrderItemId: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  /** Purchase line landed unit cost snapshot, four decimals. */
  landedUnitCost: string;
  lineCost: string;
}
export interface ReceiptData {
  id: string;
  tenantId: string;
  receiptNo: string;
  purchaseOrderId: string;
  purchaseOrderNo: string;
  packageId: string;
  trackingNo: string | null;
  carrierCode: string | null;
  warehouseId: string;
  warehouseName: string;
  status: 'CONFIRMED';
  clientOperationId: string;
  receivedBy: string;
  receivedByName: string;
  remark: string | null;
  receivedAt: string;
  createdAt: string;
  totalQuantity: number;
  /** Sum of quantity x landed unit cost, four decimals. */
  totalCost: string;
  items: ReceiptItemData[];
}

export const STOCK_MOVEMENT_TYPES = ['RECEIPT', 'OUTBOUND', 'ADJUSTMENT'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export type StockMovementDirection = 'IN' | 'OUT';

export const OUTBOUND_STATUSES = ['DRAFT', 'SHIPPED', 'CANCELLED'] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];
export interface OutboundItemData {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  /** 发货时的移动加权平均单位成本快照；草稿未发货为 null。 */
  shippedUnitCost: string | null;
  /** quantity × shippedUnitCost；草稿为 null。 */
  lineCost: string | null;
  /** 当前该仓库可出库数量，来自 stock_balances，仅供页面提示。 */
  availableQuantity: number;
}
export interface OutboundOrderData {
  id: string;
  tenantId: string;
  outboundNo: string;
  status: OutboundStatus;
  warehouseId: string;
  warehouseName: string;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  carrierCode: string | null;
  trackingNo: string | null;
  remark: string | null;
  createdBy: string;
  createdByName: string;
  shippedBy: string | null;
  shippedByName: string | null;
  /** 发货幂等操作 ID；草稿为 null。 */
  confirmOperationId: string | null;
  shippedAt: string | null;
  createdAt: string;
  updatedAt: string;
  totalQuantity: number;
  /** 本单出库成本合计；草稿为 0.0000。 */
  totalCost: string;
  items: OutboundItemData[];
}
/** 库存余额快照行：现存数量来自 stock_balances，待入库来自未收完的采购行。 */
export interface InventoryBalanceData {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  specification: string | null;
  unit: string;
  quantityOnHand: number;
  /** 已下单但还没入库的数量（整单未收数量之和，按商品+仓库聚合）。 */
  pendingInboundQuantity: number;
  /** 移动加权平均成本 = 账面总成本 / 现存数量，四位小数；无库存时为 0.0000。 */
  averageCost: string;
  /** 库存账面总成本，四位小数。 */
  totalCost: string;
  /** 该仓库这一商品最近一次入库（收货）时间；从未收过货时为 null。 */
  lastReceivedAt: string | null;
  updatedAt: string | null;
}
/** 库存总览里按仓库汇总的一行。 */
export interface InventoryWarehouseSummaryData {
  warehouseId: string;
  warehouseName: string;
  /** 该仓库有库存或待入库的商品数。 */
  skuCount: number;
  quantityOnHand: number;
  pendingInboundQuantity: number;
  totalCost: string;
  lastReceivedAt: string | null;
}
/** 库存总览：全仓合计 + 分仓明细，全部由数据库实时算出。 */
export interface InventorySummaryData {
  totalProducts: number;
  totalWarehouses: number;
  quantityOnHand: number;
  /** 账面总成本（所有仓库合计），四位小数。 */
  totalCost: string;
  /** 全局移动加权平均成本 = totalCost / quantityOnHand，四位小数。 */
  averageCost: string;
  pendingInboundQuantity: number;
  lastReceivedAt: string | null;
  warehouses: InventoryWarehouseSummaryData[];
  /** 服务端生成这份汇总的时间，用于证明页面读的是实时数据。 */
  generatedAt: string;
}
/** 一笔"已下单但还没完全入库"的采购行，按仓库+商品+采购行展开。 */
export interface InventoryPendingData {
  purchaseOrderId: string;
  orderNo: string;
  status: PurchaseStatus;
  platform: PurchasePlatform;
  purchaseDate: string | null;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  orderedQuantity: number;
  receivedQuantity: number;
  pendingQuantity: number;
  unitPrice: string;
  /** 未入库部分的采购金额 = 待入库数量 x 采购单价，四位小数。 */
  pendingAmount: string;
}
/** 一条不可变库存流水，含操作前后数量与来源单据。 */
export interface InventoryMovementData {
  id: string;
  occurredAt: string;
  type: StockMovementType;
  direction: StockMovementDirection;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  costDelta: string;
  /** |成本变动| / |数量变动|，四位小数；数量变动为 0 时为 0.0000。 */
  unitCost: string;
  totalCostBefore: string;
  totalCostAfter: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  /** 来源单据类型；目前为 RECEIPT / OUTBOUND / ADJUSTMENT。 */
  sourceType: string;
  /** 来源单号（入库单号、出库单号；调整单没有编号时为 null）。 */
  sourceNo: string | null;
  /** 来源单据行 ID，便于追溯具体凭证。 */
  sourceId: string;
  /** 来源单据头 ID（入库单 / 出库单 / 盘点单），可直接跳详情；没有单据头时为 null。 */
  sourceDocumentId: string | null;
  note: string | null;
  operatorId: string;
  operatorName: string;
}
