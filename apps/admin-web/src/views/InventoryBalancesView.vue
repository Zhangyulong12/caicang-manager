<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { Search, Refresh } from '@element-plus/icons-vue';
import type { InventoryBalanceData, WarehouseData } from '@caicang/api-contract';
import InventoryTabs from '../components/InventoryTabs.vue';
import { useInventory } from '../composables/inventory';
import { useCatalog } from '../composables/catalog';
import {
  formatMoney,
  formatQuantity,
  formatUnitCost,
  pageSummary,
  rangeProblem,
} from '../api/inventory-format';
import { formatTime } from '../api/package-status';
import { failureMessage } from '../utils/feedback';
const api = useInventory(),
  catalog = useCatalog(),
  router = useRouter();
const rows = ref<InventoryBalanceData[]>([]),
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
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    const result = await api.balances({
      page: page.value,
      pageSize: size.value,
      search: applied,
      warehouseId: warehouseId.value,
      updatedFrom: range.value?.[0],
      updatedTo: range.value?.[1],
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
    const result = await catalog.warehouses(1, 100);
    warehouses.value = result.data;
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
        <span class="section-kicker">STOCK BALANCES</span>
        <h1>商品库存列表</h1>
        <p class="muted">
          按仓库与 SKU 查看现存数量、移动加权平均成本与账面总成本；点任意一行查看该 SKU 的库存详情。
        </p>
      </div>
      <el-button :icon="Refresh" :disabled="loading" @click="load">刷新</el-button>
    </div>
    <InventoryTabs />
    <div class="surface catalog-panel" style="margin-top: 20px">
      <form class="catalog-toolbar inventory-toolbar" @submit.prevent="searchNow">
        <el-input
          v-model="search"
          aria-label="库存搜索"
          placeholder="搜索商品名称、SKU 或条码"
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
          start-placeholder="变动开始日期"
          end-placeholder="变动结束日期"
          aria-label="库存变动日期筛选"
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
          :row-key="(row: InventoryBalanceData) => row.warehouseId + row.productId"
          stripe
          :empty-text="
            filtered
              ? '没有符合条件的库存，请调整筛选'
              : '还没有库存；手机扫码验收后这里会出现真实数量'
          "
          @row-click="(row: InventoryBalanceData) => router.push('/inventory/sku/' + row.productId)"
        >
          <el-table-column label="商品名称" min-width="190">
            <template #default="{ row }">
              <span class="catalog-item-link">{{ row.name }}</span>
              <small class="catalog-item-sub">{{ row.specification || row.unit }}</small>
            </template>
          </el-table-column>
          <el-table-column label="SKU" width="150">
            <template #default="{ row }">
              <span>{{ row.sku }}</span>
              <small class="catalog-item-sub">{{ row.barcode || '无条码' }}</small>
            </template>
          </el-table-column>
          <el-table-column label="仓库" min-width="140" prop="warehouseName" />
          <el-table-column label="当前数量" width="110" align="right">
            <template #default="{ row }">
              <span class="stock-number" :class="{ zero: row.quantityOnHand === 0 }">{{
                formatQuantity(row.quantityOnHand)
              }}</span>
              <small class="catalog-item-sub">{{ row.unit }}</small>
            </template>
          </el-table-column>
          <el-table-column label="平均成本" width="120" align="right">
            <template #default="{ row }">{{ formatUnitCost(row.averageCost) }}</template>
          </el-table-column>
          <el-table-column label="库存总成本" width="140" align="right">
            <template #default="{ row }">{{ formatMoney(row.totalCost) }}</template>
          </el-table-column>
          <el-table-column label="待入库数量" width="115" align="right">
            <template #default="{ row }">
              <span class="stock-number" :class="{ pending: row.pendingInboundQuantity > 0 }">{{
                formatQuantity(row.pendingInboundQuantity)
              }}</span>
            </template>
          </el-table-column>
          <el-table-column label="最近入库时间" width="175">
            <template #default="{ row }">{{ formatTime(row.lastReceivedAt) }}</template>
          </el-table-column>
        </el-table>
        <div class="catalog-pagination">
          <span class="muted">{{ pageSummary(total, page, size) }}</span>
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
