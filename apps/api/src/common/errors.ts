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
  EMAIL_ALREADY_EXISTS: { status: 409, message: '此邮箱已注册' },
  INVALID_CREDENTIALS: { status: 401, message: '邮箱或密码不正确' },
  INVALID_ACCESS_TOKEN: { status: 401, message: '登录凭证无效或已过期，请重新登录' },
  INVALID_REFRESH_TOKEN: { status: 401, message: '刷新凭证无效或已过期，请重新登录' },
  INVALID_TENANT_HEADER: { status: 400, message: '请提供唯一有效的 X-Tenant-Id 商家标识' },
  MEMBER_ALREADY_EXISTS: { status: 409, message: '此用户已加入当前商家' },
  PRODUCT_SKU_ALREADY_EXISTS: { status: 409, message: '当前商家已存在相同 SKU 编码' },
  PRODUCT_BARCODE_ALREADY_EXISTS: { status: 409, message: '当前商家已存在相同商品条码' },
  WAREHOUSE_CODE_ALREADY_EXISTS: { status: 409, message: '当前商家已存在相同仓库编码' },
  PURCHASE_ORDER_NO_ALREADY_EXISTS: { status: 409, message: '当前商家已存在相同采购单号' },
  PURCHASE_ACCOUNT_ALREADY_EXISTS: { status: 409, message: '当前商家此平台已存在相同账号别名' },
  PURCHASE_ACCOUNT_INACTIVE: { status: 409, message: '采购账号已停用，请启用或选择其他账号' },
  PURCHASE_ACCOUNT_PLATFORM_MISMATCH: { status: 422, message: '采购账号与采购平台不匹配' },
  PURCHASE_ACCOUNT_PLATFORM_LOCKED: { status: 409, message: '已关联采购记录的账号不能修改平台' },
  PURCHASE_ACCOUNT_HAS_ORDERS: { status: 409, message: '该账号已有采购记录，不能删除；可改为停用' },
  PACKAGE_TRACKING_ALREADY_EXISTS: { status: 409, message: '当前商家此快递公司和运单号已绑定包裹' },
  PACKAGE_EXPECTED_QTY_EXCEEDED: { status: 409, message: '全部包裹预计数量超过采购明细数量' },
};
export class BusinessException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    readonly details: Record<string, unknown> = {},
  ) {
    super(ERRORS[code].message, ERRORS[code].status);
  }
}
