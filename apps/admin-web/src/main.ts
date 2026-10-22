import { createApp, watch } from 'vue';
import { createPinia } from 'pinia';
import {
  ElAlert,
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElDialog,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElPagination,
  ElSkeleton,
  ElTag,
  ElMessage,
  ElTable,
  ElTableColumn,
  ElSelect,
  ElOption,
  ElSwitch,
  ElEmpty,
} from 'element-plus';
import 'element-plus/dist/index.css';
import App from './App.vue';
import './style.css';
import './catalog.css';
import './purchases.css';
import { router } from './router';
import { useAuthStore } from './stores/auth';
import { useTenantStore } from './stores/tenant';
import { SESSION_KEY } from './api/client';
import { safeRedirect } from './router/policy';

const app = createApp(App);
app.use(createPinia());
for (const component of [
  ElAlert,
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElDialog,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElPagination,
  ElSkeleton,
  ElTag,
  ElTable,
  ElTableColumn,
  ElSelect,
  ElOption,
  ElSwitch,
  ElEmpty,
])
  app.component(component.name!, component);
const auth = useAuthStore();
const tenants = useTenantStore();
watch(
  () => auth.sessionKey,
  (next, previous) => {
    if (next !== previous) tenants.reset();
    if (!next && previous)
      void router.replace({
        path: '/login',
        query: { redirect: safeRedirect(router.currentRoute.value.path) },
      });
  },
);
window.addEventListener('storage', (event) => {
  if (event.key !== SESSION_KEY && event.key !== null) return;
  const previous = auth.sessionKey;
  auth.client.sync();
  if (previous !== auth.sessionKey)
    void router.replace(auth.sessionKey ? '/select-tenant' : '/login');
});
router.onError(() => ElMessage.error('页面加载失败，请刷新后重试'));
app.config.errorHandler = () => ElMessage.error('页面暂时出现异常，请刷新后重试');
app.use(router).mount('#app');
