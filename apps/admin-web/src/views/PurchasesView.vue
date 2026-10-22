<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Plus, Search, Refresh } from '@element-plus/icons-vue';
import type { PurchaseOrderData, PurchaseStatus, PurchasePlatform } from '@caicang/api-contract';
import { usePurchases } from '../composables/purchases';
import { useTenantStore } from '../stores/tenant';
import { failureMessage } from '../utils/feedback';
import { platformNames, statusNames } from '../api/purchase-form';
const route = useRoute(),
  router = useRouter(),
  api = usePurchases(),
  tenants = useTenantStore();
const rows = ref<PurchaseOrderData[]>([]),
  loading = ref(false),
  error = ref(''),
  page = ref(1),
  size = ref(20),
  total = ref(0);
const search = ref(typeof route.query.search === 'string' ? route.query.search.slice(0, 200) : ''),
  status = ref<PurchaseStatus | ''>(''),
  platform = ref<PurchasePlatform | ''>('');
let applied = search.value,
  sequence = 0;
const canWrite = computed(() => tenants.current?.permissions.includes('purchase:write') === true);
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
      ...(platform.value ? { platform: platform.value } : {}),
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
onMounted(load);
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">PURCHASE ORDERS</span>
        <h1>采购管理</h1>
        <p class="muted">把平台采购记录整理成清晰、可追溯的电子账单。</p>
      </div>
      <el-button
        type="primary"
        :icon="Plus"
        :disabled="!canWrite"
        @click="router.push('/purchases/new')"
        >新建采购单</el-button
      >
    </div>
    <el-alert
      v-if="!canWrite"
      title="当前角色可查看采购，不能新建、编辑、确认或取消"
      type="info"
      :closable="false"
      class="form-alert"
    />
    <div class="surface catalog-panel">
      <form class="catalog-toolbar purchase-filters" @submit.prevent="searchNow">
        <el-input
          v-model="search"
          aria-label="采购单搜索"
          placeholder="搜索采购单号或平台订单号"
          :maxlength="200"
          :prefix-icon="Search"
          clearable
        /><el-select
          v-model="status"
          aria-label="采购状态"
          placeholder="全部状态"
          @change="searchNow"
          ><el-option label="全部状态" value="" /><el-option
            v-for="(label, value) in statusNames"
            :key="value"
            :label="label"
            :value="value" /></el-select
        ><el-select
          v-model="platform"
          aria-label="采购平台筛选"
          placeholder="全部平台"
          @change="searchNow"
          ><el-option label="全部平台" value="" /><el-option
            v-for="(label, value) in platformNames"
            :key="value"
            :label="label"
            :value="value" /></el-select
        ><el-button native-type="submit" type="primary" :loading="loading">搜索</el-button
        ><el-button :icon="Refresh" :disabled="loading" @click="load">刷新</el-button>
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
            applied || status || platform
              ? '没有符合条件的采购单，请调整筛选'
              : '暂无采购单，点击新建开始记录'
          "
          ><el-table-column label="采购单 / 店铺" min-width="245"
            ><template #default="{ row }"
              ><router-link :to="'/purchases/' + row.id" class="catalog-item-link">{{
                row.orderNo
              }}</router-link
              ><small class="catalog-item-sub">{{
                row.supplierName || '未填写店铺'
              }}</small></template
            ></el-table-column
          ><el-table-column label="平台 / 平台订单号" min-width="175"
            ><template #default="{ row }"
              >{{ platformNames[row.platform as PurchasePlatform]
              }}<small class="catalog-item-sub">{{ row.platformOrderNo || '—' }}</small></template
            ></el-table-column
          ><el-table-column prop="purchaseDate" label="采购日期" width="115" /><el-table-column
            label="SKU"
            width="65"
            ><template #default="{ row }">{{ row.items.length }}</template></el-table-column
          ><el-table-column label="总成本（元）" width="130"
            ><template #default="{ row }"
              ><strong>{{ row.totalCost }}</strong></template
            ></el-table-column
          ><el-table-column label="状态" width="110"
            ><template #default="{ row }"
              ><el-tag
                :type="
                  row.status === 'CANCELLED'
                    ? 'info'
                    : row.status === 'DRAFT'
                      ? 'warning'
                      : 'success'
                "
                >{{ statusNames[row.status as PurchaseStatus] }}</el-tag
              ></template
            ></el-table-column
          ><el-table-column label="操作" width="135" fixed="right"
            ><template #default="{ row }"
              ><el-button link type="primary" @click="router.push('/purchases/' + row.id)"
                >详情</el-button
              ><el-button
                link
                type="primary"
                :disabled="!canWrite || row.status !== 'DRAFT'"
                @click="router.push('/purchases/' + row.id + '/edit')"
                >编辑</el-button
              ></template
            ></el-table-column
          ></el-table
        >
        <div class="catalog-pagination">
          <span class="muted">共 {{ total }} 张采购单 · 金额来自服务器</span
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
  </section>
</template>
