<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { Search, Refresh } from '@element-plus/icons-vue';
import type {
  InventoryMovementData,
  StockMovementType,
  WarehouseData,
} from '@caicang/api-contract';
import { STOCK_MOVEMENT_TYPES } from '@caicang/api-contract';
import InventoryTabs from '../components/InventoryTabs.vue';
import { useInventory } from '../composables/inventory';
import { useCatalog } from '../composables/catalog';
import {
  formatQuantity,
  formatUnitCost,
  movementLabel,
  movementTone,
  pageSummary,
  rangeProblem,
} from '../api/inventory-format';
import { formatTime } from '../api/package-status';
import { failureMessage } from '../utils/feedback';
const api = useInventory(),
  catalog = useCatalog();
const rows = ref<InventoryMovementData[]>([]),
  warehouses = ref<WarehouseData[]>([]),
  loading = ref(false),
  error = ref(''),
  page = ref(1),
  size = ref(20),
  total = ref(0);
const search = ref(''),
  warehouseId = ref(''),
  type = ref<StockMovementType | ''>(''),
  range = ref<[string, string] | null>(null);
const rangeError = computed(() => rangeProblem(range.value?.[0] ?? '', range.value?.[1] ?? ''));
let applied = '',
  sequence = 0;
const filtered = computed(
  () => applied !== '' || warehouseId.value !== '' || type.value !== '' || range.value !== null,
);
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    const result = await api.movements({
      page: page.value,
      pageSize: size.value,
      search: applied,
      warehouseId: warehouseId.value,
      ...(type.value ? { type: type.value } : {}),
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
  type.value = '';
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
        <span class="section-kicker">STOCK LEDGER</span>
        <h1>库存变动流水</h1>
        <p class="muted">
          每一次入库、出库与调整都是不可变流水；每一笔都带操作前后数量、来源单据与操作人。
        </p>
      </div>
      <el-button :icon="Refresh" :disabled="loading" @click="load">刷新</el-button>
    </div>
    <InventoryTabs />
    <div class="surface catalog-panel" style="margin-top: 20px">
      <form class="catalog-toolbar inventory-toolbar" @submit.prevent="searchNow">
        <el-input
          v-model="search"
          aria-label="流水搜索"
          placeholder="搜索商品名称、SKU 或条码"
          :maxlength="200"
          :prefix-icon="Search"
          clearable
        />
        <el-select v-model="type" aria-label="操作类型" placeholder="全部类型" @change="searchNow">
          <el-option label="全部类型" value="" />
          <el-option
            v-for="item in STOCK_MOVEMENT_TYPES"
            :key="item"
            :label="movementLabel(item)"
            :value="item"
          />
        </el-select>
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
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          aria-label="流水日期筛选"
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
          row-key="id"
          stripe
          :empty-text="
            filtered ? '没有符合条件的流水' : '还没有库存流水；手机扫码验收后会在这里出现'
          "
        >
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
          <el-table-column label="商品" min-width="180">
            <template #default="{ row }">
              <router-link :to="'/inventory/sku/' + row.productId" class="catalog-item-link">{{
                row.productName
              }}</router-link>
              <small class="catalog-item-sub">{{ row.sku }}</small>
            </template>
          </el-table-column>
          <el-table-column label="仓库" min-width="130" prop="warehouseName" />
          <el-table-column label="数量变动" width="105" align="right">
            <template #default="{ row }">
              <span class="movement-delta" :class="row.direction === 'IN' ? 'in' : 'out'"
                >{{ row.quantityDelta > 0 ? '+' : '' }}{{ formatQuantity(row.quantityDelta) }}</span
              >
            </template>
          </el-table-column>
          <el-table-column label="操作前" width="95" align="right">
            <template #default="{ row }">{{ formatQuantity(row.quantityBefore) }}</template>
          </el-table-column>
          <el-table-column label="操作后" width="95" align="right">
            <template #default="{ row }">{{ formatQuantity(row.quantityAfter) }}</template>
          </el-table-column>
          <el-table-column label="单位成本" width="110" align="right">
            <template #default="{ row }">{{ formatUnitCost(row.unitCost) }}</template>
          </el-table-column>
          <el-table-column label="来源单据" min-width="160">
            <template #default="{ row }">
              <router-link
                v-if="row.type === 'RECEIPT' && row.sourceDocumentId"
                :to="'/receipts/' + row.sourceDocumentId"
                class="catalog-item-link"
                >{{ row.sourceNo || '入库单' }}</router-link
              >
              <span v-else>{{ row.sourceNo || '—' }}</span>
              <small class="catalog-item-sub">{{ row.note || row.sourceType }}</small>
            </template>
          </el-table-column>
          <el-table-column label="操作人" width="120" prop="operatorName" />
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
