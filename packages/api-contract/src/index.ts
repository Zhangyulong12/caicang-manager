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
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export interface ApiErrorResponse {
  error: { code: ApiErrorCode; message: string; details: Record<string, unknown> };
  requestId: string;
}
