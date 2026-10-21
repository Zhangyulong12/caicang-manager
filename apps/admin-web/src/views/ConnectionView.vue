<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Connection } from '@element-plus/icons-vue';
const router = useRouter();
const retrying = ref(false);
async function retry() {
  retrying.value = true;
  try {
    await router.replace('/');
  } finally {
    retrying.value = false;
  }
}
</script>
<template>
  <main class="status-page">
    <el-icon :size="48"><Connection /></el-icon>
    <h1>暂时无法连接工作空间</h1>
    <p class="muted">请检查网络连接，或联系管理员确认服务状态，再重新连接。</p>
    <el-button type="primary" :loading="retrying" @click="retry">重新连接</el-button>
  </main>
</template>
