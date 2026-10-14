export function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('API 地址必须是没有凭证的 HTTP 或 HTTPS 地址');
  }
  return value.replace(/\/+$/, '');
}
