<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_LABELS,
  type InventoryBalanceData,
  type ProductData,
  type WarehouseData,
} from '@caicang/api-contract';
import InventoryTabs from '../components/InventoryTabs.vue';
import AdjustmentProductPicker from '../components/AdjustmentProductPicker.vue';
import { useAdjustments } from '../composables/adjustments';
import { useInventory } from '../composables/inventory';
import { useCatalog } from '../composables/catalog';
import { useAuthStore } from '../stores/auth';
import { useTenantStore } from '../stores/tenant';
import {
  blankAdjustment,
  adjustmentErrors,
  adjustmentDefinitelyRejected,
  createAdjustmentAttempt,
  adjustmentAttemptKey,
  pendingForm,
} from '../api/adjustment-form';
import { formatQuantity } from '../api/inventory-format';
import { ApiFailure } from '../api/client';
import { failureMessage } from '../utils/feedback';
const router = useRouter(),
  api = useAdjustments(),
  inventory = useInventory(),
  catalog = useCatalog(),
  auth = useAuthStore(),
  tenants = useTenantStore();
const form = reactive(blankAdjustment()),
  product = ref<ProductData | null>(null),
  warehouses = ref<WarehouseData[]>([]),
  balance = ref<InventoryBalanceData | null>(null);
const loading = ref(true),
  loadError = ref(''),
  balanceLoading = ref(false),
  balanceError = ref(''),
  error = ref(''),
  errors = ref<Record<string, string>>({}),
  busy = ref(false),
  confirming = ref(false),
  picker = ref(false),
  pending = ref(false),
  completedId = ref('');
const canWrite = computed(() => tenants.current?.permissions.includes('inventory:write') === true),
  locked = computed(
    () => busy.value || confirming.value || pending.value || !!completedId.value || !canWrite.value,
  );
// User + tenant scope prevents restoring another workspace's unconfirmed operation.
function currentAttempt() {
  return createAdjustmentAttempt(
    window.sessionStorage,
    adjustmentAttemptKey(auth.user?.id, tenants.current?.tenant.id),
  );
}
let alive = true,
  balanceSequence = 0;
async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const saved = currentAttempt().read();
    if (saved) {
      Object.assign(form, pendingForm(saved));
      pending.value = true;
    }
    const [options, preferred] = await Promise.all([
      api.warehouses(),
      saved ? Promise.resolve(null) : catalog.defaultWarehouse(),
    ]);
    if (!alive) return;
    warehouses.value = options;
    if (!saved && !form.warehouseId) form.warehouseId = preferred?.id ?? options[0]?.id ?? '';
    if (saved) {
      const restored = await catalog.product(saved.productId);
      if (alive) product.value = restored;
    }
  } catch (e) {
    if (alive) loadError.value = failureMessage(e);
  } finally {
    if (alive) {
      loading.value = false;
      void refreshBalance();
    }
  }
}
async function refreshBalance() {
  const version = ++balanceSequence;
  balance.value = null;
  balanceError.value = '';
  if (!form.warehouseId || !form.productId) {
    balanceLoading.value = false;
    return;
  }
  balanceLoading.value = true;
  try {
    const result = await inventory.balances({
      page: 1,
      pageSize: 1,
      warehouseId: form.warehouseId,
      productId: form.productId,
    });
    if (alive && version === balanceSequence) balance.value = result.data[0] ?? null;
  } catch (e) {
    if (alive && version === balanceSequence) balanceError.value = failureMessage(e);
  } finally {
    if (alive && version === balanceSequence) balanceLoading.value = false;
  }
}
function select(value: ProductData) {
  product.value = value;
  form.productId = value.id;
}
async function submit() {
  if (busy.value || confirming.value || !canWrite.value || completedId.value) return;
  errors.value = adjustmentErrors(form);
  if (Object.keys(errors.value).length) return;
  const inputVersion = JSON.stringify(form);
  if (!pending.value) {
    confirming.value = true;
    try {
      await ElMessageBox.confirm(
        `${form.quantityDelta.trim().startsWith('-') ? '减少' : '增加'} ${Math.abs(Number(form.quantityDelta))} ${product.value?.unit ?? '件'}，原因：${ADJUSTMENT_REASON_LABELS[form.reason]}。确认后立即生效。`,
        '确认库存调整',
        { confirmButtonText: '确认调整', cancelButtonText: '返回核对', type: 'warning' },
      );
    } catch {
      return;
    } finally {
      confirming.value = false;
    }
    if (!alive || JSON.stringify(form) !== inputVersion) return;
  }
  busy.value = true;
  error.value = '';
  let attempt: ReturnType<typeof createAdjustmentAttempt> | undefined;
  try {
    attempt = currentAttempt();
    const payload = attempt.begin(form);
    pending.value = true;
    const result = await api.create(payload);
    if (!alive) return;
    completedId.value = result.id;
    // A storage cleanup failure is safe: reloading replays the same operation, never a new delta.
    try {
      attempt.clear();
    } catch {
      /* Keep original operation for safe replay. */
    }
    pending.value = false;
    ElMessage.success('库存调整已生效，余额和流水由服务器同步更新');
    await router.replace('/inventory/adjustments/' + result.id);
  } catch (e) {
    if (!alive) return;
    error.value = failureMessage(e);
    if (adjustmentDefinitelyRejected(e)) {
      try {
        attempt?.clear();
        pending.value = false;
      } catch {
        /* Retain a stable retry if storage is unavailable. */
      }
      if (e instanceof ApiFailure && e.code === 'OUT_OF_STOCK')
        error.value += `；服务器当前可用 ${String(e.details.available ?? '不足')}，请重新核对数量。`;
      void refreshBalance();
    }
  } finally {
    busy.value = false;
  }
}
watch(() => [form.warehouseId, form.productId], refreshBalance);
onBeforeRouteLeave(() => !!completedId.value || (!busy.value && !confirming.value));
function unload(event: BeforeUnloadEvent) {
  if (busy.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
onMounted(() => {
  window.addEventListener('beforeunload', unload);
  void load();
});
onBeforeUnmount(() => {
  alive = false;
  balanceSequence++;
  window.removeEventListener('beforeunload', unload);
});
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">NEW ADJUSTMENT</span>
        <h1>新建库存调整</h1>
        <p class="muted">正数增加、负数减少；提交后立即生效，请先核对实物与原因。</p>
      </div>
      <el-button :disabled="busy || confirming" @click="router.push('/inventory/adjustments')"
        >返回调整列表</el-button
      >
    </div>
    <InventoryTabs />
    <el-skeleton v-if="loading" :rows="8" animated class="surface loading-surface" />
    <div v-else-if="loadError" class="surface catalog-error">
      <el-alert :title="loadError" type="error" :closable="false" /><el-button @click="load"
        >重试加载</el-button
      >
    </div>
    <div v-else class="surface purchase-card" style="margin-top: 20px">
      <el-alert
        v-if="!canWrite"
        title="当前角色没有库存调整权限"
        type="warning"
        :closable="false"
        class="form-alert"
      />
      <el-alert
        v-if="pending"
        title="上次提交结果尚未确认，输入已锁定。重试会使用原内容和原操作号，不会重复调整；刷新页面仍可恢复。"
        type="warning"
        :closable="false"
        class="form-alert"
      />
      <el-alert v-if="error" :title="error" type="error" :closable="false" class="form-alert" />
      <el-form label-position="top" :disabled="locked" @submit.prevent="submit">
        <div class="catalog-form-grid">
          <el-form-item label="调整仓库" required :error="errors.warehouseId"
            ><el-select v-model="form.warehouseId" aria-label="调整仓库" placeholder="选择仓库"
              ><el-option
                v-for="row in warehouses"
                :key="row.id"
                :label="row.name + ' · ' + row.code + (row.isActive ? '' : '（已停用）')"
                :value="row.id" /></el-select
          ></el-form-item>
          <el-form-item label="调整商品" required :error="errors.productId"
            ><el-button :disabled="locked" @click="picker = true">{{
              product ? '更换商品' : '选择商品'
            }}</el-button>
            <div v-if="product" class="field-hint">
              {{ product.name }} · {{ product.sku }}<br />{{ product.articleNo || '未填货号' }} /
              {{ product.color || '未填颜色' }} / {{ product.size || '未填尺码' }}
            </div></el-form-item
          >
          <el-form-item label="调整原因" required :error="errors.reason"
            ><el-select v-model="form.reason" aria-label="调整原因"
              ><el-option
                v-for="value in ADJUSTMENT_REASONS"
                :key="value"
                :label="ADJUSTMENT_REASON_LABELS[value]"
                :value="value" /></el-select
          ></el-form-item>
          <el-form-item label="调整数量" required :error="errors.quantityDelta"
            ><el-input
              v-model="form.quantityDelta"
              aria-label="调整数量"
              placeholder="例如 -2 减少，+3 增加"
              inputmode="text"
              :validate-event="false"
          /></el-form-item>
        </div>
        <el-form-item label="备注" :required="form.reason === 'OTHER'" :error="errors.remark"
          ><el-input
            v-model="form.remark"
            aria-label="调整备注"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="说明盘点差异或调整依据；其他原因必须填写"
            :validate-event="false"
        /></el-form-item>
      </el-form>
      <p v-if="form.productId" class="muted">
        当前库存参考：{{
          balanceLoading
            ? '正在查询…'
            : balanceError
              ? '查询失败'
              : balance
                ? formatQuantity(balance.quantityOnHand) + ' ' + balance.unit
                : '当前仓库无库存记录'
        }}。此数可能并发变化，调整前后数量和成本以服务器提交结果为准。
      </p>
      <div v-if="balanceError" class="catalog-error">
        <el-alert :title="balanceError" type="error" :closable="false" /><el-button
          @click="refreshBalance"
          >重新查询库存</el-button
        >
      </div>
      <p class="muted">调整不会覆盖库存余额或采购历史价格。成本由服务器按现有成本规则计算。</p>
      <div class="dialog-actions">
        <el-button
          v-if="completedId"
          type="primary"
          @click="router.replace('/inventory/adjustments/' + completedId)"
          >查看已完成调整</el-button
        ><el-button
          v-else
          type="primary"
          :loading="busy || confirming"
          :disabled="!canWrite || (!pending && (balanceLoading || !!balanceError))"
          @click="submit"
          >{{ pending ? '重试确认原调整' : '提交库存调整' }}</el-button
        >
      </div>
    </div>
    <AdjustmentProductPicker v-model:visible="picker" @select="select" />
  </section>
</template>
