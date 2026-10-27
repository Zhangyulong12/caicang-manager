<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { ProductData } from '@caicang/api-contract';
import { useCatalog } from '../composables/catalog';
import { failureMessage } from '../utils/feedback';
const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean]; select: [value: ProductData] }>();
const catalog = useCatalog(),
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
    const result = await catalog.products({
      page: page.value,
      pageSize: 10,
      search: search.value.trim(),
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
function select(row: ProductData) {
  emit('select', row);
  emit('update:visible', false);
}
onBeforeUnmount(() => sequence++);
</script>
<template>
  <el-dialog
    :model-value="visible"
    title="选择调整商品"
    width="min(860px, 95vw)"
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
        aria-label="搜索调整商品"
        placeholder="搜索 SKU、货号、颜色或尺码"
        maxlength="200"
        clearable
      /><el-button native-type="submit" type="primary" :loading="loading">查询商品</el-button>
    </form>
    <div v-if="error" class="catalog-error">
      <el-alert :title="error" type="error" :closable="false" /><el-button @click="load"
        >重试查询</el-button
      >
    </div>
    <el-skeleton v-else-if="loading" :rows="4" animated />
    <template v-else>
      <el-table :data="rows" row-key="id" empty-text="没有匹配的商品">
        <el-table-column prop="sku" label="SKU" min-width="140" /><el-table-column
          prop="name"
          label="商品名称"
          min-width="140"
        />
        <el-table-column prop="articleNo" label="货号" min-width="100" /><el-table-column
          prop="color"
          label="颜色"
          width="80"
        /><el-table-column prop="size" label="尺码" width="80" />
        <el-table-column label="状态" width="85"
          ><template #default="{ row }">{{
            row.isActive ? '启用' : '停用'
          }}</template></el-table-column
        >
        <el-table-column label="选择" width="90"
          ><template #default="{ row }"
            ><el-button link type="primary" @click="select(row)">选择商品</el-button></template
          ></el-table-column
        >
      </el-table>
      <el-pagination
        v-model:current-page="page"
        :total="total"
        :page-size="10"
        layout="total, prev, pager, next"
        class="picker-pages"
        @current-change="load"
      />
    </template>
    <p class="muted">停用商品也可盘点调整；商品状态与实际库存分别记录。</p>
  </el-dialog>
</template>
