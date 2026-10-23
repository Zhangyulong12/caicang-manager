<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import NetworkBanner from '../../components/NetworkBanner.vue';
import { loadTenants, session, selectTenant } from '../../stores/session';
import { errorMessage, toast, toastError } from '../../utils/feedback';
import { requireSignIn } from '../../utils/guard';

const ROLE_LABELS: Record<string, string> = {
  OWNER: '老板',
  ADMIN: '管理员',
  BUYER: '采购员',
  WAREHOUSE: '仓管',
  VIEWER: '只读',
};

const loading = ref(false);
const switching = ref('');
const error = ref('');

const currentId = computed(() => session.currentTenant?.tenant.id ?? '');

async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    await loadTenants();
  } catch (failure) {
    error.value = errorMessage(failure);
  } finally {
    loading.value = false;
  }
}

onShow(async () => {
  if (!(await requireSignIn())) return;
  await load();
});

async function pick(tenantId: string): Promise<void> {
  if (switching.value) return;
  if (tenantId === currentId.value) {
    uni.switchTab({ url: '/pages/home/index' });
    return;
  }
  switching.value = tenantId;
  try {
    const current = await selectTenant(tenantId);
    toast('已切换到 ' + current.tenant.name);
    uni.switchTab({ url: '/pages/home/index' });
  } catch (failure) {
    toastError(failure);
  } finally {
    switching.value = '';
  }
}
</script>

<template>
  <view class="tenant-page">
    <NetworkBanner />
    <view class="container">
      <text class="title">选择商家</text>
      <text class="subtitle">切换后首页、库存与入库记录都会按该商家显示</text>

      <view v-if="loading && session.tenants.length === 0" class="state card">
        <text class="state-text">正在加载商家…</text>
      </view>

      <view v-else-if="error && session.tenants.length === 0" class="state card">
        <text class="state-text">{{ error }}</text>
        <button class="btn btn-ghost retry" @click="load">重新加载</button>
      </view>

      <view v-else-if="session.tenants.length === 0" class="state card">
        <text class="state-text">该账号还没有加入任何商家</text>
        <text class="state-hint">请让商家管理员在管理端邀请你加入</text>
      </view>

      <view v-else class="list">
        <view
          v-for="choice in session.tenants"
          :key="choice.tenant.id"
          class="card item"
          :class="{ active: choice.tenant.id === currentId }"
          hover-class="item-hover"
          @click="pick(choice.tenant.id)"
        >
          <view class="item-text">
            <text class="item-name">{{ choice.tenant.name }}</text>
            <text class="item-role">{{
              ROLE_LABELS[choice.membership.role] ?? choice.membership.role
            }}</text>
          </view>
          <text v-if="choice.tenant.id === currentId" class="badge">当前</text>
          <text v-else-if="switching === choice.tenant.id" class="badge switching">切换中…</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.tenant-page {
  min-height: 100vh;
}

.state {
  margin-top: 32rpx;
  text-align: center;
}

.state-text {
  display: block;
  font-size: 30rpx;
  color: #3d574c;
}

.state-hint {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #7b8b83;
}

.retry {
  margin-top: 28rpx;
}

.list {
  margin-top: 32rpx;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24rpx;
  min-height: 128rpx;
}

.item-hover {
  background: #eef4f0;
}

.active {
  border: 2rpx solid #17382d;
}

.item-text {
  flex: 1;
}

.item-name {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
  color: #17382d;
}

.item-role {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #7b8b83;
}

.badge {
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  background: #17382d;
  color: #ffffff;
  font-size: 24rpx;
}

.switching {
  background: #7b8b83;
}
</style>
