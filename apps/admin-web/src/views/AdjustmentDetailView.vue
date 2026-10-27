<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { StockAdjustmentData } from '@caicang/api-contract';
import InventoryTabs from '../components/InventoryTabs.vue';
import { useAdjustments } from '../composables/adjustments';
import { formatQuantity } from '../api/inventory-format';
import { formatTime } from '../api/package-status';
import { adjustmentCostLabels } from '../api/adjustment-form';
import { failureMessage } from '../utils/feedback';
const route = useRoute(),
  router = useRouter(),
  api = useAdjustments();
const record = ref<StockAdjustmentData | null>(null),
  loading = ref(false),
  error = ref('');
const id = computed(() => String(route.params.id));
let sequence = 0;
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  record.value = null;
  try {
    const result = await api.detail(id.value);
    if (version === sequence) record.value = result;
  } catch (e) {
    if (version === sequence) error.value = failureMessage(e);
  } finally {
    if (version === sequence) loading.value = false;
  }
}
watch(id, load, { immediate: true });
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">ADJUSTMENT DETAILS</span>
        <h1>库存调整详情</h1>
        <p class="muted">已生效的调整保留原始记录，前后数量及成本均来自服务器。</p>
      </div>
      <el-button @click="router.push('/inventory/adjustments')">返回调整列表</el-button>
    </div>
    <InventoryTabs />
    <el-skeleton v-if="loading" :rows="10" animated class="surface loading-surface" />
    <div v-else-if="error" class="surface catalog-error">
      <el-alert :title="error" type="error" :closable="false" /><el-button @click="load"
        >重试加载</el-button
      >
    </div>
    <template v-else-if="record">
      <div class="surface purchase-card" style="margin-top: 20px">
        <div class="purchase-section-heading">
          <div>
            <small class="muted">调整单号</small>
            <h2>{{ record.adjustmentNo }}</h2>
          </div>
          <el-button @click="load">刷新详情</el-button>
        </div>
        <div class="inventory-metrics">
          <div class="inventory-metric">
            <p>调整前数量</p>
            <strong>{{ formatQuantity(record.quantityBefore) }}</strong>
          </div>
          <div class="inventory-metric">
            <p>调整数量</p>
            <strong class="movement-delta" :class="record.quantityDelta > 0 ? 'in' : 'out'"
              >{{ record.quantityDelta > 0 ? '+' : ''
              }}{{ formatQuantity(record.quantityDelta) }}</strong
            >
          </div>
          <div class="inventory-metric">
            <p>调整后数量</p>
            <strong>{{ formatQuantity(record.quantityAfter) }}</strong>
          </div>
        </div>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="仓库">{{ record.warehouseName }}</el-descriptions-item>
          <el-descriptions-item label="商品"
            ><router-link :to="'/inventory/sku/' + record.productId"
              >{{ record.productName }} · {{ record.sku }}</router-link
            >
            · {{ record.unit }}</el-descriptions-item
          >
          <el-descriptions-item label="调整原因">{{ record.reasonLabel }}</el-descriptions-item>
          <el-descriptions-item label="备注"
            ><span class="preserve-lines">{{
              record.remark || '未填写'
            }}</span></el-descriptions-item
          >
          <el-descriptions-item label="操作人">{{ record.createdByName }}</el-descriptions-item
          ><el-descriptions-item label="时间">{{
            formatTime(record.createdAt)
          }}</el-descriptions-item>
          <el-descriptions-item label="单位成本（元）">{{ record.unitCost }}</el-descriptions-item
          ><el-descriptions-item label="成本来源">{{
            adjustmentCostLabels[record.costSource]
          }}</el-descriptions-item>
          <el-descriptions-item label="成本变化（元）"
            >{{ record.totalCostBefore }} → {{ record.totalCostAfter }}（本次
            {{ record.costDelta }}）</el-descriptions-item
          >
        </el-descriptions>
        <div class="dialog-actions" style="margin-top: 20px">
          <el-button @click="router.push('/inventory/balances')">查看库存余额</el-button
          ><el-button
            type="primary"
            @click="
              router.push({
                path: '/inventory/movements',
                query: {
                  type: 'ADJUSTMENT',
                  productId: record.productId,
                  warehouseId: record.warehouseId,
                },
              })
            "
            >查看该商品调整流水</el-button
          >
        </div>
      </div>
    </template>
  </section>
</template>
