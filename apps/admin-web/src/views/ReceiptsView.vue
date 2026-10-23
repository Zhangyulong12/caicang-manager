<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { Search, Refresh } from '@element-plus/icons-vue';
import type { ReceiptData } from '@caicang/api-contract';
import { useReceipts } from '../composables/inventory';
import { formatMoney, formatQuantity, pageSummary, rangeProblem } from '../api/inventory-format';
import { formatTime } from '../api/package-status';
import { failureMessage } from '../utils/feedback';
const api = useReceipts(),
  router = useRouter();
const rows = ref<ReceiptData[]>([]),
  loading = ref(false),
  error = ref(''),
  page = ref(1),
  size = ref(20),
  total = ref(0);
const search = ref(''),
  range = ref<[string, string] | null>(null);
const rangeError = computed(() => rangeProblem(range.value?.[0] ?? '', range.value?.[1] ?? ''));
let applied = '',
  sequence = 0;
const filtered = computed(() => applied !== '' || range.value !== null);
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    const result = await api.list({
      page: page.value,
      pageSize: size.value,
      search: applied,
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
onMounted(load);
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">INBOUND RECEIPTS</span>
        <h1>入库记录</h1>
        <p class="muted">
          每一次手机扫码验收产生的入库单都在这里；点进去可以核对 SKU、数量与到岸成本快照。
        </p>
      </div>
      <el-button :icon="Refresh" :disabled="loading" @click="load">刷新</el-button>
    </div>
    <div class="surface catalog-panel" style="margin-top: 20px">
      <form class="catalog-toolbar inventory-toolbar" @submit.prevent="searchNow">
        <el-input
          v-model="search"
          aria-label="入库单搜索"
          placeholder="搜索入库单号、采购单号或运单号"
          :maxlength="200"
          :prefix-icon="Search"
          clearable
        />
        <el-date-picker
          v-model="range"
          type="daterange"
          unlink-panels
          value-format="YYYY-MM-DD"
          start-placeholder="入库开始日期"
          end-placeholder="入库结束日期"
          aria-label="入库日期筛选"
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
            filtered ? '没有符合条件的入库单' : '还没有入库记录；手机扫码验收后会自动出现在这里'
          "
          @row-click="(row: ReceiptData) => router.push('/receipts/' + row.id)"
        >
          <el-table-column label="入库单号" min-width="185">
            <template #default="{ row }">
              <router-link :to="'/receipts/' + row.id" class="catalog-item-link">{{
                row.receiptNo
              }}</router-link>
              <small class="catalog-item-sub">{{ formatTime(row.receivedAt) }}</small>
            </template>
          </el-table-column>
          <el-table-column label="采购单 / 包裹" min-width="190">
            <template #default="{ row }">
              <span>{{ row.purchaseOrderNo }}</span>
              <small class="catalog-item-sub">{{ row.trackingNo || '未登记运单' }}</small>
            </template>
          </el-table-column>
          <el-table-column label="仓库" min-width="130" prop="warehouseName" />
          <el-table-column label="入库件数" width="105" align="right">
            <template #default="{ row }">{{ formatQuantity(row.totalQuantity) }}</template>
          </el-table-column>
          <el-table-column label="入库金额" width="130" align="right">
            <template #default="{ row }">{{ formatMoney(row.totalCost) }}</template>
          </el-table-column>
          <el-table-column label="操作人" width="120" prop="receivedByName" />
          <el-table-column label="备注" min-width="160">
            <template #default="{ row }">
              <span :class="{ muted: !row.remark }">{{ row.remark || '—' }}</span>
            </template>
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
