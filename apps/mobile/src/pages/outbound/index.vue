<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import type { InventoryBalanceData, OutboundOrderData } from '@caicang/api-contract';
import NetworkBanner from '../../components/NetworkBanner.vue';
import { api, mobileStorage } from '../../api';
import { session, can } from '../../stores/session';
import { ScanGuard } from '../../services/scan';
import {
  findByCode,
  searchStock,
  loadWarehouses,
  normalizeScan,
  stockTone,
} from '../../services/stock';
import {
  CARRIERS,
  OutboundInputError,
  OutboundShipSubmitting,
  addOrIncrementLine,
  buildOutboundDraft,
  carrierName,
  describeShipFailure,
  linesTotalQuantity,
  overStockLines,
  recipientMissing,
  removeLine,
  saveOutboundDraft,
  stepLineQuantity,
  setLineQuantity,
  type OutboundLine,
  type PendingShipment,
  type ShipFailureInfo,
} from '../../services/outbound';
import { appendOperation, readOperations, operationClock } from '../../services/operation-log';
import { errorMessage, toast } from '../../utils/feedback';
import { requireSignIn } from '../../utils/guard';
import { formatTime } from '../../utils/package';

const isApp = typeof (globalThis as Record<string, unknown>).plus !== 'undefined';
const guard = new ScanGuard();
const submitter = new OutboundShipSubmitting(api, mobileStorage);

const warehouseId = ref('');
const warehouses = ref<{ id: string; name: string; code: string }[]>([]);
const lines = ref<OutboundLine[]>([]);
const customerName = ref('');
const customerPhone = ref('');
const customerAddress = ref('');
const carrierCode = ref('SF');
const trackingNo = ref('');
const remark = ref('');

const draft = ref<OutboundOrderData | null>(null);
const draftStale = ref(false);
const result = ref<OutboundOrderData | null>(null);
const failure = ref<ShipFailureInfo | null>(null);
const pending = ref<PendingShipment | null>(null);

const loading = ref(false);
const saving = ref(false);
const shipping = ref(false);
const scanning = ref(false);
const refreshing = ref(false);
const scanningHint = ref('');

const pickerOpen = ref(false);
const pickerKeyword = ref('');
const pickerRows = ref<InventoryBalanceData[]>([]);
const pickerLoading = ref(false);
const pickerError = ref('');

const logs = ref(readOperations(mobileStorage).slice(0, 4));
const totalQuantity = computed(() => linesTotalQuantity(lines.value));
const overStock = computed(() => overStockLines(lines.value));
const missingRecipient = computed(() =>
  recipientMissing({
    customerName: customerName.value,
    customerPhone: customerPhone.value,
    customerAddress: customerAddress.value,
  }),
);
const carrierNames = CARRIERS.map((row) => row.name);
const carrierIndex = computed(() => {
  const index = CARRIERS.findIndex((row) => row.code === carrierCode.value);
  return index >= 0 ? index : 0;
});
const warehouseName = computed(
  () => warehouses.value.find((row) => row.id === warehouseId.value)?.name ?? '',
);
const canWrite = computed(() => can('outbound:write'));
const canSubmit = computed(
  () =>
    !shipping.value &&
    !saving.value &&
    lines.value.length > 0 &&
    (!draft.value || !draftStale.value) &&
    canWrite.value,
);

onShow(async () => {
  if (!(await requireSignIn())) return;
  if (!session.currentTenant) {
    toast('请先选择商家');
    uni.switchTab({ url: '/pages/home/index' });
    return;
  }
  if (!can('outbound:write')) {
    toast('当前账号没有扫码出库权限');
    uni.switchTab({ url: '/pages/home/index' });
    return;
  }
  if (warehouses.value.length === 0) await loadWarehouseList();
});

async function loadWarehouseList(): Promise<void> {
  loading.value = true;
  try {
    warehouses.value = await loadWarehouses(api, session.currentTenant?.tenant.id);
    if (!warehouseId.value && warehouses.value[0]) warehouseId.value = warehouses.value[0].id;
  } catch (error) {
    toast(errorMessage(error));
  } finally {
    loading.value = false;
  }
}

function note(
  title: string,
  detail: string,
  ok: boolean,
  kind: 'receipt' | 'scan' | 'error' = 'scan',
) {
  appendOperation(mobileStorage, { kind, title, detail, ok });
  logs.value = readOperations(mobileStorage).slice(0, 4);
}

/** 内容改动后草稿就过期了：必须先保存，避免"改了数量却发出旧草稿"。 */
function touch(): void {
  if (draft.value) draftStale.value = true;
  failure.value = null;
}

function pickWarehouse(id: string): void {
  if (id === warehouseId.value) return;
  warehouseId.value = id;
  // 换仓库后可用数量变了，已有行的可用量需要重新问服务端，这里先清空避免误导。
  lines.value = lines.value.map((line) => ({ ...line, availableQuantity: 0 }));
  touch();
  if (lines.value.length) void refreshAvailability();
}

function startScan(): void {
  if (scanning.value) return;
  if (!isApp) {
    uni.showModal({
      title: '请在手机 App 中扫码',
      content: '浏览器预览不支持摄像头扫码。可以先用「手动搜索 SKU」添加商品。',
      showCancel: false,
      success: () => openPicker(),
    });
    return;
  }
  if (!warehouseId.value) {
    toast('请先选择发货仓库');
    return;
  }
  scanning.value = true;
  guard.reset();
  uni.scanCode({
    scanType: ['barCode', 'qrCode'],
    onlyFromCamera: true,
    success(res) {
      void handleCode(res.result);
    },
    fail(error) {
      const message = error?.errMsg ?? '';
      if (/cancel/i.test(message)) return;
      if (/auth|permission|denied|权限/i.test(message)) {
        toast('请到系统设置里允许相机权限后再扫码');
        return;
      }
      toast('扫码失败，请重试或手动搜索 SKU');
    },
    complete() {
      scanning.value = false;
    },
  });
}

async function handleCode(raw: string): Promise<void> {
  let code: string;
  try {
    code = normalizeScan(raw);
  } catch (error) {
    toast(errorMessage(error));
    return;
  }
  const gate = guard.begin(code);
  if (gate === 'busy') return;
  if (gate === 'duplicate') {
    toast('刚刚已扫过这个条码，请稍候再扫');
    guard.end();
    return;
  }
  const tenantId = session.currentTenant?.tenant.id;
  scanningHint.value = '正在按条码查询商品…';
  try {
    const found = await findByCode(api, code, { warehouseId: warehouseId.value, tenantId });
    if (found.rows.length === 0) {
      pickerKeyword.value = code;
      openPicker();
      toast('没有找到条码为 ' + code + ' 的商品，可手动搜索 SKU');
      note('扫码未匹配', code, false);
      return;
    }
    // 优先用所选仓库那一行；没有就取第一条，让用户自己决定是否换仓库。
    const row = found.rows.find((item) => item.warehouseId === warehouseId.value) ?? found.rows[0];
    if (!row) {
      toast('没有找到可出库的库存行');
      return;
    }
    addRow(row);
  } catch (error) {
    toast(errorMessage(error));
    note('扫码查询失败', errorMessage(error), false, 'error');
  } finally {
    scanningHint.value = '';
    guard.end();
  }
}

function addRow(row: InventoryBalanceData): void {
  if (row.warehouseId !== warehouseId.value) {
    // 扫到的是别的仓库的库存：提示清楚，不偷偷换仓库。
    toast(
      '这个条码在「' + row.warehouseName + '」有库存，当前仓库是「' + warehouseName.value + '」',
    );
  }
  const before = lines.value.find((line) => line.productId === row.productId);
  try {
    lines.value = addOrIncrementLine(lines.value, row);
  } catch (error) {
    toast(errorMessage(error));
    return;
  }
  touch();
  note(
    before ? '重复扫码累加' : '加入出库单',
    row.sku + ' · ' + row.name + ' → ' + (before ? before.quantity + 1 : 1) + ' 件（未扣库存）',
    true,
  );
}

function openPicker(): void {
  pickerOpen.value = true;
  pickerError.value = '';
  pickerRows.value = [];
  if (pickerKeyword.value.trim()) void runPickerSearch();
}

async function runPickerSearch(): Promise<void> {
  const text = pickerKeyword.value.trim();
  if (!text) {
    pickerError.value = '请输入商品名称、SKU 或条码';
    return;
  }
  pickerLoading.value = true;
  pickerError.value = '';
  try {
    const found = await searchStock(api, {
      text,
      warehouseId: warehouseId.value,
      tenantId: session.currentTenant?.tenant.id,
    });
    pickerRows.value = found.rows;
    if (found.rows.length === 0)
      pickerError.value =
        '没有找到匹配的商品，换个关键词；也可以先到 Web 端确认该商品是否已登记库存。';
  } catch (error) {
    pickerError.value = errorMessage(error);
    pickerRows.value = [];
  } finally {
    pickerLoading.value = false;
  }
}

function chooseFromPicker(row: InventoryBalanceData): void {
  addRow(row);
  pickerOpen.value = false;
}

function closePicker(): void {
  pickerOpen.value = false;
  pickerRows.value = [];
  pickerKeyword.value = '';
}

function minus(row: OutboundLine): void {
  lines.value = stepLineQuantity(lines.value, row.productId, -1);
  touch();
}

function plus(row: OutboundLine): void {
  lines.value = stepLineQuantity(lines.value, row.productId, 1);
  touch();
}

/** uni-app 的 blur 事件在运行时带 detail.value，类型声明却是 FocusEvent，这里显式取值。 */
function editQuantity(row: OutboundLine, event: Event): void {
  const value = (event as unknown as { detail?: { value?: string } }).detail?.value ?? '';
  try {
    lines.value = setLineQuantity(lines.value, row.productId, value);
    touch();
  } catch (error) {
    toast(errorMessage(error));
  }
}

function drop(row: OutboundLine): void {
  lines.value = removeLine(lines.value, row.productId);
  touch();
}

async function refreshAvailability(): Promise<void> {
  const tenantId = session.currentTenant?.tenant.id;
  if (!tenantId || !warehouseId.value || lines.value.length === 0) return;
  refreshing.value = true;
  try {
    const fresh = new Map<string, number>();
    for (const line of lines.value) {
      const found = await searchStockByProduct(line.productId);
      if (found) fresh.set(line.productId, found.quantityOnHand);
    }
    lines.value = lines.value.map((line) => ({
      ...line,
      availableQuantity: fresh.get(line.productId) ?? line.availableQuantity,
    }));
  } catch {
    /* 查询失败不覆盖已有数字：发货时服务端仍会兜底校验。 */
  } finally {
    refreshing.value = false;
  }
}

async function searchStockByProduct(productId: string): Promise<InventoryBalanceData | null> {
  const tenantId = session.currentTenant?.tenant.id;
  if (!tenantId) return null;
  // 手拼查询串：uni-app 的 App 运行时对 URLSearchParams 支持不一致。
  const query =
    'page=1&pageSize=1&productId=' +
    encodeURIComponent(productId) +
    '&warehouseId=' +
    encodeURIComponent(warehouseId.value);
  const response = await api.request<InventoryBalanceData[]>('/inventory/balances?' + query, {
    tenantId,
  });
  return response.data[0] ?? null;
}

async function saveDraft(): Promise<void> {
  if (saving.value || !canWrite.value) return;
  failure.value = null;
  let payload;
  try {
    payload = buildOutboundDraft({
      warehouseId: warehouseId.value,
      lines: lines.value,
      recipient: {
        customerName: customerName.value,
        customerPhone: customerPhone.value,
        customerAddress: customerAddress.value,
      },
      carrierCode: carrierCode.value,
      trackingNo: trackingNo.value,
      remark: remark.value,
      requireRecipient: true,
    });
  } catch (error) {
    toast(error instanceof OutboundInputError ? error.message : errorMessage(error));
    return;
  }
  saving.value = true;
  try {
    const saved = await saveOutboundDraft(api, payload, {
      orderId: draft.value?.id,
      tenantId: session.currentTenant?.tenant.id,
    });
    draft.value = saved;
    draftStale.value = false;
    pending.value = null;
    note(
      '保存出库草稿',
      saved.outboundNo + ' · ' + saved.totalQuantity + ' 件（库存未变动）',
      true,
      'receipt',
    );
    toast(saved.status === 'DRAFT' ? '草稿已保存，库存还未变动' : '出库单状态已更新');
    await refreshAvailability();
  } catch (error) {
    failure.value = describeShipFailure(error);
    toast(errorMessage(error));
    note('保存草稿失败', errorMessage(error), false, 'error');
  } finally {
    saving.value = false;
  }
}

function askShip(): void {
  if (shipping.value) return;
  if (!draft.value) {
    toast('请先保存出库草稿');
    return;
  }
  if (draftStale.value) {
    toast('内容修改过，请先保存草稿再发货');
    return;
  }
  if (missingRecipient.value.length) {
    toast('请先填写' + missingRecipient.value.join('、'));
    return;
  }
  if (overStock.value.length) {
    const detail = overStock.value
      .map((row) => row.sku + ' 发 ' + row.quantity + ' 件、可用 ' + row.availableQuantity + ' 件')
      .join('；');
    uni.showModal({
      title: '可用库存不足',
      content: detail + '。请减少数量并保存草稿，再确认发货。',
      showCancel: false,
      success: () => void refreshAvailability(),
    });
    return;
  }
  const summary = lines.value.map((row) => row.sku + ' ' + row.quantity + row.unit).join('、');
  uni.showModal({
    title: '确认发货 ' + totalQuantity.value + ' 件',
    content:
      '仓库：' +
      warehouseName.value +
      '\n商品：' +
      summary +
      '\n收件人：' +
      customerName.value +
      ' ' +
      customerPhone.value +
      '\n快递：' +
      carrierName(carrierCode.value) +
      (trackingNo.value ? ' · ' + trackingNo.value : '') +
      '\n\n确认后服务端立即扣减库存；网络失败重试不会重复扣减。',
    confirmText: '确认发货',
    cancelText: '再核对',
    success(res) {
      if (res.confirm) void ship();
    },
  });
}

async function ship(): Promise<void> {
  const order = draft.value;
  if (!order || shipping.value) return;
  shipping.value = true;
  failure.value = null;
  const payload = {
    ...(carrierCode.value ? { carrierCode: carrierCode.value } : {}),
    ...(trackingNo.value.trim() ? { trackingNo: trackingNo.value.trim() } : {}),
    ...(remark.value.trim() ? { remark: remark.value.trim() } : {}),
  };
  try {
    const outcome = await submitter.submit(order.id, payload, session.currentTenant?.tenant.id);
    result.value = outcome.order;
    draft.value = null;
    draftStale.value = false;
    pending.value = null;
    note(
      '发货成功',
      outcome.order.outboundNo +
        ' · ' +
        outcome.order.totalQuantity +
        ' 件' +
        (outcome.reused ? '（重试命中同一出库单，未重复扣减）' : ''),
      true,
      'receipt',
    );
  } catch (error) {
    const info = describeShipFailure(error);
    failure.value = info;
    pending.value = submitter.pendingFor(order.id);
    note(info.title, info.message, false, 'error');
    if (info.needsEdit) await refreshAvailability();
    if (info.code === 'STATUS_CONFLICT') await reloadDraft(order.id);
  } finally {
    shipping.value = false;
  }
}

/** 单据在别处被处理过（已发货/已取消）时，把服务端的最新状态取回来。 */
async function reloadDraft(orderId: string): Promise<void> {
  try {
    const response = await api.request<OutboundOrderData>(
      '/outbound-orders/' + encodeURIComponent(orderId),
      { tenantId: session.currentTenant?.tenant.id },
    );
    if (response.data.status !== 'DRAFT') {
      draft.value = null;
      draftStale.value = false;
      toast('这张出库单已经是「' + response.data.status + '」，不能再次发货');
    }
  } catch {
    /* 读不回来就让用户刷新页面，不在本地猜状态。 */
  }
}

function retryShip(): void {
  if (!failure.value || shipping.value) return;
  if (failure.value.needsEdit) {
    failure.value = null;
    return;
  }
  if (!draft.value) {
    toast('请先保存出库草稿');
    return;
  }
  void ship();
}

function startNew(): void {
  result.value = null;
  failure.value = null;
  pending.value = null;
  lines.value = [];
  customerName.value = '';
  customerPhone.value = '';
  customerAddress.value = '';
  trackingNo.value = '';
  remark.value = '';
  draft.value = null;
  draftStale.value = false;
}

function goHome(): void {
  uni.switchTab({ url: '/pages/home/index' });
}

function goStock(): void {
  uni.navigateTo({ url: '/pages/stock/index' });
}

function onCarrierChange(event: { detail: { value: number | string } }): void {
  const index = Number(event.detail.value);
  carrierCode.value = CARRIERS[index]?.code ?? 'SF';
  touch();
}

function ago(at: number): string {
  return operationClock(at);
}
</script>

<template>
  <view class="outbound">
    <NetworkBanner />

    <view class="hero">
      <text class="hero-title">扫码出库</text>
      <text class="hero-sub">扫码或搜索商品 → 填数量与收件信息 → 两次确认后才扣库存</text>
      <view v-if="warehouseName" class="hero-tag">
        <text class="hero-tag-text">{{ warehouseName }}</text>
      </view>
    </view>

    <view class="container">
      <!-- 发货成功：只展示服务端返回的单据 -->
      <template v-if="result">
        <view class="card success">
          <text class="success-glyph">✓</text>
          <text class="success-title">发货成功</text>
          <text class="success-qty">本次出库 {{ result.totalQuantity }} 件</text>
          <text class="success-no">{{ result.outboundNo }}</text>
          <text class="success-time"
            >{{ formatTime(result.shippedAt) }} · 出库成本 ¥{{ result.totalCost }}</text
          >
          <view class="success-lines">
            <view v-for="item in result.items" :key="item.id" class="success-line">
              <text class="success-line-name">{{ item.name }}</text>
              <text class="success-line-qty">{{ item.quantity }} {{ item.unit }}</text>
            </view>
          </view>
          <text class="success-note">库存已在服务端扣减，下面显示的数量是该商品的最新余额。</text>
        </view>

        <view class="card">
          <text class="card-title">发货后库存</text>
          <view v-for="item in result.items" :key="'stock-' + item.id" class="stock-line">
            <text class="stock-line-sku">{{ item.sku }}</text>
            <text class="stock-line-qty" :class="'qty-' + stockTone(item.availableQuantity)"
              >剩余 {{ item.availableQuantity }} {{ item.unit }}</text
            >
          </view>
          <text class="card-hint">Web 端「出库管理」和「商品库存」刷新后看到的是同一笔记录。</text>
        </view>

        <button class="btn-primary action" @click="startNew">继续出库</button>
        <button class="btn-ghost action" @click="goStock">查看库存</button>
        <button class="btn-ghost action" @click="goHome">返回首页</button>
      </template>

      <template v-else>
        <view v-if="!canWrite" class="card panel">
          <text class="panel-title">没有出库权限</text>
          <text class="panel-text">当前账号在当前商家不能发货，请联系管理员。</text>
        </view>

        <template v-else>
          <view class="card">
            <view class="card-head">
              <text class="card-title">1. 目标仓库</text>
              <text class="card-meta">库存按仓库扣减</text>
            </view>
            <view v-if="loading" class="card-hint">正在读取仓库…</view>
            <view v-else-if="warehouses.length === 0" class="card-hint"
              >没有可用仓库，请先到 Web 端创建仓库。</view
            >
            <view v-else class="chips">
              <text
                v-for="row in warehouses"
                :key="row.id"
                class="chip"
                :class="{ 'chip-on': row.id === warehouseId }"
                @click="pickWarehouse(row.id)"
                >{{ row.name }}</text
              >
            </view>
          </view>

          <view class="card">
            <view class="card-head">
              <text class="card-title">2. 扫描 / 搜索商品</text>
              <text class="card-meta">{{ lines.length }} 个 SKU</text>
            </view>
            <button class="btn-scan" :disabled="scanning || !warehouseId" @click="startScan">
              {{ scanning ? '正在扫码…' : '扫描商品条码' }}
            </button>
            <text v-if="scanningHint" class="scan-hint">{{ scanningHint }}</text>
            <button class="btn-ghost scan-alt" @click="openPicker">没有条码？手动搜索 SKU</button>
            <text class="card-hint"
              >重复扫描同一商品会累加待发数量，数据库库存只在确认发货后变动。</text
            >
          </view>

          <view v-if="lines.length" class="card">
            <view class="card-head">
              <text class="card-title">3. 待出库商品</text>
              <text class="card-meta">合计 {{ totalQuantity }} 件</text>
            </view>
            <view v-for="row in lines" :key="row.productId" class="line">
              <view class="line-head">
                <view class="line-text">
                  <text class="line-name">{{ row.name }}</text>
                  <text class="line-meta"
                    >{{ row.sku }} · 可用 {{ row.availableQuantity }} {{ row.unit }}</text
                  >
                </view>
                <text class="line-remove" @click="drop(row)">移除</text>
              </view>
              <view class="line-qty">
                <text class="step" @click="minus(row)">−</text>
                <input
                  class="qty-input"
                  type="number"
                  :value="String(row.quantity)"
                  @blur="editQuantity(row, $event)"
                />
                <text class="step" @click="plus(row)">+</text>
                <text class="line-unit">{{ row.unit }}</text>
                <text v-if="row.quantity > row.availableQuantity" class="line-warn"
                  >超过可用库存</text
                >
              </view>
            </view>
            <text class="card-hint">数量只存在本页，未提交前不会影响任何仓库库存。</text>
          </view>

          <view class="card">
            <view class="card-head">
              <text class="card-title">4. 客户与快递</text>
              <text class="card-meta">发货必填收货信息</text>
            </view>
            <view class="field">
              <text class="field-label">收件人</text>
              <input
                v-model="customerName"
                class="field-input"
                placeholder="客户姓名"
                :maxlength="100"
              />
            </view>
            <view class="field">
              <text class="field-label">联系电话</text>
              <input
                v-model="customerPhone"
                class="field-input"
                type="text"
                placeholder="手机号或带区号座机"
                :maxlength="50"
              />
            </view>
            <view class="field">
              <text class="field-label">收件地址</text>
              <textarea
                v-model="customerAddress"
                class="field-textarea"
                placeholder="省、市、区及详细地址"
                :maxlength="500"
              />
            </view>
            <view class="field">
              <text class="field-label">快递公司</text>
              <picker
                mode="selector"
                :range="carrierNames"
                :value="carrierIndex"
                @change="onCarrierChange"
              >
                <view class="field-picker">{{ carrierNames[carrierIndex] }}</view>
              </picker>
            </view>
            <view class="field">
              <text class="field-label">发货运单号</text>
              <input
                v-model="trackingNo"
                class="field-input"
                placeholder="可留空，前导零会原样保存"
                :maxlength="128"
              />
            </view>
            <view class="field">
              <text class="field-label">备注</text>
              <input
                v-model="remark"
                class="field-input"
                placeholder="打包说明、客户要求等"
                :maxlength="2000"
              />
            </view>
            <text v-if="missingRecipient.length" class="field-warn"
              >尚未填写：{{ missingRecipient.join('、') }}</text
            >
          </view>

          <view v-if="failure" class="card failure">
            <text class="failure-title">{{ failure.title }}</text>
            <text class="failure-text">{{ failure.message }}</text>
            <view v-if="failure.shortages.length" class="failure-rows">
              <view v-for="row in failure.shortages" :key="row.productId" class="failure-row">
                <text class="failure-sku">{{ row.sku }}</text>
                <text class="failure-num"
                  >需要 {{ row.requestedQuantity }} · 可用 {{ row.availableQuantity }}</text
                >
              </view>
            </view>
            <button v-if="failure.retryable" class="btn-ghost panel-action" @click="retryShip">
              {{ failure.needsEdit ? '返回修改数量' : '重试发货（复用同一操作号）' }}
            </button>
          </view>

          <view v-if="pending" class="banner">
            <text class="banner-title">上次发货未确认</text>
            <text class="banner-text"
              >已重试
              {{ pending.attempts }} 次。再次发货会复用同一操作号，服务端只会扣一次库存。</text
            >
          </view>

          <view v-if="draft" class="card draft">
            <view class="card-head">
              <text class="card-title">出库草稿</text>
              <text class="draft-status">待发货</text>
            </view>
            <text class="draft-no">{{ draft.outboundNo }}</text>
            <text class="draft-meta"
              >{{ draft.warehouseName }} · {{ draft.totalQuantity }} 件 · 成本 ¥{{
                draft.totalCost
              }}</text
            >
            <text v-if="draftStale" class="draft-stale">内容已修改，请先更新草稿再发货。</text>
            <text v-else class="card-hint">草稿不会改动库存，确认发货后才扣减。</text>
          </view>

          <view class="actions">
            <button
              class="btn-ghost"
              :disabled="saving || lines.length === 0 || !canWrite"
              @click="saveDraft"
            >
              {{ saving ? '保存中…' : draft ? '更新草稿' : '创建出库草稿' }}
            </button>
            <button class="btn-primary" :disabled="!canSubmit" @click="askShip">
              {{ shipping ? '正在发货…' : '确认发货' }}
            </button>
          </view>
          <text class="actions-hint"
            >「确认发货」会先弹出核对窗口，确认后才调用服务端出库事务，库存立即扣减。</text
          >

          <view v-if="logs.length" class="card logs">
            <text class="card-title">最近操作</text>
            <view v-for="entry in logs" :key="entry.at + entry.title" class="log-row">
              <text class="log-time">{{ ago(entry.at) }}</text>
              <text class="log-text" :class="{ 'log-bad': !entry.ok }"
                >{{ entry.title }} · {{ entry.detail }}</text
              >
            </view>
          </view>
        </template>
      </template>
    </view>

    <!-- 手动搜索兜底：商品没登记条码时用 -->
    <view v-if="pickerOpen" class="overlay" @click.self="closePicker">
      <view class="sheet">
        <view class="sheet-head">
          <text class="sheet-title">手动搜索商品</text>
          <text class="sheet-close" @click="closePicker">关闭</text>
        </view>
        <view class="sheet-search">
          <input
            v-model="pickerKeyword"
            class="sheet-input"
            placeholder="商品名称、SKU 或条码"
            :maxlength="200"
            confirm-type="search"
            @confirm="runPickerSearch"
          />
          <button class="sheet-btn" :disabled="pickerLoading" @click="runPickerSearch">搜索</button>
        </view>
        <text v-if="pickerError" class="sheet-error">{{ pickerError }}</text>
        <scroll-view class="sheet-list" scroll-y>
          <view
            v-for="row in pickerRows"
            :key="row.productId + row.warehouseId"
            class="sheet-row"
            @click="chooseFromPicker(row)"
          >
            <view class="sheet-row-text">
              <text class="sheet-row-name">{{ row.name }}</text>
              <text class="sheet-row-meta"
                >{{ row.sku }} · {{ row.warehouseName }} · 可用 {{ row.quantityOnHand }}</text
              >
            </view>
            <text class="sheet-row-add">加入</text>
          </view>
          <text v-if="!pickerLoading && pickerRows.length === 0 && !pickerError" class="sheet-empty"
            >输入关键词后点搜索；这里只显示该仓库有库存记录的商品。</text
          >
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.outbound {
  min-height: 100vh;
}

.hero {
  padding: 40rpx 32rpx 48rpx;
  background: linear-gradient(150deg, #17382d 0%, #235542 100%);
}

.hero-title {
  display: block;
  color: #ffffff;
  font-size: 44rpx;
  font-weight: 700;
}

.hero-sub {
  display: block;
  margin-top: 10rpx;
  color: #cfe3d8;
  font-size: 26rpx;
  line-height: 1.5;
}

.hero-tag {
  display: inline-block;
  margin-top: 20rpx;
  padding: 8rpx 24rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.16);
}

.hero-tag-text {
  color: #e7f2ec;
  font-size: 24rpx;
}

.card {
  margin-top: 24rpx;
}

.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.card-title {
  font-size: 30rpx;
  font-weight: 600;
}

.card-meta {
  color: #7b8b83;
  font-size: 24rpx;
}

.card-hint {
  display: block;
  margin-top: 14rpx;
  color: #8a9a91;
  font-size: 24rpx;
  line-height: 1.6;
}

.chips {
  display: flex;
  flex-wrap: wrap;
}

.chip {
  margin: 0 14rpx 14rpx 0;
  padding: 12rpx 26rpx;
  border-radius: 999rpx;
  background: #f2f6f4;
  color: #4f6a5e;
  font-size: 26rpx;
}

.chip-on {
  background: #17382d;
  color: #ffffff;
}

.btn-scan {
  height: 92rpx;
  line-height: 92rpx;
  border-radius: 16rpx;
  background: #17382d;
  color: #ffffff;
  font-size: 32rpx;
  text-align: center;
}

.scan-alt {
  margin-top: 16rpx;
}

.scan-hint {
  display: block;
  margin-top: 12rpx;
  color: #6b7f75;
  font-size: 24rpx;
}

.line {
  padding: 20rpx 0;
  border-bottom: 1rpx solid #eef2f0;
}

.line:last-of-type {
  border-bottom: none;
}

.line-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.line-text {
  flex: 1;
  padding-right: 16rpx;
}

.line-name {
  display: block;
  font-size: 29rpx;
  font-weight: 600;
}

.line-meta {
  display: block;
  margin-top: 6rpx;
  color: #7b8b83;
  font-size: 24rpx;
}

.line-remove {
  color: #b5483f;
  font-size: 24rpx;
}

.line-qty {
  display: flex;
  align-items: center;
  margin-top: 16rpx;
}

.step {
  width: 64rpx;
  height: 64rpx;
  line-height: 60rpx;
  text-align: center;
  border-radius: 12rpx;
  border: 2rpx solid #cfdbd4;
  font-size: 34rpx;
  color: #17382d;
}

.qty-input {
  width: 120rpx;
  height: 64rpx;
  margin: 0 12rpx;
  text-align: center;
  border-radius: 12rpx;
  background: #f2f6f4;
  font-size: 30rpx;
}

.line-unit {
  margin-left: 12rpx;
  color: #7b8b83;
  font-size: 24rpx;
}

.line-warn {
  margin-left: 16rpx;
  color: #b5483f;
  font-size: 24rpx;
}

.field {
  display: flex;
  align-items: center;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #eef2f0;
}

.field:last-of-type {
  border-bottom: none;
}

.field-label {
  width: 170rpx;
  color: #4f6a5e;
  font-size: 26rpx;
}

.field-input {
  flex: 1;
  height: 64rpx;
  font-size: 28rpx;
}

.field-textarea {
  flex: 1;
  height: 120rpx;
  font-size: 28rpx;
  line-height: 1.5;
}

.field-picker {
  flex: 1;
  height: 64rpx;
  line-height: 64rpx;
  font-size: 28rpx;
  color: #17382d;
}

.field-warn {
  display: block;
  margin-top: 12rpx;
  color: #b5483f;
  font-size: 24rpx;
}

.failure {
  border: 2rpx solid #e6b4ae;
}

.failure-title {
  display: block;
  color: #b5483f;
  font-size: 30rpx;
  font-weight: 600;
}

.failure-text {
  display: block;
  margin-top: 12rpx;
  color: #6b7f75;
  font-size: 26rpx;
  line-height: 1.6;
}

.failure-rows {
  margin-top: 16rpx;
}

.failure-row {
  display: flex;
  justify-content: space-between;
  padding: 8rpx 0;
}

.failure-sku {
  font-size: 26rpx;
  color: #3d574c;
}

.failure-num {
  font-size: 26rpx;
  color: #b5483f;
}

.banner {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background: #fdf0e3;
}

.banner-title {
  display: block;
  color: #8a5a1f;
  font-size: 27rpx;
  font-weight: 600;
}

.banner-text {
  display: block;
  margin-top: 8rpx;
  color: #8a5a1f;
  font-size: 25rpx;
  line-height: 1.6;
}

.draft {
  border: 2rpx solid #cfdbd4;
}

.draft-status {
  color: #b9873f;
  font-size: 24rpx;
}

.draft-no {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
}

.draft-meta {
  display: block;
  margin-top: 8rpx;
  color: #6b7f75;
  font-size: 25rpx;
}

.draft-stale {
  display: block;
  margin-top: 12rpx;
  color: #b5483f;
  font-size: 25rpx;
}

.actions {
  display: flex;
  margin-top: 32rpx;
}

.actions button {
  flex: 1;
  height: 92rpx;
  line-height: 92rpx;
  border-radius: 16rpx;
  font-size: 30rpx;
  text-align: center;
}

.actions button:first-child {
  margin-right: 16rpx;
}

.btn-primary {
  background: #17382d;
  color: #ffffff;
}

.btn-ghost {
  border: 2rpx solid #cfdbd4;
  color: #3d574c;
}

.btn-primary[disabled],
.btn-ghost[disabled],
.btn-scan[disabled] {
  opacity: 0.45;
}

.actions-hint {
  display: block;
  margin-top: 16rpx;
  color: #8a9a91;
  font-size: 24rpx;
  line-height: 1.6;
}

.logs {
  margin-top: 28rpx;
}

.log-row {
  display: flex;
  margin-top: 12rpx;
}

.log-time {
  width: 130rpx;
  color: #9aa89f;
  font-size: 23rpx;
}

.log-text {
  flex: 1;
  color: #6b7f75;
  font-size: 23rpx;
  line-height: 1.5;
}

.log-bad {
  color: #b5483f;
}

.panel {
  margin-top: 24rpx;
}

.panel-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
}

.panel-text {
  display: block;
  margin-top: 12rpx;
  color: #6b7f75;
  font-size: 26rpx;
  line-height: 1.6;
}

.panel-action {
  margin-top: 20rpx;
}

.success {
  margin-top: 24rpx;
  text-align: center;
}

.success-glyph {
  display: block;
  color: #17694c;
  font-size: 68rpx;
}

.success-title {
  display: block;
  margin-top: 8rpx;
  font-size: 36rpx;
  font-weight: 700;
}

.success-qty {
  display: block;
  margin-top: 12rpx;
  font-size: 32rpx;
  color: #17694c;
}

.success-no {
  display: block;
  margin-top: 12rpx;
  font-size: 28rpx;
  color: #3d574c;
}

.success-time {
  display: block;
  margin-top: 6rpx;
  color: #8a9a91;
  font-size: 24rpx;
}

.success-lines {
  margin-top: 24rpx;
  text-align: left;
}

.success-line {
  display: flex;
  justify-content: space-between;
  padding: 10rpx 0;
  border-bottom: 1rpx solid #eef2f0;
}

.success-line-name {
  font-size: 26rpx;
  color: #33453c;
}

.success-line-qty {
  font-size: 26rpx;
  font-weight: 600;
}

.success-note {
  display: block;
  margin-top: 18rpx;
  color: #8a9a91;
  font-size: 24rpx;
  line-height: 1.6;
}

.stock-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 0;
  border-bottom: 1rpx solid #eef2f0;
}

.stock-line-sku {
  font-size: 26rpx;
  color: #3d574c;
}

.stock-line-qty {
  font-size: 26rpx;
  font-weight: 600;
}

.qty-ok {
  color: #17694c;
}

.qty-warn {
  color: #b9873f;
}

.qty-empty {
  color: #b3bcc6;
}

.action {
  margin-top: 20rpx;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 16rpx;
  font-size: 30rpx;
  text-align: center;
}

.overlay {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(11, 30, 24, 0.45);
  display: flex;
  align-items: flex-end;
  z-index: 20;
}

.sheet {
  width: 100%;
  max-height: 78vh;
  padding: 32rpx 32rpx 48rpx;
  border-radius: 28rpx 28rpx 0 0;
  background: #ffffff;
  box-sizing: border-box;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sheet-title {
  font-size: 32rpx;
  font-weight: 600;
}

.sheet-close {
  color: #6b7f75;
  font-size: 26rpx;
}

.sheet-search {
  display: flex;
  align-items: center;
  margin-top: 20rpx;
}

.sheet-input {
  flex: 1;
  height: 80rpx;
  padding: 0 20rpx;
  border-radius: 14rpx;
  background: #f2f6f4;
  font-size: 28rpx;
}

.sheet-btn {
  margin-left: 12rpx;
  min-width: 120rpx;
  height: 80rpx;
  line-height: 80rpx;
  border-radius: 14rpx;
  background: #17382d;
  color: #ffffff;
  font-size: 28rpx;
  text-align: center;
}

.sheet-error {
  display: block;
  margin-top: 14rpx;
  color: #b5483f;
  font-size: 24rpx;
  line-height: 1.6;
}

.sheet-list {
  margin-top: 16rpx;
  max-height: 52vh;
}

.sheet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #eef2f0;
}

.sheet-row-text {
  flex: 1;
  padding-right: 16rpx;
}

.sheet-row-name {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
}

.sheet-row-meta {
  display: block;
  margin-top: 6rpx;
  color: #7b8b83;
  font-size: 23rpx;
}

.sheet-row-add {
  color: #2f6f57;
  font-size: 26rpx;
}

.sheet-empty {
  display: block;
  margin-top: 24rpx;
  color: #8a9a91;
  font-size: 24rpx;
  line-height: 1.6;
}
</style>
