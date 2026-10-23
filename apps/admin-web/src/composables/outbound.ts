import { createOutbound } from '../api/outbound';
import { useAuthStore } from '../stores/auth';
import { useTenantStore } from '../stores/tenant';

function scope() {
  const auth = useAuthStore(),
    tenants = useTenantStore();
  return auth.user && auth.sessionKey && tenants.current
    ? {
        userId: auth.user.id,
        sessionKey: auth.sessionKey,
        tenantId: tenants.current.tenant.id,
        permissions: tenants.current.permissions,
      }
    : null;
}
/** 出库单：列表/详情走只读权限，创建/修改/发货/取消需要 outbound:write。 */
export function useOutbound() {
  const auth = useAuthStore();
  return createOutbound(auth.client, scope);
}
