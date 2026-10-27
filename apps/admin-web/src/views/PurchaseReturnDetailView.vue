<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { InventoryBalanceData, PurchaseReturnData } from '@caicang/api-contract';
import { usePurchaseReturns } from '../composables/purchase-returns';
import { useInventory } from '../composables/inventory';
import { useTenantStore } from '../stores/tenant';
import { useAuthStore } from '../stores/auth';
import { returnConfirmation, returnStatusNames } from '../api/return-form';
import { formatTime } from '../api/package-status';
import { failureMessage } from '../utils/feedback';
const api = usePurchaseReturns(),
  inventory = useInventory(),
  tenants = useTenantStore(),
  auth = useAuthStore(),
  route = useRoute(),
  router = useRouter();
const record = ref<PurchaseReturnData | null>(null),
  balances = ref<InventoryBalanceData[]>([]),
  loading = ref(false),
  busy = ref(false),
  stockLoading = ref(false),
  error = ref(''),
  actionError = ref(''),
  stockError = ref('');
const id = computed(() => String(route.params.id)),
  canConfirm = computed(() => tenants.current?.permissions.includes('inventory:write')),
  canCancel = computed(() => tenants.current?.permissions.includes('purchase:write'));
let sequence = 0,
  stockSequence = 0,
  alive = true;
async function loadStock() {
  const current = record.value;
  if (current?.status !== 'CONFIRMED') return;
  const version = ++stockSequence;
  balances.value = [];
  stockError.value = '';
  stockLoading.value = true;
  try {
    const results = await Promise.all(
      current.items.map((i) =>
        inventory.balances({
          page: 1,
          pageSize: 100,
          warehouseId: current.warehouseId,
          productId: i.productId,
        }),
      ),
    );
    if (version === stockSequence && record.value?.id === current.id)
      balances.value = results.flatMap((r) => r.data);
  } catch (e) {
    if (version === stockSequence) stockError.value = failureMessage(e);
  } finally {
    if (version === stockSequence) stockLoading.value = false;
  }
}
async function load() {
  const version = ++sequence;
  stockSequence++;
  loading.value = true;
  error.value = '';
  balances.value = [];
  record.value = null;
  try {
    const result = await api.detail(id.value);
    if (version === sequence) {
      record.value = result;
      if (result.status === 'CONFIRMED') await loadStock();
    }
  } catch (e) {
    if (version === sequence) error.value = failureMessage(e);
  } finally {
    if (version === sequence) loading.value = false;
  }
}
async function act(action: 'confirm' | 'cancel') {
  const current = record.value;
  if (
    !current ||
    current.status !== 'DRAFT' ||
    busy.value ||
    !(action === 'confirm' ? canConfirm.value : canCancel.value)
  )
    return;
  try {
    await ElMessageBox.confirm(
      action === 'confirm'
        ? '确认将退给供应商，并按服务器校验结果扣减库存。实际退款登记金额将冻结，请核对商品、数量和金额。'
        : '取消此草稿？取消不会改变库存，历史单据会保留。',
      action === 'confirm' ? '确认采购退货' : '取消退货草稿',
      {
        confirmButtonText: action === 'confirm' ? '确认退货并扣库存' : '确认取消草稿',
        cancelButtonText: '返回',
        type: 'warning',
      },
    );
  } catch {
    return;
  }
  if (!alive || record.value?.id !== current.id) return;
  busy.value = true;
  actionError.value = '';
  try {
    // Persist the document-scoped operation before the first HTTP request, including after reload.
    const result =
      action === 'confirm'
        ? await api.confirm(
            current.id,
            returnConfirmation(
              window.sessionStorage,
              auth.user?.id,
              tenants.current?.tenant.id,
              current.id,
            )(),
          )
        : await api.cancel(current.id);
    if (!alive || record.value?.id !== current.id) return;
    record.value = result;
    ElMessage.success(action === 'confirm' ? '采购退货已确认' : '退货草稿已取消，库存未变化');
    if (result.status === 'CONFIRMED') await loadStock();
  } catch (e) {
    if (alive && record.value?.id === current.id)
      actionError.value =
        failureMessage(e) + '；确认结果不明时请刷新详情或用原确认号重试，不会自动换号扣库存。';
  } finally {
    if (alive) busy.value = false;
  }
}
watch(
  id,
  () => {
    actionError.value = '';
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  alive = false;
  sequence++;
  stockSequence++;
});
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">SUPPLIER RETURN DETAILS</span>
        <h1>采购退货详情</h1>
        <p class="muted">商品退给供应商，原采购价格和实际入库记录保持可追溯。</p>
      </div>
      <el-button @click="router.push('/purchase-returns')">返回退货列表</el-button>
    </div>
    <el-skeleton v-if="loading" :rows="9" animated class="surface loading-surface" />
    <div v-else-if="error" class="surface catalog-error">
      <el-alert :title="error" type="error" :closable="false" /><el-button @click="load"
        >重试加载</el-button
      >
    </div>
    <template v-else-if="record">
      <div class="surface purchase-card">
        <div class="purchase-section-heading">
          <div>
            <small class="muted">退货单号</small>
            <h2>{{ record.returnNo }}</h2>
            <el-tag
              :type="
                record.status === 'CONFIRMED'
                  ? 'success'
                  : record.status === 'DRAFT'
                    ? 'warning'
                    : 'info'
              "
              >{{ returnStatusNames[record.status] }}</el-tag
            >
          </div>
          <div class="purchase-actions">
            <el-button :disabled="busy" @click="load">刷新详情</el-button
            ><el-button
              type="primary"
              :loading="busy"
              :disabled="!canConfirm || record.status !== 'DRAFT' || busy"
              @click="act('confirm')"
              >确认退货</el-button
            ><el-button
              type="danger"
              plain
              :disabled="!canCancel || record.status !== 'DRAFT' || busy"
              @click="act('cancel')"
              >取消草稿</el-button
            >
          </div>
        </div>
        <el-alert
          v-if="actionError"
          :title="actionError"
          type="error"
          :closable="false"
          class="form-alert"
        />
        <el-alert
          v-if="record.status === 'DRAFT'"
          title="草稿尚未扣库存。仅有库存操作权限的人员可确认；采购员可创建、取消草稿。"
          type="info"
          :closable="false"
          class="form-alert"
        />
        <el-descriptions :column="2" border
          ><el-descriptions-item label="原采购单"
            ><router-link :to="'/purchases/' + record.purchaseOrderId">{{
              record.purchaseOrderNo
            }}</router-link></el-descriptions-item
          ><el-descriptions-item label="仓库">{{ record.warehouseName }}</el-descriptions-item
          ><el-descriptions-item label="退货日期">{{ record.returnDate }}</el-descriptions-item
          ><el-descriptions-item label="创建人">{{ record.createdByName }}</el-descriptions-item
          ><el-descriptions-item label="原因">{{ record.reason }}</el-descriptions-item
          ><el-descriptions-item label="备注">{{ record.remark || '未填写' }}</el-descriptions-item
          ><el-descriptions-item label="创建时间">{{
            formatTime(record.createdAt)
          }}</el-descriptions-item
          ><el-descriptions-item label="确认时间">{{
            record.confirmedAt ? formatTime(record.confirmedAt) : '尚未确认'
          }}</el-descriptions-item></el-descriptions
        >
        <el-table :data="record.items" row-key="id" style="margin-top: 20px">
          <el-table-column label="商品 / SKU" min-width="210"
            ><template #default="{ row }"
              >{{ row.name }}<small class="catalog-item-sub">{{ row.sku }}</small></template
            ></el-table-column
          ><el-table-column prop="quantity" label="退货数量" width="105" /><el-table-column
            label="预计退款（元）"
            prop="estimatedRefundAmount"
            width="150"
          />
          <el-table-column label="原入库追溯" min-width="250"
            ><template #default="{ row }"
              ><div v-for="a in row.allocations" :key="a.id">
                <router-link :to="'/receipts/' + a.receiptId">{{ a.receiptNo }}</router-link> ·
                {{ a.quantity }} {{ row.unit }}
              </div>
              <span v-if="!row.allocations.length" class="muted"
                >确认成功后分配原入库来源</span
              ></template
            ></el-table-column
          >
          <el-table-column label="库存扣减成本（元）" min-width="165"
            ><template #default="{ row }">{{
              row.stockCost ?? '确认后核算'
            }}</template></el-table-column
          >
          <el-table-column label="库存追溯" width="120"
            ><template #default="{ row }"
              ><router-link
                :to="{
                  path: '/inventory/movements',
                  query: {
                    type: 'PURCHASE_RETURN',
                    productId: row.productId,
                    warehouseId: record.warehouseId,
                  },
                }"
                >查看流水</router-link
              ></template
            ></el-table-column
          >
        </el-table>
      </div>
      <div class="surface purchase-card" style="margin-top: 20px">
        <h2>退款记录</h2>
        <div class="inventory-metrics">
          <div class="inventory-metric">
            <p>预计退款金额（元）</p>
            <strong>{{ record.estimatedRefundAmount }}</strong>
            <p>按原采购商品实付价比例估算，不含运费</p>
          </div>
          <div class="inventory-metric">
            <p>实际退款金额（业务登记，元）</p>
            <strong>{{ record.refundAmount }}</strong>
            <p>
              {{
                record.status === 'CONFIRMED'
                  ? '已随退货确认冻结'
                  : record.status === 'DRAFT'
                    ? '草稿登记，尚未确认'
                    : '已取消，不计生效退款'
              }}
            </p>
          </div>
        </div>
        <p class="muted">
          登记归属本退货单，创建人 {{ record.createdByName }}，确认人
          {{
            record.confirmedByName ||
            (record.confirmedBy === record.createdBy
              ? record.createdByName
              : record.confirmedBy
                ? '已授权操作人'
                : '尚未确认')
          }}。本记录不代表支付系统到账凭证；实际退款与库存成本分别核算。
        </p>
        <p v-if="record.status === 'CONFIRMED'" class="muted">
          库存扣减成本 {{ record.stockCost }} 元；原入库来源成本 {{ record.receivedCost }} 元。
        </p>
      </div>
      <div
        v-if="record.status === 'CONFIRMED'"
        class="surface purchase-card"
        style="margin-top: 20px"
      >
        <div class="purchase-section-heading">
          <h2>确认后的真实库存</h2>
          <el-button :loading="stockLoading" @click="loadStock">刷新库存余额</el-button>
        </div>
        <el-alert v-if="stockError" :title="stockError" type="error" :closable="false" /><el-table
          v-loading="stockLoading"
          :data="balances"
          empty-text="暂无库存余额"
          ><el-table-column prop="sku" label="SKU" /><el-table-column
            prop="quantityOnHand"
            label="当前数量" /><el-table-column prop="totalCost" label="当前库存成本（元）"
        /></el-table>
        <p class="muted">
          以上为当前服务器余额，可能包含确认后发生的其他业务；本次扣减前后数量以对应库存流水为准。
        </p>
      </div>
    </template>
  </section>
</template>
