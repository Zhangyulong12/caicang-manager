<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import type { OutboundOrderData, WarehouseData } from '@caicang/api-contract';
import { useOutbound } from '../composables/outbound';
import { useCatalog } from '../composables/catalog';
import { useTenantStore } from '../stores/tenant';
import {
  carrierName,
  outboundStatusLabel,
  outboundStatusNames,
  outboundStatusTone,
  outboundFailureText,
} from '../api/outbound';
import { formatMoney, formatQuantity, pageSummary, rangeProblem } from '../api/inventory-format';
import { formatTime } from '../api/package-status';
const api = useOutbound(),
  catalog = useCatalog(),
  tenants = useTenantStore(),
  router = useRouter();
const rows = ref<OutboundOrderData[]>([]),
  warehouses = ref<WarehouseData[]>([]),
  loading = ref(false),
  error = ref(''),
  page = ref(1),
  size = ref(20),
  total = ref(0);
const applied = ref(''),
  status = ref(''),
  warehouseId = ref(''),
  range = ref<[string, string] | null>(null);
const canWrite = computed(() => tenants.current?.permissions.includes('outbound:write') === true);
const rangeError = computed(() => rangeProblem(range.value?.[0] ?? '', range.value?.[1] ?? ''));
const filtered = computed(
  () => applied.value !== '' || status.value !== '' || warehouseId.value !== '' || !!range.value,
);
let sequence = 0;
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    const result = await api.list({
      page: page.value,
      pageSize: size.value,
      search: applied.value,
      status: status.value ? (status.value as OutboundOrderData['status']) : undefined,
      warehouseId: warehouseId.value,
      from: range.value?.[0],
      to: range.value?.[1],
    });
    if (version !== sequence) return;
    rows.value = result.data;
    total.value = result.pagination.total;
  } catch (e) {
    if (version === sequence) {
      error.value = outboundFailureText(e);
      total.value = 0;
    }
  } finally {
    if (version === sequence) loading.value = false;
  }
}
function searchNow() {
  if (rangeError.value) return;
  applied.value = applied.value.trim();
  page.value = 1;
  void load();
}
function resetFilters() {
  applied.value = '';
  status.value = '';
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
function itemSummary(row: OutboundOrderData) {
  const first = row.items[0];
  if (!first) return '—';
  return row.items.length > 1
    ? `${first.sku} 等 ${row.items.length} 个 SKU`
    : `${first.sku} · ${first.name}`;
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
        <span class="section-kicker">OUTBOUND ORDERS</span>
        <h1>出库管理</h1>
        <p class="muted">
          从草稿到发货：先选商品与数量，确认发货时由服务端扣减库存并写流水，页面只展示服务器结果。
        </p>
      </div>
      <div class="outbound-heading-actions">
        <el-button :icon="Refresh" :disabled="loading" @click="load">刷新</el-button>
        <el-button v-if="canWrite" type="primary" :icon="Plus" @click="router.push('/outbound/new')"
          >新建出库单</el-button
        >
      </div>
    </div>
    <div class="surface catalog-panel">
      <form class="catalog-toolbar outbound-toolbar" @submit.prevent="searchNow">
        <el-input
          v-model="applied"
          aria-label="出库单搜索"
          placeholder="搜索出库单号、运单号、收件人或电话"
          :maxlength="200"
          :prefix-icon="Search"
          clearable
        />
        <el-select
          v-model="status"
          aria-label="出库状态筛选"
          placeholder="全部状态"
          @change="searchNow"
        >
          <el-option label="全部状态" value="" />
          <el-option
            v-for="(label, value) in outboundStatusNames"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <el-select
          v-model="warehouseId"
          aria-label="出库仓库筛选"
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
          start-placeholder="创建开始日期"
          end-placeholder="创建结束日期"
          aria-label="出库单创建日期筛选"
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
          :row-key="(row: OutboundOrderData) => row.id"
          stripe
          :empty-text="
            filtered ? '没有符合条件的出库单，请调整筛选' : '还没有出库单，点右上角新建一张'
          "
          @row-click="(row: OutboundOrderData) => router.push('/outbound/' + row.id)"
        >
          <el-table-column label="出库单号" min-width="215">
            <template #default="{ row }">
              <span class="catalog-item-link">{{ row.outboundNo }}</span>
              <small class="catalog-item-sub">{{ formatTime(row.createdAt) }}</small>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="outboundStatusTone(row.status)" size="small" effect="light">{{
                outboundStatusLabel(row.status)
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="仓库" min-width="130" prop="warehouseName" />
          <el-table-column label="收件人" min-width="150">
            <template #default="{ row }">
              <span>{{ row.customerName || '未填写' }}</span>
              <small class="catalog-item-sub">{{ row.customerPhone || '—' }}</small>
            </template>
          </el-table-column>
          <el-table-column label="商品" min-width="200">
            <template #default="{ row }">
              <span>{{ itemSummary(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="件数" width="90" align="right">
            <template #default="{ row }">{{ formatQuantity(row.totalQuantity) }}</template>
          </el-table-column>
          <el-table-column label="出库成本" width="120" align="right">
            <template #default="{ row }">{{ formatMoney(row.totalCost) }}</template>
          </el-table-column>
          <el-table-column label="快递 / 运单号" min-width="180">
            <template #default="{ row }">
              <span>{{ carrierName(row.carrierCode) }}</span>
              <small class="catalog-item-sub">{{ row.trackingNo || '未填写运单号' }}</small>
            </template>
          </el-table-column>
          <el-table-column label="发货时间" width="170">
            <template #default="{ row }">{{ formatTime(row.shippedAt) }}</template>
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
