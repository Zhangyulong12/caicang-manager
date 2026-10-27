<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { PurchaseOrderData } from '@caicang/api-contract';
import { ArrowLeft, Edit, Refresh } from '@element-plus/icons-vue';
import { usePurchases } from '../composables/purchases';
import { useTenantStore } from '../stores/tenant';
import { failureMessage } from '../utils/feedback';
import { statusNames, platformNames, mayCancel } from '../api/purchase-form';
const route = useRoute(),
  router = useRouter(),
  api = usePurchases(),
  tenants = useTenantStore();
const order = ref<PurchaseOrderData | null>(null),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  actionError = ref('');
let sequence = 0,
  alive = true;
const warehouseLabel = ref('');
const canWrite = computed(() => tenants.current?.permissions.includes('purchase:write') === true);
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  order.value = null;
  warehouseLabel.value = '';
  try {
    const [result, warehouses] = await Promise.all([
      api.detail(String(route.params.id)),
      api.warehouses().catch(() => []),
    ]);
    if (version === sequence) {
      order.value = result;
      const warehouse = warehouses.find((row) => row.id === result.warehouseId);
      warehouseLabel.value = warehouse
        ? warehouse.name + ' · ' + warehouse.code
        : result.warehouseId;
    }
  } catch (e) {
    if (version === sequence) error.value = failureMessage(e);
  } finally {
    if (version === sequence) loading.value = false;
  }
}
async function act(action: 'place' | 'cancel') {
  if (!order.value || busy.value || !canWrite.value) return;
  const current = order.value;
  try {
    await ElMessageBox.confirm(
      action === 'place'
        ? '确认后商品数量、原始价格与费用将冻结，不能继续编辑。'
        : '只有没有任何收货记录的订单才可取消，服务器会再次检查。取消保留历史记录。',
      action === 'place' ? '确认下单' : '取消采购单',
      {
        confirmButtonText: action === 'place' ? '确认下单' : '确认取消',
        cancelButtonText: '返回',
        type: 'warning',
      },
    );
  } catch {
    return;
  }
  if (!alive || order.value?.id !== current.id) return;
  busy.value = true;
  actionError.value = '';
  try {
    const result = await api.action(current.id, action);
    if (!alive || order.value?.id !== current.id) return;
    order.value = result;
    ElMessage.success(action === 'place' ? '采购单已确认，成本已冻结' : '采购单已取消');
  } catch (e) {
    if (alive && order.value?.id === current.id)
      actionError.value = failureMessage(e) + '；请刷新查看最新状态后再操作。';
  } finally {
    busy.value = false;
  }
}
watch(
  () => route.params.id,
  () => {
    actionError.value = '';
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  alive = false;
  sequence++;
});
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">PURCHASE DETAILS</span>
        <h1>采购单详情</h1>
        <p class="muted">查看原始采购、明细与服务器核算结果。</p>
      </div>
      <el-button :icon="ArrowLeft" @click="router.push('/purchases')">返回列表</el-button>
    </div>
    <el-skeleton v-if="loading" :rows="9" animated class="surface loading-surface" />
    <div v-else-if="error" class="surface catalog-error">
      <el-alert :title="error" type="error" :closable="false" /><el-button @click="load"
        >重试加载</el-button
      >
    </div>
    <template v-else-if="order"
      ><div class="surface purchase-detail-header">
        <div>
          <small class="muted">采购单号</small>
          <h2>{{ order.orderNo }}</h2>
          <el-tag
            :type="
              order.status === 'CANCELLED'
                ? 'info'
                : order.status === 'DRAFT'
                  ? 'warning'
                  : 'success'
            "
            >{{ statusNames[order.status] }}</el-tag
          >
        </div>
        <div class="purchase-actions">
          <el-button
            :disabled="!canWrite || !order.items.some((i) => i.receivedQuantity > 0) || busy"
            @click="
              router.push({ path: '/purchase-returns/new', query: { purchaseOrderId: order.id } })
            "
            >创建采购退货</el-button
          >
          <el-button
            @click="
              router.push({ path: '/purchase-returns', query: { purchaseOrderId: order.id } })
            "
            >关联退货记录</el-button
          >
          <el-button :icon="Refresh" :disabled="busy" @click="load">刷新</el-button
          ><el-button
            :icon="Edit"
            :disabled="!canWrite || order.status !== 'DRAFT' || busy"
            @click="router.push('/purchases/' + order.id + '/edit')"
            >修改草稿</el-button
          ><el-button
            type="primary"
            :disabled="!canWrite || order.status !== 'DRAFT' || busy"
            :loading="busy"
            @click="act('place')"
            >确认下单</el-button
          ><el-button
            type="danger"
            plain
            :disabled="!canWrite || !mayCancel(order) || busy"
            @click="act('cancel')"
            >取消订单</el-button
          >
        </div>
      </div>
      <el-alert
        v-if="actionError"
        :title="actionError"
        type="error"
        :closable="false"
        class="form-alert"
      /><el-alert
        v-if="order.status !== 'DRAFT'"
        title="此单不能继续编辑；商品资料与价格以此单快照为准。"
        type="info"
        :closable="false"
        class="form-alert"
      />
      <div class="purchase-detail-grid">
        <div class="surface purchase-card">
          <h3>采购信息</h3>
          <el-descriptions :column="1" border
            ><el-descriptions-item label="采购平台">{{
              platformNames[order.platform]
            }}</el-descriptions-item
            ><el-descriptions-item label="平台订单号">{{
              order.platformOrderNo || '未填写'
            }}</el-descriptions-item>
            <el-descriptions-item label="采购账号">{{
              order.purchaseAccountAlias || '未指定账号'
            }}</el-descriptions-item>
            <el-descriptions-item label="店铺名称">{{
              order.supplierName || '未填写'
            }}</el-descriptions-item
            ><el-descriptions-item label="采购日期">{{
              order.purchaseDate || '历史记录未填写'
            }}</el-descriptions-item
            ><el-descriptions-item label="目标仓库">{{ warehouseLabel }}</el-descriptions-item
            ><el-descriptions-item label="确认时间">{{
              order.placedAt ? new Date(order.placedAt).toLocaleString('zh-CN') : '尚未确认'
            }}</el-descriptions-item></el-descriptions
          >
        </div>
        <div class="surface purchase-card">
          <h3>收货信息 <small v-if="order.recipientMasked" class="muted">当前角色已脱敏</small></h3>
          <el-descriptions :column="1" border
            ><el-descriptions-item label="收货人">{{
              order.recipient.name || '—'
            }}</el-descriptions-item
            ><el-descriptions-item label="电话">{{
              order.recipient.phone || '—'
            }}</el-descriptions-item
            ><el-descriptions-item label="地址"
              ><span class="preserve-lines">{{
                order.recipient.address || '—'
              }}</span></el-descriptions-item
            ><el-descriptions-item label="备注"
              ><span class="preserve-lines">{{ order.remark || '—' }}</span></el-descriptions-item
            ></el-descriptions
          >
        </div>
      </div>
      <div class="surface catalog-panel">
        <div class="purchase-section-heading">
          <h3>采购明细</h3>
          <span class="muted">{{ order.items.length }} 个 SKU · 数量按实际采购记录</span>
        </div>
        <el-table :data="order.items" row-key="id"
          ><el-table-column label="商品 / SKU" min-width="210"
            ><template #default="{ row }"
              ><strong>{{ row.name }}</strong
              ><small class="catalog-item-sub">{{ row.sku }}</small></template
            ></el-table-column
          ><el-table-column label="货号 / 颜色 / 尺码" min-width="190"
            ><template #default="{ row }"
              >{{ row.articleNo || '—' }} / {{ row.color || '—' }} / {{ row.size || '—' }}</template
            ></el-table-column
          ><el-table-column prop="quantity" label="采购数量" width="100" /><el-table-column
            prop="receivedQuantity"
            label="已收数量"
            width="100"
          /><el-table-column prop="unitPrice" label="原单价" width="100" /><el-table-column
            prop="discountAmount"
            label="行优惠"
            width="100"
          /><el-table-column prop="lineNet" label="折后金额" width="110" /><el-table-column
            label="运费分摊"
            width="100"
            ><template #default="{ row }">{{
              row.freightAllocated ?? '待确认'
            }}</template></el-table-column
          ><el-table-column label="单位到仓成本" width="135"
            ><template #default="{ row }">{{
              row.landedUnitCost ?? '待确认'
            }}</template></el-table-column
          ></el-table
        >
        <div class="purchase-totals">
          <span
            >商品原额 <b>¥ {{ order.goodsAmount }}</b></span
          ><span
            >优惠合计 <b>− ¥ {{ order.discountAmount }}</b></span
          ><span
            >采购运费 <b>+ ¥ {{ order.freightAmount }}</b></span
          ><strong
            >服务器总成本 <em>¥ {{ order.totalCost }}</em></strong
          >
        </div>
      </div>
    </template>
  </section>
</template>
