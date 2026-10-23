<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import type { ApiPageResponse, PackageData, ReceiptData } from '@caicang/api-contract';
import NetworkBanner from '../../components/NetworkBanner.vue';
import { api } from '../../api';
import { session, can } from '../../stores/session';
import { errorMessage } from '../../utils/feedback';
import { requireSignIn } from '../../utils/guard';
import {
  formatTime,
  packageStatusNames,
  packageTone,
  receivingStatusNames,
} from '../../utils/package';

const RECEIPT_PAGE_SIZE = 10;

const packageId = ref('');
const detail = ref<PackageData | null>(null);
const receipts = ref<ReceiptData[]>([]);
const loading = ref(false);
const error = ref('');
const receiptNote = ref('');
/** 从收货页返回时强制刷新，避免还显示收货前的数量。 */
const stale = ref(false);
const canReceive = computed(() => {
  if (!can('receiving:confirm') || !detail.value) return false;
  return detail.value.receivingStatus !== 'RECEIVED' && detail.value.status !== 'RECEIVED';
});
const planTotal = computed(() =>
  detail.value
    ? detail.value.expectedItems.reduce((sum, item) => sum + item.expectedQuantity, 0)
    : 0,
);

onLoad((options) => {
  packageId.value = String(options?.id ?? '');
});

onShow(async () => {
  if (!(await requireSignIn())) return;
  if (!packageId.value) {
    loading.value = false;
    error.value = '缺少包裹编号，请返回重新扫码';
    return;
  }
  if (detail.value && !stale.value) return;
  await load();
});

async function load(): Promise<void> {
  if (loading.value) return;
  const tenantId = session.currentTenant?.tenant.id;
  if (!tenantId) {
    loading.value = false;
    error.value = '请先选择商家';
    return;
  }
  loading.value = true;
  error.value = '';
  receiptNote.value = '';
  try {
    const result = await api.request<PackageData>(
      '/packages/' + encodeURIComponent(packageId.value),
      { tenantId },
    );
    detail.value = result.data;
    stale.value = false;
  } catch (failure) {
    error.value = errorMessage(failure);
    return;
  } finally {
    loading.value = false;
  }
  await loadReceipts(tenantId);
}

/** 入库单只是补充信息，拉不到不影响主信息展示。 */
async function loadReceipts(tenantId: string): Promise<void> {
  try {
    const result = (await api.request<ReceiptData[]>(
      '/receipts?packageId=' +
        encodeURIComponent(packageId.value) +
        '&page=1&pageSize=' +
        RECEIPT_PAGE_SIZE,
      { tenantId },
    )) as ApiPageResponse<ReceiptData>;
    receipts.value = result.data;
  } catch (failure) {
    receiptNote.value = errorMessage(failure);
  }
}

function openReceiving(): void {
  if (!detail.value) return;
  stale.value = true;
  uni.navigateTo({
    url: '/pages/receiving/index?id=' + encodeURIComponent(detail.value.id),
  });
}

function backToScan(): void {
  // 从扫码页进来时返回上一页；如果是直接打开的（没有上一页）就新开扫码页。
  uni.navigateBack({
    fail: () => {
      uni.navigateTo({ url: '/pages/scan/index' });
    },
  });
}

function goHome(): void {
  uni.switchTab({ url: '/pages/home/index' });
}
</script>

<template>
  <view class="detail">
    <NetworkBanner />

    <view v-if="detail" class="hero">
      <text class="hero-kicker">运单号</text>
      <text class="hero-code">{{ detail.trackingNo || '未填写运单号' }}</text>
      <view class="hero-tags">
        <text class="tag">{{ packageStatusNames[detail.status] }}</text>
        <text class="tag">{{ receivingStatusNames[detail.receivingStatus] }}</text>
        <text class="tag">已收 {{ detail.receivedQuantity }} 件</text>
      </view>
    </view>

    <view class="container body">
      <view v-if="loading && !detail" class="card panel">
        <text class="panel-text">正在读取包裹信息…</text>
      </view>

      <view v-if="error" class="card panel">
        <text class="panel-title">包裹信息加载失败</text>
        <text class="panel-text">{{ error }}</text>
        <button class="btn btn-primary panel-action" @click="load">重试</button>
      </view>

      <template v-if="detail">
        <view class="card info">
          <view class="row">
            <text class="row-label">采购单号</text>
            <text class="row-value">{{ detail.purchaseOrderNo }}</text>
          </view>
          <view class="row">
            <text class="row-label">承运商</text>
            <text class="row-value">{{ detail.carrierCode ?? '未填写' }}</text>
          </view>
          <view class="row">
            <text class="row-label">包裹状态</text>
            <text class="row-value" :class="'tone-' + packageTone(detail.status)">
              {{ packageStatusNames[detail.status] }}
            </text>
          </view>
          <view class="row">
            <text class="row-label">收货状态</text>
            <text class="row-value">{{ receivingStatusNames[detail.receivingStatus] }}</text>
          </view>
          <view class="row">
            <text class="row-label">已收数量</text>
            <text class="row-value">{{ detail.receivedQuantity }} 件</text>
          </view>
          <view class="row">
            <text class="row-label">绑定时间</text>
            <text class="row-value">{{ formatTime(detail.createdAt) }}</text>
          </view>
          <view v-if="detail.remark" class="row">
            <text class="row-label">备注</text>
            <text class="row-value">{{ detail.remark }}</text>
          </view>
        </view>

        <view class="section-head">
          <text class="section-title">预计明细</text>
          <text class="section-meta">
            {{ detail.expectedItems.length }} 项 · 预计 {{ planTotal }} 件
          </text>
        </view>

        <view v-if="detail.expectedItems.length === 0" class="card empty">
          <text class="empty-text">
            这个包裹没有设置预计明细，收货时可在管理端按采购单剩余商品选择。
          </text>
        </view>

        <view v-for="item in detail.expectedItems" :key="item.id" class="card item">
          <text class="item-name">{{ item.name }}</text>
          <text class="item-meta">{{ item.sku }} · 单位 {{ item.unit }}</text>
          <view class="item-row">
            <view class="item-cell">
              <text class="cell-label">采购数量</text>
              <text class="cell-value">{{ item.orderedQuantity }}</text>
            </view>
            <view class="item-cell">
              <text class="cell-label">本包裹预计</text>
              <text class="cell-value">{{ item.expectedQuantity }}</text>
            </view>
            <view class="item-cell">
              <text class="cell-label">本包裹已收</text>
              <text class="cell-value strong">{{ item.receivedQuantity }}</text>
            </view>
          </view>
        </view>

        <view class="section-head">
          <text class="section-title">入库单</text>
          <text class="section-meta">{{ receipts.length }} 条</text>
        </view>

        <view v-if="receiptNote" class="card empty">
          <text class="empty-text">{{ receiptNote }}</text>
        </view>
        <view v-else-if="receipts.length === 0" class="card empty">
          <text class="empty-text">这个包裹还没有入库记录。</text>
        </view>
        <view v-for="receipt in receipts" :key="receipt.id" class="card item">
          <view class="receipt-head">
            <text class="item-name">{{ receipt.receiptNo }}</text>
            <text class="receipt-qty">{{ receipt.totalQuantity }} 件</text>
          </view>
          <text class="item-meta">
            {{ formatTime(receipt.receivedAt) }} · {{ receipt.receivedByName }} · 入库仓
            {{ receipt.warehouseName }}
          </text>
        </view>

        <view class="notice">
          <text class="notice-text">
            扫码与查看详情都不会修改库存；点「确认收货」才会调用真实入库事务，库存以服务端入库单为准。
          </text>
        </view>

        <button v-if="canReceive" class="btn btn-primary action" @click="openReceiving">
          确认收货
        </button>
        <button
          class="action"
          :class="canReceive ? 'btn btn-ghost' : 'btn btn-primary'"
          @click="backToScan"
        >
          继续扫码
        </button>
        <button class="btn btn-ghost action" @click="goHome">返回首页</button>
      </template>
    </view>
  </view>
</template>

<style scoped>
.detail {
  min-height: 100vh;
  padding-bottom: 48rpx;
}

.hero {
  padding: 40rpx 32rpx 56rpx;
  background: linear-gradient(150deg, #17382d 0%, #235542 100%);
}

.hero-kicker {
  display: block;
  color: #cfe3d8;
  font-size: 24rpx;
}

.hero-code {
  display: block;
  margin-top: 10rpx;
  color: #ffffff;
  font-size: 48rpx;
  font-weight: 700;
  word-break: break-all;
  letter-spacing: 2rpx;
}

.hero-tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: 24rpx;
}

.tag {
  margin: 0 16rpx 12rpx 0;
  padding: 6rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.16);
  color: #e7f2ec;
  font-size: 24rpx;
}

.body {
  margin-top: -32rpx;
}

.panel {
  margin-bottom: 24rpx;
}

.panel-title {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
}

.panel-text {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #6b7f75;
  line-height: 1.6;
}

.panel-action {
  margin-top: 20rpx;
}

.info {
  margin-bottom: 24rpx;
}

.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16rpx 0;
  border-bottom: 2rpx solid #f0f4f2;
}

.row:last-child {
  border-bottom: none;
}

.row-label {
  flex: 0 0 180rpx;
  font-size: 26rpx;
  color: #7b8b83;
}

.row-value {
  flex: 1;
  text-align: right;
  font-size: 28rpx;
  color: #17382d;
  word-break: break-all;
}

.tone-ok {
  color: #2f8f6a;
}

.tone-warn {
  color: #b8791f;
}

.tone-danger {
  color: #c0392b;
}

.tone-info {
  color: #3d6b9a;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 8rpx 0 20rpx;
}

.section-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #3d574c;
}

.section-meta {
  font-size: 24rpx;
  color: #7b8b83;
}

.empty {
  margin-bottom: 24rpx;
}

.empty-text {
  font-size: 26rpx;
  color: #6b7f75;
  line-height: 1.6;
}

.item {
  margin-bottom: 20rpx;
}

.item-name {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #17382d;
}

.item-meta {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #7b8b83;
  line-height: 1.5;
}

.item-row {
  display: flex;
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid #f0f4f2;
}

.item-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.cell-label {
  font-size: 22rpx;
  color: #7b8b83;
}

.cell-value {
  margin-top: 6rpx;
  font-size: 32rpx;
  color: #17382d;
}

.cell-value.strong {
  font-weight: 700;
  color: #235542;
}

.receipt-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.receipt-qty {
  font-size: 26rpx;
  color: #2f8f6a;
}

.notice {
  margin: 8rpx 0 24rpx;
  padding: 24rpx;
  background: #eef4f0;
  border-radius: 16rpx;
}

.notice-text {
  font-size: 24rpx;
  color: #4a6357;
  line-height: 1.6;
}

.action {
  margin-bottom: 20rpx;
}
</style>
