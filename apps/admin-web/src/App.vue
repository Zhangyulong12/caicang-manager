<script setup lang="ts">
import { ref } from 'vue';
import { getHealth } from './api/health';

const state = ref<'idle' | 'loading' | 'ok' | 'error'>('idle');
const message = ref('点击检查服务连接');

async function checkConnection(): Promise<void> {
  state.value = 'loading';
  try {
    const result = await getHealth();
    state.value = 'ok';
    message.value = `服务与数据库连接正常 · ${new Date(result.data.timestamp).toLocaleString('zh-CN')}`;
  } catch {
    state.value = 'error';
    message.value = '连接失败，请确认服务已启动后重试';
  }
}
</script>

<template>
  <main class="welcome">
    <p class="eyebrow">CAICANG MANAGER</p>
    <h1>采仓管家</h1>
    <p class="subtitle">让每一次采购、收货和发货都有迹可循。</p>
    <el-card shadow="never">
      <h2>开发环境已就绪</h2>
      <p>当前已建立项目骨架，采购与库存功能将在后续任务中逐步开放。</p>
      <div class="connection">
        <el-tag :type="state === 'ok' ? 'success' : state === 'error' ? 'danger' : 'info'">{{
          message
        }}</el-tag>
        <el-button type="primary" :loading="state === 'loading'" @click="checkConnection"
          >检查连接</el-button
        >
      </div>
    </el-card>
  </main>
</template>

<style>
body {
  margin: 0;
  background: #f4f7f5;
  color: #17382d;
  font-family: 'Microsoft YaHei', sans-serif;
}
.welcome {
  max-width: 840px;
  margin: 12vh auto;
  padding: 24px;
}
.eyebrow {
  letter-spacing: 0.18em;
  font-size: 13px;
  color: #60766b;
}
h1 {
  font-size: 48px;
  margin: 16px 0;
}
h2 {
  font-size: 22px;
}
.subtitle {
  color: #60766b;
  margin-bottom: 36px;
}
.connection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-top: 24px;
}
</style>
