import type { ApiErrorResponse, ApiResponse, LoginData, PublicUser } from '@caicang/api-contract';

/**
 * 与 UI、uni API 完全解耦的会话客户端：存储、传输、时钟都从外部注入。
 * 这样同一份逻辑既能跑在 App/H5 里，也能在 Node 集成测试里对真实 API 执行。
 */
export const SESSION_KEY = 'caicang.mobile.session.v1';
export const TENANT_KEY = 'caicang.mobile.tenant.v1';

export interface MobileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TransportRequest {
  url: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  body?: unknown;
  timeout: number;
}

export interface TransportResponse {
  statusCode: number;
  data: unknown;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface Session {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  user: PublicUser;
  sessionKey: string;
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  /** 服务端 error.details，例如超收时的 maxReceivableQuantity、冲突时的 purchaseStatus。 */
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

export interface ClientOptions {
  baseUrl: string;
  storage: MobileStorage;
  transport: Transport;
  now?: () => number;
  timeoutMs?: number;
  /** 提前这么久刷新 access token，避免请求发出时刚好过期。 */
  refreshLeewayMs?: number;
  onSessionChange?: (session: Session | null) => void;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  tenantId?: string;
  token?: string;
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const strings = ['accessToken', 'refreshToken', 'sessionKey'];
  if (!strings.every((key) => typeof record[key] === 'string' && record[key] !== '')) return false;
  if (
    !['accessExpiresAt', 'refreshExpiresAt'].every((key) => Number.isFinite(record[key] as number))
  )
    return false;
  const user = record.user as Record<string, unknown> | undefined;
  return Boolean(user && typeof user.id === 'string' && typeof user.email === 'string');
}

function randomKey(): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  return 'session-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function createApiClient(options: ClientOptions) {
  const now = options.now ?? (() => Date.now());
  const timeout = options.timeoutMs ?? 15000;
  const leeway = options.refreshLeewayMs ?? 30000;
  const base = options.baseUrl.replace(/\/+$/, '');
  let refreshing: Promise<Session> | null = null;

  function readSession(): Session | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.storage.getItem(SESSION_KEY) ?? 'null');
    } catch {
      parsed = null;
    }
    return isSession(parsed) ? parsed : null;
  }

  function saveSession(session: Session | null): void {
    if (session) options.storage.setItem(SESSION_KEY, JSON.stringify(session));
    else options.storage.removeItem(SESSION_KEY);
    options.onSessionChange?.(session);
  }

  function requireSession(): Session {
    const session = readSession();
    if (!session) throw new ApiFailure(401, 'UNAUTHENTICATED', '请先登录');
    return session;
  }

  async function raw<T>(path: string, request: RequestOptions = {}): Promise<ApiResponse<T>> {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new ApiFailure(400, 'INVALID_PATH', '请求地址无效');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';
    if (request.token) headers.Authorization = 'Bearer ' + request.token;
    if (request.tenantId) headers['X-Tenant-Id'] = request.tenantId;
    let response: TransportResponse;
    try {
      response = await options.transport({
        url: base + path,
        method: request.method ?? 'GET',
        headers,
        timeout,
        ...(request.body === undefined ? {} : { body: request.body }),
      });
    } catch {
      throw new ApiFailure(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试');
    }
    const payload = response.data as
      (Partial<ApiResponse<T>> & Partial<ApiErrorResponse>) | null | undefined;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const failure = payload?.error;
      const message =
        response.statusCode === 429
          ? '操作过于频繁，请稍后再试'
          : typeof failure?.message === 'string' && failure.message.length <= 200
            ? failure.message
            : '请求未完成，请稍后重试';
      throw new ApiFailure(
        response.statusCode,
        failure?.code ?? 'HTTP_ERROR',
        message,
        payload?.requestId,
        failure?.details && typeof failure.details === 'object' ? failure.details : undefined,
      );
    }
    if (!payload || !('data' in payload))
      throw new ApiFailure(502, 'INVALID_RESPONSE', '服务响应异常，请稍后重试');
    return payload as ApiResponse<T>;
  }

  function fromLogin(data: LoginData, previous: Session | null): Session {
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessExpiresAt: now() + data.expiresIn * 1000,
      refreshExpiresAt: now() + data.refreshExpiresIn * 1000,
      user: data.user,
      sessionKey: previous?.sessionKey ?? randomKey(),
    };
  }

  /** 同一时刻只允许一个刷新请求；刷新凭证用过即废，失败就要求重新登录。 */
  function refresh(current: Session): Promise<Session> {
    if (refreshing) return refreshing;
    const task = (async () => {
      const stored = readSession();
      if (!stored || stored.sessionKey !== current.sessionKey)
        throw new ApiFailure(401, 'SESSION_CHANGED', '登录状态已改变，请重新登录');
      if (stored.refreshExpiresAt <= now()) {
        saveSession(null);
        throw new ApiFailure(401, 'SESSION_EXPIRED', '登录已过期，请重新登录');
      }
      try {
        const result = await raw<LoginData>('/auth/refresh', {
          method: 'POST',
          body: { refreshToken: stored.refreshToken },
        });
        const latest = readSession();
        if (!latest || latest.sessionKey !== stored.sessionKey)
          throw new ApiFailure(401, 'SESSION_CHANGED', '登录状态已改变，请重新登录');
        const next = fromLogin(result.data, stored);
        saveSession(next);
        return next;
      } catch (error) {
        saveSession(null);
        throw error instanceof ApiFailure
          ? error
          : new ApiFailure(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试');
      }
    })();
    refreshing = task;
    void task
      .catch(() => undefined)
      .finally(() => {
        refreshing = null;
      });
    return task;
  }

  async function request<T>(path: string, options_: Omit<RequestOptions, 'token'> = {}) {
    let session = requireSession();
    if (session.accessExpiresAt <= now() + leeway) session = await refresh(session);
    try {
      return await raw<T>(path, { ...options_, token: session.accessToken });
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.status !== 401) throw error;
      if (error.code === 'SESSION_CHANGED') throw error;
      const next = await refresh(session);
      return await raw<T>(path, { ...options_, token: next.accessToken });
    }
  }

  return {
    SESSION_KEY,
    TENANT_KEY,
    readSession,
    saveSession,
    request,
    async login(input: { email: string; password: string }): Promise<Session> {
      const result = await raw<LoginData>('/auth/login', { method: 'POST', body: input });
      const session = fromLogin(result.data, null);
      saveSession(session);
      options.storage.removeItem(TENANT_KEY);
      return session;
    },
    async logout(): Promise<void> {
      const current = readSession();
      if (!current) {
        saveSession(null);
        return;
      }
      try {
        await raw('/auth/logout', {
          method: 'POST',
          body: { refreshToken: current.refreshToken },
          token: current.accessToken,
        });
      } catch {
        // 网络异常也必须先让本机退出，否则用户会卡在已失效的会话里。
      }
      saveSession(null);
      options.storage.removeItem(TENANT_KEY);
    },
    async refreshNow(): Promise<Session> {
      return await refresh(requireSession());
    },
    async profile(): Promise<PublicUser> {
      const result = await request<PublicUser>('/me');
      const session = readSession();
      if (session) saveSession({ ...session, user: result.data });
      return result.data;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
