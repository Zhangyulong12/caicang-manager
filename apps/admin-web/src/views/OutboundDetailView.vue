<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, Edit, Refresh, Promotion, Close } from '@element-plus/icons-vue';
import type { OutboundOrderData } from '@caicang/api-contract';
import { useOutbound } from '../composables/outbound';
import { useInventory } from '../composables/inventory';
import { useTenantStore } from '../stores/tenant';
import {
  carrierName,
  lineShortage,
  outboundFailureText,
  outboundCarriers,
  outboundStatusLabel,
  outboundStatusTone,
  recipientMissing,
  shipFingerprint,
  shortagesOf,
  type OutboundLineForm,
  type ShipPayload,
} from '../api/outbound';
import { formatMoney, formatQuantity, formatUnitCost } from '../api/inventory-format';
import { formatTime } from '../api/package-status';
const route = useRoute(),
  router = useRouter(),
  api = useOutbound(),
  inventory = useInventory(),
  tenants = useTenantStore();
const order = ref<OutboundOrderData | null>(null),
  loading = ref(false),
  error = ref(''),
  serverError = ref(''),
  serverHint = ref(''),
  confirming = ref(false),
  cancelling = ref(false),
  dialog = ref(false),
  refreshing = ref(false);
/** 发货时补充的物流信息；留空就用草稿里的值。 */
const shipForm = ref({ carrierCode: '', trackingNo: '', remark: '' });
const canWrite = computed(() => tenants.current?.permissions.includes('outbound:write') === true);
const isDraft = computed(() => order.value?.status === 'DRAFT');
const orderId = computed(() => String(route.params.id));
const missing = computed(() => (order.value ? recipientMissing(order.value) : []));
/** 用服务端返回的可用数量提示，页面不自己推算库存。 */
const lines = computed<OutboundLineForm[]>(() =>
  (order.value?.items ?? []).map((row) => ({
    key: row.id,
    productId: row.productId,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    quantity: String(row.quantity),
    availableQuantity: row.availableQuantity,
  })),
);
const shortageRows = computed(() => lines.value.filter(lineShortage));
const readyToShip = computed(
  () =>
    isDraft.value &&
    canWrite.value &&
    !!order.value &&
    order.value.items.length > 0 &&
    missing.value.length === 0,
);
let sequence = 0,
  availabilitySequence = 0,
  alive = true,
  /** 同一次发货重试复用同一个操作号，避免"网络超时后重试"变成重复扣减。 */
  operation: { orderId: string; fingerprint: string; id: string } | null = null;

function shipBody(): Omit<ShipPayload, 'clientOperationId'> {
  const body: Omit<ShipPayload, 'clientOperationId'> = {};
  for (const key of ['carrierCode', 'trackingNo', 'remark'] as const) {
    const text = shipForm.value[key].trim();
    if (text) body[key] = text;
  }
  return body;
}
function operationId(id: string, body: Omit<ShipPayload, 'clientOperationId'>): string {
  const fingerprint = shipFingerprint(id, body);
  // 内容变了就换新操作号：服务端会把"同号不同内容"判成 409，这是它的职责。
  if (!operation || operation.orderId !== id || operation.fingerprint !== fingerprint)
    operation = { orderId: id, fingerprint, id: crypto.randomUUID() };
  return operation.id;
}
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  try {
    const result = await api.detail(orderId.value);
    if (version !== sequence) return;
    order.value = result;
    shipForm.value = {
      carrierCode: result.carrierCode ?? '',
      trackingNo: result.trackingNo ?? '',
      remark: result.remark ?? '',
    };
  } catch (e) {
    if (version !== sequence) return;
    error.value = outboundFailureText(e);
    order.value = null;
  } finally {
    if (version === sequence) loading.value = false;
  }
}
/** 打开确认框前重新问一次可用库存：只在页面显示，判定仍由发货事务做。 */
async function refreshAvailability() {
  const current = order.value;
  if (!current) return;
  const version = ++availabilitySequence;
  refreshing.value = true;
  try {
    const pairs = await Promise.all(
      current.items.map(async (row) => {
        try {
          const result = await inventory.balances({
            page: 1,
            pageSize: 1,
            warehouseId: current.warehouseId,
            productId: row.productId,
          });
          return [row.productId, result.data[0]?.quantityOnHand ?? 0] as const;
        } catch {
          return [row.productId, row.availableQuantity] as const;
        }
      }),
    );
    if (version !== availabilitySequence || !order.value) return;
    const known = new Map(pairs);
    order.value = {
      ...order.value,
      items: order.value.items.map((row) => ({
        ...row,
        availableQuantity: known.get(row.productId) ?? row.availableQuantity,
      })),
    };
  } finally {
    if (version === availabilitySequence) refreshing.value = false;
  }
}
async function openShip() {
  if (!order.value) return;
  if (missing.value.length) {
    ElMessage.warning('请先补齐' + missing.value.join('、') + '再发货');
    return;
  }
  serverError.value = '';
  dialog.value = true;
  await refreshAvailability();
}
async function ship() {
  const current = order.value;
  if (!current || confirming.value) return;
  const body = shipBody();
  const id = operationId(current.id, body);
  confirming.value = true;
  serverError.value = '';
  serverHint.value = '';
  try {
    // 库存是否足够由服务端在事务里判断；页面只把结果原样呈现，不做任何本地扣减。
    const result = await api.ship(current.id, { clientOperationId: id, ...body });
    if (!alive) return;
    order.value = result;
    dialog.value = false;
    operation = null;
    serverHint.value =
      `已发货 ${formatQuantity(result.totalQuantity)} 件，出库成本 ${formatMoney(result.totalCost)}；` +
      '库存已在服务端扣减，下方数量是服务器返回的最新余额。';
    ElMessage.success('发货成功，库存已更新');
    await refreshAvailability();
  } catch (e) {
    if (!alive) return;
    // 服务端错误原样显示：库存不足会列出每个 SKU 要多少、只有多少。
    serverError.value = outboundFailureText(e);
    dialog.value = false;
    if (shortagesOf(e).length) await refreshAvailability();
    else if ((e as { code?: string }).code === 'STATUS_CONFLICT') await load();
  } finally {
    confirming.value = false;
  }
}
async function cancel() {
  const current = order.value;
  if (!current || cancelling.value) return;
  try {
    await ElMessageBox.confirm(
      '取消后这张草稿不能再发货，也不会改动任何库存。确定取消？',
      '取消出库草稿 ' + current.outboundNo,
      { confirmButtonText: '取消草稿', cancelButtonText: '保留草稿', type: 'warning' },
    );
  } catch {
    return;
  }
  cancelling.value = true;
  serverError.value = '';
  try {
    const result = await api.cancel(current.id);
    if (!alive) return;
    order.value = result.order;
    serverHint.value = result.cancelled
      ? '草稿已取消，库存未变动。'
      : '这张草稿此前已取消，本次没有产生任何变化。';
    ElMessage.success(result.cancelled ? '草稿已取消' : '草稿此前已取消');
  } catch (e) {
    if (!alive) return;
    serverError.value = outboundFailureText(e);
    await load();
  } finally {
    cancelling.value = false;
  }
}
watch(orderId, load, { immediate: true });
onBeforeUnmount(() => {
  alive = false;
  sequence++;
  availabilitySequence++;
});
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">OUTBOUND DETAILS</span>
        <h1>出库单详情</h1>
        <p class="muted">
          草稿只是计划；确认发货后由服务端在一个事务里扣减库存、写成本快照与流水。
        </p>
      </div>
      <el-button :icon="ArrowLeft" @click="router.push('/outbound')">返回出库管理</el-button>
    </div>
    <el-skeleton v-if="loading && !order" :rows="9" animated class="surface loading-surface" />
    <div v-else-if="error" class="surface catalog-error">
      <el-alert :title="error" type="error" :closable="false" /><el-button @click="load"
        >重试加载</el-button
      >
    </div>
    <template v-else-if="order">
      <div class="surface outbound-detail-head">
        <div>
          <div class="outbound-detail-title">
            <h2>{{ order.outboundNo }}</h2>
            <el-tag :type="outboundStatusTone(order.status)" size="small" effect="light">{{
              outboundStatusLabel(order.status)
            }}</el-tag>
          </div>
          <p class="outbound-meta">
            {{ order.warehouseName }} · 创建人 {{ order.createdByName }} ·
            {{ formatTime(order.createdAt) }}
            <span v-if="order.shippedAt">
              · 发货人 {{ order.shippedByName || '—' }} · {{ formatTime(order.shippedAt) }}</span
            >
          </p>
        </div>
        <div class="outbound-detail-actions">
          <el-button :icon="Refresh" :disabled="loading || confirming" @click="load"
            >刷新</el-button
          >
          <el-button
            v-if="isDraft && canWrite"
            :icon="Edit"
            @click="router.push('/outbound/' + order.id + '/edit')"
            >修改草稿</el-button
          >
          <el-button v-if="isDraft && canWrite" :icon="Close" :loading="cancelling" @click="cancel"
            >取消草稿</el-button
          >
          <el-button
            v-if="isDraft && canWrite"
            type="primary"
            :icon="Promotion"
            :disabled="!readyToShip"
            @click="openShip"
            >{{ confirming ? '正在发货…' : '确认发货' }}</el-button
          >
        </div>
      </div>
      <el-alert
        v-if="serverError"
        :title="serverError"
        type="error"
        :closable="false"
        show-icon
        class="form-alert"
      />
      <el-alert
        v-if="serverHint"
        :title="serverHint"
        type="success"
        :closable="false"
        show-icon
        class="form-alert"
      />
      <el-alert
        v-if="isDraft && !canWrite"
        title="当前角色只能查看出库单，不能发货或取消"
        type="warning"
        :closable="false"
        class="form-alert"
      />
      <el-alert
        v-if="isDraft && canWrite && missing.length"
        :title="'还不能发货：' + missing.join('、') + ' 未填写，请先修改草稿补齐收货信息'"
        type="warning"
        :closable="false"
        class="form-alert"
      />
      <div class="inventory-metrics">
        <div class="surface inventory-metric">
          <p>发货件数</p>
          <strong>{{ formatQuantity(order.totalQuantity) }}</strong>
          <small>{{ order.items.length }} 个 SKU</small>
        </div>
        <div class="surface inventory-metric">
          <p>{{ isDraft ? '预计出库成本' : '出库成本' }}</p>
          <strong>{{ formatMoney(order.totalCost) }}</strong>
          <small>{{ isDraft ? '按发货时的移动平均成本计算' : '成本快照合计' }}</small>
        </div>
        <div class="surface inventory-metric">
          <p>快递公司</p>
          <strong style="font-size: 19px">{{ carrierName(order.carrierCode) }}</strong>
          <small>{{ order.trackingNo || '未填写运单号' }}</small>
        </div>
        <div class="surface inventory-metric">
          <p>状态</p>
          <strong style="font-size: 19px">{{ outboundStatusLabel(order.status) }}</strong>
          <small>{{ order.shippedAt ? formatTime(order.shippedAt) : '库存尚未变动' }}</small>
        </div>
      </div>
      <div class="surface outbound-grid">
        <div class="outbound-panel">
          <div class="inventory-panel-head">
            <div>
              <h3>客户收货信息</h3>
              <p>发货前必须齐全，否则服务端拒绝确认</p>
            </div>
          </div>
          <dl class="outbound-facts">
            <div>
              <dt>收件人</dt>
              <dd>{{ order.customerName || '未填写' }}</dd>
            </div>
            <div>
              <dt>联系电话</dt>
              <dd>{{ order.customerPhone || '未填写' }}</dd>
            </div>
            <div>
              <dt>收件地址</dt>
              <dd>{{ order.customerAddress || '未填写' }}</dd>
            </div>
            <div>
              <dt>备注</dt>
              <dd>{{ order.remark || '未填写' }}</dd>
            </div>
          </dl>
        </div>
        <div class="outbound-panel">
          <div class="inventory-panel-head">
            <div>
              <h3>库存与成本</h3>
              <p>数量来自服务端；草稿没有成本快照</p>
            </div>
          </div>
          <dl class="outbound-facts">
            <div>
              <dt>发货仓库</dt>
              <dd>{{ order.warehouseName }}</dd>
            </div>
            <div>
              <dt>出库单号</dt>
              <dd>{{ order.outboundNo }}</dd>
            </div>
            <div>
              <dt>发货时间</dt>
              <dd>{{ order.shippedAt ? formatTime(order.shippedAt) : '尚未发货' }}</dd>
            </div>
            <div>
              <dt>确认操作号</dt>
              <dd class="outbound-mono">{{ order.confirmOperationId || '尚未发货' }}</dd>
            </div>
          </dl>
        </div>
      </div>
      <div class="surface catalog-panel">
        <div class="inventory-panel-head">
          <div>
            <h3>出库明细</h3>
            <p>可用库存为服务器实时返回；发货后这里显示成本快照</p>
          </div>
          <el-button
            v-if="isDraft"
            link
            type="primary"
            :loading="refreshing"
            @click="refreshAvailability"
            >刷新可用库存</el-button
          >
        </div>
        <el-table :data="lines" row-key="key" stripe>
          <el-table-column label="SKU" width="150" prop="sku" />
          <el-table-column label="商品名称" min-width="200" prop="name" />
          <el-table-column label="数量" width="100" align="right">
            <template #default="{ row }">{{ formatQuantity(row.quantity) }}</template>
          </el-table-column>
          <el-table-column label="单位" width="80" prop="unit" />
          <el-table-column label="可用库存" width="120" align="right">
            <template #default="{ row }">
              <span class="stock-number" :class="{ zero: row.availableQuantity === 0 }">{{
                formatQuantity(row.availableQuantity)
              }}</span>
              <small v-if="lineShortage(row)" class="purchase-field-error">不足</small>
            </template>
          </el-table-column>
          <el-table-column label="成本快照" width="130" align="right">
            <template #default="{ row }">
              {{ row.shippedUnitCost ? formatUnitCost(row.shippedUnitCost) : '—' }}
            </template>
          </el-table-column>
          <el-table-column label="行成本" width="140" align="right">
            <template #default="{ row }">
              {{ row.lineCost ? formatMoney(row.lineCost) : '—' }}
            </template>
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
            >合计数量 <strong>{{ formatQuantity(order.totalQuantity) }}</strong></span
          >
          <span
            >合计成本 <strong>{{ formatMoney(order.totalCost) }}</strong></span
          >
        </div>
      </div>
      <el-dialog v-model="dialog" title="确认发货" width="min(560px, 94vw)">
        <p class="outbound-dialog-lead">
          确认后服务端会扣除库存并写入出库流水，操作不可撤销。库存不足时会被拒绝，数量保持不变。
        </p>
        <el-alert
          v-if="shortageRows.length"
          :title="
            '按当前可用库存发货会被服务端拒绝：' +
            shortageRows.map((row) => row.sku).join('、') +
            '。仍可提交以查看服务端返回的具体差额。'
          "
          type="warning"
          :closable="false"
          class="form-alert"
        />
        <el-form label-position="top">
          <el-form-item label="快递公司">
            <el-select
              v-model="shipForm.carrierCode"
              aria-label="发货快递公司"
              placeholder="未指定"
            >
              <el-option label="未指定" value="" />
              <el-option
                v-for="row in outboundCarriers"
                :key="row.code"
                :label="row.name"
                :value="row.code"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="发货运单号">
            <el-input
              v-model="shipForm.trackingNo"
              :maxlength="128"
              placeholder="可留空，发货后补登"
            />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="shipForm.remark" type="textarea" :rows="2" :maxlength="2000" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button :disabled="confirming" @click="dialog = false">再检查一下</el-button>
          <el-button type="primary" :loading="confirming" @click="ship">确认发货</el-button>
        </template>
      </el-dialog>
    </template>
  </section>
</template>
