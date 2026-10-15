import { HttpException } from '@nestjs/common';
import type { ApiErrorCode } from '@caicang/api-contract';

export const ERRORS: Record<ApiErrorCode, { status: number; message: string }> = {
  BAD_REQUEST: { status: 400, message: '请求格式不正确' },
  VALIDATION_ERROR: { status: 400, message: '请求参数验证失败' },
  UNAUTHENTICATED: { status: 401, message: '请先登录' },
  FORBIDDEN: { status: 403, message: '没有操作权限' },
  NOT_FOUND: { status: 404, message: '资源不存在' },
  METHOD_NOT_ALLOWED: { status: 405, message: '不支持此请求方法' },
  RESOURCE_CONFLICT: { status: 409, message: '数据或操作冲突' },
  BUSINESS_VALIDATION_FAILED: { status: 422, message: '业务参数不符合要求' },
  RATE_LIMITED: { status: 429, message: '请求过于频繁，请稍后重试' },
  PAYLOAD_TOO_LARGE: { status: 413, message: '请求内容过大' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: '不支持此内容类型' },
  INTERNAL_ERROR: { status: 500, message: '服务暂时异常' },
  DATABASE_UNAVAILABLE: { status: 503, message: '数据库暂不可用' },
  SERVICE_UNAVAILABLE: { status: 503, message: '服务暂不可用' },
  OUT_OF_STOCK: { status: 409, message: '库存不足' },
  IDEMPOTENCY_CONFLICT: { status: 409, message: '操作标识与原请求不一致' },
  RECEIPT_QTY_EXCEEDED: { status: 409, message: '收货数量超过可收数量' },
  STATUS_CONFLICT: { status: 409, message: '当前状态不允许此操作' },
};
export class BusinessException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    readonly details: Record<string, unknown> = {},
  ) {
    super(ERRORS[code].message, ERRORS[code].status);
  }
}
