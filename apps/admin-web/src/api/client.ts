import type { ApiResponse, LoginData, PublicUser, RegisterData } from '@caicang/api-contract';

export const SESSION_KEY = 'caicang.auth.v1';
export interface SavedSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  sessionKey: string;
  revision: string;
}
export interface ClientOptions {
  baseUrl: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  lock: <T>(work: () => Promise<T>) => Promise<T>;
  onSession?: (session: SavedSession | null) => void;
  onLoading?: (delta: number) => void;
  fetcher?: typeof fetch;
  now?: () => number;
}
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    /** 服务端结构化原因，例如库存不足时的 shortages 列表。 */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export function createApiClient(options: ClientOptions) {
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');
  let active: SavedSession | null = null;
  function sync(): SavedSession | null {
    try {
      const parsed: unknown = JSON.parse(options.storage.getItem(SESSION_KEY) ?? 'null');
      if (
        parsed &&
        typeof parsed === 'object' &&
        ['accessToken', 'refreshToken', 'sessionKey', 'revision'].every(
          (key) =>
            typeof Reflect.get(parsed, key) === 'string' && Reflect.get(parsed, key).length > 0,
        ) &&
        ['accessExpiresAt', 'refreshExpiresAt'].every((key) =>
          Number.isFinite(Reflect.get(parsed, key)),
        )
      ) {
        active = parsed as SavedSession;
      } else active = null;
    } catch {
      active = null;
    }
    options.onSession?.(active);
    return active;
  }
  function save(session: SavedSession | null) {
    if (session) options.storage.setItem(SESSION_KEY, JSON.stringify(session));
    else options.storage.removeItem(SESSION_KEY);
    active = session;
    options.onSession?.(active);
  }
  function ended(): never {
    throw new ApiFailure(401, 'SESSION_ENDED', '登录已过期，请重新登录');
  }
  function sameSession(expected: SavedSession) {
    const current = sync();
    if (!current || current.sessionKey !== expected.sessionKey)
      throw new ApiFailure(401, 'SESSION_CHANGED', '登录状态已改变，请重新打开此页面');
    return current;
  }
  function clearIfCurrent(expected: SavedSession) {
    if (sync()?.sessionKey === expected.sessionKey) save(null);
  }
  async function raw<T>(
    path: string,
    init: { method?: string; body?: unknown; token?: string; tenantId?: string } = {},
  ): Promise<ApiResponse<T>> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path');
    options.onLoading?.(1);
    try {
      let response: Response;
      try {
        response = await fetcher(base + path, {
          method: init.method ?? 'GET',
          credentials: 'omit',
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
          headers: {
            ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
            ...(init.tenantId ? { 'X-Tenant-Id': init.tenantId } : {}),
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        });
      } catch {
        throw new ApiFailure(0, 'NETWORK_ERROR', '暂时无法连接服务，请检查网络后重试');
      }
      const body = (await response.json().catch(() => null)) as {
        data?: T;
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
        requestId?: string;
      } | null;
      if (!response.ok) {
        const message = body?.error?.message;
        throw new ApiFailure(
          response.status,
          body?.error?.code ?? 'HTTP_ERROR',
          response.status === 429
            ? '操作过于频繁，请稍后再试'
            : typeof message === 'string' && message.length <= 200
              ? message
              : '请求未完成，请稍后重试',
          body?.requestId,
          body?.error?.details ?? {},
        );
      }
      if (!body || !('data' in body))
        throw new ApiFailure(502, 'INVALID_RESPONSE', '服务响应异常，请稍后重试');
      return body as ApiResponse<T>;
    } finally {
      options.onLoading?.(-1);
    }
  }
  function fromLogin(data: LoginData, sessionKey: string = crypto.randomUUID()): SavedSession {
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessExpiresAt: now() + data.expiresIn * 1000,
      refreshExpiresAt: now() + data.refreshExpiresIn * 1000,
      sessionKey,
      revision: crypto.randomUUID(),
    };
  }
  async function refresh(expected: SavedSession): Promise<SavedSession> {
    return options.lock(async () => {
      const current = sameSession(expected);
      if (current.revision !== expected.revision && current.accessExpiresAt > now() + 30000)
        return current;
      if (current.refreshExpiresAt <= now()) {
        clearIfCurrent(current);
        return ended();
      }
      try {
        // Never retry a consumed refresh credential, including an ambiguous network failure.
        const result = await raw<LoginData>('/auth/refresh', {
          method: 'POST',
          body: { refreshToken: current.refreshToken },
        });
        sameSession(current);
        const next = fromLogin(result.data, current.sessionKey);
        save(next);
        return next;
      } catch (error) {
        clearIfCurrent(current);
        throw error;
      }
    });
  }
  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown; tenantId?: string } = {},
  ): Promise<ApiResponse<T>> {
    let session = sync();
    if (!session) return ended();
    if (session.accessExpiresAt <= now() + 30000) session = await refresh(session);
    try {
      const response = await raw<T>(path, { ...init, token: session.accessToken });
      sameSession(session);
      return response;
    } catch (error) {
      if (
        !(error instanceof ApiFailure) ||
        error.status !== 401 ||
        error.code === 'SESSION_CHANGED'
      )
        throw error;
      const next = await refresh(session);
      try {
        const result = await raw<T>(path, { ...init, token: next.accessToken });
        sameSession(next);
        return result;
      } catch (retryError) {
        if (
          retryError instanceof ApiFailure &&
          retryError.status === 401 &&
          retryError.code !== 'SESSION_CHANGED'
        )
          clearIfCurrent(next);
        throw retryError;
      }
    }
  }
  return {
    sync,
    request,
    async register(input: { email: string; password: string; displayName?: string }) {
      return (await raw<RegisterData>('/auth/register', { method: 'POST', body: input })).data;
    },
    async login(input: { email: string; password: string }): Promise<PublicUser> {
      return options.lock(async () => {
        const data = (await raw<LoginData>('/auth/login', { method: 'POST', body: input })).data;
        save(fromLogin(data));
        return data.user;
      });
    },
    async logout() {
      return options.lock(async () => {
        const current = sync();
        if (!current) return;
        await raw('/auth/logout', { method: 'POST', body: { refreshToken: current.refreshToken } });
        clearIfCurrent(current);
      });
    },
  };
}
