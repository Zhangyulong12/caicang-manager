import { bootstrap, isSignedIn, session } from '../stores/session';

let booting: Promise<void> | null = null;

/** 每次进入页面先确认会话就绪，避免首屏在"未登录"和"已登录"之间闪。 */
export async function ensureSession(): Promise<void> {
  if (session.ready) return;
  if (!booting) {
    booting = bootstrap().finally(() => {
      booting = null;
    });
  }
  await booting;
}

/** 返回 true 表示可以继续渲染；false 表示已跳转登录页。 */
export async function requireSignIn(): Promise<boolean> {
  await ensureSession();
  if (isSignedIn()) return true;
  uni.reLaunch({ url: '/pages/login/index' });
  return false;
}

export async function redirectIfSignedIn(): Promise<boolean> {
  await ensureSession();
  if (!isSignedIn()) return false;
  uni.reLaunch({ url: '/pages/home/index' });
  return true;
}
