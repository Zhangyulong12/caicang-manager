import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { MembersModule } from './modules/members/members.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { WarehousesModule } from './modules/warehouses/warehouses.module.js';

@Module({
  imports: [
    CommonModule,
    PrismaModule,
    AuthModule,
    TenantsModule,
    MembersModule,
    ProductsModule,
    WarehousesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
