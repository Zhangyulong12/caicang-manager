import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useTenantStore } from '../stores/tenant';
import { ApiFailure } from '../api/client';
import { allowed, navigation, safeRedirect } from './policy';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('../views/AuthView.vue') },
    { path: '/register', component: () => import('../views/AuthView.vue') },
    { path: '/select-tenant', component: () => import('../views/TenantView.vue') },
    { path: '/connection-error', component: () => import('../views/ConnectionView.vue') },
    { path: '/forbidden', component: () => import('../views/ForbiddenView.vue') },
    {
      path: '/',
      component: () => import('../layouts/MainLayout.vue'),
      children: navigation.map((item) => ({
        path: item.path === '/' ? '' : item.path.slice(1),
        meta: { title: item.title },
        component:
          item.path === '/'
            ? () => import('../views/HomeView.vue')
            : item.path === '/settings'
              ? () => import('../views/SettingsView.vue')
              : () => import('../views/ModuleView.vue'),
      })),
    },
    { path: '/:pathMatch(.*)*', component: () => import('../views/NotFoundView.vue') },
  ],
});
router.beforeEach(async (to) => {
  if (to.path === '/connection-error') return true;
  const auth = useAuthStore();
  const tenants = useTenantStore();
  try {
    await auth.initialize();
  } catch {
    return '/connection-error';
  }
  const publicPage = to.path === '/login' || to.path === '/register';
  if (!auth.user)
    return publicPage ? true : { path: '/login', query: { redirect: safeRedirect(to.path) } };
  if (publicPage) return safeRedirect(to.query.redirect);
  if (to.path === '/select-tenant') return true;
  try {
    if (!(await tenants.restore()))
      return { path: '/select-tenant', query: { redirect: safeRedirect(to.path) } };
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 403) {
      tenants.forget();
      return '/select-tenant';
    }
    if (!auth.sessionKey) return '/login';
    return '/connection-error';
  }
  if (
    navigation.some((item) => item.path === to.path) &&
    !allowed(to.path, tenants.current?.permissions ?? [])
  )
    return '/forbidden';
  return true;
});
