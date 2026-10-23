import { apiBaseUrl } from '../config';
import { createApiClient, type MobileStorage, type Transport } from './client';

export { ApiFailure, SESSION_KEY, TENANT_KEY } from './client';
export type { ApiClient, Session } from './client';

export const mobileStorage: MobileStorage = {
  getItem(key) {
    const value = uni.getStorageSync(key);
    return typeof value === 'string' && value.length > 0 ? value : null;
  },
  setItem(key, value) {
    uni.setStorageSync(key, value);
  },
  removeItem(key) {
    uni.removeStorageSync(key);
  },
};

/**
 * 把 uni.request 的回调式接口收敛成客户端要的 Promise 契约。
 * uni.request 的类型声明没有 PATCH：H5 走 XHR 可用，App 端接入写接口前需实测。
 */
type UniMethod = 'OPTIONS' | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'TRACE' | 'CONNECT';

const transport: Transport = (request) =>
  new Promise((resolve, reject) => {
    uni.request({
      url: request.url,
      method: request.method as UniMethod,
      header: request.headers,
      data: request.body as Record<string, unknown> | undefined,
      timeout: request.timeout,
      success(response) {
        resolve({ statusCode: response.statusCode, data: response.data });
      },
      fail() {
        reject(new Error('request failed'));
      },
    });
  });

export const api = createApiClient({
  baseUrl: apiBaseUrl,
  storage: mobileStorage,
  transport,
});
