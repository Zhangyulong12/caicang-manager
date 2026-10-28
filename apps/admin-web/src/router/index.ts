import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useTenantStore } from '../stores/tenant';
import { ApiFailure } from '../api/client';
import {
  allowed,
  inventoryPath,
  navigation,
  outboundPath,
  purchaseReturnPath,
  receiptPath,
  safeRedirect,
} from './policy';

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
      children: [
        ...navigation.map((item) => ({
          path: item.path === '/' ? '' : item.path.slice(1),
          meta: { title: item.title },
          component:
            item.path === '/'
              ? () => import('../views/HomeView.vue')
              : item.path === '/products'
                ? () => import('../views/ProductsView.vue')
                : item.path === '/purchases'
                  ? () => import('../views/PurchasesView.vue')
                  : item.path === '/purchase-returns'
                    ? () => import('../views/PurchaseReturnsView.vue')
                    : item.path === '/purchase-accounts'
                      ? () => import('../views/PurchaseAccountsView.vue')
                      : item.path === '/packages'
                        ? () => import('../views/PackagesView.vue')
                        : item.path === '/inventory'
                          ? () => import('../views/InventoryOverviewView.vue')
                          : item.path === '/receipts'
                            ? () => import('../views/ReceiptsView.vue')
                            : item.path === '/outbound'
                              ? () => import('../views/OutboundView.vue')
                              : item.path === '/warehouses'
                                ? () => import('../views/WarehousesView.vue')
                                : item.path === '/reports'
                                  ? () => import('../views/ReportsView.vue')
                                  : item.path === '/settings'
                                    ? () => import('../views/SettingsView.vue')
                                    : () => import('../views/ModuleView.vue'),
        })),
        {
          path: 'inventory/balances',
          component: () => import('../views/InventoryBalancesView.vue'),
          meta: { title: '商品库存' },
        },
        {
          path: 'inventory/adjustments',
          component: () => import('../views/AdjustmentsView.vue'),
          meta: { title: '库存调整' },
        },
        {
          path: 'inventory/adjustments/new',
          component: () => import('../views/AdjustmentFormView.vue'),
          meta: { title: '新建库存调整' },
        },
        {
          path: 'inventory/adjustments/:id',
          component: () => import('../views/AdjustmentDetailView.vue'),
          meta: { title: '库存调整详情' },
        },
        {
          path: 'inventory/movements',
          component: () => import('../views/InventoryMovementsView.vue'),
          meta: { title: '库存变动流水' },
        },
        {
          path: 'inventory/pending',
          component: () => import('../views/InventoryPendingView.vue'),
          meta: { title: '待入库采购商品' },
        },
        {
          path: 'inventory/sku/:productId',
          component: () => import('../views/InventorySkuView.vue'),
          meta: { title: 'SKU 库存详情' },
        },
        {
          path: 'receipts/:id',
          component: () => import('../views/ReceiptDetailView.vue'),
          meta: { title: '入库记录详情' },
        },
        {
          path: 'purchases/new',
          component: () => import('../views/PurchaseFormView.vue'),
          meta: { title: '新建采购单' },
        },
        {
          path: 'purchase-returns/new',
          component: () => import('../views/PurchaseReturnFormView.vue'),
          meta: { title: '新建采购退货' },
        },
        {
          path: 'purchase-returns/:id',
          component: () => import('../views/PurchaseReturnDetailView.vue'),
          meta: { title: '采购退货详情' },
        },
        {
          path: 'purchases/:id/edit',
          component: () => import('../views/PurchaseFormView.vue'),
          meta: { title: '修改采购草稿' },
        },
        {
          path: 'purchases/:id',
          component: () => import('../views/PurchaseDetailView.vue'),
          meta: { title: '采购单详情' },
        },
        {
          path: 'outbound/new',
          component: () => import('../views/OutboundFormView.vue'),
          meta: { title: '新建出库单' },
        },
        {
          path: 'outbound/:id/edit',
          component: () => import('../views/OutboundFormView.vue'),
          meta: { title: '修改出库草稿' },
        },
        {
          path: 'outbound/:id',
          component: () => import('../views/OutboundDetailView.vue'),
          meta: { title: '出库单详情' },
        },
        {
          path: 'products/:id',
          component: () => import('../views/ProductDetailView.vue'),
          meta: { title: '商品详情' },
        },
      ],
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
    (navigation.some((item) => item.path === to.path) ||
      to.path.startsWith('/products/') ||
      to.path.startsWith('/purchases/') ||
      inventoryPath(to.path) ||
      receiptPath(to.path) ||
      outboundPath(to.path) ||
      purchaseReturnPath(to.path)) &&
    !allowed(to.path, tenants.current?.permissions ?? [])
  )
    return '/forbidden';
  return true;
});
