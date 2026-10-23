<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { startNetworkWatch } from './services/network';

onLaunch(() => {
  startNetworkWatch();
});
</script>

<style>
page {
  background: #f4f7f5;
  color: #17382d;
  font-family: -apple-system, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.container {
  padding: 32rpx 32rpx 48rpx;
  box-sizing: border-box;
}

.card {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 32rpx;
  box-shadow: 0 4rpx 16rpx rgba(23, 56, 45, 0.06);
}

.title {
  display: block;
  font-size: 44rpx;
  font-weight: 700;
  line-height: 1.3;
}

.subtitle {
  display: block;
  margin-top: 12rpx;
  font-size: 28rpx;
  color: #6b7f75;
}

.muted {
  color: #6b7f75;
  font-size: 26rpx;
}

button {
  margin: 0;
  padding: 0;
  font-size: 32rpx;
  line-height: 1.2;
  background: transparent;
  border-radius: 20rpx;
}

button::after {
  border: none;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 104rpx;
  border-radius: 20rpx;
  font-size: 34rpx;
  font-weight: 600;
}

.btn-primary {
  background: #17382d;
  color: #ffffff;
}

.btn-primary[disabled] {
  background: #9aaba2;
  color: #f2f5f3;
}

.btn-ghost {
  background: #ffffff;
  color: #17382d;
  border: 2rpx solid #cfdcd5;
}

.btn-danger {
  background: #ffffff;
  color: #c0392b;
  border: 2rpx solid #e6b3ac;
}
</style>
