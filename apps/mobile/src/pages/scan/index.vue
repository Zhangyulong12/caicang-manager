<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import type { PackageLookupData } from '@caicang/api-contract';
import NetworkBanner from '../../components/NetworkBanner.vue';
import { api } from '../../api';
import { session, can } from '../../stores/session';
import {
  ScanGuard,
  classifyLookup,
  lookupPackages,
  normalizeTrackingNo,
} from '../../services/scan';
import { errorMessage, toast } from '../../utils/feedback';
import { requireSignIn } from '../../utils/guard';
import { packageStatusNames, receivingStatusNames } from '../../utils/package';

type View = 'idle' | 'loading' | 'choose' | 'notFound' | 'error' | 'denied';

/** App 里 window.plus 存在；H5 预览没有，不能把浏览器当成扫码设备。 */
const isApp = typeof (globalThis as Record<string, unknown>).plus !== 'undefined';

const view = ref<View>('idle');
const scanning = ref(false);
const manualCode = ref('');
const currentCode = ref('');
const candidates = ref<PackageLookupData[]>([]);
const errorText = ref('');
const guard = new ScanGuard();

const cameraApi = uni as unknown as {
  getAppAuthorizeSetting?: () => { cameraAuthorized?: string };
  openAppAuthorizeSetting?: (options?: { fail?: () => void }) => void;
};

onShow(async () => {
  if (!(await requireSignIn())) return;
  if (!session.currentTenant) {
    toast('请先选择商家');
    uni.switchTab({ url: '/pages/home/index' });
    return;
  }
  if (!can('packages:lookup')) {
    toast('当前账号没有查询包裹权限');
    uni.switchTab({ url: '/pages/home/index' });
  }
});

function cameraBlocked(): boolean {
  if (!isApp) return false;
  try {
    return cameraApi.getAppAuthorizeSetting?.().cameraAuthorized === 'denied';
  } catch {
    return false;
  }
}

function openSettings(): void {
  if (!isApp) return;
  cameraApi.openAppAuthorizeSetting?.({
    fail: () => toast('请到系统设置 → 应用 → 采仓管家 → 权限中开启相机'),
  });
}

function startScan(): void {
  if (scanning.value) return;
  if (!isApp) {
    view.value = 'idle';
    uni.showModal({
      title: '请在手机 App 中扫码',
      content: '浏览器预览不支持摄像头扫码。可以先用下方的手动输入查询运单号。',
      showCancel: false,
    });
    return;
  }
  if (cameraBlocked()) {
    view.value = 'denied';
    return;
  }
  scanning.value = true;
  guard.reset();
  uni.scanCode({
    scanType: ['barCode', 'qrCode'],
    onlyFromCamera: true,
    success(result) {
      void handleCode(result.result);
    },
    fail(error) {
      const message = error?.errMsg ?? '';
      if (/cancel/i.test(message)) return;
      if (/auth|permission|denied|权限/i.test(message)) {
        view.value = 'denied';
        return;
      }
      if (/not support/i.test(message)) {
        toast('当前环境不支持扫码，请使用手机 App');
        return;
      }
      toast('扫码失败，请重试');
    },
    complete() {
      scanning.value = false;
    },
  });
}

async function handleCode(raw: string): Promise<void> {
  let code: string;
  try {
    code = normalizeTrackingNo(raw);
  } catch (error) {
    toast(errorMessage(error));
    return;
  }
  const gate = guard.begin(code);
  if (gate === 'busy') return;
  if (gate === 'duplicate') {
    toast('刚刚已查询过该单号，请稍候再试');
    return;
  }
  try {
    await runLookup(code);
  } finally {
    guard.end();
  }
}

async function runLookup(code: string): Promise<void> {
  const tenantId = session.currentTenant?.tenant.id;
  if (!tenantId) {
    toast('请先选择商家');
    return;
  }
  currentCode.value = code;
  errorText.value = '';
  view.value = 'loading';
  try {
    const rows = await lookupPackages(api, code, tenantId);
    candidates.value = rows;
    const outcome = classifyLookup(rows);
    if (outcome === 'single') {
      openDetail(rows[0]);
      return;
    }
    view.value = outcome === 'multiple' ? 'choose' : 'notFound';
  } catch (error) {
    errorText.value = errorMessage(error);
    view.value = 'error';
  }
}

function openDetail(row: PackageLookupData | undefined): void {
  if (!row) return;
  view.value = 'idle';
  const tracking = encodeURIComponent(row.trackingNo ?? '');
  uni.navigateTo({
    url: '/pages/package/index?id=' + row.packageId + '&trackingNo=' + tracking,
  });
}

function rescan(): void {
  guard.reset();
  candidates.value = [];
  errorText.value = '';
  currentCode.value = '';
  view.value = 'idle';
  startScan();
}

function retry(): void {
  if (!currentCode.value) {
    view.value = 'idle';
    return;
  }
  guard.reset();
  void handleCode(currentCode.value);
}

async function submitManual(): Promise<void> {
  const value = manualCode.value;
  if (!value.trim()) {
    toast('请输入运单号');
    return;
  }
  await handleCode(value);
}

function paste(): void {
  uni.getClipboardData({
    success(result) {
      manualCode.value = String(result.data ?? '');
    },
    fail() {
      toast('无法读取剪贴板，请手动输入单号');
    },
  });
}

function backToInput(): void {
  view.value = 'idle';
}

function goHome(): void {
  uni.switchTab({ url: '/pages/home/index' });
}
</script>

<template>
  <view class="scan">
    <NetworkBanner />

    <view class="hero">
      <text class="hero-title">扫一扫</text>
      <text class="hero-sub">对准快递面单上的运单条码，支持一维条形码与二维码</text>
    </view>

    <view class="container body">
      <button class="scan-button" :loading="scanning" :disabled="scanning" @click="startScan">
        <text class="scan-glyph">扫</text>
        <text class="scan-label">{{ scanning ? '正在打开相机…' : '扫一扫' }}</text>
        <text class="scan-hint">点击打开摄像头</text>
      </button>

      <view v-if="view === 'denied'" class="card panel">
        <text class="panel-title">需要相机权限</text>
        <text class="panel-text">
          扫码需要使用摄像头。请在系统设置中允许「采仓管家」使用相机，然后返回重试。
        </text>
        <button class="btn btn-primary panel-action" @click="openSettings">去设置开启</button>
        <button class="btn btn-ghost panel-action" @click="startScan">我已开启，重新扫码</button>
      </view>

      <view v-if="view === 'loading'" class="card panel">
        <text class="panel-title">正在查询运单</text>
        <text class="panel-code">{{ currentCode }}</text>
        <text class="panel-text">正在向服务器确认这个运单对应的包裹…</text>
      </view>

      <view v-if="view === 'error'" class="card panel">
        <text class="panel-title">查询失败</text>
        <text class="panel-text">{{ errorText }}</text>
        <button class="btn btn-primary panel-action" @click="retry">重试</button>
        <button class="btn btn-ghost panel-action" @click="backToInput">手动输入运单号</button>
      </view>

      <view v-if="view === 'notFound'" class="card panel">
        <text class="panel-title">没有找到这个运单的包裹</text>
        <text class="panel-code">{{ currentCode }}</text>
        <text class="panel-text">
          可能原因：运单号录入有误、包裹还没在管理端绑定到采购单，或该包裹属于其他商家。
        </text>
        <text class="panel-text">请让采购同事在管理端「采购单 → 绑定包裹」补录后再扫。</text>
        <button class="btn btn-primary panel-action" @click="rescan">重新扫码</button>
        <button class="btn btn-ghost panel-action" @click="backToInput">手动输入运单号</button>
        <button class="btn btn-ghost panel-action" @click="goHome">返回首页</button>
      </view>

      <view v-if="view === 'choose'" class="choose">
        <text class="choose-title">找到 {{ candidates.length }} 个包裹</text>
        <text class="choose-hint">同一运单号可能被多个承运商使用，请选择正确的包裹</text>
        <view
          v-for="row in candidates"
          :key="row.packageId"
          class="card choice"
          hover-class="choice-hover"
          @click="openDetail(row)"
        >
          <view class="choice-head">
            <text class="choice-order">{{ row.purchaseOrderNo }}</text>
            <text class="choice-status">{{ packageStatusNames[row.packageStatus] }}</text>
          </view>
          <text class="choice-line">承运商 {{ row.carrierCode ?? '未填写' }}</text>
          <text class="choice-line">
            收货 {{ receivingStatusNames[row.receivingStatus] }} · 已收
            {{ row.receivedQuantity }} 件
          </text>
        </view>
        <button class="btn btn-ghost panel-action" @click="rescan">重新扫码</button>
      </view>

      <view class="card manual">
        <text class="manual-title">手动输入运单号</text>
        <text class="manual-hint">条码磨损时可以手输，前导零要保留</text>
        <view class="manual-row">
          <input
            v-model="manualCode"
            class="manual-input"
            type="text"
            confirm-type="search"
            placeholder="例如 000783456123"
            placeholder-class="placeholder"
            maxlength="128"
            @confirm="submitManual"
          />
          <button class="paste" @click="paste">粘贴</button>
        </view>
        <button class="btn btn-primary manual-submit" @click="submitManual">查询包裹</button>
      </view>

      <view class="notice">
        <text class="notice-text">
          扫码只用于查询包裹信息，不会修改库存。确认收货在包裹详情页单独提交。
        </text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.scan {
  min-height: 100vh;
  padding-bottom: 48rpx;
}

.hero {
  padding: 40rpx 32rpx 48rpx;
  background: linear-gradient(150deg, #17382d 0%, #235542 100%);
}

.hero-title {
  display: block;
  color: #ffffff;
  font-size: 48rpx;
  font-weight: 700;
}

.hero-sub {
  display: block;
  margin-top: 12rpx;
  color: #cfe3d8;
  font-size: 26rpx;
  line-height: 1.5;
}

.body {
  margin-top: -24rpx;
}

.scan-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 320rpx;
  background: #ffffff;
  border: 3rpx dashed #235542;
  border-radius: 28rpx;
  box-shadow: 0 6rpx 20rpx rgba(23, 56, 45, 0.08);
}

.scan-glyph {
  font-size: 76rpx;
  font-weight: 700;
  color: #17382d;
  line-height: 1.1;
}

.scan-label {
  margin-top: 12rpx;
  font-size: 36rpx;
  font-weight: 600;
  color: #17382d;
}

.scan-hint {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #7b8b83;
}

.panel {
  margin-top: 24rpx;
}

.panel-title {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
  color: #17382d;
}

.panel-code {
  display: block;
  margin-top: 12rpx;
  font-size: 30rpx;
  color: #235542;
  word-break: break-all;
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

.choose {
  margin-top: 24rpx;
}

.choose-title {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
}

.choose-hint {
  display: block;
  margin: 8rpx 0 20rpx;
  font-size: 24rpx;
  color: #7b8b83;
}

.choice {
  margin-bottom: 20rpx;
}

.choice-hover {
  background: #eef4f0;
}

.choice-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.choice-order {
  font-size: 30rpx;
  font-weight: 600;
  color: #17382d;
}

.choice-status {
  font-size: 24rpx;
  color: #2f8f6a;
}

.choice-line {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  color: #6b7f75;
}

.manual {
  margin-top: 24rpx;
}

.manual-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
}

.manual-hint {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #7b8b83;
}

.manual-row {
  display: flex;
  align-items: center;
  margin-top: 20rpx;
}

.manual-input {
  flex: 1;
  height: 104rpx;
  padding: 0 24rpx;
  background: #f4f7f5;
  border: 2rpx solid #dbe6e0;
  border-radius: 16rpx;
  font-size: 32rpx;
  color: #17382d;
  box-sizing: border-box;
}

.placeholder {
  color: #9aaba2;
}

.paste {
  margin-left: 16rpx;
  min-width: 120rpx;
  height: 104rpx;
  line-height: 100rpx;
  padding: 0 24rpx;
  border: 2rpx solid #cfdcd5;
  border-radius: 16rpx;
  font-size: 28rpx;
  color: #17382d;
}

.manual-submit {
  margin-top: 24rpx;
}

.notice {
  margin-top: 32rpx;
  padding: 24rpx;
  background: #eef4f0;
  border-radius: 16rpx;
}

.notice-text {
  font-size: 24rpx;
  color: #4a6357;
  line-height: 1.6;
}
</style>
