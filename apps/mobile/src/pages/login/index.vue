<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import NetworkBanner from '../../components/NetworkBanner.vue';
import { apiBaseUrl, apiChannel } from '../../config';
import { lastEmail, session, signIn } from '../../stores/session';
import { errorMessage, toastError } from '../../utils/feedback';
import { redirectIfSignedIn } from '../../utils/guard';

const email = ref(lastEmail());
const password = ref('');
const error = ref('');
const busy = ref(false);
const statusBarHeight = uni.getSystemInfoSync().statusBarHeight ?? 0;

onShow(async () => {
  await redirectIfSignedIn();
});

async function submit(): Promise<void> {
  if (busy.value) return;
  const account = email.value.trim();
  if (!account) {
    error.value = '请输入登录邮箱';
    return;
  }
  if (!password.value) {
    error.value = '请输入密码';
    return;
  }
  error.value = '';
  busy.value = true;
  try {
    await signIn(account, password.value);
    password.value = '';
    uni.reLaunch({ url: '/pages/home/index' });
  } catch (failure) {
    error.value = errorMessage(failure);
    toastError(failure);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <view class="login">
    <NetworkBanner />
    <view class="hero" :style="{ paddingTop: statusBarHeight + 72 + 'px' }">
      <text class="brand">采仓管家</text>
      <text class="slogan">采购 · 验收 · 库存 · 发货</text>
    </view>

    <view class="form card">
      <text class="form-title">账号登录</text>
      <text class="muted form-hint">使用管理端同一个账号登录</text>

      <view class="field">
        <text class="label">邮箱</text>
        <input
          v-model="email"
          class="input"
          type="text"
          :disabled="busy"
          placeholder="name@example.com"
          placeholder-class="placeholder"
          confirm-type="next"
        />
      </view>

      <view class="field">
        <text class="label">密码</text>
        <input
          v-model="password"
          class="input"
          password
          :disabled="busy"
          placeholder="请输入密码"
          placeholder-class="placeholder"
          confirm-type="done"
          @confirm="submit"
        />
      </view>

      <text v-if="error" class="error">{{ error }}</text>

      <button class="btn btn-primary submit" :disabled="busy" :loading="busy" @click="submit">
        {{ busy ? '登录中…' : '登 录' }}
      </button>
    </view>

    <view class="footer">
      <text class="muted">{{ apiChannel }} · {{ apiBaseUrl }}</text>
      <text v-if="session.lastError" class="muted footer-error">{{ session.lastError }}</text>
    </view>
  </view>
</template>

<style scoped>
.login {
  min-height: 100vh;
  background: linear-gradient(160deg, #17382d 0%, #22513f 46%, #f4f7f5 46%, #f4f7f5 100%);
}

.hero {
  padding: 0 48rpx 96rpx;
}

.brand {
  display: block;
  color: #ffffff;
  font-size: 64rpx;
  font-weight: 700;
  letter-spacing: 4rpx;
}

.slogan {
  display: block;
  margin-top: 16rpx;
  color: #cfe3d8;
  font-size: 28rpx;
}

.form {
  margin: 0 32rpx;
}

.form-title {
  display: block;
  font-size: 38rpx;
  font-weight: 700;
}

.form-hint {
  display: block;
  margin-top: 8rpx;
}

.field {
  margin-top: 32rpx;
}

.label {
  display: block;
  margin-bottom: 12rpx;
  font-size: 28rpx;
  color: #3d574c;
}

.input {
  height: 104rpx;
  padding: 0 28rpx;
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

.error {
  display: block;
  margin-top: 24rpx;
  padding: 20rpx 24rpx;
  background: #fdecea;
  border-radius: 12rpx;
  color: #b03a2e;
  font-size: 26rpx;
  line-height: 1.5;
}

.submit {
  margin-top: 40rpx;
}

.footer {
  padding: 48rpx 40rpx;
  text-align: center;
}

.footer-error {
  display: block;
  margin-top: 8rpx;
  color: #b03a2e;
}
</style>
