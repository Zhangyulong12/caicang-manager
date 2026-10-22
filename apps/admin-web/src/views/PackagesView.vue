<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { Search, Refresh } from '@element-plus/icons-vue';
import type { PackageData, PackageReceivingStatus, PackageStatus } from '@caicang/api-contract';
import { usePackages } from '../composables/packages';
import { failureMessage } from '../utils/feedback';
import {
  expectedTotal,
  formatTime,
  itemSummary,
  packageStatusNames,
  packageStatusTone,
  receivingPercent,
  receivingStatusNames,
  receivingStatusTone,
} from '../api/package-status';
const api = usePackages();
const rows = ref<PackageData[]>([]),
  loading = ref(false),
  error = ref(''),
  page = ref(1),
  size = ref(20),
  total = ref(0);
const search = ref(''),
  status = ref<PackageStatus | ''>(''),
  hasReceipts = ref<'' | 'true' | 'false'>('');
let applied = '',
  sequence = 0;
const selected = ref<PackageData | null>(null),
  detailLoading = ref(false),
  detailError = ref('');
let detailSequence = 0;
const filtered = computed(() => applied !== '' || status.value !== '' || hasReceipts.value !== '');
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
      ...(status.value ? { status: status.value } : {}),
      ...(hasReceipts.value === '' ? {} : { hasReceipts: hasReceipts.value === 'true' }),
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
  applied = search.value.trim();
  page.value = 1;
  void load();
}
function resetFilters() {
  search.value = '';
  status.value = '';
  hasReceipts.value = '';
  searchNow();
}
async function openDetail(row: PackageData) {
  const version = ++detailSequence;
  selected.value = row;
  detailLoading.value = true;
  detailError.value = '';
  try {
    const detail = await api.detail(row.id);
    if (version === detailSequence) selected.value = detail;
  } catch (e) {
    if (version === detailSequence) detailError.value = failureMessage(e);
  } finally {
    if (version === detailSequence) detailLoading.value = false;
  }
}
function closeDetail() {
  detailSequence++;
  selected.value = null;
  detailError.value = '';
  detailLoading.value = false;
}
onMounted(load);
onBeforeUnmount(() => {
  sequence++;
  detailSequence++;
});
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">PARCELS &amp; TRACKING</span>
        <h1>快递包裹</h1>
        <p class="muted">按运单追踪到仓包裹，核对采购来源与预计数量；物流到达不等于实际入库。</p>
      </div>
    </div>
    <div class="surface catalog-panel">
      <form class="catalog-toolbar package-filters" @submit.prevent="searchNow">
        <el-input
          v-model="search"
          aria-label="包裹搜索"
          placeholder="搜索运单号、采购单号或商品 SKU"
          :maxlength="200"
          :prefix-icon="Search"
          clearable
        /><el-select
          v-model="status"
          aria-label="包裹物流状态"
          placeholder="全部物流状态"
          @change="searchNow"
          ><el-option label="全部物流状态" value="" /><el-option
            v-for="(label, value) in packageStatusNames"
            :key="value"
            :label="label"
            :value="value" /></el-select
        ><el-select
          v-model="hasReceipts"
          aria-label="收货记录筛选"
          placeholder="全部收货情况"
          @change="searchNow"
          ><el-option label="全部收货情况" value="" /><el-option
            label="已有收货记录"
            value="true" /><el-option label="尚无收货记录" value="false" /></el-select
        ><el-button native-type="submit" type="primary" :loading="loading">搜索</el-button
        ><el-button :icon="Refresh" :disabled="loading" @click="load">刷新</el-button
        ><el-button v-if="filtered" link type="primary" @click="resetFilters">清除筛选</el-button>
      </form>
      <div v-if="error" class="catalog-error">
        <el-alert :title="error" type="error" :closable="false" show-icon /><el-button @click="load"
          >重试加载</el-button
        >
      </div>
      <el-skeleton v-else-if="loading" :rows="6" animated class="loading-surface" />
      <template v-else
        ><el-table
          :data="rows"
          row-key="id"
          stripe
          :empty-text="
            filtered ? '没有符合条件的包裹，请调整筛选' : '暂无包裹，可在采购单中登记快递运单'
          "
          ><el-table-column label="运单号 / 快递" min-width="190"
            ><template #default="{ row }"
              ><span class="package-tracking">{{ row.trackingNo || '未填写运单' }}</span
              ><small class="catalog-item-sub">{{
                row.carrierCode || '未填写快递公司'
              }}</small></template
            ></el-table-column
          ><el-table-column label="采购单" min-width="175"
            ><template #default="{ row }"
              ><router-link :to="'/purchases/' + row.purchaseOrderId" class="catalog-item-link">{{
                row.purchaseOrderNo
              }}</router-link
              ><small class="catalog-item-sub">{{ row.purchaseStatus }}</small></template
            ></el-table-column
          ><el-table-column label="商品与预计数量" min-width="220"
            ><template #default="{ row }"
              ><span>{{ itemSummary(row.expectedItems) }}</span
              ><small class="catalog-item-sub"
                >预计 {{ expectedTotal(row.expectedItems) }} 件 · 已收
                {{ row.receivedQuantity }} 件</small
              ></template
            ></el-table-column
          ><el-table-column label="物流状态" width="112"
            ><template #default="{ row }"
              ><el-tag :type="packageStatusTone(row.status)">{{
                packageStatusNames[row.status as PackageStatus] || row.status
              }}</el-tag></template
            ></el-table-column
          ><el-table-column label="收货进度" width="126"
            ><template #default="{ row }"
              ><el-tag :type="receivingStatusTone(row.receivingStatus)" effect="plain">{{
                receivingStatusNames[row.receivingStatus as PackageReceivingStatus]
              }}</el-tag
              ><small class="catalog-item-sub">{{
                row.expectedItems.length ? receivingPercent(row) + '% 计划到货' : '无预计明细'
              }}</small></template
            ></el-table-column
          ><el-table-column label="创建时间" width="165"
            ><template #default="{ row }">{{
              formatTime(row.createdAt)
            }}</template></el-table-column
          ><el-table-column label="操作" width="80" fixed="right"
            ><template #default="{ row }"
              ><el-button link type="primary" @click="openDetail(row)">详情</el-button></template
            ></el-table-column
          ></el-table
        >
        <div class="catalog-pagination">
          <span class="muted">共 {{ total }} 个包裹 · 数据来自服务器</span
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
          /></div
      ></template>
    </div>
    <el-dialog
      :model-value="selected !== null"
      title="包裹详情"
      width="760px"
      top="6vh"
      @close="closeDetail"
      ><div v-if="detailLoading" class="loading-surface"><el-skeleton :rows="5" animated /></div>
      <div v-else-if="detailError" class="catalog-error">
        <el-alert :title="detailError" type="error" :closable="false" show-icon /><el-button
          @click="selected && openDetail(selected)"
          >重试加载</el-button
        >
      </div>
      <div v-else-if="selected" class="package-detail">
        <el-descriptions :column="2" border
          ><el-descriptions-item label="运单号">{{
            selected.trackingNo || '—'
          }}</el-descriptions-item
          ><el-descriptions-item label="快递公司">{{
            selected.carrierCode || '—'
          }}</el-descriptions-item
          ><el-descriptions-item label="采购单"
            ><router-link
              :to="'/purchases/' + selected.purchaseOrderId"
              class="catalog-item-link"
              @click="closeDetail"
              >{{ selected.purchaseOrderNo }}</router-link
            ></el-descriptions-item
          ><el-descriptions-item label="采购状态">{{
            selected.purchaseStatus
          }}</el-descriptions-item
          ><el-descriptions-item label="物流状态"
            ><el-tag :type="packageStatusTone(selected.status)">{{
              packageStatusNames[selected.status] || selected.status
            }}</el-tag></el-descriptions-item
          ><el-descriptions-item label="收货进度"
            ><el-tag :type="receivingStatusTone(selected.receivingStatus)" effect="plain">{{
              receivingStatusNames[selected.receivingStatus]
            }}</el-tag></el-descriptions-item
          ><el-descriptions-item label="创建时间">{{
            formatTime(selected.createdAt)
          }}</el-descriptions-item
          ><el-descriptions-item label="最后更新">{{
            formatTime(selected.updatedAt)
          }}</el-descriptions-item
          ><el-descriptions-item label="备注" :span="2">{{
            selected.remark || '—'
          }}</el-descriptions-item></el-descriptions
        >
        <h3 class="package-detail-title">
          预计明细 <small class="muted">预计数量是采购计划，不代表已到货</small>
        </h3>
        <el-table :data="selected.expectedItems" size="small" empty-text="此包裹未登记预计商品"
          ><el-table-column prop="sku" label="SKU" min-width="120" /><el-table-column
            prop="name"
            label="商品"
            min-width="160" /><el-table-column
            prop="unit"
            label="单位"
            width="70" /><el-table-column
            prop="orderedQuantity"
            label="采购数量"
            width="95" /><el-table-column
            prop="expectedQuantity"
            label="预计数量"
            width="95" /><el-table-column prop="receivedQuantity" label="本包已收" width="95"
        /></el-table>
        <p class="muted package-detail-note">
          本页只读取真实包裹与收货数据；扫码验收与正式入库在后续功能中开放。
        </p>
      </div>
      <template #footer><el-button @click="closeDetail">关闭</el-button></template></el-dialog
    >
  </section>
</template>
