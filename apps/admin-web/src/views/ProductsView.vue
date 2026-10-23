<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Search, Refresh } from '@element-plus/icons-vue';
import type { ProductData } from '@caicang/api-contract';
import { useTenantStore } from '../stores/tenant';
import { useCatalog } from '../composables/catalog';
import { previewProductName } from '../api/catalog-form';
import { failureMessage } from '../utils/feedback';
import ProductEditor from '../components/ProductEditor.vue';
const router = useRouter();
const tenants = useTenantStore();
const catalog = useCatalog();
const rows = ref<ProductData[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const search = ref('');
const appliedSearch = ref('');
const status = ref('all');
const loading = ref(false);
const error = ref('');
const editor = ref(false);
const selected = ref<ProductData | null>(null);
const acting = ref('');
let sequence = 0;
let alive = true;
const canWrite = computed(() => tenants.current?.permissions.includes('products:write') === true);
// 列表按 货号+颜色+尺码 认识商品，货号为空时退回名称。
const label = (row: ProductData) => row.articleNo || row.name;
const generatedName = (row: ProductData) =>
  previewProductName({
    articleNo: row.articleNo ?? '',
    color: row.color ?? '',
    size: row.size ?? '',
    sku: row.sku,
  });
// 自动生成的名称已经等于货号+颜色+尺码，重复显示没有意义。
// 没有货号时首列直接显示名称，所以只有"有货号 + 自定义名称"才在下面补一行名字。
const subline = (row: ProductData) =>
  row.articleNo && row.name !== generatedName(row) ? row.name : (row.specification ?? '');
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    const result = await catalog.products({
      page: page.value,
      pageSize: pageSize.value,
      search: appliedSearch.value,
      ...(status.value === 'all' ? {} : { isActive: status.value === 'active' }),
    });
    if (version !== sequence) return;
    total.value = result.pagination.total;
    if (page.value > 1 && !result.data.length && total.value > 0) {
      page.value = Math.max(1, Math.ceil(total.value / pageSize.value));
      await load();
      return;
    }
    rows.value = result.data;
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
  appliedSearch.value = search.value.trim();
  page.value = 1;
  void load();
}
function create() {
  if (!canWrite.value || acting.value) return;
  selected.value = null;
  editor.value = true;
}
async function edit(row: ProductData) {
  if (!canWrite.value || acting.value) return;
  acting.value = row.id;
  try {
    const result = await catalog.product(row.id);
    if (!alive) return;
    selected.value = result;
    editor.value = true;
  } catch (e) {
    if (alive) ElMessage.error(failureMessage(e));
  } finally {
    acting.value = '';
  }
}
async function toggle(row: ProductData) {
  if (!canWrite.value || acting.value) return;
  try {
    await ElMessageBox.confirm(
      row.isActive ? '停用后扫码查询不再匹配此商品，历史单据仍会保留。' : '确认重新启用此商品？',
      row.isActive ? '停用商品' : '启用商品',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  if (!alive) return;
  acting.value = row.id;
  try {
    await catalog.setActive(row.id, !row.isActive);
    if (!alive) return;
    ElMessage.success(row.isActive ? '商品已停用' : '商品已启用');
    await load();
  } catch (e) {
    if (alive) ElMessage.error(failureMessage(e));
  } finally {
    acting.value = '';
  }
}
onMounted(load);
onBeforeUnmount(() => {
  sequence++;
  alive = false;
});
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">PRODUCT CATALOG</span>
        <h1>商品管理</h1>
        <p class="muted">按货号、颜色、尺码维护每个 SKU，参考进货价只作建档参考。</p>
      </div>
      <el-button type="primary" :icon="Plus" :disabled="!canWrite || !!acting" @click="create"
        >添加商品</el-button
      >
    </div>
    <el-alert
      v-if="!canWrite"
      title="当前角色为只读，可查看商品资料，不能添加、编辑或停用"
      type="info"
      :closable="false"
      class="form-alert"
    />
    <div class="surface catalog-panel">
      <form class="catalog-toolbar" @submit.prevent="searchNow">
        <el-input
          v-model="search"
          aria-label="搜索商品"
          placeholder="搜索货号、颜色、尺码、SKU、名称或条码"
          clearable
          :maxlength="200"
          :prefix-icon="Search"
        /><el-select v-model="status" aria-label="商品状态" @change="searchNow"
          ><el-option label="全部状态" value="all" /><el-option
            label="仅启用"
            value="active" /><el-option label="仅停用" value="inactive" /></el-select
        ><el-button native-type="submit" type="primary" :loading="loading">搜索</el-button
        ><el-button :icon="Refresh" :disabled="loading" @click="load">刷新</el-button>
      </form>
      <div v-if="error" class="catalog-error">
        <el-alert :title="error" type="error" :closable="false" show-icon /><el-button @click="load"
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
            appliedSearch || status !== 'all'
              ? '未找到符合条件的商品，请调整搜索或筛选'
              : '暂无商品，点击“添加商品”建立第一份档案'
          "
        >
          <el-table-column label="商品货号" min-width="170">
            <template #default="{ row }">
              <router-link :to="'/products/' + row.id" class="catalog-item-link">{{
                label(row)
              }}</router-link>
              <small v-if="subline(row)" class="catalog-item-sub">{{ subline(row) }}</small>
            </template>
          </el-table-column>
          <el-table-column label="颜色" width="90">
            <template #default="{ row }">{{ row.color || '—' }}</template>
          </el-table-column>
          <el-table-column label="尺码" width="90">
            <template #default="{ row }">{{ row.size || '—' }}</template>
          </el-table-column>
          <el-table-column prop="sku" label="SKU 编码" min-width="150" show-overflow-tooltip />
          <el-table-column prop="unit" label="单位" width="70" />
          <el-table-column label="参考进货价（元）" width="150">
            <template #default="{ row }">{{ row.referencePurchasePrice ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="85">
            <template #default="{ row }">
              <el-tag :type="row.isActive ? 'success' : 'info'">{{
                row.isActive ? '启用' : '停用'
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="190" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="router.push('/products/' + row.id)"
                >详情</el-button
              >
              <el-button link type="primary" :disabled="!canWrite || !!acting" @click="edit(row)"
                >编辑</el-button
              >
              <el-button
                link
                :type="row.isActive ? 'danger' : 'primary'"
                :disabled="!canWrite || !!acting"
                @click="toggle(row)"
                >{{ row.isActive ? '停用' : '启用' }}</el-button
              >
            </template>
          </el-table-column>
        </el-table>
        <div class="catalog-pagination">
          <span class="muted">共 {{ total }} 个商品</span
          ><el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
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
    <ProductEditor v-model:visible="editor" :product="selected" @saved="load" />
  </section>
</template>
