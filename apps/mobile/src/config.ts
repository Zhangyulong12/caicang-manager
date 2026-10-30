import { normalizeApiBaseUrl } from '@caicang/utils';

/**
 * 开发与正式环境通过 .env.development / .env.production 的 VITE_API_BASE_URL 区分。
 * Android 真机不能用 localhost，必须把开发地址改成电脑的局域网 IP（见 docs/MOBILE_APP.md）。
 */
const DEVELOPMENT_FALLBACK = 'http://localhost:3000/api/v1';
// 故意用不可解析的域名：正式包必须在 .env.production 里写明真实地址，避免悄悄连到错的服务器。
const PRODUCTION_FALLBACK = 'https://api.invalid.local/api/v1';

function resolve(): { url: string; channel: string; configured: boolean } {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  const fallback = import.meta.env.DEV ? DEVELOPMENT_FALLBACK : PRODUCTION_FALLBACK;
  const value = configured || fallback;
  if (!import.meta.env.DEV && !value.startsWith('https://'))
    throw new Error('正式环境必须使用 HTTPS API 地址');
  return {
    url: normalizeApiBaseUrl(value),
    channel: import.meta.env.DEV ? '开发环境' : '正式环境',
    configured: Boolean(configured),
  };
}

const resolved = resolve();

export const apiBaseUrl = resolved.url;
export const apiChannel = resolved.channel;
export const apiConfigured = resolved.configured;
