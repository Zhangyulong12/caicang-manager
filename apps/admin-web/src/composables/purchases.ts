import { createPurchases } from '../api/purchases';
import { useAuthStore } from '../stores/auth';
import { useTenantStore } from '../stores/tenant';
export function usePurchases() {
  const auth = useAuthStore(),
    tenants = useTenantStore();
  return createPurchases(auth.client, () =>
    auth.user && auth.sessionKey && tenants.current
      ? {
          userId: auth.user.id,
          sessionKey: auth.sessionKey,
          tenantId: tenants.current.tenant.id,
          permissions: tenants.current.permissions,
        }
      : null,
  );
}
