import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { TENANT_ROLES } from '@caicang/api-contract';
import { AppModule } from '../src/app.module.js';
import { createApplication } from '../src/bootstrap.js';
import { ConfigService } from '../src/config/env.js';
import { CurrentTenant, type TenantContext } from '../src/common/tenancy/tenant-context.js';
import {
  RequirePermissions,
  Roles,
  TenantEndpoint,
} from '../src/common/tenancy/tenant.decorators.js';

// Authorization fixtures only: no purchasing/stock implementation and never imported by production.
@Controller('__tenant-test')
@TenantEndpoint(...TENANT_ROLES)
class TenantFixtureController {
  @Get('purchase') @RequirePermissions('purchase:write') purchase(
    @CurrentTenant() context: TenantContext,
  ) {
    return { tenantId: context.tenantId, role: context.role };
  }
  @Get('receiving') @RequirePermissions('receiving:confirm') receiving() {
    return { allowed: true };
  }
  @Get('outbound') @RequirePermissions('outbound:write') outbound() {
    return { allowed: true };
  }
  @Get('buyer-only') @Roles('BUYER') buyer() {
    return { allowed: true };
  }
}
@Controller('__tenant-default-test')
class UndeclaredPolicyController {
  @Get() value() {
    return { mustNeverBeReturned: true };
  }
}
@Module({
  imports: [AppModule],
  controllers: [TenantFixtureController, UndeclaredPolicyController],
})
class TenantFixtureModule {}
const app = await createApplication(TenantFixtureModule);
await app.listen(app.get(ConfigService).values.port, '127.0.0.1');
