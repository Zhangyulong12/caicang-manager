<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import type { PackageData, PackageReceivableData, ReceiptData } from '@caicang/api-contract';
import NetworkBanner from '../../components/NetworkBanner.vue';
import { api, mobileStorage } from '../../api';
import { session, can } from '../../stores/session';
import {
  MAX_REMARK_LENGTH,
  ReceiptSubmitting,
  buildReceiptDraft,
  describeReceiptFailure,
  receivingBlockedReason,
  toReceivableRows,
  type PendingOperation,
  type ReceiptDraft,
  type ReceiptFailureInfo,
  type ReceivableRow,
} from '../../services/receiving';
import { appendOperation, readOperations, operationClock } from '../../services/operation-log';
import { errorMessage, toast } from '../../utils/feedback';
import { requireSignIn } from '../../utils/guard';
import {
  formatTime,
  packageStatusNames,
  purchaseStatusNames,
  receivingStatusNames,
} from '../../utils/package';

interface EditableRow extends ReceivableRow {
  qty: string;
}

const submitter = new ReceiptSubmitting(api, mobileStorage);

const packageId = ref('');
const detail = ref<PackageData | null>(null);
const receivable = ref<PackageReceivableData | null>(null);
const rows = ref<EditableRow[]>([]);
const remark = ref('');
const loading = ref(false);
const submitting = ref(false);
const loadError = ref('');
const formError = ref('');
const failure = ref<ReceiptFailureInfo | null>(null);
const result = ref<ReceiptData | null>(null);
const reusedReceipt = ref(false);
const pending = ref<PendingOperation | null>(null);
const logs = ref(readOperations(mobileStorage).slice(0, 5));

const blockedReason = computed(() =>
  receivable.value ? receivingBlockedReason(receivable.value) : null,
);
const closed = computed(() => {
  if (!receivable.value) return false;
  return (
    receivable.value.receivingClosed ||
    receivable.value.receivingStatus === 'RECEIVED' ||
    receivable.value.packageStatus === 'RECEIVED'
  );
});
const totalQuantity = computed(() =>
  rows.value.reduce((sum, row) => sum + quantityOrZero(row.qty), 0),
);
const filledLines = computed(() => rows.value.filter((row) => quantityOrZero(row.qty) > 0).length);
const remarkLeft = computed(() => MAX_REMARK_LENGTH - remark.value.length);

function quantityOrZero(raw: string): number {
  const text = String(raw ?? '').trim();
  if (!text) return 0;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

onLoad((options) => {
  packageId.value = String(options?.id ?? '');
});

onShow(async () => {
  if (!(await requireSignIn())) return;
  if (!packageId.value) {
    loadError.value = '缺少包裹编号，请返回重新扫码';
    return;
  }
  if (!session.currentTenant) {
    toast('请先选择商家');
    uni.switchTab({ url: '/pages/home/index' });
    return;
  }
  if (!can('receiving:confirm')) {
    toast('当前账号没有确认收货权限');
    uni.switchTab({ url: '/pages/home/index' });
    return;
  }
  if (!receivable.value) await load();
});

async function load(): Promise<void> {
  if (loading.value) return;
  const tenantId = session.currentTenant?.tenant.id;
  if (!tenantId) return;
  loading.value = true;
  loadError.value = '';
  try {
    const [pkg, recv] = await Promise.all([
      api.request<PackageData>('/packages/' + encodeURIComponent(packageId.value), { tenantId }),
      api.request<PackageReceivableData>(
        '/packages/' + encodeURIComponent(packageId.value) + '/receivable',
        { tenantId },
      ),
    ]);
    detail.value = pkg.data;
    receivable.value = recv.data;
    rows.value = toReceivableRows(recv.data).map((row) => ({
      ...row,
      qty: row.maxReceivableQuantity > 0 ? String(row.suggestedQuantity) : '',
    }));
    pending.value = submitter.pendingFor(packageId.value);
  } catch (error) {
    loadError.value = errorMessage(error);
    appendOperation(mobileStorage, {
      kind: 'error',
      title: '读取可收明细失败',
      detail: loadError.value,
      ok: false,
    });
    logs.value = readOperations(mobileStorage).slice(0, 5);
  } finally {
    loading.value = false;
  }
}

function fillMax(row: EditableRow): void {
  row.qty = String(row.maxReceivableQuantity);
}

function clearAll(): void {
  for (const row of rows.value) row.qty = '';
  formError.value = '';
}

function validate(): ReceiptDraft | null {
  formError.value = '';
  for (const row of rows.value) {
    const text = String(row.qty ?? '').trim();
    if (!text) continue;
    if (!/^\d+$/.test(text)) {
      formError.value = row.name + '：数量只能填整数';
      return null;
    }
    const value = Number(text);
    if (value > row.maxReceivableQuantity) {
      formError.value =
        row.name +
        '：本次最多可收 ' +
        row.maxReceivableQuantity +
        ' ' +
        row.unit +
        '（已入库 ' +
        row.receivedQuantity +
        ' / 订购 ' +
        row.orderedQuantity +
        '）';
      return null;
    }
  }
  try {
    const draft = buildReceiptDraft({
      packageId: packageId.value,
      lines: rows.value.map((row) => ({
        purchaseOrderItemId: row.purchaseOrderItemId,
        quantity: row.qty,
      })),
      remark: remark.value,
    });
    return draft;
  } catch (error) {
    formError.value = errorMessage(error);
    return null;
  }
}

function askConfirm(): void {
  if (submitting.value) return;
  if (blockedReason.value) {
    toast(blockedReason.value);
    return;
  }
  const draft = validate();
  if (!draft) return;
  const summary = draft.items
    .map((item) => {
      const row = rows.value.find((line) => line.purchaseOrderItemId === item.purchaseOrderItemId);
      return (row?.name ?? '商品') + ' ' + item.receivedQty + (row?.unit ?? '件');
    })
    .join('、');
  uni.showModal({
    title: '确认入库 ' + totalQuantity.value + ' 件',
    content:
      summary +
      (draft.remark ? '\n备注：' + draft.remark : '') +
      '\n\n确认后库存立即增加；网络失败重试不会重复入库。',
    confirmText: '确认入库',
    cancelText: '再核对',
    success(res) {
      if (res.confirm) void submit(draft);
    },
  });
}

async function submit(draft: ReceiptDraft): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  formError.value = '';
  failure.value = null;
  const tenantId = session.currentTenant?.tenant.id;
  const total = draft.items.reduce((sum, item) => sum + item.receivedQty, 0);
  appendOperation(mobileStorage, {
    kind: 'receipt',
    title: '提交入库',
    detail: '本次 ' + total + ' 件，' + draft.items.length + ' 个商品',
    ok: true,
  });
  logs.value = readOperations(mobileStorage).slice(0, 5);
  try {
    const outcome = await submitter.submit(draft, tenantId);
    result.value = outcome.receipt;
    reusedReceipt.value = outcome.reused;
    pending.value = null;
    appendOperation(mobileStorage, {
      kind: 'receipt',
      title: '入库成功',
      detail:
        outcome.receipt.receiptNo +
        ' · ' +
        outcome.receipt.totalQuantity +
        ' 件' +
        (outcome.reused ? '（重试命中同一入库单，未重复加库存）' : ''),
      ok: true,
    });
  } catch (error) {
    const info = describeReceiptFailure(error);
    failure.value = info;
    pending.value = submitter.pendingFor(packageId.value);
    appendOperation(mobileStorage, {
      kind: 'error',
      title: info.title,
      detail: info.message,
      ok: false,
    });
    // 数量类错误必须重新拉一次上限，避免用户按旧数字反复试。
    if (info.needsEdit) await refreshReceivable();
  } finally {
    submitting.value = false;
    logs.value = readOperations(mobileStorage).slice(0, 5);
  }
}

async function refreshReceivable(): Promise<void> {
  const tenantId = session.currentTenant?.tenant.id;
  if (!tenantId) return;
  try {
    const recv = await api.request<PackageReceivableData>(
      '/packages/' + encodeURIComponent(packageId.value) + '/receivable',
      { tenantId },
    );
    receivable.value = recv.data;
    const latest = new Map(
      toReceivableRows(recv.data).map((row) => [row.purchaseOrderItemId, row]),
    );
    rows.value = rows.value.map((row) => {
      const fresh = latest.get(row.purchaseOrderItemId);
      if (!fresh) return { ...row, maxReceivableQuantity: 0, qty: '' };
      const qty = quantityOrZero(row.qty);
      return {
        ...fresh,
        qty: qty > fresh.maxReceivableQuantity ? String(fresh.maxReceivableQuantity) : row.qty,
      };
    });
  } catch {
    /* 刷新失败不覆盖用户已填内容，提交时服务端仍会兜底校验。 */
  }
}

function retry(): void {
  if (!failure.value || submitting.value) return;
  if (failure.value.needsEdit) {
    failure.value = null;
    return;
  }
  const draft = validate();
  if (!draft) return;
  void submit(draft);
}

function modify(): void {
  failure.value = null;
}

function continueScan(): void {
  uni.navigateBack({
    delta: 2,
    fail: () => {
      uni.redirectTo({ url: '/pages/scan/index' });
    },
  });
}

function goRecords(): void {
  uni.switchTab({ url: '/pages/records/index' });
}

function goHome(): void {
  uni.switchTab({ url: '/pages/home/index' });
}
</script>

<template>
  <view class="receiving">
    <NetworkBanner />

    <view v-if="detail" class="hero">
      <text class="hero-kicker">
        {{ detail.purchaseOrderNo }} · {{ purchaseStatusNames[detail.purchaseStatus] }}
      </text>
      <text class="hero-code">{{ detail.trackingNo || '未填写运单号' }}</text>
      <view class="hero-tags">
        <text class="tag">{{ detail.carrierCode ?? '未填写承运商' }}</text>
        <text class="tag">{{ packageStatusNames[detail.status] }}</text>
        <text class="tag">{{ receivingStatusNames[detail.receivingStatus] }}</text>
      </view>
    </view>

    <view class="container body">
      <view v-if="loading" class="card panel">
        <text class="panel-text">正在读取采购单与可收数量…</text>
      </view>

      <view v-if="loadError" class="card panel">
        <text class="panel-title">无法打开收货页</text>
        <text class="panel-text">{{ loadError }}</text>
        <button class="btn btn-primary panel-action" @click="load">重试</button>
        <button class="btn btn-ghost panel-action" @click="goHome">返回首页</button>
      </view>

      <!-- 成功：只展示服务端返回的入库单，本次库存已经落库 -->
      <template v-if="result">
        <view class="card success">
          <text class="success-glyph">✓</text>
          <text class="success-title">入库成功</text>
          <text class="success-qty">本次入库 {{ result.totalQuantity }} 件</text>
          <text class="success-no">{{ result.receiptNo }}</text>
          <text class="success-time">{{ formatTime(result.receivedAt) }}</text>
          <view class="success-lines">
            <view v-for="item in result.items" :key="item.id" class="success-line">
              <text class="success-line-name">{{ item.name }}</text>
              <text class="success-line-qty">{{ item.quantity }} {{ item.unit }}</text>
            </view>
          </view>
          <text v-if="reusedReceipt" class="success-note">
            这次是网络重试，服务端返回的是同一张入库单，库存没有重复增加。
          </text>
        </view>

        <button class="btn btn-primary action" @click="continueScan">继续扫下一包裹</button>
        <button class="btn btn-ghost action" @click="goRecords">查看入库记录</button>
        <button class="btn btn-ghost action" @click="goHome">返回首页</button>
      </template>

      <!-- 表单 -->
      <template v-else-if="receivable">
        <view v-if="blockedReason" class="card panel">
          <text class="panel-title">{{ closed ? '包裹已验收完成' : '当前不能收货' }}</text>
          <text class="panel-text">{{ blockedReason }}</text>
          <button class="btn btn-ghost panel-action" @click="goRecords">查看入库记录</button>
          <button class="btn btn-ghost panel-action" @click="goHome">返回首页</button>
        </view>

        <template v-else>
          <view v-if="pending" class="banner">
            <text class="banner-title">上次提交未完成</text>
            <text class="banner-text">
              已重试 {{ pending.attempts }} 次。继续提交会复用同一操作号，不会重复增加库存。
            </text>
          </view>

          <view class="card summary">
            <view class="summary-row">
              <text class="summary-label">采购单</text>
              <text class="summary-value">{{ receivable.purchaseOrderNo }}</text>
            </view>
            <view class="summary-row">
              <text class="summary-label">快递</text>
              <text class="summary-value">
                {{ detail?.carrierCode ?? '未填写' }} · {{ detail?.trackingNo ?? '无运单号' }}
              </text>
            </view>
            <view class="summary-row">
              <text class="summary-label">收货方式</text>
              <text class="summary-value">
                {{ receivable.hasPlan ? '按包裹预计明细验收' : '按采购单剩余商品验收' }}
              </text>
            </view>
          </view>

          <view class="section-head">
            <text class="section-title">本次到货</text>
            <text class="section-meta">{{ filledLines }} / {{ rows.length }} 个商品</text>
          </view>

          <view v-for="row in rows" :key="row.purchaseOrderItemId" class="card item">
            <view class="item-head">
              <text class="item-name">{{ row.name }}</text>
              <text v-if="row.maxReceivableQuantity <= 0 && !closed" class="item-done">已收完</text>
            </view>
            <text class="item-meta">{{ row.sku }} · 单位 {{ row.unit }}</text>
            <view class="item-nums">
              <view class="num-cell">
                <text class="num-label">订购</text>
                <text class="num-value">{{ row.orderedQuantity }}</text>
              </view>
              <view class="num-cell">
                <text class="num-label">已入库</text>
                <text class="num-value">{{ row.receivedQuantity }}</text>
              </view>
              <view class="num-cell">
                <text class="num-label">剩余</text>
                <text class="num-value strong">{{ row.orderRemainingQuantity }}</text>
              </view>
              <view v-if="row.inPackagePlan" class="num-cell">
                <text class="num-label">本包裹待收</text>
                <text class="num-value">{{ row.maxReceivableQuantity }}</text>
              </view>
            </view>

            <view v-if="row.maxReceivableQuantity > 0" class="qty-row">
              <text class="qty-label">本次到货</text>
              <input
                v-model="row.qty"
                class="qty-input"
                type="number"
                inputmode="numeric"
                :placeholder="'最多 ' + row.maxReceivableQuantity"
                placeholder-class="placeholder"
              />
              <button class="qty-fill" @click="fillMax(row)">收满</button>
            </view>
            <text v-else class="qty-disabled">这件商品没有可收数量</text>
          </view>

          <view class="card remark">
            <view class="remark-head">
              <text class="remark-title">收货备注</text>
              <text class="remark-left">还可输入 {{ remarkLeft }} 字</text>
            </view>
            <textarea
              v-model="remark"
              class="remark-input"
              maxlength="2000"
              placeholder="例如：外箱破损 2 件已拍照、实际到货与面单一致"
              placeholder-class="placeholder"
            />
          </view>

          <view v-if="formError" class="form-error">
            <text class="form-error-text">{{ formError }}</text>
          </view>

          <view v-if="failure" class="card failure">
            <text class="failure-title">{{ failure.title }}</text>
            <text class="failure-text">{{ failure.message }}</text>
            <text v-if="failure.unconfirmed" class="failure-note">
              提示：网络中断时无法确认服务端是否已写入，重试会复用同一操作号；即使上次其实成功了，也只会返回原入库单。
            </text>
            <button v-if="failure.retryable" class="btn btn-primary panel-action" @click="retry">
              重试本次提交
            </button>
            <button v-if="failure.needsEdit" class="btn btn-ghost panel-action" @click="modify">
              修改数量后重新提交
            </button>
            <button class="btn btn-ghost panel-action" @click="goRecords">查看入库记录</button>
          </view>

          <view class="total-bar">
            <view class="total-text">
              <text class="total-qty">{{ totalQuantity }} 件</text>
              <text class="total-hint">本次合计</text>
            </view>
            <button class="total-clear" @click="clearAll">全部清零</button>
          </view>

          <button
            class="btn btn-primary submit"
            :disabled="submitting || totalQuantity <= 0"
            :loading="submitting"
            @click="askConfirm"
          >
            {{ submitting ? '正在提交…' : '确认入库 ' + totalQuantity + ' 件' }}
          </button>
          <text class="submit-hint">点确认后还会再弹一次确认框，防止误触。</text>
        </template>
      </template>

      <view v-if="logs.length > 0" class="card logs">
        <text class="logs-title">最近操作</text>
        <view v-for="(entry, index) in logs" :key="entry.at + '-' + index" class="log-row">
          <text class="log-time">{{ operationClock(entry.at) }}</text>
          <view class="log-body">
            <text class="log-title" :class="entry.ok ? 'log-ok' : 'log-bad'">{{
              entry.title
            }}</text>
            <text class="log-detail">{{ entry.detail }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.receiving {
  min-height: 100vh;
  padding-bottom: 56rpx;
}

.hero {
  padding: 40rpx 32rpx 56rpx;
  background: linear-gradient(150deg, #17382d 0%, #235542 100%);
}

.hero-kicker {
  display: block;
  color: #cfe3d8;
  font-size: 24rpx;
}

.hero-code {
  display: block;
  margin-top: 10rpx;
  color: #ffffff;
  font-size: 44rpx;
  font-weight: 700;
  word-break: break-all;
  letter-spacing: 2rpx;
}

.hero-tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: 24rpx;
}

.tag {
  margin: 0 16rpx 12rpx 0;
  padding: 6rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.16);
  color: #e7f2ec;
  font-size: 24rpx;
}

.body {
  margin-top: -32rpx;
}

.panel {
  margin-bottom: 24rpx;
}

.panel-title {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
}

.panel-text {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #6b7f75;
  line-height: 1.6;
}

.panel-action {
  margin-top: 20rpx;
}

.banner {
  margin-bottom: 24rpx;
  padding: 24rpx;
  background: #fdf0e3;
  border-radius: 16rpx;
}

.banner-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #8a5a1f;
}

.banner-text {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #8a5a1f;
  line-height: 1.6;
}

.summary {
  margin-bottom: 24rpx;
}

.summary-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 14rpx 0;
  border-bottom: 2rpx solid #f0f4f2;
}

.summary-row:last-child {
  border-bottom: none;
}

.summary-label {
  flex: 0 0 150rpx;
  font-size: 26rpx;
  color: #7b8b83;
}

.summary-value {
  flex: 1;
  text-align: right;
  font-size: 28rpx;
  color: #17382d;
  word-break: break-all;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 8rpx 0 20rpx;
}

.section-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #3d574c;
}

.section-meta {
  font-size: 24rpx;
  color: #7b8b83;
}

.item {
  margin-bottom: 20rpx;
}

.item-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.item-name {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: #17382d;
}

.item-done {
  margin-left: 16rpx;
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  background: #eef4f0;
  color: #2f8f6a;
  font-size: 22rpx;
}

.item-meta {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #7b8b83;
}

.item-nums {
  display: flex;
  margin-top: 20rpx;
}

.num-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.num-label {
  font-size: 22rpx;
  color: #7b8b83;
}

.num-value {
  margin-top: 6rpx;
  font-size: 30rpx;
  color: #17382d;
}

.num-value.strong {
  font-weight: 700;
  color: #235542;
}

.qty-row {
  display: flex;
  align-items: center;
  margin-top: 24rpx;
  padding-top: 24rpx;
  border-top: 2rpx solid #f0f4f2;
}

.qty-label {
  flex: 0 0 140rpx;
  font-size: 28rpx;
  color: #3d574c;
}

.qty-input {
  flex: 1;
  height: 96rpx;
  padding: 0 24rpx;
  background: #f4f7f5;
  border: 2rpx solid #dbe6e0;
  border-radius: 16rpx;
  font-size: 36rpx;
  font-weight: 600;
  color: #17382d;
  box-sizing: border-box;
}

.qty-fill {
  margin-left: 16rpx;
  min-width: 120rpx;
  height: 96rpx;
  line-height: 92rpx;
  padding: 0 20rpx;
  border: 2rpx solid #cfdcd5;
  border-radius: 16rpx;
  font-size: 26rpx;
  color: #17382d;
}

.qty-disabled {
  display: block;
  margin-top: 20rpx;
  font-size: 24rpx;
  color: #9aaba2;
}

.remark {
  margin-top: 8rpx;
}

.remark-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.remark-title {
  font-size: 28rpx;
  font-weight: 600;
}

.remark-left {
  font-size: 22rpx;
  color: #9aaba2;
}

.remark-input {
  width: 100%;
  height: 160rpx;
  margin-top: 16rpx;
  padding: 20rpx;
  background: #f4f7f5;
  border: 2rpx solid #dbe6e0;
  border-radius: 16rpx;
  font-size: 28rpx;
  line-height: 1.5;
  box-sizing: border-box;
}

.placeholder {
  color: #9aaba2;
}

.form-error {
  margin-top: 20rpx;
  padding: 20rpx 24rpx;
  background: #fdecea;
  border-radius: 16rpx;
}

.form-error-text {
  font-size: 26rpx;
  color: #c0392b;
  line-height: 1.5;
}

.failure {
  margin-top: 24rpx;
  border: 2rpx solid #f0c9c4;
}

.failure-title {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: #c0392b;
}

.failure-text {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #7c4a44;
  line-height: 1.6;
}

.failure-note {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #9a6a63;
  line-height: 1.6;
}

.total-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 24rpx;
  padding: 24rpx 28rpx;
  background: #eef4f0;
  border-radius: 16rpx;
}

.total-text {
  display: flex;
  align-items: baseline;
}

.total-qty {
  font-size: 40rpx;
  font-weight: 700;
  color: #17382d;
}

.total-hint {
  margin-left: 12rpx;
  font-size: 24rpx;
  color: #6b7f75;
}

.total-clear {
  padding: 0 20rpx;
  min-height: 64rpx;
  line-height: 60rpx;
  border: 2rpx solid #cfdcd5;
  border-radius: 12rpx;
  font-size: 24rpx;
  color: #4a6357;
}

.submit {
  margin-top: 24rpx;
}

.submit-hint {
  display: block;
  margin-top: 12rpx;
  text-align: center;
  font-size: 22rpx;
  color: #9aaba2;
}

.success {
  margin-bottom: 24rpx;
  text-align: center;
}

.success-glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 96rpx;
  height: 96rpx;
  margin: 8rpx auto 0;
  border-radius: 50%;
  background: #2f8f6a;
  color: #ffffff;
  font-size: 48rpx;
  font-weight: 700;
}

.success-title {
  display: block;
  margin-top: 20rpx;
  font-size: 36rpx;
  font-weight: 700;
  color: #17382d;
}

.success-qty {
  display: block;
  margin-top: 12rpx;
  font-size: 44rpx;
  font-weight: 700;
  color: #2f8f6a;
}

.success-no {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #3d574c;
  word-break: break-all;
}

.success-time {
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  color: #7b8b83;
}

.success-lines {
  margin-top: 24rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid #f0f4f2;
}

.success-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 8rpx 0;
}

.success-line-name {
  font-size: 26rpx;
  color: #3d574c;
}

.success-line-qty {
  font-size: 28rpx;
  font-weight: 600;
  color: #17382d;
}

.success-note {
  display: block;
  margin-top: 20rpx;
  padding: 16rpx;
  background: #eef4f0;
  border-radius: 12rpx;
  font-size: 24rpx;
  color: #4a6357;
  line-height: 1.6;
  text-align: left;
}

.action {
  margin-bottom: 20rpx;
}

.logs {
  margin-top: 24rpx;
}

.logs-title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #3d574c;
}

.log-row {
  display: flex;
  align-items: flex-start;
  margin-top: 16rpx;
}

.log-time {
  flex: 0 0 110rpx;
  font-size: 22rpx;
  color: #9aaba2;
}

.log-body {
  flex: 1;
}

.log-title {
  display: block;
  font-size: 24rpx;
  font-weight: 600;
}

.log-ok {
  color: #2f8f6a;
}

.log-bad {
  color: #c0392b;
}

.log-detail {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: #7b8b83;
  line-height: 1.5;
}
</style>
