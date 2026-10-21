import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { PublicUser } from '@caicang/api-contract';
import { createApiClient, ApiFailure } from '../api/client';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<PublicUser | null>(null);
  const sessionKey = ref<string | null>(null);
  const initialized = ref(false);
  const pending = ref(0);
  let initialization: Promise<void> | null = null;
  const client = createApiClient({
    baseUrl: import.meta.env.VITE_API_BASE_URL || '/api/v1',
    storage: window.localStorage,
    lock: async (work) => {
      if (!navigator.locks)
        return Promise.reject(
          new ApiFailure(
            0,
            'BROWSER_UNSUPPORTED',
            '请使用支持安全会话协调的新版 Chrome 或 Edge 浏览器',
          ),
        );
      return await navigator.locks.request('caicang.auth.v1', work);
    },
    onLoading: (delta) => {
      pending.value += delta;
    },
    onSession: (session) => {
      const key = session?.sessionKey ?? null;
      if (key !== sessionKey.value) {
        user.value = null;
        initialized.value = false;
      }
      sessionKey.value = key;
    },
  });
  async function initialize() {
    client.sync();
    if (initialized.value) return;
    if (initialization) return initialization;
    initialization = (async () => {
      if (sessionKey.value) {
        try {
          user.value = (await client.request<PublicUser>('/me')).data;
        } catch (error) {
          if (sessionKey.value) throw error;
        }
      }
      initialized.value = true;
    })().finally(() => {
      initialization = null;
    });
    return initialization;
  }
  async function login(email: string, password: string) {
    user.value = await client.login({ email, password });
    initialized.value = true;
  }
  async function logout() {
    await client.logout();
    user.value = null;
    initialized.value = true;
  }
  return {
    user,
    sessionKey,
    initialized,
    pending,
    busy: computed(() => pending.value > 0),
    client,
    initialize,
    login,
    logout,
  };
});
