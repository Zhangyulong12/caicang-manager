export function normalizeApiBaseUrl(value: string): string {
  const invalid = () => {
    throw new Error('API 地址必须是没有凭证的 HTTP 或 HTTPS 地址');
  };
  if (typeof URL === 'function') {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) invalid();
  } else {
    // App 的 JS service 环境没有浏览器 URL。只接受明确的 HTTP(S) 主机、端口及路径，
    // 不给全局对象打补丁，也不允许凭证、反斜线、查询串或片段混入 API 基地址。
    const match =
      /^https?:\/\/([a-z0-9.-]+|\[[a-f0-9:.]+\])(?::([0-9]{1,5}))?(\/[^?#\s\\]*)?$/i.exec(value);
    if (!match || (match[2] && Number(match[2]) > 65535)) invalid();
  }
  return value.replace(/\/+$/, '');
}
