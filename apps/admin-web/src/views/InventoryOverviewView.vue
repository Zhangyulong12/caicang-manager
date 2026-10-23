<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { Refresh, ArrowRight } from '@element-plus/icons-vue';
import type { InventoryMovementData, InventorySummaryData } from '@caicang/api-contract';
import InventoryTabs from '../components/InventoryTabs.vue';
import { useInventory } from '../composables/inventory';
import {
  formatMoney,
  formatQuantity,
  formatUnitCost,
  movementLabel,
  movementTone,
} from '../api/inventory-format';
import { formatTime } from '../api/package-status';
import { failureMessage } from '../utils/feedback';
const api = useInventory(),
  router = useRouter();
const summary = ref<InventorySummaryData | null>(null),
  movements = ref<InventoryMovementData[]>([]),
  loading = ref(false),
  error = ref('');
let sequence = 0;
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  try {
    const [data, recent] = await Promise.all([
      api.summary(),
      api.movements({ page: 1, pageSize: 5 }),
    ]);
    if (version !== sequence) return;
    summary.value = data;
    movements.value = recent.data;
  } catch (e) {
    if (version === sequence) {
      error.value = failureMessage(e);
      summary.value = null;
      movements.value = [];
    }
  } finally {
    if (version === sequence) loading.value = false;
  }
}
onMounted(load);
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">INVENTORY OVERVIEW</span>
        <h1>库存总览</h1>
        <p class="muted">
          数量、成本与待入库全部由服务端按真实入库流水计算；手机扫码入库后刷新即可看到变化。
        </p>
      </div>
      <el-button :icon="Refresh" :disabled="loading" @click="load">刷新数据</el-button>
    </div>
    <InventoryTabs />
    <el-skeleton v-if="loading && !summary" :rows="8" animated class="surface loading-surface" />
    <div v-else-if="error" class="surface catalog-error">
      <el-alert :title="error" type="error" :closable="false" /><el-button @click="load"
        >重试加载</el-button
      >
    </div>
    <template v-else-if="summary">
      <div class="inventory-metrics">
        <div class="surface inventory-metric">
          <p>现存件数</p>
          <strong>{{ formatQuantity(summary.quantityOnHand) }}</strong>
          <small
            >覆盖 {{ summary.totalProducts }} 个商品 · {{ summary.totalWarehouses }} 个仓库</small
          >
        </div>
        <div class="surface inventory-metric">
          <p>库存账面总成本</p>
          <strong>{{ formatMoney(summary.totalCost) }}</strong>
          <small>移动加权平均成本 {{ formatUnitCost(summary.averageCost) }} / 件</small>
        </div>
        <div class="surface inventory-metric">
          <p>采购待入库</p>
          <strong>{{ formatQuantity(summary.pendingInboundQuantity) }}</strong>
          <small>已下单但还没验收的数量，不含已取消</small>
        </div>
        <div class="surface inventory-metric">
          <p>最近一次入库</p>
          <strong>{{
            summary.lastReceivedAt ? formatTime(summary.lastReceivedAt) : '尚无入库'
          }}</strong>
          <small>数据时间 {{ formatTime(summary.generatedAt) }}</small>
        </div>
      </div>
      <div class="inventory-split">
        <div class="surface catalog-panel">
          <div class="inventory-panel-head">
            <div>
              <h3>分仓库存</h3>
              <p>每个仓库的商品数、现存数量、账面成本与待入库</p>
            </div>
            <el-button link type="primary" @click="router.push('/inventory/balances')"
              >商品库存列表<el-icon><ArrowRight /></el-icon
            ></el-button>
          </div>
          <el-table
            :data="summary.warehouses"
            row-key="warehouseId"
            stripe
            empty-text="还没有任何库存或待入库记录"
          >
            <el-table-column label="仓库" min-width="150">
              <template #default="{ row }">
                <span class="catalog-item-link">{{ row.warehouseName }}</span>
                <small class="catalog-item-sub">{{ row.skuCount }} 个商品</small>
              </template>
            </el-table-column>
            <el-table-column label="现存数量" width="110" align="right">
              <template #default="{ row }">
                <span class="stock-number" :class="{ zero: row.quantityOnHand === 0 }">{{
                  formatQuantity(row.quantityOnHand)
                }}</span>
              </template>
            </el-table-column>
            <el-table-column label="账面成本" width="130" align="right">
              <template #default="{ row }">{{ formatMoney(row.totalCost) }}</template>
            </el-table-column>
            <el-table-column label="待入库" width="95" align="right">
              <template #default="{ row }">
                <span class="stock-number" :class="{ pending: row.pendingInboundQuantity > 0 }">{{
                  formatQuantity(row.pendingInboundQuantity)
                }}</span>
              </template>
            </el-table-column>
            <el-table-column label="最近入库" width="165">
              <template #default="{ row }">{{ formatTime(row.lastReceivedAt) }}</template>
            </el-table-column>
          </el-table>
        </div>
        <div class="surface catalog-panel">
          <div class="inventory-panel-head">
            <div>
              <h3>最近库存变动</h3>
              <p>最新 5 笔流水，含来源单据与操作人</p>
            </div>
            <el-button link type="primary" @click="router.push('/inventory/movements')"
              >全部流水<el-icon><ArrowRight /></el-icon
            ></el-button>
          </div>
          <el-table
            :data="movements"
            row-key="id"
            stripe
            empty-text="还没有库存流水；用手机扫码验收后会在这里出现"
          >
            <el-table-column label="时间" width="160">
              <template #default="{ row }">{{ formatTime(row.occurredAt) }}</template>
            </el-table-column>
            <el-table-column label="类型" width="105">
              <template #default="{ row }">
                <el-tag size="small" :type="movementTone(row.type)">{{
                  movementLabel(row.type)
                }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="商品" min-width="140">
              <template #default="{ row }">
                <span class="catalog-item-link">{{ row.productName }}</span>
                <small class="catalog-item-sub">{{ row.sku }} · {{ row.warehouseName }}</small>
              </template>
            </el-table-column>
            <el-table-column label="数量" width="90" align="right">
              <template #default="{ row }">
                <span class="movement-delta" :class="row.direction === 'IN' ? 'in' : 'out'"
                  >{{ row.quantityDelta > 0 ? '+' : ''
                  }}{{ formatQuantity(row.quantityDelta) }}</span
                >
                <small class="catalog-item-sub">余 {{ formatQuantity(row.quantityAfter) }}</small>
              </template>
            </el-table-column>
            <el-table-column label="来源单据" width="150">
              <template #default="{ row }">{{ row.sourceNo || '—' }}</template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </template>
  </section>
</template>
