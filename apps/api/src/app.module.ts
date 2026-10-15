import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CommonModule } from './common/common.module.js';

@Module({ imports: [CommonModule, PrismaModule, AuthModule], controllers: [HealthController] })
export class AppModule {}
