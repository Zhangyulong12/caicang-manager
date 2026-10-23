<script setup lang="ts">
import { online } from '../services/network';
</script>

<template>
  <view v-if="!online" class="offline">
    <text class="offline-text">当前网络已断开，操作会在联网后生效</text>
  </view>
</template>

<style scoped>
.offline {
  background: #b03a2e;
  padding: 16rpx 24rpx;
}

.offline-text {
  color: #ffffff;
  font-size: 26rpx;
}
</style>
