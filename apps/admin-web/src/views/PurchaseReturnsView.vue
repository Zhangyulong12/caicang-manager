<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  PURCHASE_RETURN_STATUSES,
  type PurchaseReturnData,
  type PurchaseReturnStatus,
} from '@caicang/api-contract';
import { usePurchaseReturns } from '../composables/purchase-returns';
import { useTenantStore } from '../stores/tenant';
import { returnStatusNames } from '../api/return-form';
import { formatTime } from '../api/package-status';
import { rangeProblem, pageSummary } from '../api/inventory-format';
import { failureMessage } from '../utils/feedback';
const api = usePurchaseReturns(),
  tenants = useTenantStore(),
  router = useRouter(),
  route = useRoute();
const rows = ref<PurchaseReturnData[]>([]),
  search = ref(''),
  status = ref<PurchaseReturnStatus | ''>(''),
  range = ref<[string, string] | null>(null),
  loading = ref(false),
  error = ref(''),
  page = ref(1),
  size = ref(20),
  total = ref(0);
const purchaseOrderId = ref(
  typeof route.query.purchaseOrderId === 'string' ? route.query.purchaseOrderId : '',
);
const canWrite = computed(() => tenants.current?.permissions.includes('purchase:write'));
const rangeError = computed(() => rangeProblem(range.value?.[0] ?? '', range.value?.[1] ?? ''));
let sequence = 0,
  applied = '';
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
      status: status.value,
      from: range.value?.[0],
      to: range.value?.[1],
      purchaseOrderId: purchaseOrderId.value,
    });
    if (version === sequence) {
      rows.value = result.data;
      total.value = result.pagination.total;
    }
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
function clear() {
  search.value = '';
  status.value = '';
  range.value = null;
  purchaseOrderId.value = '';
  query();
}
onMounted(load);
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">SUPPLIER RETURNS</span>
        <h1>采购退货</h1>
        <p class="muted">退给供应商的已入库商品，数量、退款与库存去向清楚可查。</p>
      </div>
      <el-button type="primary" :disabled="!canWrite" @click="router.push('/purchase-returns/new')"
        >新建采购退货</el-button
      >
    </div>
    <el-alert
      v-if="!canWrite"
      title="当前角色可查看；新建、取消与确认按商家角色分别授权"
      type="info"
      :closable="false"
      class="form-alert"
    />
    <div class="surface catalog-panel">
      <form class="catalog-toolbar inventory-toolbar" @submit.prevent="query">
        <el-input
          v-model="search"
          aria-label="退货搜索"
          placeholder="退货单号 / 原采购单号 / SKU"
          maxlength="100"
          clearable
        />
        <el-select v-model="status" aria-label="退货状态" placeholder="全部状态" @change="query"
          ><el-option label="全部状态" value="" /><el-option
            v-for="s in PURCHASE_RETURN_STATUSES"
            :key="s"
            :value="s"
            :label="returnStatusNames[s]"
        /></el-select>
        <el-date-picker
          v-model="range"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="退货开始日期"
          end-placeholder="结束日期"
          @change="query"
        />
        <el-button type="primary" native-type="submit" :loading="loading">查询</el-button
        ><el-button :disabled="loading" @click="load">刷新</el-button
        ><el-button link @click="clear">清除筛选</el-button>
        <p v-if="rangeError" class="inventory-toolbar-hint">{{ rangeError }}</p>
      </form>
      <div v-if="error" class="catalog-error">
        <el-alert :title="error" type="error" :closable="false" /><el-button @click="load"
          >重试加载</el-button
        >
      </div>
      <el-skeleton v-else-if="loading" :rows="6" animated />
      <template v-else>
        <el-table :data="rows" row-key="id" stripe empty-text="暂无采购退货记录">
          <el-table-column label="退货单 / 原采购单" min-width="260"
            ><template #default="{ row }"
              ><router-link :to="'/purchase-returns/' + row.id">{{ row.returnNo }}</router-link
              ><small class="catalog-item-sub">{{ row.purchaseOrderNo }}</small></template
            ></el-table-column
          >
          <el-table-column label="商品 / 仓库" min-width="210"
            ><template #default="{ row }"
              >{{
                row.items
                  .map((i: PurchaseReturnData['items'][number]) => i.sku + ' × ' + i.quantity)
                  .join('，')
              }}<small class="catalog-item-sub">{{ row.warehouseName }}</small></template
            ></el-table-column
          >
          <el-table-column label="状态" width="130"
            ><template #default="{ row }">{{
              returnStatusNames[row.status as PurchaseReturnStatus]
            }}</template></el-table-column
          >
          <el-table-column prop="returnDate" label="退货日期" width="115" />
          <el-table-column label="预计退款（元）" width="145" align="right"
            ><template #default="{ row }">{{
              row.estimatedRefundAmount
            }}</template></el-table-column
          >
          <el-table-column label="实际退款登记（元）" width="170" align="right"
            ><template #default="{ row }"
              >{{ row.refundAmount
              }}<small v-if="row.status !== 'CONFIRMED'" class="catalog-item-sub">{{
                row.status === 'DRAFT' ? '草稿登记，尚未确认' : '已取消，不计生效退款'
              }}</small></template
            ></el-table-column
          >
          <el-table-column prop="createdByName" label="创建人" width="110" /><el-table-column
            label="创建时间"
            width="175"
            ><template #default="{ row }">{{
              formatTime(row.createdAt)
            }}</template></el-table-column
          >
          <el-table-column label="操作" width="80" fixed="right"
            ><template #default="{ row }"
              ><el-button link type="primary" @click="router.push('/purchase-returns/' + row.id)"
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
