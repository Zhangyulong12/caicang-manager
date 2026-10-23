import type { PackageLookupData } from '@caicang/api-contract';
import type { ApiClient } from '../api/client';

/** 与后端 PackageLookupQueryDto 的上限保持一致。 */
export const MAX_TRACKING_LENGTH = 128;
/** 同一单号在这个窗口内重复扫码不再发请求。 */
export const DUPLICATE_WINDOW_MS = 3000;

export type ScanInputCode = 'EMPTY' | 'TOO_LONG' | 'INVALID';
export type ScanGate = 'ok' | 'busy' | 'duplicate';

export class ScanInputError extends Error {
  readonly code: ScanInputCode;

  constructor(code: ScanInputCode, message: string) {
    super(message);
    this.name = 'ScanInputError';
    this.code = code;
  }
}

/**
 * 扫码结果是原样字符串，必须保留前导零（"000783456123" 不能变成数字 783456123），
 * 因此这里只裁剪首尾空白，不做任何数字化、大小写或补零处理。
 */
export function normalizeTrackingNo(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) throw new ScanInputError('EMPTY', '请扫描或输入运单号');
  if (value.length > MAX_TRACKING_LENGTH)
    throw new ScanInputError('TOO_LONG', '运单号不能超过 ' + MAX_TRACKING_LENGTH + ' 个字符');
  // 只允许可打印字符：扫码枪偶尔会把不可见的控制符带进结果。
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value))
    throw new ScanInputError('INVALID', '运单号包含无法识别的控制字符');
  return value;
}

/** 查询本身放在这里，页面只负责渲染，测试可以直接对真实接口执行。 */
export async function lookupPackages(
  api: ApiClient,
  trackingNo: string,
  tenantId?: string,
): Promise<PackageLookupData[]> {
  const code = normalizeTrackingNo(trackingNo);
  const response = await api.request<PackageLookupData[]>(
    '/packages/lookup?trackingNo=' + encodeURIComponent(code),
    { tenantId },
  );
  return response.data;
}

export type LookupOutcome = 'single' | 'multiple' | 'none';

export function classifyLookup(candidates: readonly PackageLookupData[]): LookupOutcome {
  if (candidates.length === 0) return 'none';
  return candidates.length === 1 ? 'single' : 'multiple';
}

/**
 * 扫码防抖：一次查询没结束前不再响应新的扫码结果；同一个单号在时间窗内重复上报直接忽略。
 * 用户主动点"重新扫码"时调用 reset()，允许再次扫同一个箱子。
 */
export class ScanGuard {
  private inFlight = false;
  private lastCode = '';
  private lastAt = 0;

  begin(code: string, now: number = Date.now()): ScanGate {
    if (this.inFlight) return 'busy';
    if (code === this.lastCode && now - this.lastAt < DUPLICATE_WINDOW_MS) return 'duplicate';
    this.inFlight = true;
    this.lastCode = code;
    this.lastAt = now;
    return 'ok';
  }

  end(): void {
    this.inFlight = false;
  }

  reset(): void {
    this.inFlight = false;
    this.lastCode = '';
    this.lastAt = 0;
  }
}
