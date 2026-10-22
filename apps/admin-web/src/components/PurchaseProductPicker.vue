<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import type { ProductData } from '@caicang/api-contract';
import { useCatalog } from '../composables/catalog';
import { failureMessage } from '../utils/feedback';
const props = defineProps<{ visible: boolean; selected: string[] }>();
const emit = defineEmits<{ 'update:visible': [value: boolean]; select: [value: ProductData] }>();
const api = useCatalog(),
  rows = ref<ProductData[]>([]),
  search = ref(''),
  page = ref(1),
  total = ref(0),
  loading = ref(false),
  error = ref('');
let sequence = 0;
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    const result = await api.products({
      page: page.value,
      pageSize: 10,
      search: search.value,
      isActive: true,
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
watch(
  () => props.visible,
  (open) => {
    sequence++;
    if (open) {
      search.value = '';
      page.value = 1;
      void load();
    }
  },
);
function choose(row: ProductData) {
  if (props.selected.includes(row.id)) return;
  emit('select', row);
  emit('update:visible', false);
}
onBeforeUnmount(() => sequence++);
</script>
<template>
  <el-dialog
    :model-value="visible"
    title="选择采购商品"
    width="min(760px, 95vw)"
    @update:model-value="emit('update:visible', $event)"
  >
    <form
      class="picker-search"
      @submit.prevent="
        page = 1;
        load();
      "
    >
      <el-input
        v-model="search"
        aria-label="搜索可采购商品"
        placeholder="搜索 SKU、商品名称、条码或规格"
        :maxlength="200"
        clearable
      /><el-button native-type="submit" type="primary" :loading="loading">查询商品</el-button>
    </form>
    <div v-if="error" class="catalog-error">
      <el-alert :title="error" type="error" :closable="false" /><el-button @click="load"
        >重试查询</el-button
      >
    </div>
    <el-skeleton v-else-if="loading" :rows="4" animated />
    <template v-else
      ><el-table :data="rows" row-key="id" empty-text="没有匹配的启用商品，请先到商品管理建立档案"
        ><el-table-column prop="sku" label="SKU 编码" min-width="150" /><el-table-column
          prop="name"
          label="商品名称"
          min-width="160"
        /><el-table-column label="参考价" width="100"
          ><template #default="{ row }">{{
            row.referencePurchasePrice ?? '未设置'
          }}</template></el-table-column
        ><el-table-column label="选择" width="100"
          ><template #default="{ row }"
            ><el-button
              type="primary"
              link
              :disabled="selected.includes(row.id)"
              @click="choose(row)"
              >{{ selected.includes(row.id) ? '已添加' : '添加此 SKU' }}</el-button
            ></template
          ></el-table-column
        ></el-table
      >
      <el-pagination
        v-model:current-page="page"
        :page-size="10"
        :total="total"
        layout="total, prev, pager, next"
        class="picker-pages"
        @current-change="load"
    /></template>
    <p class="muted catalog-form-note">
      参考价仅作为新行输入建议；实际采购单价可修改。每个 SKU 只可添加一次。
    </p>
  </el-dialog>
</template>
