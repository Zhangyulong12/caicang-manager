<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import type { TenantPermission } from '@caicang/api-contract';
import NetworkBanner from '../../components/NetworkBanner.vue';
import { session, refreshTenant } from '../../stores/session';
import { errorMessage, toast, toastError } from '../../utils/feedback';
import { requireSignIn } from '../../utils/guard';

interface Entry {
  key: string;
  label: string;
  glyph: string;
  hint: string;
  permission: TenantPermission;
  tab?: string;
  url?: string;
}

const entries: Entry[] = [
  {
    key: 'receiving',
    label: '扫码入库',
    glyph: '入',
    hint: '扫描运单查询包裹',
    permission: 'receiving:confirm',
    url: '/pages/scan/index',
  },
  {
    key: 'stock',
    label: '库存查询',
    glyph: '存',
    hint: '查看实时库存数量',
    permission: 'products:read',
    url: '/pages/stock/index',
  },
  {
    key: 'outbound',
    label: '扫码出库',
    glyph: '出',
    hint: '扫描商品完成出库',
    permission: 'outbound:write',
    url: '/pages/outbound/index',
  },
  {
    key: 'records',
    label: '入库记录',
    glyph: '记',
    hint: '最近的收货明细',
    permission: 'packages:read',
    tab: '/pages/records/index',
  },
];

const ROLE_LABELS: Record<string, string> = {
  OWNER: '老板',
  ADMIN: '管理员',
  BUYER: '采购员',
  WAREHOUSE: '仓管',
  VIEWER: '只读',
};

const busy = ref(false);
const notice = ref('');
const roleLabel = computed(() => {
  const role = session.currentTenant?.membership.role;
  return role ? (ROLE_LABELS[role] ?? role) : '未加入商家';
});
const displayName = computed(() => session.user?.displayName || session.user?.email || '');

onShow(async () => {
  if (!(await requireSignIn())) return;
  if (!session.currentTenant) await refreshTenant().catch(() => undefined);
});

function allowed(entry: Entry): boolean {
  return session.currentTenant?.permissions.includes(entry.permission) ?? false;
}

function open(entry: Entry): void {
  if (!allowed(entry)) {
    toast('当前账号没有「' + entry.label + '」权限');
    return;
  }
  if (entry.tab) {
    uni.switchTab({ url: entry.tab });
    return;
  }
  if (entry.url) {
    uni.navigateTo({ url: entry.url });
    return;
  }
  toast(entry.label + '将在下一阶段开放');
}

async function switchTenant(): Promise<void> {
  uni.navigateTo({ url: '/pages/tenant/index' });
}

async function reload(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    await refreshTenant();
    if (!session.currentTenant) notice.value = '该账号还没有加入任何商家，请联系管理员。';
  } catch (error) {
    notice.value = errorMessage(error);
    toastError(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <view class="home">
    <NetworkBanner />

    <view class="header">
      <view class="header-row">
        <view class="header-text">
          <text class="greeting">你好，{{ displayName }}</text>
          <text class="tenant">{{ session.currentTenant?.tenant.name ?? '尚未选择商家' }}</text>
        </view>
        <button class="switch" @click="switchTenant">切换商家</button>
      </view>
      <text class="role">{{ roleLabel }}</text>
    </view>

    <view class="body container">
      <view v-if="notice" class="notice">
        <text class="notice-text">{{ notice }}</text>
        <button class="notice-action" @click="reload">重新加载</button>
      </view>

      <text class="section-title">常用操作</text>
      <view class="grid">
        <view
          v-for="entry in entries"
          :key="entry.key"
          class="entry"
          :class="{ 'entry-disabled': !allowed(entry) }"
          hover-class="entry-hover"
          @click="open(entry)"
        >
          <text class="glyph">{{ entry.glyph }}</text>
          <text class="entry-label">{{ entry.label }}</text>
          <text class="entry-hint">{{ allowed(entry) ? entry.hint : '无权限' }}</text>
        </view>
      </view>

      <view class="card tip">
        <text class="tip-title">仓库操作提示</text>
        <text class="tip-text"
          >收货前先核对包裹与运单号；确认后库存立即增加，重复提交不会重复入库。</text
        >
      </view>
    </view>
  </view>
</template>

<style scoped>
.home {
  min-height: 100vh;
}

.header {
  padding: 40rpx 32rpx 56rpx;
  background: linear-gradient(150deg, #17382d 0%, #235542 100%);
}

.header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.header-text {
  flex: 1;
  padding-right: 24rpx;
}

.greeting {
  display: block;
  color: #cfe3d8;
  font-size: 26rpx;
}

.tenant {
  display: block;
  margin-top: 12rpx;
  color: #ffffff;
  font-size: 44rpx;
  font-weight: 700;
  line-height: 1.3;
}

.switch {
  min-height: 72rpx;
  padding: 0 28rpx;
  border-radius: 36rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.5);
  color: #ffffff;
  font-size: 26rpx;
  line-height: 68rpx;
}

.role {
  display: inline-block;
  margin-top: 24rpx;
  padding: 6rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.16);
  color: #e7f2ec;
  font-size: 24rpx;
}

.body {
  margin-top: -32rpx;
}

.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24rpx;
  padding: 24rpx;
  background: #fdf0e3;
  border-radius: 16rpx;
}

.notice-text {
  flex: 1;
  color: #8a5a1f;
  font-size: 26rpx;
  line-height: 1.5;
}

.notice-action {
  margin-left: 16rpx;
  padding: 0 20rpx;
  min-height: 64rpx;
  line-height: 60rpx;
  border: 2rpx solid #d8a86a;
  border-radius: 12rpx;
  color: #8a5a1f;
  font-size: 24rpx;
}

.section-title {
  display: block;
  margin: 8rpx 0 24rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: #3d574c;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}

.entry {
  width: 48.5%;
  margin-bottom: 24rpx;
  padding: 36rpx 28rpx;
  background: #ffffff;
  border-radius: 24rpx;
  box-shadow: 0 4rpx 16rpx rgba(23, 56, 45, 0.06);
  box-sizing: border-box;
}

.entry-hover {
  background: #eef4f0;
}

.entry-disabled {
  opacity: 0.45;
}

.glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 96rpx;
  height: 96rpx;
  border-radius: 24rpx;
  background: #17382d;
  color: #ffffff;
  font-size: 42rpx;
  font-weight: 700;
}

.entry-label {
  display: block;
  margin-top: 24rpx;
  font-size: 34rpx;
  font-weight: 600;
  color: #17382d;
}

.entry-hint {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #7b8b83;
}

.tip {
  margin-top: 8rpx;
}

.tip-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
}

.tip-text {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #6b7f75;
  line-height: 1.6;
}
</style>
