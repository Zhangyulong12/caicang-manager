import { ref } from 'vue';
import { defineStore } from 'pinia';
import type {
  ApiPageResponse,
  CreatedTenantData,
  CurrentTenantData,
  TenantChoiceData,
} from '@caicang/api-contract';
import { useAuthStore } from './auth';

export const useTenantStore = defineStore('tenant', () => {
  const current = ref<CurrentTenantData | null>(null);
  const choices = ref<TenantChoiceData[]>([]);
  const total = ref(0);
  const page = ref(1);
  let generation = 0;
  function preferenceKey() {
    return 'caicang.tenant.' + (useAuthStore().user?.id ?? '');
  }
  function reset() {
    generation++;
    current.value = null;
    choices.value = [];
    total.value = 0;
    page.value = 1;
  }
  function forget() {
    localStorage.removeItem(preferenceKey());
    generation++;
    current.value = null;
  }
  async function list(targetPage = 1) {
    const version = generation;
    const result = (await useAuthStore().client.request<TenantChoiceData[]>(
      `/tenants?page=${targetPage}&pageSize=20`,
    )) as ApiPageResponse<TenantChoiceData>;
    if (generation !== version) return;
    choices.value = result.data;
    total.value = result.pagination.total;
    page.value = targetPage;
  }
  async function select(id: string) {
    const version = ++generation;
    current.value = null;
    const result = await useAuthStore().client.request<CurrentTenantData>('/tenants/current', {
      tenantId: id,
    });
    if (generation !== version) return false;
    current.value = result.data;
    localStorage.setItem(preferenceKey(), id);
    return true;
  }
  async function restore() {
    const id = current.value?.tenant.id ?? localStorage.getItem(preferenceKey());
    if (!id) return false;
    return select(id);
  }
  async function create(name: string) {
    const result = await useAuthStore().client.request<CreatedTenantData>('/tenants', {
      method: 'POST',
      body: { name },
    });
    return select(result.data.tenant.id);
  }
  return { current, choices, total, page, reset, forget, list, select, restore, create };
});
