<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { ArrowDown, SwitchButton } from '@element-plus/icons-vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useTenantStore } from '../stores/tenant';
import { failureMessage } from '../utils/feedback';
const auth = useAuthStore();
const tenants = useTenantStore();
const router = useRouter();
const loggingOut = ref(false);
async function logout() {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await auth.logout();
    tenants.reset();
    await router.replace('/login');
    ElMessage.success('已安全退出登录');
  } catch (error) {
    ElMessage.error('退出未完成：' + failureMessage(error));
  } finally {
    loggingOut.value = false;
  }
}
</script>
<template>
  <el-dropdown trigger="click" @command="logout"
    ><button class="user-trigger" type="button" :disabled="loggingOut" aria-label="用户菜单">
      <span class="avatar">{{ auth.user?.displayName.slice(0, 1).toUpperCase() || 'U' }}</span
      ><span class="user-caption"
        ><strong>{{ auth.user?.displayName }}</strong
        ><small>{{ auth.user?.email }}</small></span
      ><el-icon><ArrowDown /></el-icon></button
    ><template #dropdown
      ><el-dropdown-menu
        ><el-dropdown-item command="logout" :icon="SwitchButton" :disabled="loggingOut">{{
          loggingOut ? '正在退出…' : '退出登录'
        }}</el-dropdown-item></el-dropdown-menu
      ></template
    ></el-dropdown
  >
</template>
