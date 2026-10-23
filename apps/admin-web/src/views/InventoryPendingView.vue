<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { Search, Refresh } from '@element-plus/icons-vue';
import type { InventoryPendingData, WarehouseData } from '@caicang/api-contract';
import InventoryTabs from '../components/InventoryTabs.vue';
import { useInventory } from '../composables/inventory';
import { useCatalog } from '../composables/catalog';
import { platformLabel, purchaseStatusLabel } from '../api/receipts';
import {
  formatDate,
  formatMoney,
  formatQuantity,
  pageSummary,
  rangeProblem,
} from '../api/inventory-format';
import { failureMessage } from '../utils/feedback';
const api = useInventory(),
  catalog = useCatalog();
const rows = ref<InventoryPendingData[]>([]),
  warehouses = ref<WarehouseData[]>([]),
  loading = ref(false),
  error = ref(''),
  page = ref(1),
  size = ref(20),
  total = ref(0);
const search = ref(''),
  warehouseId = ref(''),
  range = ref<[string, string] | null>(null);
const rangeError = computed(() => rangeProblem(range.value?.[0] ?? '', range.value?.[1] ?? ''));
let applied = '',
  sequence = 0;
const filtered = computed(() => applied !== '' || warehouseId.value !== '' || range.value !== null);
/** 当前页的待入库件数与金额合计（只合计本页，避免让用户以为这是全量）。 */
const pageTotals = computed(() =>
  rows.value.reduce(
    (sum, row) => ({
      quantity: sum.quantity + row.pendingQuantity,
      amount: sum.amount + Number(row.pendingAmount),
    }),
    { quantity: 0, amount: 0 },
  ),
);
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    const result = await api.pending({
      page: page.value,
      pageSize: size.value,
      search: applied,
      warehouseId: warehouseId.value,
      from: range.value?.[0],
      to: range.value?.[1],
    });
    if (version !== sequence) return;
    rows.value = result.data;
    total.value = result.pagination.total;
  } catch (e) {
    if (version === sequence) {
      error.value = failureMessage(e);
      total.value = 0;
    }
  } finally {
    if (version === sequence) loading.value = false;
  }
}
function searchNow() {
  if (rangeError.value) return;
  applied = search.value.trim();
  page.value = 1;
  void load();
}
function resetFilters() {
  search.value = '';
  warehouseId.value = '';
  range.value = null;
  searchNow();
}
function changePage(next: number) {
  page.value = next;
  void load();
}
function changeSize(next: number) {
  size.value = next;
  page.value = 1;
  void load();
}
onMounted(async () => {
  void load();
  try {
    warehouses.value = (await catalog.warehouses(1, 100)).data;
  } catch {
    warehouses.value = [];
  }
});
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">PENDING INBOUND</span>
        <h1>待入库采购商品</h1>
        <p class="muted">
          已下单但还没验收完的采购行；数量由采购单减去已入库明细算出，用于提前安排仓位与人力。
        </p>
      </div>
      <el-button :icon="Refresh" :disabled="loading" @click="load">刷新</el-button>
    </div>
    <InventoryTabs />
    <div class="surface catalog-panel" style="margin-top: 20px">
      <form class="catalog-toolbar inventory-toolbar" @submit.prevent="searchNow">
        <el-input
          v-model="search"
          aria-label="待入库搜索"
          placeholder="搜索采购单号、商品名称或 SKU"
          :maxlength="200"
          :prefix-icon="Search"
          clearable
        />
        <el-select
          v-model="warehouseId"
          aria-label="仓库筛选"
          placeholder="全部仓库"
          @change="searchNow"
        >
          <el-option label="全部仓库" value="" />
          <el-option
            v-for="warehouse in warehouses"
            :key="warehouse.id"
            :label="warehouse.name"
            :value="warehouse.id"
          />
        </el-select>
        <el-date-picker
          v-model="range"
          type="daterange"
          unlink-panels
          value-format="YYYY-MM-DD"
          start-placeholder="采购开始日期"
          end-placeholder="采购结束日期"
          aria-label="采购日期筛选"
          @change="searchNow"
        />
        <el-button native-type="submit" type="primary" :loading="loading">搜索</el-button>
        <el-button v-if="filtered" link type="primary" @click="resetFilters">清除筛选</el-button>
        <p v-if="rangeError" class="inventory-toolbar-hint" style="color: #c35b5b">
          {{ rangeError }}
        </p>
      </form>
      <div v-if="error" class="catalog-error">
        <el-alert :title="error" type="error" :closable="false" /><el-button @click="load"
          >重试加载</el-button
        >
      </div>
      <el-skeleton v-else-if="loading" :rows="6" animated class="loading-surface" />
      <template v-else>
        <el-table
          :data="rows"
          :row-key="(row: InventoryPendingData) => row.purchaseOrderId + row.productId"
          stripe
          :empty-text="
            filtered ? '没有符合条件的待入库商品' : '当前没有待入库商品，所有采购单都已收完'
          "
        >
          <el-table-column label="采购单" min-width="180">
            <template #default="{ row }">
              <router-link :to="'/purchases/' + row.purchaseOrderId" class="catalog-item-link">{{
                row.orderNo
              }}</router-link>
              <small class="catalog-item-sub"
                >{{ platformLabel(row.platform) }} · {{ purchaseStatusLabel(row.status) }}</small
              >
            </template>
          </el-table-column>
          <el-table-column label="采购日期" width="115">
            <template #default="{ row }">{{ formatDate(row.purchaseDate) }}</template>
          </el-table-column>
          <el-table-column label="仓库" min-width="130" prop="warehouseName" />
          <el-table-column label="商品" min-width="190">
            <template #default="{ row }">
              <span class="catalog-item-link">{{ row.name }}</span>
              <small class="catalog-item-sub">{{ row.sku }}</small>
            </template>
          </el-table-column>
          <el-table-column label="订购" width="80" align="right">
            <template #default="{ row }">{{ formatQuantity(row.orderedQuantity) }}</template>
          </el-table-column>
          <el-table-column label="已入库" width="90" align="right">
            <template #default="{ row }">{{ formatQuantity(row.receivedQuantity) }}</template>
          </el-table-column>
          <el-table-column label="待入库" width="95" align="right">
            <template #default="{ row }">
              <span class="stock-number pending">{{ formatQuantity(row.pendingQuantity) }}</span>
              <small class="catalog-item-sub">{{ row.unit }}</small>
            </template>
          </el-table-column>
          <el-table-column label="采购单价" width="110" align="right">
            <template #default="{ row }">{{ formatMoney(row.unitPrice) }}</template>
          </el-table-column>
          <el-table-column label="待入库金额" width="125" align="right">
            <template #default="{ row }">{{ formatMoney(row.pendingAmount) }}</template>
          </el-table-column>
        </el-table>
        <div class="catalog-pagination">
          <span class="muted"
            >{{ pageSummary(total, page, size) }} · 本页待入库
            {{ formatQuantity(pageTotals.quantity) }} 件 /
            {{ formatMoney(pageTotals.amount.toFixed(4)) }}
          </span>
          <el-pagination
            :current-page="page"
            :page-size="size"
            :total="total"
            :page-sizes="[10, 20, 50, 100]"
            layout="sizes, prev, pager, next"
            background
            @current-change="changePage"
            @size-change="changeSize"
          />
        </div>
      </template>
    </div>
  </section>
</template>
