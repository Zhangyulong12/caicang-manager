<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import NetworkBanner from '../../components/NetworkBanner.vue';
import { apiBaseUrl, apiChannel } from '../../config';
import { session, signOut } from '../../stores/session';
import { confirm, toastError } from '../../utils/feedback';
import { requireSignIn } from '../../utils/guard';

const ROLE_LABELS: Record<string, string> = {
  OWNER: '老板',
  ADMIN: '管理员',
  BUYER: '采购员',
  WAREHOUSE: '仓管',
  VIEWER: '只读',
};

const busy = ref(false);
const version = computed(() => {
  const info = uni.getSystemInfoSync();
  return info.appVersion || '0.1.0';
});
const roleLabel = computed(() => {
  const role = session.currentTenant?.membership.role;
  return role ? (ROLE_LABELS[role] ?? role) : '—';
});

onShow(async () => {
  await requireSignIn();
});

function openTenants(): void {
  uni.navigateTo({ url: '/pages/tenant/index' });
}

async function logout(): Promise<void> {
  if (busy.value) return;
  const agreed = await confirm('退出登录', '退出后需要重新输入邮箱和密码。');
  if (!agreed) return;
  busy.value = true;
  try {
    await signOut();
    uni.reLaunch({ url: '/pages/login/index' });
  } catch (error) {
    toastError(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <view class="account">
    <NetworkBanner />

    <view class="profile">
      <view class="avatar">
        <text class="avatar-text">{{
          (session.user?.displayName || session.user?.email || '?').slice(0, 1)
        }}</text>
      </view>
      <view class="profile-text">
        <text class="name">{{ session.user?.displayName || '未设置姓名' }}</text>
        <text class="email">{{ session.user?.email }}</text>
      </view>
    </view>

    <view class="container">
      <view class="card group">
        <view class="row" @click="openTenants">
          <text class="row-label">当前商家</text>
          <view class="row-value">
            <text class="value-text">{{ session.currentTenant?.tenant.name ?? '未选择' }}</text>
            <text class="chevron">›</text>
          </view>
        </view>
        <view class="divider" />
        <view class="row">
          <text class="row-label">我的角色</text>
          <text class="value-text">{{ roleLabel }}</text>
        </view>
        <view class="divider" />
        <view class="row">
          <text class="row-label">服务环境</text>
          <text class="value-text">{{ apiChannel }}</text>
        </view>
        <view class="divider" />
        <view class="row column">
          <text class="row-label">服务地址</text>
          <text class="address">{{ apiBaseUrl }}</text>
        </view>
        <view class="divider" />
        <view class="row">
          <text class="row-label">版本</text>
          <text class="value-text">{{ version }}</text>
        </view>
      </view>

      <button class="btn btn-danger logout" :disabled="busy" @click="logout">
        {{ busy ? '正在退出…' : '退出登录' }}
      </button>
    </view>
  </view>
</template>

<style scoped>
.account {
  min-height: 100vh;
}

.profile {
  display: flex;
  align-items: center;
  padding: 48rpx 32rpx 56rpx;
  background: linear-gradient(150deg, #17382d 0%, #235542 100%);
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 112rpx;
  height: 112rpx;
  border-radius: 56rpx;
  background: rgba(255, 255, 255, 0.16);
}

.avatar-text {
  color: #ffffff;
  font-size: 44rpx;
  font-weight: 700;
}

.profile-text {
  margin-left: 24rpx;
}

.name {
  display: block;
  color: #ffffff;
  font-size: 38rpx;
  font-weight: 700;
}

.email {
  display: block;
  margin-top: 8rpx;
  color: #cfe3d8;
  font-size: 26rpx;
}

.group {
  padding: 8rpx 32rpx;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 104rpx;
}

.row.column {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 24rpx 0;
}

.row-label {
  font-size: 30rpx;
  color: #3d574c;
}

.row-value {
  display: flex;
  align-items: center;
}

.value-text {
  font-size: 30rpx;
  color: #17382d;
}

.chevron {
  margin-left: 12rpx;
  color: #9aaba2;
  font-size: 34rpx;
}

.address {
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #6b7f75;
  word-break: break-all;
  line-height: 1.5;
}

.divider {
  height: 2rpx;
  background: #eef3f0;
}

.logout {
  margin-top: 48rpx;
}
</style>
