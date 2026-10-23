<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, Refresh } from '@element-plus/icons-vue';
import type { InventoryBalanceData, InventoryMovementData } from '@caicang/api-contract';
import InventoryTabs from '../components/InventoryTabs.vue';
import { useInventory } from '../composables/inventory';
import {
  formatMoney,
  formatQuantity,
  formatUnitCost,
  movementLabel,
  movementTone,
  pageSummary,
  stockState,
} from '../api/inventory-format';
import { formatTime } from '../api/package-status';
import { failureMessage } from '../utils/feedback';
const route = useRoute(),
  router = useRouter(),
  api = useInventory();
const balances = ref<InventoryBalanceData[]>([]),
  movements = ref<InventoryMovementData[]>([]),
  loading = ref(false),
  error = ref(''),
  page = ref(1),
  size = ref(20),
  total = ref(0);
let sequence = 0;
const productId = computed(() => String(route.params.productId));
const head = computed(() => balances.value[0] ?? null);
const totals = computed(() =>
  balances.value.reduce(
    (sum, row) => ({
      quantity: sum.quantity + row.quantityOnHand,
      pending: sum.pending + row.pendingInboundQuantity,
    }),
    { quantity: 0, pending: 0 },
  ),
);
const totalCost = computed(() =>
  balances.value.reduce((sum, row) => sum + Number(row.totalCost), 0).toFixed(4),
);
const averageCost = computed(() =>
  totals.value.quantity > 0
    ? (Number(totalCost.value) / totals.value.quantity).toFixed(4)
    : '0.0000',
);
const lastReceivedAt = computed(() => {
  const times = balances.value
    .map((row) => row.lastReceivedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  return times.at(-1) ?? null;
});
async function loadBalances() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  try {
    const result = await api.balances({ page: 1, pageSize: 100, productId: productId.value });
    if (version !== sequence) return;
    balances.value = result.data;
  } catch (e) {
    if (version === sequence) {
      error.value = failureMessage(e);
      balances.value = [];
    }
  } finally {
    if (version === sequence) loading.value = false;
  }
}
async function loadMovements() {
  const version = sequence;
  try {
    const result = await api.movements({
      page: page.value,
      pageSize: size.value,
      productId: productId.value,
    });
    if (version !== sequence) return;
    movements.value = result.data;
    total.value = result.pagination.total;
  } catch (e) {
    if (version === sequence) {
      error.value = failureMessage(e);
      movements.value = [];
      total.value = 0;
    }
  }
}
async function load() {
  await loadBalances();
  await loadMovements();
}
function changePage(next: number) {
  page.value = next;
  void loadMovements();
}
watch(productId, () => {
  page.value = 1;
  void load();
});
onBeforeUnmount(() => sequence++);
void load();
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">SKU STOCK</span>
        <h1>SKU 库存详情</h1>
        <p class="muted">
          同一商品在各仓库的余额与全部变动流水，用来回答"这批货到底怎么变成现在这个数"。
        </p>
      </div>
      <el-button :icon="ArrowLeft" @click="router.push('/inventory/balances')"
        >返回库存列表</el-button
      >
    </div>
    <InventoryTabs />
    <el-skeleton v-if="loading && !head" :rows="8" animated class="surface loading-surface" />
    <div v-else-if="error" class="surface catalog-error">
      <el-alert :title="error" type="error" :closable="false" /><el-button @click="load"
        >重试加载</el-button
      >
    </div>
    <template v-else-if="head">
      <div class="surface inventory-detail-head" style="margin-top: 20px">
        <div>
          <small class="muted">SKU {{ head.sku }}</small>
          <h2>{{ head.name }}</h2>
          <p class="inventory-meta">
            {{ head.specification || '无规格' }} · 单位 {{ head.unit }} · 条码
            {{ head.barcode || '未登记' }}
          </p>
        </div>
        <el-button :icon="Refresh" :disabled="loading" @click="load">刷新</el-button>
      </div>
      <div class="inventory-metrics">
        <div class="surface inventory-metric">
          <p>合计现存</p>
          <strong>{{ formatQuantity(totals.quantity) }}</strong>
          <small>{{ balances.length }} 个仓库有记录</small>
        </div>
        <div class="surface inventory-metric">
          <p>合计账面成本</p>
          <strong>{{ formatMoney(totalCost) }}</strong>
          <small>均价 {{ formatUnitCost(averageCost) }} / {{ head.unit }}</small>
        </div>
        <div class="surface inventory-metric">
          <p>待入库合计</p>
          <strong>{{ formatQuantity(totals.pending) }}</strong>
          <small>已下单未验收</small>
        </div>
        <div class="surface inventory-metric">
          <p>最近入库</p>
          <strong>{{ lastReceivedAt ? formatTime(lastReceivedAt) : '尚无入库' }}</strong>
          <small>取所有仓库中最晚的一次</small>
        </div>
      </div>
      <div class="surface catalog-panel">
        <div class="inventory-panel-head">
          <div>
            <h3>分仓余额</h3>
            <p>每个仓库的现存数量、成本与待入库</p>
          </div>
        </div>
        <el-table :data="balances" :row-key="(row: InventoryBalanceData) => row.warehouseId" stripe>
          <el-table-column label="仓库" min-width="160" prop="warehouseName" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag size="small" :type="stockState(row).tone">{{ stockState(row).label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="现存数量" width="115" align="right">
            <template #default="{ row }">
              <span class="stock-number" :class="{ zero: row.quantityOnHand === 0 }">{{
                formatQuantity(row.quantityOnHand)
              }}</span>
            </template>
          </el-table-column>
          <el-table-column label="平均成本" width="120" align="right">
            <template #default="{ row }">{{ formatUnitCost(row.averageCost) }}</template>
          </el-table-column>
          <el-table-column label="账面成本" width="135" align="right">
            <template #default="{ row }">{{ formatMoney(row.totalCost) }}</template>
          </el-table-column>
          <el-table-column label="待入库" width="100" align="right">
            <template #default="{ row }">
              <span class="stock-number" :class="{ pending: row.pendingInboundQuantity > 0 }">{{
                formatQuantity(row.pendingInboundQuantity)
              }}</span>
            </template>
          </el-table-column>
          <el-table-column label="最近入库" width="170">
            <template #default="{ row }">{{ formatTime(row.lastReceivedAt) }}</template>
          </el-table-column>
        </el-table>
      </div>
      <div class="surface catalog-panel" style="margin-top: 20px">
        <div class="inventory-panel-head">
          <div>
            <h3>变动流水</h3>
            <p>该商品的全部库存变动，按时间倒序</p>
          </div>
          <el-button link type="primary" @click="router.push('/inventory/movements')"
            >查看全仓流水</el-button
          >
        </div>
        <el-table :data="movements" row-key="id" stripe empty-text="这个商品还没有库存变动">
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ formatTime(row.occurredAt) }}</template>
          </el-table-column>
          <el-table-column label="类型" width="105">
            <template #default="{ row }">
              <el-tag size="small" :type="movementTone(row.type)">{{
                movementLabel(row.type)
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="仓库" min-width="130" prop="warehouseName" />
          <el-table-column label="数量变动" width="110" align="right">
            <template #default="{ row }">
              <span class="movement-delta" :class="row.direction === 'IN' ? 'in' : 'out'"
                >{{ row.quantityDelta > 0 ? '+' : '' }}{{ formatQuantity(row.quantityDelta) }}</span
              >
            </template>
          </el-table-column>
          <el-table-column label="操作前 / 后" width="130" align="right">
            <template #default="{ row }"
              >{{ formatQuantity(row.quantityBefore) }} →
              {{ formatQuantity(row.quantityAfter) }}</template
            >
          </el-table-column>
          <el-table-column label="来源单据" width="160">
            <template #default="{ row }">{{ row.sourceNo || '—' }}</template>
          </el-table-column>
          <el-table-column label="操作人" width="120" prop="operatorName" />
        </el-table>
        <div class="catalog-pagination">
          <span class="muted">{{ pageSummary(total, page, size) }}</span>
          <el-pagination
            :current-page="page"
            :page-size="size"
            :total="total"
            layout="prev, pager, next"
            background
            @current-change="changePage"
          />
        </div>
      </div>
    </template>
    <div v-else class="surface catalog-error" style="margin-top: 20px">
      <el-empty description="这个商品还没有库存或待入库记录" />
      <el-button @click="router.push('/inventory/balances')">返回库存列表</el-button>
    </div>
  </section>
</template>
