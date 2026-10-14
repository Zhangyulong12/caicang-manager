import type { HealthResponse } from '@caicang/api-contract';
import { normalizeApiBaseUrl } from '@caicang/utils';

const baseUrl = normalizeApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1',
);

export function getHealth(): Promise<HealthResponse> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${baseUrl}/health`,
      method: 'GET',
      timeout: 5000,
      success(response) {
        if (response.statusCode !== 200) return reject(new Error('服务连接失败'));
        resolve(response.data as HealthResponse);
      },
      fail() {
        reject(new Error('无法连接服务'));
      },
    });
  });
}
