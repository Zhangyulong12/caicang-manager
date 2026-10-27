import { createAdjustments } from '../api/adjustments';
import { useAuthStore } from '../stores/auth';
import { useTenantStore } from '../stores/tenant';
export function useAdjustments() {
  const auth = useAuthStore(),
    tenants = useTenantStore();
  return createAdjustments(auth.client, () =>
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
