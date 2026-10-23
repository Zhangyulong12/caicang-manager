<script setup lang="ts">
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import type { ApiPageResponse, ReceiptData } from '@caicang/api-contract';
import NetworkBanner from '../../components/NetworkBanner.vue';
import { api } from '../../api';
import { session } from '../../stores/session';
import { errorMessage } from '../../utils/feedback';
import { requireSignIn } from '../../utils/guard';

const PAGE_SIZE = 20;

const items = ref<ReceiptData[]>([]);
const total = ref(0);
const page = ref(0);
const loading = ref(false);
const loaded = ref(false);
const error = ref('');

const finished = computed(() => loaded.value && items.value.length >= total.value);

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (input: number) => String(input).padStart(2, '0');
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  );
}

function formatMoney(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : value;
}

async function load(reset: boolean): Promise<void> {
  if (loading.value) return;
  if (!reset && finished.value) return;
  loading.value = true;
  error.value = '';
  const next = reset ? 1 : page.value + 1;
  try {
    const result = (await api.request<ReceiptData[]>(
      `/receipts?page=${next}&pageSize=${PAGE_SIZE}`,
      { tenantId: session.currentTenant?.tenant.id },
    )) as ApiPageResponse<ReceiptData>;
    items.value = reset ? result.data : [...items.value, ...result.data];
    total.value = result.pagination.total;
    page.value = next;
    loaded.value = true;
  } catch (failure) {
    error.value = errorMessage(failure);
    if (reset) items.value = [];
  } finally {
    loading.value = false;
  }
}

onShow(async () => {
  if (!(await requireSignIn())) return;
  if (!session.currentTenant) return;
  if (!loaded.value) await load(true);
});

onPullDownRefresh(async () => {
  await load(true);
  uni.stopPullDownRefresh();
});

onReachBottom(async () => {
  await load(false);
});
</script>

<template>
  <view class="records">
    <NetworkBanner />
    <view class="container">
      <view v-if="!session.currentTenant" class="state card">
        <text class="state-text">请先在首页选择商家</text>
      </view>

      <view v-else-if="error && items.length === 0" class="state card">
        <text class="state-text">{{ error }}</text>
        <button class="btn btn-ghost retry" @click="load(true)">重新加载</button>
      </view>

      <view v-else-if="loading && items.length === 0" class="state card">
        <text class="state-text">正在加载入库记录…</text>
      </view>

      <view v-else-if="items.length === 0" class="state card">
        <text class="state-text">还没有入库记录</text>
        <text class="state-hint">完成第一次扫码入库后会显示在这里</text>
      </view>

      <view v-else class="list">
        <view v-for="item in items" :key="item.id" class="card row">
          <view class="row-head">
            <text class="no">{{ item.receiptNo }}</text>
            <text class="time">{{ formatTime(item.receivedAt) }}</text>
          </view>
          <text class="line">采购单 {{ item.purchaseOrderNo }} · 运单 {{ item.trackingNo }}</text>
          <view class="row-foot">
            <text class="quantity">{{ item.totalQuantity }} 件</text>
            <text class="cost">¥{{ formatMoney(item.totalCost) }}</text>
          </view>
        </view>

        <view class="footer">
          <text v-if="loading" class="muted">正在加载…</text>
          <text v-else-if="finished" class="muted">没有更多了</text>
          <button v-else class="btn btn-ghost" @click="load(false)">加载更多</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.records {
  min-height: 100vh;
}

.state {
  margin-top: 24rpx;
  text-align: center;
}

.state-text {
  display: block;
  font-size: 30rpx;
  color: #3d574c;
}

.state-hint {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #7b8b83;
}

.retry {
  margin-top: 28rpx;
}

.list {
  padding-top: 24rpx;
}

.row {
  margin-bottom: 24rpx;
}

.row-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.no {
  font-size: 30rpx;
  font-weight: 700;
  color: #17382d;
}

.time {
  font-size: 24rpx;
  color: #7b8b83;
}

.line {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #6b7f75;
  line-height: 1.5;
}

.row-foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 20rpx;
}

.quantity {
  font-size: 34rpx;
  font-weight: 700;
  color: #17382d;
}

.cost {
  font-size: 30rpx;
  color: #2f8f6a;
  font-weight: 600;
}

.footer {
  padding: 16rpx 0 48rpx;
  text-align: center;
}
</style>
