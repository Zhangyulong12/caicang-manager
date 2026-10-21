<script setup lang="ts">
import { useAuthStore } from './stores/auth';
import { ElConfigProvider } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
const auth = useAuthStore();
</script>
<template>
  <el-config-provider :locale="zhCn">
    <div v-if="auth.busy" class="network-progress" role="status" aria-label="正在加载"></div>
    <router-view></router-view>
  </el-config-provider>
</template>
