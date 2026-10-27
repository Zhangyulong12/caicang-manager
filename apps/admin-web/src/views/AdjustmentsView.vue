<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_LABELS,
  type AdjustmentReason,
  type StockAdjustmentData,
  type WarehouseData,
} from '@caicang/api-contract';
import InventoryTabs from '../components/InventoryTabs.vue';
import { useAdjustments } from '../composables/adjustments';
import { useTenantStore } from '../stores/tenant';
import { formatQuantity, pageSummary, rangeProblem } from '../api/inventory-format';
import { formatTime } from '../api/package-status';
import { failureMessage } from '../utils/feedback';
const api = useAdjustments(),
  tenants = useTenantStore(),
  route = useRoute(),
  router = useRouter();
const rows = ref<StockAdjustmentData[]>([]),
  warehouses = ref<WarehouseData[]>([]),
  loading = ref(false),
  error = ref(''),
  page = ref(1),
  size = ref(20),
  total = ref(0);
const search = ref(''),
  warehouseId = ref(typeof route.query.warehouseId === 'string' ? route.query.warehouseId : ''),
  productId = ref(typeof route.query.productId === 'string' ? route.query.productId : ''),
  reason = ref<AdjustmentReason | ''>(''),
  range = ref<[string, string] | null>(null);
const canWrite = computed(() => tenants.current?.permissions.includes('inventory:write') === true),
  rangeError = computed(() => rangeProblem(range.value?.[0] ?? '', range.value?.[1] ?? ''));
let sequence = 0,
  alive = true,
  applied = '';
async function load() {
  const version = ++sequence;
  loading.value = true;
  rows.value = [];
  error.value = '';
  try {
    const result = await api.list({
      page: page.value,
      pageSize: size.value,
      search: applied,
      warehouseId: warehouseId.value,
      productId: productId.value,
      ...(reason.value ? { reason: reason.value } : {}),
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
function query() {
  if (rangeError.value) return;
  applied = search.value.trim();
  page.value = 1;
  void load();
}
function reset() {
  search.value = '';
  warehouseId.value = '';
  productId.value = '';
  reason.value = '';
  range.value = null;
  query();
}
async function initialize() {
  loading.value = true;
  error.value = '';
  try {
    const result = await api.warehouses();
    if (!alive) return;
    warehouses.value = result;
    await load();
  } catch (e) {
    if (alive) {
      loading.value = false;
      error.value = failureMessage(e);
    }
  }
}
onMounted(initialize);
onBeforeUnmount(() => {
  alive = false;
  sequence++;
});
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">STOCK ADJUSTMENTS</span>
        <h1>库存调整</h1>
        <p class="muted">记录盘盈、盘亏、损坏和丢失，每次变动都有单据与流水可追溯。</p>
      </div>
      <el-button
        type="primary"
        :disabled="!canWrite"
        @click="router.push('/inventory/adjustments/new')"
        >新建库存调整</el-button
      >
    </div>
    <InventoryTabs />
    <el-alert
      v-if="!canWrite"
      title="当前角色只可查看库存调整，不能修改库存"
      type="info"
      :closable="false"
      class="form-alert"
    />
    <div class="surface catalog-panel" style="margin-top: 20px">
      <form class="catalog-toolbar inventory-toolbar" @submit.prevent="query">
        <el-input
          v-model="search"
          aria-label="调整单搜索"
          placeholder="搜索调整单号、SKU 或商品名称"
          maxlength="128"
          clearable
        />
        <el-select
          v-model="warehouseId"
          aria-label="调整仓库筛选"
          placeholder="全部仓库"
          @change="query"
          ><el-option label="全部仓库" value="" /><el-option
            v-for="row in warehouses"
            :key="row.id"
            :label="row.name"
            :value="row.id"
        /></el-select>
        <el-select v-model="reason" aria-label="调整原因筛选" placeholder="全部原因" @change="query"
          ><el-option label="全部原因" value="" /><el-option
            v-for="value in ADJUSTMENT_REASONS"
            :key="value"
            :label="ADJUSTMENT_REASON_LABELS[value]"
            :value="value"
        /></el-select>
        <el-date-picker
          v-model="range"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          aria-label="调整日期筛选"
          @change="query"
        />
        <el-button native-type="submit" type="primary" :loading="loading">查询</el-button
        ><el-button :disabled="loading" @click="initialize">刷新</el-button
        ><el-button link @click="reset">清除筛选</el-button>
        <p v-if="rangeError" class="inventory-toolbar-hint">{{ rangeError }}</p>
      </form>
      <div v-if="error" class="catalog-error">
        <el-alert :title="error" type="error" :closable="false" /><el-button @click="initialize"
          >重试加载</el-button
        >
      </div>
      <el-skeleton v-else-if="loading" :rows="6" animated />
      <template v-else>
        <el-table :data="rows" row-key="id" stripe empty-text="暂无符合条件的库存调整记录">
          <el-table-column label="调整单号" min-width="245"
            ><template #default="{ row }"
              ><router-link :to="'/inventory/adjustments/' + row.id" class="catalog-item-link">{{
                row.adjustmentNo
              }}</router-link></template
            ></el-table-column
          >
          <el-table-column label="仓库 / 商品" min-width="200"
            ><template #default="{ row }"
              >{{ row.warehouseName
              }}<small class="catalog-item-sub"
                >{{ row.productName }} · {{ row.sku }}</small
              ></template
            ></el-table-column
          >
          <el-table-column prop="reasonLabel" label="原因" width="110" />
          <el-table-column label="调整前" width="100" align="right"
            ><template #default="{ row }">{{
              formatQuantity(row.quantityBefore)
            }}</template></el-table-column
          >
          <el-table-column label="调整数量" width="105" align="right"
            ><template #default="{ row }"
              ><strong class="movement-delta" :class="row.quantityDelta > 0 ? 'in' : 'out'"
                >{{ row.quantityDelta > 0 ? '+' : ''
                }}{{ formatQuantity(row.quantityDelta) }}</strong
              ></template
            ></el-table-column
          >
          <el-table-column label="调整后" width="100" align="right"
            ><template #default="{ row }">{{
              formatQuantity(row.quantityAfter)
            }}</template></el-table-column
          >
          <el-table-column prop="createdByName" label="操作人" width="120" /><el-table-column
            label="时间"
            width="175"
            ><template #default="{ row }">{{
              formatTime(row.createdAt)
            }}</template></el-table-column
          >
          <el-table-column label="操作" width="80" fixed="right"
            ><template #default="{ row }"
              ><el-button
                link
                type="primary"
                @click="router.push('/inventory/adjustments/' + row.id)"
                >详情</el-button
              ></template
            ></el-table-column
          >
        </el-table>
        <div class="catalog-pagination">
          <span class="muted">{{ pageSummary(total, page, size) }}</span
          ><el-pagination
            v-model:current-page="page"
            v-model:page-size="size"
            :total="total"
            :page-sizes="[10, 20, 50, 100]"
            layout="sizes, prev, pager, next"
            @current-change="load"
            @size-change="
              page = 1;
              load();
            "
          />
        </div>
      </template>
    </div>
  </section>
</template>
