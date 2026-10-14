<script setup lang="ts">
import { ref } from 'vue';
import { getHealth } from '../../services/health';

const busy = ref(false);
const message = ref('项目骨架已建立，业务功能将在后续开放');

async function checkConnection(): Promise<void> {
  busy.value = true;
  try {
    const result = await getHealth();
    message.value = result.data.database === 'reachable' ? '服务与数据库连接正常' : '连接异常';
  } catch {
    message.value = '连接失败，请确认服务地址与网络后重试';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <view class="home">
    <text class="title">采仓管家</text>
    <text class="description">采购 · 验收 · 库存 · 发货</text>
    <view class="card">
      <text>{{ message }}</text>
      <button :loading="busy" :disabled="busy" @click="checkConnection">检查服务连接</button>
    </view>
  </view>
</template>

<style scoped>
.home {
  padding: 40px 24px;
}
.title {
  display: block;
  font-size: 30px;
  font-weight: bold;
}
.description {
  display: block;
  margin: 16px 0 32px;
  color: #60766b;
}
.card {
  padding: 24px;
  background: white;
  border-radius: 12px;
}
button {
  margin-top: 24px;
  background: #17382d;
  color: white;
}
</style>
