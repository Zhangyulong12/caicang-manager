<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import type { InventoryBalanceData } from '@caicang/api-contract';
import { useInventory } from '../composables/inventory';
import { formatQuantity } from '../api/inventory-format';
import { failureMessage } from '../utils/feedback';
const props = defineProps<{ visible: boolean; warehouseId: string; selected: string[] }>();
const emit = defineEmits<{
  'update:visible': [value: boolean];
  select: [value: InventoryBalanceData];
}>();
const api = useInventory(),
  rows = ref<InventoryBalanceData[]>([]),
  search = ref(''),
  page = ref(1),
  total = ref(0),
  loading = ref(false),
  error = ref('');
let sequence = 0;
async function load() {
  if (!props.warehouseId) {
    rows.value = [];
    total.value = 0;
    return;
  }
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    // 直接查库存余额：选到的每一行都带着服务端算好的可用数量。
    const result = await api.balances({
      page: page.value,
      pageSize: 10,
      warehouseId: props.warehouseId,
      search: search.value,
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
watch(
  () => props.warehouseId,
  () => {
    if (props.visible) {
      page.value = 1;
      void load();
    }
  },
);
function choose(row: InventoryBalanceData) {
  if (props.selected.some((id) => id.toLowerCase() === row.productId.toLowerCase())) return;
  emit('select', row);
  emit('update:visible', false);
}
function turn(next: number) {
  page.value = next;
  void load();
}
onBeforeUnmount(() => sequence++);
</script>
<template>
  <el-dialog
    :model-value="visible"
    title="选择出库商品"
    width="min(820px, 96vw)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div v-if="!warehouseId" class="catalog-error">
      <el-alert title="请先选择发货仓库，可用库存按仓库统计" type="warning" :closable="false" />
    </div>
    <template v-else>
      <form
        class="picker-search"
        @submit.prevent="
          page = 1;
          load();
        "
      >
        <el-input
          v-model="search"
          aria-label="搜索可出库商品"
          placeholder="搜索 SKU、商品名称或条码"
          :maxlength="200"
          clearable
        /><el-button native-type="submit" type="primary" :loading="loading">查询库存</el-button>
      </form>
      <div v-if="error" class="catalog-error">
        <el-alert :title="error" type="error" :closable="false" /><el-button @click="load"
          >重试加载</el-button
        >
      </div>
      <el-skeleton v-else-if="loading" :rows="5" animated class="loading-surface" />
      <template v-else>
        <el-table
          :data="rows"
          :row-key="(row: InventoryBalanceData) => row.productId"
          stripe
          empty-text="这个仓库还没有库存，先去收货再来发货"
          @row-click="choose"
        >
          <el-table-column label="商品 / SKU" min-width="220">
            <template #default="{ row }">
              <span class="catalog-item-link">{{ row.name }}</span>
              <small class="catalog-item-sub">{{ row.sku }} · {{ row.unit }}</small>
            </template>
          </el-table-column>
          <el-table-column label="可用库存" width="120" align="right">
            <template #default="{ row }">
              <span class="stock-number" :class="{ zero: row.quantityOnHand === 0 }">{{
                formatQuantity(row.quantityOnHand)
              }}</span>
            </template>
          </el-table-column>
          <el-table-column label="平均成本" width="120" align="right">
            <template #default="{ row }">{{ row.averageCost }}</template>
          </el-table-column>
          <el-table-column label="操作" width="110" align="right">
            <template #default="{ row }">
              <span v-if="selected.includes(row.productId)" class="muted">已添加</span>
              <el-button v-else link type="primary">加入出库单</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="catalog-pagination">
          <span class="muted">共 {{ total }} 条</span>
          <el-pagination
            :current-page="page"
            :page-size="10"
            :total="total"
            layout="prev, pager, next"
            background
            @current-change="turn"
          />
        </div>
      </template>
    </template>
  </el-dialog>
</template>
