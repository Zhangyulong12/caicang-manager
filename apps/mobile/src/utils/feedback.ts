import { ApiFailure } from '../api/client';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.code === 'NETWORK_ERROR') return '网络连接失败，请检查网络后重试';
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return '操作失败，请稍后重试';
}

export function toast(title: string): void {
  uni.showToast({ title, icon: 'none', duration: 2200 });
}

export function toastError(error: unknown): void {
  toast(errorMessage(error));
}

export function confirm(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      confirmText: '确定',
      cancelText: '取消',
      success(result) {
        resolve(Boolean(result.confirm));
      },
      fail() {
        resolve(false);
      },
    });
  });
}
