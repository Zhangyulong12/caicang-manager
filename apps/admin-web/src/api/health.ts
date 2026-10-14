import type { HealthResponse } from '@caicang/api-contract';
import { normalizeApiBaseUrl } from '@caicang/utils';

const baseUrl = normalizeApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1',
);

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('服务连接失败，请确认后端已启动');
  return (await response.json()) as HealthResponse;
}
