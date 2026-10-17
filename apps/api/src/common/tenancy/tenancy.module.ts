import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { TenantContextService } from './tenant-context.js';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class TenancyModule {}
