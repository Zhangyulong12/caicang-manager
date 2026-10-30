import { isIP } from 'node:net';
export function productionApiUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    url.pathname.replace(/\/$/, '') !== '/api/v1' ||
    isIP(host) ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|lan|test|invalid|example)$/.test(host) ||
    /(?:^|\.)example\.(?:com|org|net)$/.test(host)
  )
    throw new Error(
      'Use an approved real HTTPS domain on port 443 ending /api/v1; no local/example address or credentials',
    );
  return url.href.replace(/\/$/, '');
}
export function releaseManifest(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest));
  const android = copy['app-plus']?.distribute?.android;
  if (!android) throw new Error('Android manifest configuration is missing');
  android.usesCleartextTraffic = false;
  return copy;
}
