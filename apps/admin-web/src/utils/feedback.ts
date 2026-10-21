import { ApiFailure } from '../api/client';
export function failureMessage(error: unknown): string {
  return error instanceof ApiFailure
    ? error.message + (error.requestId ? `（请求编号 ${error.requestId}）` : '')
    : '操作未完成，请稍后重试';
}
