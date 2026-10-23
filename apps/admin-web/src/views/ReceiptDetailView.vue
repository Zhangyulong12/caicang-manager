<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, Refresh } from '@element-plus/icons-vue';
import type { ReceiptData } from '@caicang/api-contract';
import { useReceipts } from '../composables/inventory';
import { formatMoney, formatQuantity, formatUnitCost } from '../api/inventory-format';
import { formatTime } from '../api/package-status';
import { failureMessage } from '../utils/feedback';
const route = useRoute(),
  router = useRouter(),
  api = useReceipts();
const receipt = ref<ReceiptData | null>(null),
  loading = ref(false),
  error = ref('');
let sequence = 0;
const receiptId = computed(() => String(route.params.id));
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  try {
    const result = await api.detail(receiptId.value);
    if (version === sequence) receipt.value = result;
  } catch (e) {
    if (version === sequence) {
      error.value = failureMessage(e);
      receipt.value = null;
    }
  } finally {
    if (version === sequence) loading.value = false;
  }
}
watch(receiptId, load);
onBeforeUnmount(() => sequence++);
void load();
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">RECEIPT DETAILS</span>
        <h1>入库记录详情</h1>
        <p class="muted">这张入库单的全部明细；数量与成本是服务端确认时的快照，不可修改。</p>
      </div>
      <el-button :icon="ArrowLeft" @click="router.push('/receipts')">返回入库记录</el-button>
    </div>
    <el-skeleton v-if="loading && !receipt" :rows="8" animated class="surface loading-surface" />
    <div v-else-if="error" class="surface catalog-error">
      <el-alert :title="error" type="error" :closable="false" /><el-button @click="load"
        >重试加载</el-button
      >
    </div>
    <template v-else-if="receipt">
      <div class="surface inventory-detail-head" style="margin-top: 20px">
        <div>
          <small class="muted">入库单号</small>
          <h2>{{ receipt.receiptNo }}</h2>
          <p class="inventory-meta">
            {{ formatTime(receipt.receivedAt) }} · {{ receipt.warehouseName }} ·
            {{ receipt.receivedByName }}
          </p>
        </div>
        <div>
          <el-button :icon="Refresh" :disabled="loading" @click="load">刷新</el-button>
          <el-button
            type="primary"
            plain
            @click="router.push('/purchases/' + receipt.purchaseOrderId)"
            >查看采购单</el-button
          >
        </div>
      </div>
      <div class="inventory-metrics">
        <div class="surface inventory-metric">
          <p>本次入库件数</p>
          <strong>{{ formatQuantity(receipt.totalQuantity) }}</strong>
          <small>{{ receipt.items.length }} 个 SKU</small>
        </div>
        <div class="surface inventory-metric">
          <p>入库金额</p>
          <strong>{{ formatMoney(receipt.totalCost) }}</strong>
          <small>按到岸成本快照合计</small>
        </div>
        <div class="surface inventory-metric">
          <p>采购单</p>
          <strong style="font-size: 19px">{{ receipt.purchaseOrderNo }}</strong>
          <small>{{ receipt.trackingNo || '未登记运单' }}</small>
        </div>
        <div class="surface inventory-metric">
          <p>承运商</p>
          <strong style="font-size: 19px">{{ receipt.carrierCode || '未登记' }}</strong>
          <small>入库时间 {{ formatTime(receipt.receivedAt) }}</small>
        </div>
      </div>
      <div class="surface catalog-panel">
        <div class="inventory-panel-head">
          <div>
            <h3>入库明细</h3>
            <p>逐 SKU 的数量与到岸单价，乘以数量就是行金额</p>
          </div>
        </div>
        <el-table :data="receipt.items" row-key="id" stripe>
          <el-table-column label="SKU" width="150" prop="sku" />
          <el-table-column label="商品名称" min-width="200" prop="name" />
          <el-table-column label="数量" width="100" align="right">
            <template #default="{ row }">{{ formatQuantity(row.quantity) }}</template>
          </el-table-column>
          <el-table-column label="单位" width="80" prop="unit" />
          <el-table-column label="到岸单价" width="130" align="right">
            <template #default="{ row }">{{ formatUnitCost(row.landedUnitCost) }}</template>
          </el-table-column>
          <el-table-column label="行金额" width="140" align="right">
            <template #default="{ row }">{{ formatMoney(row.lineCost) }}</template>
          </el-table-column>
          <el-table-column label="库存详情" width="110">
            <template #default="{ row }">
              <router-link :to="'/inventory/sku/' + row.productId" class="catalog-item-link"
                >查看库存</router-link
              >
            </template>
          </el-table-column>
        </el-table>
        <div class="receipt-items-total">
          <span
            >合计数量 <strong>{{ formatQuantity(receipt.totalQuantity) }}</strong></span
          >
          <span
            >合计金额 <strong>{{ formatMoney(receipt.totalCost) }}</strong></span
          >
        </div>
        <div class="inventory-empty-note">备注：{{ receipt.remark || '未填写' }}</div>
      </div>
    </template>
  </section>
</template>
