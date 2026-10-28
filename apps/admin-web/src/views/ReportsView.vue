<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type {
  ReportDataset,
  ReportOverviewData,
  ReportTableData,
  PurchaseAccountData,
  WarehouseData,
} from '@caicang/api-contract';
import { useReports } from '../composables/reports';
import { usePurchases } from '../composables/purchases';
import { useTenantStore } from '../stores/tenant';
import { reportSource, type ReportFilters } from '../api/reports';
import { failureMessage } from '../utils/feedback';
import { ElMessage } from 'element-plus';
const api = useReports(),
  purchases = usePurchases(),
  tenants = useTenantStore(),
  router = useRouter();
const today = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const range = ref<[string, string] | null>([today.slice(0, 7) + '-01', today]);
const filters = ref<ReportFilters>({}),
  dataset = ref<ReportDataset>('accounts'),
  overview = ref<ReportOverviewData | null>(null),
  table = ref<ReportTableData | null>(null),
  loading = ref(false),
  exporting = ref(false),
  error = ref(''),
  optionsError = ref(''),
  page = ref(1),
  accounts = ref<PurchaseAccountData[]>([]),
  warehouses = ref<WarehouseData[]>([]);
const datasets: { value: ReportDataset; label: string }[] = [
  { value: 'accounts', label: '按采购账号' },
  { value: 'platforms', label: '按平台' },
  { value: 'daily', label: '按日期' },
  { value: 'products', label: '按商品' },
  { value: 'purchase-lines', label: '采购明细 / 最近采购' },
  { value: 'pending', label: '待入库商品' },
  { value: 'inventory', label: '当前库存' },
  { value: 'receipts', label: '最近入库' },
  { value: 'outbound', label: '最近出库' },
  { value: 'returns', label: '采购退货 / 退款' },
  { value: 'adjustments', label: '最近库存调整' },
];
const canExport = computed(() => tenants.current?.permissions.includes('reports:export'));
const pooled = computed(() => ['inventory', 'outbound', 'adjustments'].includes(dataset.value));
const headerOnly = computed(() =>
  ['accounts', 'platforms', 'daily', 'returns'].includes(dataset.value),
);
const cards = computed(() =>
  overview.value
    ? [
        ['本月采购（月初至今天）', overview.value.monthPurchaseAmount, '元；所选账号/平台/仓库'],
        ['筛选采购总金额', overview.value.purchaseAmount, '元；原单含优惠、运费'],
        ['当前待入库金额', overview.value.pendingAmount, '元；所选采购单剩余估值'],
        ['当前库存总成本', overview.value.inventoryCost, '元；混合库存，不按采购账号'],
        ['期间出库成本', overview.value.outboundCost, '元；实际流水，不按采购账号'],
        ['采购退货退款登记', overview.value.returnRefundAmount, '元；所选账号整单，不按 SKU'],
        ['期间入库成本', overview.value.receivedCost, '元；实际入库流水'],
        ['退货库存成本减少', overview.value.returnStockCost, '元；独立于退款'],
      ]
    : [],
);
let sequence = 0;
let applied: ReportFilters = {};
async function options() {
  optionsError.value = '';
  try {
    const [a, w] = await Promise.all([purchases.accountOptions(), purchases.warehouses()]);
    accounts.value = a;
    warehouses.value = w;
  } catch (e) {
    optionsError.value = failureMessage(e);
  }
}
async function load() {
  const v = ++sequence;
  loading.value = true;
  error.value = '';
  table.value = null;
  overview.value = null;
  try {
    const [summary, result] = await Promise.all([
      api.overview(applied),
      api.table(dataset.value, applied, page.value),
    ]);
    if (v === sequence) {
      overview.value = summary;
      table.value = result;
    }
  } catch (e) {
    if (v === sequence) error.value = failureMessage(e);
  } finally {
    if (v === sequence) loading.value = false;
  }
}
function query() {
  if (range.value && range.value[0] > range.value[1]) {
    error.value = '开始日期不能晚于结束日期';
    return;
  }
  applied = { ...filters.value, from: range.value?.[0], to: range.value?.[1] };
  page.value = 1;
  void load();
}
function reset() {
  filters.value = {};
  range.value = null;
  query();
}
async function download() {
  exporting.value = true;
  try {
    const result = await api.export(dataset.value, applied);
    const url = URL.createObjectURL(
      new window.Blob([result.csv], { type: 'text/csv;charset=utf-8' }),
    );
    const a = window.document.createElement('a');
    a.href = url;
    a.download = result.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ElMessage.success(`已导出 ${result.rowCount} 行`);
  } catch (e) {
    ElMessage.error(failureMessage(e));
  } finally {
    exporting.value = false;
  }
}
watch(dataset, () => {
  page.value = 1;
  void load();
});
onMounted(() => {
  void options();
  query();
});
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">PURCHASE RECONCILIATION</span>
        <h1>数据统计 / 采购对账</h1>
        <p class="muted">采购发生额、入库成本、库存账面成本与退款分开核对。</p>
      </div>
      <el-button :disabled="!canExport || loading || !table" :loading="exporting" @click="download"
        >导出当前报表 CSV</el-button
      >
    </div>
    <el-alert v-if="optionsError" :title="optionsError" type="error" :closable="false"
      ><el-button @click="options">重新加载筛选项</el-button></el-alert
    >
    <div class="surface catalog-panel">
      <form class="report-filters" @submit.prevent="query">
        <el-select
          v-model="filters.purchaseAccountId"
          clearable
          filterable
          placeholder="全部采购账号"
          aria-label="采购账号"
          ><el-option label="未指定账号" value="UNASSIGNED" /><el-option
            v-for="a in accounts"
            :key="a.id"
            :value="a.id"
            :label="a.alias + (a.isActive ? '' : '（已停用）')"
        /></el-select>
        <el-select v-model="filters.platform" clearable placeholder="全部平台" aria-label="采购平台"
          ><el-option label="淘宝" value="TAOBAO" /><el-option label="京东" value="JD" /><el-option
            label="拼多多"
            value="PDD" /><el-option label="其他" value="OTHER"
        /></el-select>
        <el-date-picker
          v-model="range"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          aria-label="业务日期范围"
        />
        <el-select v-model="filters.warehouseId" clearable placeholder="全部仓库" aria-label="仓库"
          ><el-option v-for="w in warehouses" :key="w.id" :value="w.id" :label="w.name"
        /></el-select>
        <el-input
          v-model="filters.sku"
          placeholder="精确 SKU（原单/当前，见口径）"
          aria-label="SKU"
          maxlength="80"
          clearable
        />
        <el-input
          v-model="filters.articleNo"
          placeholder="精确商品货号"
          aria-label="商品货号"
          maxlength="80"
          clearable
        />
        <el-button type="primary" native-type="submit" :loading="loading">查询</el-button
        ><el-button @click="reset">清空（全部日期）</el-button>
      </form>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" class="form-alert"
      ><el-button @click="load">重试</el-button></el-alert
    >
    <div v-loading="loading" class="report-cards">
      <div v-for="card in cards" :key="card[0]!" class="surface report-card">
        <p class="muted">{{ card[0] }}</p>
        <strong>{{ card[1] ?? '缺少原始分摊' }}</strong>
        <p class="muted">{{ card[2] }}</p>
      </div>
    </div>
    <el-alert
      v-if="overview"
      :title="overview.scopeNote"
      type="info"
      :closable="false"
      class="form-alert"
    />
    <p v-if="overview" class="muted">
      采购 {{ overview.purchaseQuantity }} 件 · 待入库 {{ overview.pendingQuantity }} 件 /
      {{ overview.pendingPackageCount }} 个候选包裹 · 当前库存 {{ overview.inventoryQuantity }} 件 ·
      出库 {{ overview.outboundQuantity }} 件 · 退货 {{ overview.returnQuantity }} 件 · 缺失分摊明细
      {{ overview.missingAllocationCount }} 条
    </p>
    <div class="surface catalog-panel">
      <el-select v-model="dataset" aria-label="统计报表" class="report-dataset"
        ><el-option v-for="d in datasets" :key="d.value" :value="d.value" :label="d.label"
      /></el-select>
      <p v-if="pooled" class="muted">
        此表不按采购账号或平台归属{{ dataset === 'inventory' ? '，也不按日期回溯' : '' }}。
      </p>
      <p v-if="headerOnly" class="muted">
        此表按整单汇总，不按 SKU / 货号拆分；可切换“按商品”或“采购明细”核对商品金额。
      </p>
      <p v-if="table" class="muted">{{ table.scopeNote }}</p>
      <el-table v-loading="loading" :data="table?.rows ?? []" empty-text="当前筛选暂无数据" stripe>
        <el-table-column
          v-for="c in table?.columns ?? []"
          :key="c.key"
          :label="c.label"
          :min-width="c.kind === 'text' ? 155 : 135"
          ><template #default="{ row }">{{
            row[c.key] ?? '未记录 / 缺少原始分摊'
          }}</template></el-table-column
        >
        <el-table-column label="追溯" fixed="right" width="150"
          ><template #default="{ row }"
            ><el-button
              v-if="reportSource(row, dataset)"
              link
              type="primary"
              @click="router.push(reportSource(row, dataset)!)"
              >原始单据</el-button
            ><el-button link type="primary" @click="router.push('/inventory/movements')"
              >库存流水</el-button
            ></template
          ></el-table-column
        >
      </el-table>
      <el-pagination
        v-if="table"
        v-model:current-page="page"
        layout="total, prev, pager, next"
        :total="table.pagination.total"
        :page-size="20"
        @current-change="load"
      />
      <p v-if="table" class="muted">
        生成时间 {{ new Date(table.generatedAt).toLocaleString('zh-CN') }}；金额由后端计算。导出最多
        10000 行，覆盖已查询筛选，不只当前页。
      </p>
    </div>
  </section>
</template>
<style scoped>
.report-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.report-filters .el-select,
.report-filters .el-input {
  width: 210px;
}
.report-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin: 20px 0;
}
.report-card {
  padding: 20px;
}
.report-card strong {
  font-size: 26px;
  font-variant-numeric: tabular-nums;
  color: var(--el-color-primary);
}
.report-card p {
  font-size: 13px;
}
.report-dataset {
  width: 250px;
  margin-bottom: 12px;
}
.el-pagination {
  margin-top: 18px;
}
</style>
