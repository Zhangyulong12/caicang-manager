<script setup lang="ts">
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, ArrowLeft } from '@element-plus/icons-vue';
import type { ProductData, WarehouseData } from '@caicang/api-contract';
import { usePurchases } from '../composables/purchases';
import { useCatalog } from '../composables/catalog';
import { useTenantStore } from '../stores/tenant';
import { ApiFailure } from '../api/client';
import { failureMessage } from '../utils/feedback';
import {
  blankPurchase,
  purchaseForm,
  purchaseErrors,
  preview,
  newPurchaseLine,
  platformNames,
} from '../api/purchase-form';
import PurchaseProductPicker from '../components/PurchaseProductPicker.vue';
const route = useRoute(),
  router = useRouter(),
  api = usePurchases(),
  catalog = useCatalog(),
  tenants = useTenantStore();
const form = reactive(blankPurchase()),
  warehouses = ref<WarehouseData[]>([]),
  loading = ref(false),
  saving = ref(false),
  loadError = ref(''),
  error = ref(''),
  errors = ref<Record<string, string>>({}),
  picker = ref(false),
  initialized = ref(false),
  baseline = ref(''),
  locked = ref(false);
const editing = computed(() => typeof route.params.id === 'string'),
  canWrite = computed(() => tenants.current?.permissions.includes('purchase:write') === true),
  estimate = computed(() => preview(form)),
  dirty = computed(() => initialized.value && JSON.stringify(form) !== baseline.value);
let sequence = 0,
  alive = true,
  leaveApproved = false;
async function load() {
  const version = ++sequence;
  initialized.value = false;
  loading.value = true;
  loadError.value = '';
  error.value = '';
  errors.value = {};
  locked.value = false;
  picker.value = false;
  try {
    const [options, order, preferred] = await Promise.all([
      api.warehouses(),
      editing.value ? api.detail(String(route.params.id)) : Promise.resolve(null),
      editing.value ? Promise.resolve(null) : catalog.defaultWarehouse(),
    ]);
    if (version !== sequence) return;
    warehouses.value = options;
    Object.assign(form, order ? purchaseForm(order) : blankPurchase());
    if (!order) form.warehouseId = preferred?.id ?? '';
    locked.value = !!order && order.status !== 'DRAFT';
    baseline.value = JSON.stringify(form);
    initialized.value = true;
  } catch (e) {
    if (version === sequence) loadError.value = failureMessage(e);
  } finally {
    if (version === sequence) loading.value = false;
  }
}
function add(product: ProductData) {
  if (form.items.some((row) => row.productId === product.id)) {
    ElMessage.warning('此 SKU 已添加，请直接修改数量');
    return;
  }
  if (form.items.length >= 100) {
    ElMessage.warning('每单最多 100 个 SKU');
    return;
  }
  form.items.push(newPurchaseLine(product));
  errors.value.items = '';
}
async function save() {
  if (saving.value || !canWrite.value || locked.value) return;
  errors.value = purchaseErrors(form);
  if (Object.keys(errors.value).length) {
    error.value = '请修正标红字段后保存';
    return;
  }
  saving.value = true;
  error.value = '';
  const version = sequence;
  try {
    const result = await api.save(form, editing.value ? String(route.params.id) : undefined);
    if (!alive || version !== sequence) return;
    baseline.value = JSON.stringify(form);
    leaveApproved = true;
    ElMessage.success('采购草稿已保存，金额已由服务器核算');
    await router.push('/purchases/' + result.id);
  } catch (e) {
    if (!alive || version !== sequence) return;
    error.value = failureMessage(e);
    if (e instanceof ApiFailure) {
      if (e.code === 'PURCHASE_ORDER_NO_ALREADY_EXISTS')
        errors.value.orderNo = '此单号已存在，请先按单号查询，勿重复创建';
      if (e.status === 0) error.value += '；保存结果暂未确认，请先按单号查询，重试时保留同一单号。';
    }
  } finally {
    saving.value = false;
  }
}
async function mayLeave() {
  if (leaveApproved) return true;
  if (saving.value) {
    ElMessage.warning('正在保存，请等待服务器结果');
    return false;
  }
  if (!dirty.value) return true;
  try {
    await ElMessageBox.confirm('尚有未保存的采购内容，离开后将丢失。', '离开采购表单', {
      confirmButtonText: '放弃修改并离开',
      cancelButtonText: '继续填写',
      type: 'warning',
    });
    return true;
  } catch {
    return false;
  }
}
function unload(event: BeforeUnloadEvent) {
  if (dirty.value || saving.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
onBeforeRouteLeave(mayLeave);
onBeforeRouteUpdate(mayLeave);
watch(
  () => route.params.id,
  () => {
    leaveApproved = false;
    void load();
  },
  { immediate: true },
);
watch(
  form,
  () => {
    if (!Object.keys(errors.value).length) return;
    errors.value = purchaseErrors(form);
    if (!Object.keys(errors.value).length && error.value === '请修正标红字段后保存')
      error.value = '';
  },
  { deep: true },
);
window.addEventListener('beforeunload', unload);
onBeforeUnmount(() => {
  alive = false;
  sequence++;
  window.removeEventListener('beforeunload', unload);
});
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">PURCHASE BILL</span>
        <h1>{{ editing ? '修改采购草稿' : '新建采购单' }}</h1>
        <p class="muted">逐行录入平台采购记录，保存后再确认下单。</p>
      </div>
      <el-button
        :icon="ArrowLeft"
        @click="router.push(editing ? '/purchases/' + route.params.id : '/purchases')"
        >返回</el-button
      >
    </div>
    <el-skeleton v-if="loading" :rows="12" animated class="surface loading-surface" />
    <div v-else-if="loadError" class="surface catalog-error">
      <el-alert :title="loadError" type="error" :closable="false" /><el-button @click="load"
        >重试加载</el-button
      >
    </div>
    <template v-else-if="initialized"
      ><el-alert
        v-if="locked || !canWrite"
        title="此订单当前不可编辑，请返回详情查看状态与权限"
        type="warning"
        :closable="false"
        class="form-alert"
      />
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        show-icon
        class="form-alert"
      />
      <el-form
        :model="form"
        label-position="top"
        :disabled="saving || locked || !canWrite"
        @submit.prevent="save"
      >
        <div class="surface purchase-card">
          <div class="purchase-section-heading">
            <h3>采购信息</h3>
            <span class="muted">平台采购 → 自有仓库</span>
          </div>
          <div class="purchase-form-grid">
            <el-form-item label="采购单号" required :error="errors.orderNo"
              ><el-input
                v-model="form.orderNo"
                :validate-event="false"
                placeholder="商家内唯一，失败重试时保留此编号"
            /></el-form-item>
            <el-form-item label="采购平台" required :error="errors.platform"
              ><el-select v-model="form.platform" aria-label="采购平台"
                ><el-option
                  v-for="(label, value) in platformNames"
                  :key="value"
                  :label="label"
                  :value="value" /></el-select
            ></el-form-item>
            <el-form-item label="平台订单号" :error="errors.platformOrderNo"
              ><el-input
                v-model="form.platformOrderNo"
                :validate-event="false"
                placeholder="复制淘宝、京东等平台的订单号"
            /></el-form-item>
            <el-form-item label="店铺名称" :error="errors.supplierName"
              ><el-input
                v-model="form.supplierName"
                :validate-event="false"
                placeholder="填写实际采购店铺"
            /></el-form-item>
            <el-form-item label="采购日期" required :error="errors.purchaseDate"
              ><el-input v-model="form.purchaseDate" type="date" :validate-event="false"
            /></el-form-item>
            <el-form-item label="目标仓库" required :error="errors.warehouseId"
              ><el-select
                v-model="form.warehouseId"
                aria-label="目标仓库"
                placeholder="选择收货仓库"
                ><el-option
                  v-for="row in warehouses"
                  :key="row.id"
                  :label="row.name + ' · ' + row.code"
                  :value="row.id"
                  :disabled="!row.isActive" /></el-select
              ><small v-if="!warehouses.some((row) => row.isActive)" class="field-hint"
                >没有启用仓库，请先在仓库管理建立。</small
              ></el-form-item
            >
          </div>
        </div>
        <div class="surface purchase-card">
          <h3>收货信息</h3>
          <div class="purchase-form-grid">
            <el-form-item label="收货人" required :error="errors.recipientName"
              ><el-input
                v-model="form.recipientName"
                :validate-event="false"
                placeholder="仓库实际收货人" /></el-form-item
            ><el-form-item label="收货电话" required :error="errors.recipientPhone"
              ><el-input
                v-model="form.recipientPhone"
                :validate-event="false"
                placeholder="填写联系电话" /></el-form-item
            ><el-form-item
              label="收货地址"
              required
              :error="errors.recipientAddress"
              class="purchase-full-width"
              ><el-input
                v-model="form.recipientAddress"
                :validate-event="false"
                type="textarea"
                :rows="2"
                placeholder="省、市、区及详细仓库地址"
            /></el-form-item>
          </div>
        </div>
        <div class="surface purchase-card purchase-lines">
          <div class="purchase-section-heading">
            <div>
              <h3>商品明细</h3>
              <small class="muted">每行一个 SKU，优惠填写整行优惠金额。</small>
            </div>
            <el-button :icon="Plus" :disabled="form.items.length >= 100" @click="picker = true"
              >添加 SKU</el-button
            >
          </div>
          <el-alert
            v-if="errors.items"
            :title="errors.items"
            type="error"
            :closable="false"
            class="form-alert"
          />
          <el-empty
            v-if="!form.items.length"
            description="尚未添加商品，从真实商品档案选择 SKU"
            :image-size="70"
          />
          <div v-else class="purchase-lines-scroll">
            <table class="purchase-input-table">
              <thead>
                <tr>
                  <th>商品 / SKU</th>
                  <th>数量</th>
                  <th>采购单价（元）</th>
                  <th>行优惠（元）</th>
                  <th>折后预估（元）</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in form.items" :key="row.key">
                  <td>
                    <strong>{{ row.name }}</strong
                    ><small>{{ row.sku }} · {{ row.unit }}</small
                    ><span
                      v-if="errors['items.' + index + '.productId']"
                      class="purchase-field-error"
                      >{{ errors['items.' + index + '.productId'] }}</span
                    >
                  </td>
                  <td>
                    <el-form-item :error="errors['items.' + index + '.quantity']"
                      ><el-input
                        v-model="row.quantity"
                        :validate-event="false"
                        :aria-label="'数量-' + (index + 1)"
                        inputmode="numeric"
                    /></el-form-item>
                  </td>
                  <td>
                    <el-form-item :error="errors['items.' + index + '.unitPrice']"
                      ><el-input
                        v-model="row.unitPrice"
                        :validate-event="false"
                        :aria-label="'采购单价-' + (index + 1)"
                        inputmode="decimal"
                        placeholder="实际采购价"
                    /></el-form-item>
                  </td>
                  <td>
                    <el-form-item :error="errors['items.' + index + '.discountAmount']"
                      ><el-input
                        v-model="row.discountAmount"
                        :validate-event="false"
                        :aria-label="'行优惠-' + (index + 1)"
                        inputmode="decimal"
                    /></el-form-item>
                  </td>
                  <td>
                    <strong>{{ estimate.rows[index] ?? '待完善' }}</strong>
                  </td>
                  <td>
                    <el-button
                      type="danger"
                      link
                      :aria-label="'移除 SKU-' + (index + 1)"
                      @click="form.items.splice(index, 1)"
                      >移除</el-button
                    >
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="purchase-form-grid purchase-fees">
            <el-form-item label="采购运费（元）" :error="errors.freightAmount"
              ><el-input
                v-model="form.freightAmount"
                :validate-event="false"
                inputmode="decimal" /></el-form-item
            ><el-form-item label="采购备注" :error="errors.remark" class="purchase-full-width"
              ><el-input
                v-model="form.remark"
                :validate-event="false"
                type="textarea"
                :rows="2"
                placeholder="采购补充说明"
            /></el-form-item>
          </div>
        </div>
        <div class="surface purchase-estimate">
          <div>
            <span class="section-kicker">COST ESTIMATE</span>
            <h3>实时金额预估</h3>
            <p class="muted">商品原额 − 行优惠 + 运费；最终金额以服务器结果为准。</p>
          </div>
          <div>
            <span
              >商品原额 <b>¥ {{ estimate.goodsAmount ?? '—' }}</b></span
            ><span
              >优惠合计 <b>− ¥ {{ estimate.discountAmount ?? '—' }}</b></span
            ><strong
              >预估总成本 <em>¥ {{ estimate.totalCost ?? '待完善' }}</em></strong
            >
          </div>
        </div>
        <el-alert v-if="errors.total" :title="errors.total" type="error" :closable="false" />
        <div class="purchase-save-bar">
          <span class="muted">保存为草稿后，可核对服务器金额并确认下单。</span>
          <div>
            <el-button
              :disabled="saving"
              @click="router.push(editing ? '/purchases/' + route.params.id : '/purchases')"
              >返回详情 / 列表</el-button
            ><el-button
              native-type="submit"
              type="primary"
              :loading="saving"
              :disabled="!canWrite || locked"
              >保存采购草稿</el-button
            >
          </div>
        </div> </el-form
      ><el-button
        v-if="error"
        link
        type="primary"
        @click="router.push({ path: '/purchases', query: { search: form.orderNo } })"
        >按当前采购单号查询已保存订单</el-button
      >
      <PurchaseProductPicker
        v-model:visible="picker"
        :selected="form.items.map((row) => row.productId)"
        @select="add"
      />
    </template>
  </section>
</template>
