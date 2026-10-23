import type { MobileStorage } from '../api/client';

/**
 * 仓库现场的操作留痕：扫码、提交成功、提交失败、网络中断都记一条。
 * 只存在本机（App 私有目录），用于"刚才到底点了什么、报了什么错"的追溯；
 * 服务端的审计日志仍然是入库事实的唯一来源。
 */
export const OPERATION_LOG_KEY = 'caicang.mobile.operation-log.v1';
export const OPERATION_LOG_LIMIT = 50;

export type OperationKind = 'receipt' | 'error' | 'scan';

export interface OperationEntry {
  at: number;
  kind: OperationKind;
  title: string;
  detail: string;
  ok: boolean;
}

export function appendOperation(
  storage: MobileStorage,
  entry: Omit<OperationEntry, 'at'>,
  now: number = Date.now(),
): OperationEntry {
  const record: OperationEntry = { ...entry, at: now };
  const next = [record, ...readOperations(storage)].slice(0, OPERATION_LOG_LIMIT);
  storage.setItem(OPERATION_LOG_KEY, JSON.stringify(next));
  return record;
}

export function readOperations(storage: MobileStorage): OperationEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(OPERATION_LOG_KEY) ?? 'null');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is OperationEntry =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as OperationEntry).title === 'string' &&
        typeof (item as OperationEntry).at === 'number',
    );
  } catch {
    return [];
  }
}

export function clearOperations(storage: MobileStorage): void {
  storage.removeItem(OPERATION_LOG_KEY);
}

/** 日志里只留时分秒，仓库同事看的是"刚刚"而不是日期。 */
export function operationClock(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  const pad = (input: number) => String(input).padStart(2, '0');
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}
