import { ref } from 'vue';

/** 全局网络状态：断网时页面显示提示条，请求失败也能给出可读原因。 */
export const online = ref(true);
let started = false;

export function startNetworkWatch(): void {
  if (started) return;
  started = true;
  uni.getNetworkType({
    success(result) {
      online.value = result.networkType !== 'none';
    },
  });
  uni.onNetworkStatusChange((result) => {
    const next = result.isConnected;
    if (next === online.value) return;
    online.value = next;
    uni.showToast({ title: next ? '网络已恢复' : '网络已断开', icon: 'none', duration: 2000 });
  });
}

/** 下拉刷新等场景主动确认一次，避免只依赖最后一次事件。 */
export function checkNetwork(): Promise<boolean> {
  return new Promise((resolve) => {
    uni.getNetworkType({
      success(result) {
        online.value = result.networkType !== 'none';
        resolve(online.value);
      },
      fail() {
        resolve(online.value);
      },
    });
  });
}
