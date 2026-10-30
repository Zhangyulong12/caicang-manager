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
  'REGISTRATION_DISABLED',
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
  'ADJUSTMENT_REASON_MISMATCH',
  'PURCHASE_RETURN_QTY_EXCEEDED',
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
  'inventory:write',
  'reports:read',
  'reports:export',
] as const;
export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];

export const REPORT_DATASETS = [
  'accounts',
  'platforms',
  'daily',
  'purchase-lines',
  'pending',
  'inventory',
  'outbound',
  'returns',
  'products',
  'receipts',
  'adjustments',
] as const;
export type ReportDataset = (typeof REPORT_DATASETS)[number];
export interface ReportColumn {
  key: string;
  label: string;
  kind: 'text' | 'money' | 'quantity';
  digits?: 2 | 4;
}
export interface ReportTableData {
  dataset: ReportDataset;
  columns: ReportColumn[];
  rows: Record<string, string | null>[];
  pagination: Pagination;
  generatedAt: string;
  scopeNote: string;
}
export interface ReportOverviewData {
  purchaseAmount: string | null;
  monthPurchaseAmount: string;
  missingAllocationCount: string;
  pendingPackageCount: string;
  receivedQuantity: string;
  receivedCost: string;
  scopeNote: string;
  purchaseQuantity: string;
  purchaseOrderCount: string;
  pendingQuantity: string;
  pendingAmount: string | null;
  inventoryQuantity: string;
  inventoryCost: string;
  outboundQuantity: string;
  outboundCost: string;
  returnRefundAmount: string;
  returnStockCost: string;
  returnQuantity: string;
  generatedAt: string;
  timeZone: 'Asia/Shanghai';
}
export interface ReportExportData {
  fileName: string;
  csv: string;
  rowCount: number;
  generatedAt: string;
}

/** 库存调整原因：只允许这五类，方向规则见 ADJUSTMENT_REASON_DIRECTION。 */
export const ADJUSTMENT_REASONS = [
  'STOCKTAKE_GAIN',
  'STOCKTAKE_LOSS',
  'DAMAGED',
  'LOST',
  'OTHER',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];
export const ADJUSTMENT_REASON_LABELS: Readonly<Record<AdjustmentReason, string>> = Object.freeze({
  STOCKTAKE_GAIN: '盘点盘盈',
  STOCKTAKE_LOSS: '盘点盘亏',
  DAMAGED: '商品损坏',
  LOST: '商品丢失',
  OTHER: '其他原因',
});
/** 盘盈只能加、盘亏/损坏/丢失只能减；其他原因两个方向都允许。 */
export const ADJUSTMENT_REASON_DIRECTION: Readonly<Record<AdjustmentReason, 1 | -1 | 0>> =
  Object.freeze({ STOCKTAKE_GAIN: 1, STOCKTAKE_LOSS: -1, DAMAGED: -1, LOST: -1, OTHER: 0 });
/**
 * 调整成本的来源：减少一律按移动加权平均；增加在有库存时同样用平均成本，
 * 零库存盘盈先看商品参考进货价，两者都没有才记 0（成本未知，不应据此估值）。
 */
export const ADJUSTMENT_COST_SOURCES = ['AVERAGE', 'REFERENCE', 'ZERO'] as const;
export type AdjustmentCostSource = (typeof ADJUSTMENT_COST_SOURCES)[number];
export interface StockAdjustmentData {
  id: string;
  tenantId: string;
  adjustmentNo: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: AdjustmentReason;
  reasonLabel: string;
  remark: string | null;
  /** 本次调整采用的单位成本，四位小数字符串。 */
  unitCost: string;
  costDelta: string;
  totalCostBefore: string;
  totalCostAfter: string;
  costSource: AdjustmentCostSource;
  clientOperationId: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}
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

export const STOCK_MOVEMENT_TYPES = [
  'RECEIPT',
  'OUTBOUND',
  'ADJUSTMENT',
  'PURCHASE_RETURN',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export const PURCHASE_RETURN_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const;
export type PurchaseReturnStatus = (typeof PURCHASE_RETURN_STATUSES)[number];
export interface PurchaseReturnAllocationData {
  id: string;
  receiptId: string;
  receiptNo: string;
  receiptItemId: string;
  quantity: number;
  receivedUnitCost: string;
  receivedCost: string;
}
export interface PurchaseReturnItemData {
  estimatedRefundAmount: string;
  id: string;
  purchaseOrderItemId: string;
  productId: string;
  requestedReceiptItemId: string | null;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  stockUnitCost: string | null;
  stockCost: string | null;
  allocations: PurchaseReturnAllocationData[];
}
export interface PurchaseReturnData {
  confirmedByName: string | null;
  estimatedRefundAmount: string;
  id: string;
  tenantId: string;
  purchaseOrderId: string;
  purchaseOrderNo: string;
  warehouseId: string;
  warehouseName: string;
  returnNo: string;
  status: PurchaseReturnStatus;
  reason: string;
  returnDate: string;
  refundAmount: string;
  stockCost: string | null;
  receivedCost: string | null;
  remark: string | null;
  createdBy: string;
  createdByName: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  confirmOperationId: string | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseReturnItemData[];
}
export interface PurchaseReturnableData {
  purchaseOrderId: string;
  orderNo: string;
  warehouseId: string;
  items: {
    purchaseOrderItemId: string;
    productId: string;
    sku: string;
    name: string;
    unit: string;
    orderedQuantity: number;
    purchaseNetAmount: string;
    receivedQuantity: number;
    returnedQuantity: number;
    availableQuantity: number;
    stockQuantity: number;
    receipts: {
      receiptId: string;
      receiptNo: string;
      receiptItemId: string;
      receivedAt: string;
      receivedQuantity: number;
      returnedQuantity: number;
      availableQuantity: number;
    }[];
  }[];
}
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
  /** 来源单号（入库单号、出库单号、调整单号；历史调整行没有单号时为 null）。 */
  sourceNo: string | null;
  /** 来源单据行 ID，便于追溯具体凭证。 */
  sourceId: string;
  /** 来源单据头 ID（入库单 / 出库单 / 盘点单），可直接跳详情；没有单据头时为 null。 */
  sourceDocumentId: string | null;
  note: string | null;
  operatorId: string;
  operatorName: string;
}
