<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import type { InventoryBalanceData } from '@caicang/api-contract';
import NetworkBanner from '../../components/NetworkBanner.vue';
import { api } from '../../api';
import { session, can } from '../../stores/session';
import { ScanGuard } from '../../services/scan';
import {
  normalizeScan,
  searchStock,
  findByCode,
  loadWarehouses,
  totalOnHand,
  stockTone,
  describeMiss,
  type StockLookupResult,
} from '../../services/stock';
import { errorMessage, toast } from '../../utils/feedback';
import { requireSignIn } from '../../utils/guard';
import { formatTime } from '../../utils/package';

const isApp = typeof (globalThis as Record<string, unknown>).plus !== 'undefined';
const guard = new ScanGuard();

const keyword = ref('');
const warehouseId = ref('');
const warehouses = ref<{ id: string; name: string; code: string }[]>([]);
const rows = ref<InventoryBalanceData[]>([]);
const searched = ref(false);
const matchMode = ref<'barcode' | 'sku' | 'search' | null>(null);
const currentQuery = ref('');
const loading = ref(false);
const scanning = ref(false);
const errorText = ref('');
const missText = ref('');

const grouped = computed(() => {
  const map = new Map<string, { name: string; code: string; rows: InventoryBalanceData[] }>();
  for (const row of rows.value) {
    const entry = map.get(row.warehouseId) ?? {
      name: row.warehouseName,
      code: row.warehouseId,
      rows: [],
    };
    entry.rows.push(row);
    map.set(row.warehouseId, entry);
  }
  return [...map.values()];
});
const total = computed(() => totalOnHand(rows.value));
const warehouseName = computed(
  () => warehouses.value.find((row) => row.id === warehouseId.value)?.name ?? '',
);

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
  if (warehouses.value.length === 0) void loadWarehouseList();
});

async function loadWarehouseList(): Promise<void> {
  try {
    warehouses.value = await loadWarehouses(api, session.currentTenant?.tenant.id);
  } catch {
    /* 仓库列表只用于筛选与显示名字，失败不影响查询（余额行自带仓库名）。 */
    warehouses.value = [];
  }
}

function begin(): boolean {
  if (loading.value) {
    toast('正在查询，请稍候');
    return false;
  }
  errorText.value = '';
  missText.value = '';
  return true;
}

function apply(result: StockLookupResult): void {
  rows.value = result.rows;
  matchMode.value = result.match;
  currentQuery.value = result.query;
  searched.value = true;
  missText.value = result.rows.length
    ? ''
    : describeMiss({
        query: result.query,
        byScan: false,
        warehouseName: warehouseName.value || undefined,
      });
}

async function runSearch(): Promise<void> {
  if (!begin()) return;
  const tenantId = session.currentTenant?.tenant.id;
  loading.value = true;
  try {
    apply(
      await searchStock(api, { text: keyword.value, warehouseId: warehouseId.value, tenantId }),
    );
  } catch (error) {
    errorText.value = errorMessage(error);
    rows.value = [];
    searched.value = true;
  } finally {
    loading.value = false;
  }
}

function startScan(): void {
  if (scanning.value) return;
  if (!isApp) {
    uni.showModal({
      title: '请在手机 App 中扫码',
      content: '浏览器预览不支持摄像头扫码。可以先用下方的搜索框输入商品名称或 SKU。',
      showCancel: false,
    });
    return;
  }
  scanning.value = true;
  guard.reset();
  uni.scanCode({
    scanType: ['barCode', 'qrCode'],
    onlyFromCamera: true,
    success(result) {
      void handleCode(result.result);
    },
    fail(error) {
      const message = error?.errMsg ?? '';
      if (/cancel/i.test(message)) return;
      if (/auth|permission|denied|权限/i.test(message)) {
        toast('请到系统设置里允许相机权限后再扫码');
        return;
      }
      toast('扫码失败，请重试或改用手动搜索');
    },
    complete() {
      scanning.value = false;
    },
  });
}

async function handleCode(raw: string): Promise<void> {
  let code: string;
  try {
    code = normalizeScan(raw);
  } catch (error) {
    toast(errorMessage(error));
    return;
  }
  const gate = guard.begin(code);
  if (gate === 'busy') return;
  if (gate === 'duplicate') {
    toast('刚刚已扫过这个条码');
    return;
  }
  const tenantId = session.currentTenant?.tenant.id;
  if (!begin()) {
    guard.end();
    return;
  }
  loading.value = true;
  try {
    const result = await findByCode(api, code, { warehouseId: warehouseId.value, tenantId });
    keyword.value = code;
    rows.value = result.rows;
    matchMode.value = result.match;
    currentQuery.value = code;
    searched.value = true;
    missText.value = result.rows.length
      ? ''
      : describeMiss({
          query: code,
          byScan: true,
          warehouseName: warehouseName.value || undefined,
        });
  } catch (error) {
    errorText.value = errorMessage(error);
    rows.value = [];
    searched.value = true;
  } finally {
    loading.value = false;
    guard.end();
  }
}

function pickWarehouse(id: string): void {
  warehouseId.value = id;
  if (searched.value && currentQuery.value) void runSearch();
}

function openDetail(row: InventoryBalanceData): void {
  uni.navigateTo({
    url:
      '/pages/stock/detail?productId=' +
      encodeURIComponent(row.productId) +
      '&warehouseId=' +
      encodeURIComponent(row.warehouseId),
  });
}

function clearAll(): void {
  keyword.value = '';
  rows.value = [];
  searched.value = false;
  matchMode.value = null;
  currentQuery.value = '';
  missText.value = '';
  errorText.value = '';
}

function goOutbound(): void {
  uni.navigateTo({ url: '/pages/outbound/index' });
}

function quantityText(value: number): string {
  return String(value);
}
</script>

<template>
  <view class="stock">
    <NetworkBanner />

    <view class="hero">
      <text class="hero-title">库存查询</text>
      <text class="hero-sub">按商品名称、SKU 搜索，或直接扫描商品条码</text>
      <view v-if="rows.length" class="hero-sum">
        <text class="hero-sum-label">当前结果合计</text>
        <text class="hero-sum-value">{{ total }} 件 · {{ rows.length }} 条仓库库存</text>
      </view>
    </view>

    <view class="container">
      <view class="card search-card">
        <view class="search-row">
          <input
            v-model="keyword"
            class="search-input"
            type="text"
            confirm-type="search"
            placeholder="商品名称或 SKU"
            :maxlength="200"
            @confirm="runSearch"
          />
          <button class="btn-search" :disabled="loading" @click="runSearch">查询</button>
        </view>
        <view class="search-actions">
          <button class="btn-scan" :disabled="scanning" @click="startScan">
            {{ scanning ? '正在扫码…' : '扫描条码查询' }}
          </button>
          <button v-if="searched" class="btn-link" @click="clearAll">清空结果</button>
        </view>
        <view class="filter-row">
          <text class="filter-label">仓库</text>
          <scroll-view class="filter-scroll" scroll-x>
            <view class="filter-chips">
              <text
                class="chip"
                :class="{ 'chip-on': warehouseId === '' }"
                @click="pickWarehouse('')"
                >全部仓库</text
              >
              <text
                v-for="row in warehouses"
                :key="row.id"
                class="chip"
                :class="{ 'chip-on': warehouseId === row.id }"
                @click="pickWarehouse(row.id)"
                >{{ row.name }}</text
              >
            </view>
          </scroll-view>
        </view>
      </view>

      <view v-if="errorText" class="card panel">
        <text class="panel-title">查询失败</text>
        <text class="panel-text">{{ errorText }}</text>
        <button class="btn-ghost panel-action" @click="runSearch">重新查询</button>
      </view>

      <view v-else-if="loading" class="card panel">
        <text class="panel-text">正在查询库存…</text>
      </view>

      <view v-else-if="searched && rows.length === 0" class="card panel">
        <text class="panel-title">没有查到库存</text>
        <text class="panel-text">{{ missText }}</text>
        <button class="btn-ghost panel-action" @click="startScan">再扫一次</button>
      </view>

      <template v-else>
        <view v-if="rows.length" class="match-hint">
          <text class="match-text">
            {{
              matchMode === 'barcode'
                ? '已按条码匹配：' + currentQuery
                : matchMode === 'sku'
                  ? '已按 SKU 匹配：' + currentQuery
                  : '搜索结果：' + currentQuery
            }}
          </text>
        </view>

        <view v-for="group in grouped" :key="group.code" class="group">
          <view class="group-head">
            <text class="group-name">{{ group.name }}</text>
            <text class="group-meta">{{ group.rows.length }} 个 SKU</text>
          </view>
          <view
            v-for="row in group.rows"
            :key="row.productId + row.warehouseId"
            class="card item"
            hover-class="item-hover"
            @click="openDetail(row)"
          >
            <view class="item-head">
              <text class="item-name">{{ row.name }}</text>
              <text class="item-qty" :class="'qty-' + stockTone(row.quantityOnHand)">{{
                quantityText(row.quantityOnHand)
              }}</text>
            </view>
            <text class="item-meta">{{ row.sku }} · {{ row.unit }}</text>
            <text v-if="row.barcode" class="item-code">条码 {{ row.barcode }}</text>
            <view class="item-foot">
              <text class="item-foot-text">均价 ¥{{ row.averageCost }}</text>
              <text v-if="row.pendingInboundQuantity > 0" class="item-foot-warn"
                >待入库 {{ row.pendingInboundQuantity }}</text
              >
              <text class="item-foot-text"
                >最近入库 {{ row.lastReceivedAt ? formatTime(row.lastReceivedAt) : '—' }}</text
              >
            </view>
          </view>
        </view>
      </template>

      <view v-if="!searched" class="card tip">
        <text class="tip-title">怎么查</text>
        <text class="tip-text"
          >1. 扫商品包装上的条码，直接定位到该商品的仓库库存；2. 没有条码时在搜索框输入名称或
          SKU；3. 点任意一行查看各仓库数量与最近库存流水。</text
        >
        <button v-if="can('outbound:write')" class="btn-primary tip-action" @click="goOutbound">
          去扫码出库
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.stock {
  min-height: 100vh;
}

.hero {
  padding: 40rpx 32rpx 48rpx;
  background: linear-gradient(150deg, #17382d 0%, #235542 100%);
}

.hero-title {
  display: block;
  color: #ffffff;
  font-size: 44rpx;
  font-weight: 700;
}

.hero-sub {
  display: block;
  margin-top: 10rpx;
  color: #cfe3d8;
  font-size: 26rpx;
}

.hero-sum {
  margin-top: 24rpx;
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.12);
}

.hero-sum-label {
  display: block;
  color: #cfe3d8;
  font-size: 24rpx;
}

.hero-sum-value {
  display: block;
  margin-top: 6rpx;
  color: #ffffff;
  font-size: 34rpx;
  font-weight: 600;
}

.search-card {
  margin-top: -32rpx;
}

.search-row {
  display: flex;
  align-items: center;
}

.search-input {
  flex: 1;
  height: 84rpx;
  padding: 0 24rpx;
  border-radius: 16rpx;
  background: #f2f6f4;
  font-size: 30rpx;
}

.btn-search {
  margin-left: 16rpx;
  min-width: 132rpx;
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 16rpx;
  background: #17382d;
  color: #ffffff;
  font-size: 30rpx;
}

.search-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20rpx;
}

.btn-scan {
  flex: 1;
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 16rpx;
  border: 2rpx solid #17382d;
  color: #17382d;
  font-size: 30rpx;
  text-align: center;
}

.btn-link {
  margin-left: 20rpx;
  color: #6b7f75;
  font-size: 26rpx;
}

.filter-row {
  margin-top: 20rpx;
}

.filter-label {
  font-size: 24rpx;
  color: #7b8b83;
}

.filter-scroll {
  margin-top: 10rpx;
  white-space: nowrap;
}

.filter-chips {
  display: flex;
}

.chip {
  margin-right: 14rpx;
  padding: 10rpx 24rpx;
  border-radius: 999rpx;
  background: #f2f6f4;
  color: #4f6a5e;
  font-size: 24rpx;
}

.chip-on {
  background: #17382d;
  color: #ffffff;
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

.match-hint {
  margin: 24rpx 4rpx 8rpx;
}

.match-text {
  color: #7b8b83;
  font-size: 24rpx;
}

.group {
  margin-top: 16rpx;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 4rpx;
}

.group-name {
  font-size: 28rpx;
  font-weight: 600;
  color: #3d574c;
}

.group-meta {
  font-size: 24rpx;
  color: #7b8b83;
}

.item {
  margin-bottom: 20rpx;
}

.item-hover {
  background: #f7faf8;
}

.item-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.item-name {
  flex: 1;
  padding-right: 20rpx;
  font-size: 32rpx;
  font-weight: 600;
  line-height: 1.4;
}

.item-qty {
  min-width: 110rpx;
  text-align: right;
  font-size: 46rpx;
  font-weight: 700;
  line-height: 1;
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

.item-meta {
  display: block;
  margin-top: 12rpx;
  color: #6b7f75;
  font-size: 26rpx;
}

.item-code {
  display: block;
  margin-top: 6rpx;
  color: #9aa89f;
  font-size: 24rpx;
}

.item-foot {
  display: flex;
  flex-wrap: wrap;
  margin-top: 18rpx;
  gap: 20rpx;
}

.item-foot-text {
  color: #7b8b83;
  font-size: 24rpx;
}

.item-foot-warn {
  color: #b9873f;
  font-size: 24rpx;
}

.tip {
  margin-top: 24rpx;
}

.tip-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
}

.tip-text {
  display: block;
  margin-top: 12rpx;
  color: #6b7f75;
  font-size: 26rpx;
  line-height: 1.7;
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

.tip-action {
  margin-top: 20rpx;
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
</style>
