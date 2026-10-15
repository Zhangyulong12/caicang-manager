import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { PrismaService } from './prisma/prisma.service.js';
import { CommonModule } from './common/common.module.js';

@Module({ imports: [CommonModule], controllers: [HealthController], providers: [PrismaService] })
export class AppModule {}
