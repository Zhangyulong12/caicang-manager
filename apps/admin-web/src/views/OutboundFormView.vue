<script setup lang="ts">
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, ArrowLeft, Refresh } from '@element-plus/icons-vue';
import type { InventoryBalanceData, WarehouseData } from '@caicang/api-contract';
import { useOutbound } from '../composables/outbound';
import { useInventory } from '../composables/inventory';
import { useCatalog } from '../composables/catalog';
import { useTenantStore } from '../stores/tenant';
import {
  blankOutbound,
  lineShortage,
  outboundCarriers,
  outboundErrors,
  outboundFailureText,
  outboundForm,
  outboundLineFromBalance,
  outboundPayload,
  recipientMissing,
} from '../api/outbound';
import { formatQuantity } from '../api/inventory-format';
import OutboundProductPicker from '../components/OutboundProductPicker.vue';
const route = useRoute(),
  router = useRouter(),
  api = useOutbound(),
  inventory = useInventory(),
  catalog = useCatalog(),
  tenants = useTenantStore();
const form = reactive(blankOutbound()),
  warehouses = ref<WarehouseData[]>([]),
  loading = ref(false),
  saving = ref(false),
  refreshing = ref(false),
  loadError = ref(''),
  error = ref(''),
  errors = ref<Record<string, string>>({}),
  picker = ref(false),
  initialized = ref(false),
  baseline = ref('');
const editing = computed(() => typeof route.params.id === 'string'),
  canWrite = computed(() => tenants.current?.permissions.includes('outbound:write') === true),
  missingRecipient = computed(() => recipientMissing(form)),
  totalPieces = computed(() =>
    form.items.reduce((sum, row) => {
      const value = /^[1-9]\d{0,9}$/.test(row.quantity) ? Number(row.quantity) : 0;
      return sum + value;
    }, 0),
  ),
  shortageRows = computed(() => form.items.filter(lineShortage)),
  dirty = computed(() => initialized.value && JSON.stringify(form) !== baseline.value);
let sequence = 0,
  availabilitySequence = 0,
  alive = true,
  leaveApproved = false;

/** 可用库存一律问服务端：换仓库、进页面、手动刷新都重新查，不在本地扣减。 */
async function refreshAvailability() {
  if (!form.warehouseId || !form.items.length) return;
  const version = ++availabilitySequence;
  refreshing.value = true;
  try {
    const pairs = await Promise.all(
      form.items.map(async (row) => {
        try {
          const result = await inventory.balances({
            page: 1,
            pageSize: 1,
            warehouseId: form.warehouseId,
            productId: row.productId,
          });
          return [row.productId, result.data[0]?.quantityOnHand ?? 0] as const;
        } catch {
          return [row.productId, row.availableQuantity] as const;
        }
      }),
    );
    if (version !== availabilitySequence) return;
    const known = new Map(pairs);
    for (const row of form.items)
      row.availableQuantity = known.get(row.productId) ?? row.availableQuantity;
  } finally {
    if (version === availabilitySequence) refreshing.value = false;
  }
}
async function load() {
  const version = ++sequence;
  initialized.value = false;
  loading.value = true;
  loadError.value = '';
  error.value = '';
  errors.value = {};
  picker.value = false;
  try {
    const [options, order, preferred] = await Promise.all([
      catalog.warehouses(1, 100),
      editing.value ? api.detail(String(route.params.id)) : Promise.resolve(null),
      editing.value ? Promise.resolve(null) : catalog.defaultWarehouse(),
    ]);
    if (version !== sequence) return;
    warehouses.value = options.data;
    Object.assign(form, order ? outboundForm(order) : blankOutbound());
    if (!order) form.warehouseId = preferred?.id ?? '';
    if (order && order.status !== 'DRAFT') {
      // 已发货/已取消的单不允许改：这是账本事实，页面直接拒绝进入编辑。
      loadError.value = '这张出库单已发货或已取消，不能再修改；请返回详情查看状态';
      return;
    }
    baseline.value = JSON.stringify(form);
    initialized.value = true;
    if (editing.value) void refreshAvailability();
  } catch (e) {
    if (version === sequence) loadError.value = outboundFailureText(e);
  } finally {
    if (version === sequence) loading.value = false;
  }
}
function add(row: InventoryBalanceData) {
  if (form.items.some((line) => line.productId === row.productId)) {
    ElMessage.warning('此 SKU 已添加，请直接修改数量');
    return;
  }
  if (form.items.length >= 100) {
    ElMessage.warning('每单最多 100 个 SKU');
    return;
  }
  form.items.push(outboundLineFromBalance(row));
  errors.value.items = '';
  void refreshAvailability();
}
async function save() {
  if (saving.value || !canWrite.value) return;
  errors.value = outboundErrors(form);
  if (Object.keys(errors.value).length) {
    error.value = '请修正标红字段后再保存';
    return;
  }
  saving.value = true;
  error.value = '';
  const version = sequence;
  try {
    const payload = outboundPayload(form);
    const result = editing.value
      ? await api.update(String(route.params.id), payload)
      : await api.create(payload);
    if (!alive || version !== sequence) return;
    baseline.value = JSON.stringify(form);
    leaveApproved = true;
    ElMessage.success(editing.value ? '草稿已更新' : '出库草稿已保存，库存尚未变动');
    await router.push('/outbound/' + result.id);
  } catch (e) {
    if (!alive || version !== sequence) return;
    error.value = outboundFailureText(e);
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
    await ElMessageBox.confirm('尚有未保存的出库内容，离开后将丢失。', '离开出库表单', {
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
watch(
  () => route.params.id,
  () => {
    leaveApproved = false;
    void load();
  },
  { immediate: true },
);
watch(
  () => form.warehouseId,
  () => {
    if (initialized.value) void refreshAvailability();
  },
);
watch(
  form,
  () => {
    if (!Object.keys(errors.value).length) return;
    errors.value = outboundErrors(form);
    if (!Object.keys(errors.value).length && error.value === '请修正标红字段后再保存')
      error.value = '';
  },
  { deep: true },
);
window.addEventListener('beforeunload', unload);
onBeforeUnmount(() => {
  alive = false;
  sequence++;
  availabilitySequence++;
  window.removeEventListener('beforeunload', unload);
});
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">OUTBOUND DRAFT</span>
        <h1>{{ editing ? '修改出库草稿' : '新建出库单' }}</h1>
        <p class="muted">
          先选商品与数量保存草稿；确认发货时才由服务端扣减库存，这里显示的可用数量来自服务器。
        </p>
      </div>
      <el-button
        :icon="ArrowLeft"
        @click="router.push(editing ? '/outbound/' + route.params.id : '/outbound')"
        >返回</el-button
      >
    </div>
    <el-skeleton v-if="loading" :rows="10" animated class="surface loading-surface" />
    <div v-else-if="loadError" class="surface catalog-error">
      <el-alert :title="loadError" type="error" :closable="false" /><el-button @click="load"
        >重试加载</el-button
      >
    </div>
    <template v-else-if="initialized">
      <el-alert
        v-if="!canWrite"
        title="当前角色只能查看出库单，不能创建或修改"
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
        :disabled="saving || !canWrite"
        @submit.prevent="save"
      >
        <div class="surface purchase-card">
          <div class="purchase-section-heading">
            <h3>发货信息</h3>
            <span class="muted">从仓库发货给客户</span>
          </div>
          <div class="purchase-form-grid">
            <el-form-item label="发货仓库" required :error="errors.warehouseId">
              <el-select
                v-model="form.warehouseId"
                aria-label="发货仓库"
                placeholder="选择发货仓库"
              >
                <el-option
                  v-for="row in warehouses"
                  :key="row.id"
                  :label="row.name + ' · ' + row.code"
                  :value="row.id"
                  :disabled="!row.isActive"
                />
              </el-select>
              <small class="field-hint">可出库数量按所选仓库统计</small>
            </el-form-item>
            <el-form-item label="快递公司" :error="errors.carrierCode">
              <el-select
                v-model="form.carrierCode"
                aria-label="快递公司"
                placeholder="选择快递公司"
              >
                <el-option label="暂不指定" value="" />
                <el-option
                  v-for="row in outboundCarriers"
                  :key="row.code"
                  :label="row.name"
                  :value="row.code"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="发货运单号" :error="errors.trackingNo">
              <el-input
                v-model="form.trackingNo"
                :validate-event="false"
                placeholder="快递单号，前导零会原样保存"
              />
            </el-form-item>
            <el-form-item label="备注" :error="errors.remark">
              <el-input
                v-model="form.remark"
                :validate-event="false"
                type="textarea"
                :rows="2"
                placeholder="打包说明、客户要求等"
              />
            </el-form-item>
          </div>
        </div>
        <div class="surface purchase-card">
          <div class="purchase-section-heading">
            <h3>客户收货信息</h3>
            <span class="muted">草稿可留空，发货前必须补齐</span>
          </div>
          <el-alert
            v-if="missingRecipient.length"
            :title="
              '尚未填写：' + missingRecipient.join('、') + '；草稿可以保存，但确认发货前需补齐'
            "
            type="warning"
            :closable="false"
            class="form-alert"
          />
          <div class="purchase-form-grid">
            <el-form-item label="收件人" :error="errors.customerName">
              <el-input
                v-model="form.customerName"
                :validate-event="false"
                placeholder="客户姓名"
              />
            </el-form-item>
            <el-form-item label="联系电话" :error="errors.customerPhone">
              <el-input
                v-model="form.customerPhone"
                :validate-event="false"
                placeholder="手机号或带区号座机"
              />
            </el-form-item>
            <el-form-item
              label="收件地址"
              :error="errors.customerAddress"
              class="purchase-full-width"
            >
              <el-input
                v-model="form.customerAddress"
                :validate-event="false"
                type="textarea"
                :rows="2"
                placeholder="省、市、区及详细地址"
              />
            </el-form-item>
          </div>
        </div>
        <div class="surface purchase-card purchase-lines">
          <div class="purchase-section-heading">
            <div>
              <h3>商品明细</h3>
              <small class="muted">每行一个 SKU，可用库存由服务器按仓库返回。</small>
            </div>
            <div class="outbound-lines-actions">
              <el-button
                :icon="Refresh"
                :loading="refreshing"
                :disabled="!form.warehouseId || !form.items.length"
                @click="refreshAvailability"
                >刷新可用库存</el-button
              >
              <el-button :icon="Plus" :disabled="form.items.length >= 100" @click="picker = true"
                >添加 SKU</el-button
              >
            </div>
          </div>
          <el-alert
            v-if="errors.items"
            :title="errors.items"
            type="error"
            :closable="false"
            class="form-alert"
          />
          <el-alert
            v-if="shortageRows.length"
            :title="
              '以下 SKU 超过当前可用库存，确认发货会被服务器拒绝：' +
              shortageRows.map((row) => row.sku).join('、')
            "
            type="warning"
            :closable="false"
            class="form-alert"
          />
          <el-empty
            v-if="!form.items.length"
            description="尚未添加商品，从当前仓库的库存里选择 SKU"
            :image-size="70"
          />
          <div v-else class="purchase-lines-scroll">
            <table class="purchase-input-table">
              <thead>
                <tr>
                  <th>商品 / SKU</th>
                  <th>可用库存</th>
                  <th>发货数量</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in form.items" :key="row.key">
                  <td>
                    <strong>{{ row.name }}</strong>
                    <small>{{ row.sku }} · {{ row.unit }}</small>
                    <span
                      v-if="errors['items.' + index + '.productId']"
                      class="purchase-field-error"
                      >{{ errors['items.' + index + '.productId'] }}</span
                    >
                  </td>
                  <td>
                    <span class="stock-number" :class="{ zero: row.availableQuantity === 0 }">{{
                      formatQuantity(row.availableQuantity)
                    }}</span>
                    <small class="catalog-item-sub">{{ row.unit }}</small>
                  </td>
                  <td>
                    <el-form-item :error="errors['items.' + index + '.quantity']">
                      <el-input
                        v-model="row.quantity"
                        :validate-event="false"
                        :aria-label="'发货数量-' + (index + 1)"
                        inputmode="numeric"
                      />
                    </el-form-item>
                    <small v-if="lineShortage(row)" class="purchase-field-error"
                      >超过可用库存</small
                    >
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
          <p class="muted outbound-total-hint">
            本次共 {{ form.items.length }} 个 SKU、{{ formatQuantity(totalPieces) }}
            件；出库后会由服务端写入成本快照与库存流水。
          </p>
        </div>
        <div class="purchase-save-bar">
          <span class="muted">保存为草稿不会改动库存；确认发货在详情页完成。</span>
          <div>
            <el-button
              :disabled="saving"
              @click="router.push(editing ? '/outbound/' + route.params.id : '/outbound')"
              >取消</el-button
            >
            <el-button
              native-type="submit"
              type="primary"
              :loading="saving"
              :disabled="!canWrite"
              >{{ editing ? '保存修改' : '保存出库草稿' }}</el-button
            >
          </div>
        </div>
      </el-form>
      <OutboundProductPicker
        v-model:visible="picker"
        :warehouse-id="form.warehouseId"
        :selected="form.items.map((row) => row.productId)"
        @select="add"
      />
    </template>
  </section>
</template>
