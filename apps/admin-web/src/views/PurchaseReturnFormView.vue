<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import type { PurchaseOrderData, PurchaseReturnableData } from '@caicang/api-contract';
import { usePurchaseReturns } from '../composables/purchase-returns';
import { useTenantStore } from '../stores/tenant';
import { blankReturn, returnErrors, returnEstimate, returnInput } from '../api/return-form';
import { failureMessage } from '../utils/feedback';
import { ApiFailure } from '../api/client';
const api = usePurchaseReturns(),
  tenants = useTenantStore(),
  router = useRouter(),
  route = useRoute();
const form = reactive(blankReturn()),
  source = ref<PurchaseReturnableData | null>(null),
  options = ref<PurchaseOrderData[]>([]),
  search = ref(''),
  page = ref(1),
  total = ref(0),
  loading = ref(false),
  sourceLoading = ref(false),
  busy = ref(false),
  uncertain = ref(false),
  error = ref(''),
  sourceError = ref(''),
  submitError = ref(''),
  attempted = ref(false),
  saved = ref(false);
const errors = computed(() => returnErrors(form, source.value)),
  estimate = computed(() => returnEstimate(form, source.value)),
  canWrite = computed(() => tenants.current?.permissions.includes('purchase:write'));
let sequence = 0,
  sourceSequence = 0,
  alive = true;
async function findOrders() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  options.value = [];
  try {
    const result = await api.purchases(search.value, page.value);
    if (version === sequence) {
      options.value = result.data;
      total.value = result.pagination.total;
    }
  } catch (e) {
    if (version === sequence) error.value = failureMessage(e);
  } finally {
    if (version === sequence) loading.value = false;
  }
}
async function choose(id: string) {
  const version = ++sourceSequence;
  form.purchaseOrderId = id;
  form.quantities = {};
  source.value = null;
  sourceError.value = '';
  sourceLoading.value = true;
  try {
    const result = await api.returnable(id);
    if (version === sourceSequence) source.value = result;
  } catch (e) {
    if (version === sourceSequence) sourceError.value = failureMessage(e);
  } finally {
    if (version === sourceSequence) sourceLoading.value = false;
  }
}
async function save() {
  if (busy.value || uncertain.value || !canWrite.value) return;
  attempted.value = true;
  submitError.value = '';
  if (Object.keys(errors.value).length) return;
  busy.value = true;
  try {
    const result = await api.create(returnInput(form, source.value));
    if (!alive) return;
    saved.value = true;
    await router.push('/purchase-returns/' + result.id);
  } catch (e) {
    if (alive) {
      uncertain.value = !(
        e instanceof ApiFailure &&
        e.status >= 400 &&
        e.status < 500 &&
        e.code !== 'SCOPE_CHANGED'
      );
      submitError.value = failureMessage(e) + '。若保存结果不明，请先核对退货列表再重建草稿。';
    }
  } finally {
    if (alive) busy.value = false;
  }
}
onMounted(async () => {
  if (typeof route.query.purchaseOrderId === 'string') await choose(route.query.purchaseOrderId);
  await findOrders();
});
onBeforeRouteLeave(async () => {
  if (saved.value || (!form.purchaseOrderId && !form.reason && !form.remark)) return true;
  if (busy.value) return false;
  try {
    await ElMessageBox.confirm('退货草稿尚未保存，确定离开？', '离开新建页面', {
      confirmButtonText: '离开',
      cancelButtonText: '继续填写',
    });
    return true;
  } catch {
    return false;
  }
});
onBeforeUnmount(() => {
  alive = false;
  sequence++;
  sourceSequence++;
});
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">NEW SUPPLIER RETURN</span>
        <h1>新建采购退货</h1>
        <p class="muted">先选择已实际入库的采购记录；保存草稿不会扣减库存。</p>
      </div>
      <el-button :disabled="busy" @click="router.push('/purchase-returns')">返回列表</el-button>
    </div>
    <div class="surface purchase-card">
      <h2>1. 选择原采购记录</h2>
      <form
        class="catalog-toolbar"
        @submit.prevent="
          page = 1;
          findOrders();
        "
      >
        <el-input
          v-model="search"
          aria-label="原采购搜索"
          placeholder="按原采购单号、平台订单号或 SKU 搜索"
          maxlength="200"
        /><el-button native-type="submit" :loading="loading">搜索采购记录</el-button>
      </form>
      <el-alert v-if="error" :title="error" type="error" :closable="false" /><el-button
        v-if="error"
        @click="findOrders"
        >重试采购查询</el-button
      >
      <el-table
        v-loading="loading"
        :data="options"
        empty-text="暂无采购记录，请先创建采购并实际入库"
      >
        <el-table-column prop="orderNo" label="采购单号" min-width="230" /><el-table-column
          prop="platformOrderNo"
          label="平台订单号"
          min-width="140"
        /><el-table-column prop="purchaseDate" label="采购日期" width="120" />
        <el-table-column label="操作" width="110"
          ><template #default="{ row }"
            ><el-button
              link
              type="primary"
              :disabled="
                busy ||
                sourceLoading ||
                !row.items.some((i: PurchaseOrderData['items'][number]) => i.receivedQuantity > 0)
              "
              @click="choose(row.id)"
              >{{
                !row.items.some((i: PurchaseOrderData['items'][number]) => i.receivedQuantity > 0)
                  ? '尚未入库'
                  : form.purchaseOrderId === row.id
                    ? '已选择'
                    : '选择此单'
              }}</el-button
            ></template
          ></el-table-column
        >
      </el-table>
      <el-pagination
        v-model:current-page="page"
        :page-size="10"
        :total="total"
        layout="prev, pager, next"
        @current-change="findOrders"
      />
      <p v-if="attempted && errors.purchaseOrderId" class="field-error">
        {{ errors.purchaseOrderId }}
      </p>
    </div>
    <div class="surface purchase-card" style="margin-top: 20px">
      <h2>2. 填写退货商品与退款</h2>
      <el-skeleton v-if="sourceLoading" :rows="5" animated />
      <div v-else-if="sourceError" class="catalog-error">
        <el-alert :title="sourceError" type="error" :closable="false" /><el-button
          @click="choose(form.purchaseOrderId)"
          >重试可退数量</el-button
        >
      </div>
      <template v-else-if="source">
        <el-alert
          v-if="!source.items.some((i) => i.availableQuantity > 0)"
          title="此采购单尚无可退商品：未实际入库，或已全部退货。"
          type="warning"
          :closable="false"
        />
        <p>
          原采购单：<router-link :to="'/purchases/' + source.purchaseOrderId">{{
            source.orderNo
          }}</router-link>
        </p>
        <el-table :data="source.items" row-key="purchaseOrderItemId" empty-text="原单没有可退商品">
          <el-table-column label="商品 / SKU" min-width="210"
            ><template #default="{ row }"
              >{{ row.name
              }}<small class="catalog-item-sub">{{ row.sku }} · {{ row.unit }}</small></template
            ></el-table-column
          >
          <el-table-column prop="receivedQuantity" label="已入库" width="100" /><el-table-column
            prop="returnedQuantity"
            label="已退"
            width="90"
          /><el-table-column
            prop="availableQuantity"
            label="剩余可退"
            width="110"
          /><el-table-column prop="stockQuantity" label="当前库存" width="100" />
          <el-table-column label="本次退货数量" min-width="190"
            ><template #default="{ row }"
              ><el-input
                v-model="form.quantities[row.purchaseOrderItemId]"
                :aria-label="'退货数量 ' + row.sku"
                :disabled="busy || !canWrite || !row.availableQuantity"
                inputmode="numeric"
                placeholder="留空不退"
              /><small v-if="attempted && errors[row.purchaseOrderItemId]" class="field-error">{{
                errors[row.purchaseOrderItemId]
              }}</small></template
            ></el-table-column
          >
        </el-table>
        <p v-if="attempted && errors.items" class="field-error">{{ errors.items }}</p>
        <p class="muted">
          可退上限与当前库存不同；保存及确认都会由后端重新校验。未指定入库来源时由服务器分配并保留追溯。
        </p>
      </template>
      <el-empty v-else description="请先选择原采购记录" />
      <el-form label-position="top" :disabled="busy || !canWrite" @submit.prevent="save">
        <el-form-item label="退货日期" required :error="attempted ? errors.returnDate : ''"
          ><el-date-picker
            v-model="form.returnDate"
            type="date"
            value-format="YYYY-MM-DD"
            :clearable="false"
            aria-label="退货日期"
        /></el-form-item>
        <el-form-item label="退货原因" required :error="attempted ? errors.reason : ''"
          ><el-input
            v-model="form.reason"
            aria-label="退货原因"
            maxlength="500"
            type="textarea"
            :rows="2"
            show-word-limit
        /></el-form-item>
        <div class="inventory-metrics">
          <div class="inventory-metric">
            <p>预计退款金额（元）</p>
            <strong>{{ estimate }}</strong>
            <p>原采购商品实付价按数量比例估算，不含运费</p>
          </div>
          <div class="inventory-metric">
            <p>实际退款金额（业务登记，元）</p>
            <el-form-item :error="attempted ? errors.refundAmount : ''"
              ><el-input
                v-model="form.refundAmount"
                aria-label="实际退款金额"
                inputmode="decimal"
                maxlength="19"
            /></el-form-item>
            <p>按供应商实际约定登记，确认后冻结；不代表银行到账凭证</p>
          </div>
        </div>
        <el-form-item label="备注" :error="attempted ? errors.remark : ''"
          ><el-input
            v-model="form.remark"
            aria-label="退货备注"
            type="textarea"
            :rows="2"
            maxlength="2000"
        /></el-form-item>
        <el-alert
          v-if="submitError"
          :title="submitError"
          type="error"
          :closable="false"
          class="form-alert"
        />
        <div class="dialog-actions">
          <el-button
            type="primary"
            :loading="busy"
            :disabled="
              !canWrite ||
              sourceLoading ||
              !source?.items.some((i) => i.availableQuantity > 0) ||
              uncertain
            "
            @click="save"
            >保存退货草稿</el-button
          >
        </div>
      </el-form>
    </div>
  </section>
</template>
