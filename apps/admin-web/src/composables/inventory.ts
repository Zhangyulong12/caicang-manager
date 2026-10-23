import { createInventory } from '../api/inventory';
import { createReceipts } from '../api/receipts';
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
/** 库存查询（只读）：总览、余额、流水、待入库。 */
export function useInventory() {
  const auth = useAuthStore();
  return createInventory(auth.client, scope);
}
/** 入库记录查询（只读）：列表与详情。 */
export function useReceipts() {
  const auth = useAuthStore();
  return createReceipts(auth.client, scope);
}
