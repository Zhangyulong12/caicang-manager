import { SetMetadata } from '@nestjs/common';
export const PUBLIC_ROUTE = Symbol('public-route');
/** Explicit exception to the default access-token guard, never a tenant/role bypass. */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
