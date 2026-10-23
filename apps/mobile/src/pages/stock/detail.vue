<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import type { InventoryBalanceData, InventoryMovementData } from '@caicang/api-contract';
import NetworkBanner from '../../components/NetworkBanner.vue';
import { api } from '../../api';
import { session, can } from '../../stores/session';
import {
  loadProductStock,
  loadRecentMovements,
  totalOnHand,
  totalPendingInbound,
  stockTone,
  movementLabel,
  movementDeltaLabel,
  RECENT_MOVEMENT_LIMIT,
} from '../../services/stock';
import { errorMessage, toast } from '../../utils/feedback';
import { requireSignIn } from '../../utils/guard';
import { formatTime } from '../../utils/package';

const productId = ref('');
const warehouseId = ref('');
const balances = ref<InventoryBalanceData[]>([]);
const movements = ref<InventoryMovementData[]>([]);
const loading = ref(false);
const errorText = ref('');
const loaded = ref(false);

const first = computed(() => balances.value[0] ?? null);
const productName = computed(() => first.value?.name ?? movements.value[0]?.productName ?? '商品');
const sku = computed(() => first.value?.sku ?? movements.value[0]?.sku ?? '');
const unit = computed(() => first.value?.unit ?? movements.value[0]?.unit ?? '件');
const total = computed(() => totalOnHand(balances.value));
const pending = computed(() => totalPendingInbound(balances.value));
const current = computed(() =>
  warehouseId.value ? balances.value.find((row) => row.warehouseId === warehouseId.value) : null,
);

onLoad((options) => {
  productId.value = String(options?.productId ?? '');
  warehouseId.value = String(options?.warehouseId ?? '');
});

onShow(async () => {
  if (!(await requireSignIn())) return;
  if (!session.currentTenant) {
    toast('请先选择商家');
    uni.switchTab({ url: '/pages/home/index' });
    return;
  }
  if (!can('products:read')) {
    toast('当前账号没有查看库存的权限');
    uni.switchTab({ url: '/pages/home/index' });
    return;
  }
  if (!productId.value) {
    errorText.value = '缺少商品编号，请返回重新查询';
    return;
  }
  if (!loaded.value) await load();
});

async function load(): Promise<void> {
  if (loading.value) return;
  const tenantId = session.currentTenant?.tenant.id;
  loading.value = true;
  errorText.value = '';
  try {
    const [stock, recent] = await Promise.all([
      loadProductStock(api, { productId: productId.value, tenantId }),
      loadRecentMovements(api, {
        productId: productId.value,
        tenantId,
        limit: RECENT_MOVEMENT_LIMIT,
      }),
    ]);
    balances.value = stock.balances;
    movements.value = recent;
    loaded.value = true;
  } catch (error) {
    errorText.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

function back(): void {
  uni.navigateBack({ fail: () => uni.redirectTo({ url: '/pages/stock/index' }) });
}

function goOutbound(): void {
  uni.navigateTo({ url: '/pages/outbound/index' });
}
</script>

<template>
  <view class="detail">
    <NetworkBanner />

    <view class="hero">
      <text class="hero-name">{{ productName }}</text>
      <text class="hero-meta">{{ sku }} · 单位 {{ unit }}</text>
      <view class="hero-stats">
        <view class="hero-stat">
          <text class="hero-stat-label">合计现存</text>
          <text class="hero-stat-value">{{ total }}</text>
        </view>
        <view class="hero-stat">
          <text class="hero-stat-label">待入库</text>
          <text class="hero-stat-value">{{ pending }}</text>
        </view>
        <view class="hero-stat">
          <text class="hero-stat-label">仓库数</text>
          <text class="hero-stat-value">{{ balances.length }}</text>
        </view>
      </view>
    </view>

    <view class="container">
      <view v-if="errorText" class="card panel">
        <text class="panel-title">无法读取库存</text>
        <text class="panel-text">{{ errorText }}</text>
        <button class="btn-ghost panel-action" @click="load">重试</button>
        <button class="btn-ghost panel-action" @click="back">返回查询</button>
      </view>

      <view v-else-if="loading && !loaded" class="card panel">
        <text class="panel-text">正在读取库存与流水…</text>
      </view>

      <template v-else>
        <view class="section-head">
          <text class="section-title">各仓库库存</text>
          <button class="btn-link" @click="load">刷新</button>
        </view>

        <view v-if="balances.length === 0" class="card panel">
          <text class="panel-text">这个商品在所有仓库都还没有库存余额。</text>
        </view>

        <view
          v-for="row in balances"
          :key="row.warehouseId"
          class="card warehouse"
          :class="{ 'warehouse-current': row.warehouseId === warehouseId }"
        >
          <view class="warehouse-head">
            <text class="warehouse-name">{{ row.warehouseName }}</text>
            <text class="warehouse-qty" :class="'qty-' + stockTone(row.quantityOnHand)">{{
              row.quantityOnHand
            }}</text>
          </view>
          <view class="warehouse-rows">
            <view class="warehouse-row">
              <text class="row-label">规格</text>
              <text class="row-value">{{ row.specification || '—' }}</text>
            </view>
            <view class="warehouse-row">
              <text class="row-label">条码</text>
              <text class="row-value">{{ row.barcode || '未登记条码' }}</text>
            </view>
            <view class="warehouse-row">
              <text class="row-label">平均成本</text>
              <text class="row-value">¥{{ row.averageCost }}</text>
            </view>
            <view class="warehouse-row">
              <text class="row-label">账面成本</text>
              <text class="row-value">¥{{ row.totalCost }}</text>
            </view>
            <view class="warehouse-row">
              <text class="row-label">待入库</text>
              <text class="row-value">{{ row.pendingInboundQuantity }} {{ row.unit }}</text>
            </view>
            <view class="warehouse-row">
              <text class="row-label">最近入库</text>
              <text class="row-value">{{
                row.lastReceivedAt ? formatTime(row.lastReceivedAt) : '—'
              }}</text>
            </view>
          </view>
        </view>

        <view class="section-head">
          <text class="section-title">最近库存流水</text>
          <text class="section-meta">最近 {{ movements.length }} 条</text>
        </view>

        <view v-if="movements.length === 0" class="card panel">
          <text class="panel-text">这个商品还没有任何库存变动。</text>
        </view>

        <view v-for="row in movements" :key="row.id" class="card movement">
          <view class="movement-head">
            <text class="movement-type">{{ movementLabel(row.type) }}</text>
            <text
              class="movement-delta"
              :class="row.quantityDelta > 0 ? 'delta-in' : 'delta-out'"
              >{{ movementDeltaLabel(row) }}</text
            >
          </view>
          <text class="movement-meta"
            >{{ formatTime(row.occurredAt) }} · {{ row.warehouseName }}</text
          >
          <text class="movement-flow"
            >操作前 {{ row.quantityBefore }} → 操作后 {{ row.quantityAfter }} {{ row.unit }}</text
          >
          <text v-if="row.sourceNo" class="movement-source"
            >来源单据 {{ row.sourceNo }} · {{ row.operatorName }}</text
          >
          <text v-else class="movement-source">操作人 {{ row.operatorName }}</text>
          <text v-if="row.note" class="movement-note">{{ row.note }}</text>
        </view>

        <button
          v-if="can('outbound:write') && current && current.quantityOnHand > 0"
          class="btn-primary action"
          @click="goOutbound"
        >
          去扫码出库
        </button>
        <button class="btn-ghost action" @click="back">返回查询</button>
      </template>
    </view>
  </view>
</template>

<style scoped>
.detail {
  min-height: 100vh;
}

.hero {
  padding: 40rpx 32rpx 48rpx;
  background: linear-gradient(150deg, #17382d 0%, #235542 100%);
}

.hero-name {
  display: block;
  color: #ffffff;
  font-size: 42rpx;
  font-weight: 700;
  line-height: 1.35;
}

.hero-meta {
  display: block;
  margin-top: 10rpx;
  color: #cfe3d8;
  font-size: 26rpx;
}

.hero-stats {
  display: flex;
  margin-top: 28rpx;
}

.hero-stat {
  flex: 1;
}

.hero-stat-label {
  display: block;
  color: #cfe3d8;
  font-size: 24rpx;
}

.hero-stat-value {
  display: block;
  margin-top: 6rpx;
  color: #ffffff;
  font-size: 40rpx;
  font-weight: 700;
}

.panel {
  margin-top: 24rpx;
}

.panel-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
}

.panel-text {
  display: block;
  margin-top: 12rpx;
  color: #6b7f75;
  font-size: 26rpx;
  line-height: 1.6;
}

.panel-action {
  margin-top: 20rpx;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 36rpx 4rpx 16rpx;
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

.btn-link {
  color: #2f6f57;
  font-size: 26rpx;
}

.warehouse {
  margin-bottom: 20rpx;
}

.warehouse-current {
  border: 2rpx solid #17382d;
}

.warehouse-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.warehouse-name {
  font-size: 30rpx;
  font-weight: 600;
}

.warehouse-qty {
  font-size: 44rpx;
  font-weight: 700;
}

.qty-ok {
  color: #17694c;
}

.qty-warn {
  color: #b9873f;
}

.qty-empty {
  color: #b3bcc6;
}

.warehouse-rows {
  margin-top: 16rpx;
}

.warehouse-row {
  display: flex;
  justify-content: space-between;
  padding: 8rpx 0;
}

.row-label {
  color: #7b8b83;
  font-size: 25rpx;
}

.row-value {
  color: #33453c;
  font-size: 25rpx;
}

.movement {
  margin-bottom: 16rpx;
}

.movement-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.movement-type {
  font-size: 29rpx;
  font-weight: 600;
}

.movement-delta {
  font-size: 36rpx;
  font-weight: 700;
}

.delta-in {
  color: #17694c;
}

.delta-out {
  color: #b5483f;
}

.movement-meta,
.movement-flow,
.movement-source {
  display: block;
  margin-top: 8rpx;
  color: #6b7f75;
  font-size: 25rpx;
}

.movement-note {
  display: block;
  margin-top: 8rpx;
  color: #9aa89f;
  font-size: 24rpx;
}

.btn-primary {
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 16rpx;
  background: #17382d;
  color: #ffffff;
  font-size: 30rpx;
  text-align: center;
}

.btn-ghost {
  height: 80rpx;
  line-height: 80rpx;
  border-radius: 16rpx;
  border: 2rpx solid #cfdbd4;
  color: #3d574c;
  font-size: 28rpx;
  text-align: center;
}

.action {
  margin-top: 20rpx;
}
</style>
