import { reactive } from 'vue';
import type {
  ApiPageResponse,
  CurrentTenantData,
  PublicUser,
  TenantChoiceData,
  TenantPermission,
} from '@caicang/api-contract';
import { api, ApiFailure, TENANT_KEY } from '../api';
import { errorMessage } from '../utils/feedback';

const CACHE_KEY = 'caicang.mobile.cache.v1';
const EMAIL_KEY = 'caicang.mobile.last-email.v1';

export interface SessionState {
  user: PublicUser | null;
  currentTenant: CurrentTenantData | null;
  tenants: TenantChoiceData[];
  ready: boolean;
  busy: boolean;
  lastError: string | null;
}

export const session = reactive<SessionState>({
  user: null,
  currentTenant: null,
  tenants: [],
  ready: false,
  busy: false,
  lastError: null,
});

interface CacheSnapshot {
  tenants: TenantChoiceData[];
  currentTenant: CurrentTenantData | null;
}

function readCache(): CacheSnapshot {
  try {
    const parsed: unknown = JSON.parse(uni.getStorageSync(CACHE_KEY) || 'null');
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Partial<CacheSnapshot>;
      return {
        tenants: Array.isArray(record.tenants) ? record.tenants : [],
        currentTenant: record.currentTenant ?? null,
      };
    }
  } catch {
    /* 缓存损坏时按空处理，重新从服务端拉取。 */
  }
  return { tenants: [], currentTenant: null };
}

function writeCache(): void {
  const snapshot: CacheSnapshot = {
    tenants: session.tenants,
    currentTenant: session.currentTenant,
  };
  uni.setStorageSync(CACHE_KEY, JSON.stringify(snapshot));
}

export function preferredTenantId(): string | null {
  const value = uni.getStorageSync(TENANT_KEY);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function lastEmail(): string {
  const value = uni.getStorageSync(EMAIL_KEY);
  return typeof value === 'string' ? value : '';
}

function rememberEmail(email: string): void {
  uni.setStorageSync(EMAIL_KEY, email);
}

export function isSignedIn(): boolean {
  return Boolean(session.user);
}

export function can(permission: TenantPermission): boolean {
  return session.currentTenant?.permissions.includes(permission) ?? false;
}

export function resetSession(): void {
  session.user = null;
  session.currentTenant = null;
  session.tenants = [];
  session.lastError = null;
  session.ready = true;
}

function clearLocal(): void {
  api.saveSession(null);
  uni.removeStorageSync(CACHE_KEY);
  uni.removeStorageSync(TENANT_KEY);
  resetSession();
}

export async function loadTenants(): Promise<void> {
  const collected: TenantChoiceData[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = (await api.request<TenantChoiceData[]>(
      `/tenants?page=${page}&pageSize=100`,
    )) as ApiPageResponse<TenantChoiceData>;
    collected.push(...result.data);
    if (collected.length >= result.pagination.total || result.data.length === 0) break;
  }
  session.tenants = collected;
}

export async function selectTenant(tenantId: string): Promise<CurrentTenantData> {
  const result = await api.request<CurrentTenantData>('/tenants/current', { tenantId });
  session.currentTenant = result.data;
  uni.setStorageSync(TENANT_KEY, tenantId);
  writeCache();
  return result.data;
}

async function restoreTenant(): Promise<void> {
  const candidate =
    session.tenants.find((choice) => choice.tenant.id === preferredTenantId()) ??
    session.tenants[0];
  if (!candidate) {
    session.currentTenant = null;
    writeCache();
    return;
  }
  if (
    session.currentTenant?.tenant.id === candidate.tenant.id &&
    session.currentTenant.permissions.length > 0
  )
    return;
  await selectTenant(candidate.tenant.id);
}

export async function bootstrap(): Promise<void> {
  const stored = api.readSession();
  if (!stored) {
    resetSession();
    return;
  }
  session.user = stored.user;
  const cache = readCache();
  session.tenants = cache.tenants;
  session.currentTenant = cache.currentTenant;
  try {
    session.user = await api.profile();
    await loadTenants();
    await restoreTenant();
    session.lastError = null;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 401) {
      clearLocal();
    } else {
      // 断网时保留本地缓存，首页仍可打开并提示"离线"。
      session.lastError = errorMessage(error);
    }
  } finally {
    session.ready = true;
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  session.busy = true;
  try {
    const stored = await api.login({ email: email.trim(), password });
    session.user = stored.user;
    rememberEmail(email.trim());
    // 登录已成功，商家列表拉取失败不应把用户挡在登录页外，首页会提示并可重试。
    try {
      await loadTenants();
      await restoreTenant();
      session.lastError = null;
    } catch (error) {
      session.lastError = errorMessage(error);
    }
  } finally {
    session.busy = false;
  }
}

export async function signOut(): Promise<void> {
  session.busy = true;
  try {
    await api.logout();
    clearLocal();
  } finally {
    session.busy = false;
  }
}

export async function refreshTenant(): Promise<void> {
  await loadTenants();
  await restoreTenant();
}
