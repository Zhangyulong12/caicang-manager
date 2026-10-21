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
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export interface PurchaseItemData {
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
