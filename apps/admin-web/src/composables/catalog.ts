import { createCatalog } from '../api/catalog';
import { useAuthStore } from '../stores/auth';
import { useTenantStore } from '../stores/tenant';
export function useCatalog() {
  const auth = useAuthStore();
  const tenants = useTenantStore();
  return createCatalog(
    auth.client,
    () =>
      auth.user && auth.sessionKey && tenants.current
        ? {
            userId: auth.user.id,
            sessionKey: auth.sessionKey,
            tenantId: tenants.current.tenant.id,
            permissions: tenants.current.permissions,
          }
        : null,
    window.localStorage,
  );
}
