import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { HealthResponse } from '@caicang/api-contract';
import { PrismaService } from './prisma/prisma.service.js';

class HealthDataDto {
  @ApiProperty({ enum: ['ok'] }) status!: 'ok';
  @ApiProperty({ example: 'caicang-api' }) service!: string;
  @ApiProperty({ enum: ['reachable'] }) database!: 'reachable';
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
}

class HealthResponseDto {
  @ApiProperty({ type: HealthDataDto }) data!: HealthDataDto;
  @ApiProperty({ format: 'uuid' }) requestId!: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOkResponse({ type: HealthResponseDto, description: 'API 和 PostgreSQL 可连接' })
  async health(): Promise<HealthResponse> {
    const requestId = randomUUID();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        error: { code: 'DATABASE_UNAVAILABLE', message: '数据库暂不可用', details: {} },
        requestId,
      });
    }
    return {
      data: {
        status: 'ok',
        service: 'caicang-api',
        database: 'reachable',
        timestamp: new Date().toISOString(),
      },
      requestId,
    };
  }
}
