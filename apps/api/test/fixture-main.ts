import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Module,
  HttpException,
  ParseIntPipe,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Min,
  MinLength,
  IsArray,
  ArrayNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { AppModule } from '../src/app.module.js';
import { createApplication } from '../src/bootstrap.js';
import { BusinessException } from '../src/common/errors.js';
import { SafeLogger } from '../src/common/logging.js';
import { PageResult } from '../src/common/response.js';
import { PaginationQueryDto } from '../src/common/pagination.dto.js';
import { SensitiveRateLimit } from '../src/common/rate-limit.js';
import { ConfigService } from '../src/config/env.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { Public } from '../src/modules/auth/public.decorator.js';

class LineDto {
  @IsString() @MinLength(1) sku!: string;
  @IsInt() @Min(1) quantity!: number;
}
class InputDto {
  @IsString() @MinLength(1) name!: string;
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  items!: LineDto[];
}
// Isolated test root; never imported by AppModule or production main.
@Controller('__test')
@Public()
class FixtureController {
  constructor(private readonly logger: SafeLogger) {}
  @Post('validate') validate(@Body() dto: InputDto) {
    return dto;
  }
  @Get('page') page(@Query() query: PaginationQueryDto) {
    return new PageResult([{ sku: 'TEST' }], { ...query, total: 1 });
  }
  @Get('reserved') reserved() {
    return { data: 'business field', pagination: 'business field' };
  }
  @Get('empty') empty(): void {}
  @Get('money') money() {
    return { price: new Prisma.Decimal('123.45') };
  }
  @Get('business') business(): never {
    throw new BusinessException('OUT_OF_STOCK', {
      available: 2,
      password: 'hidden-password',
      nested: { refreshToken: 'hidden-token', recipientAddress: 'hidden-address' },
    });
  }
  @Get('http/:status') http(@Param('status', ParseIntPipe) status: number): never {
    throw new HttpException('SECRET_EXCEPTION_TEXT', status);
  }
  @Get('crash') crash(): never {
    throw new Error('password=SECRET_EXCEPTION_TEXT address=SECRET_EXCEPTION_ADDRESS');
  }
  @Get('prisma') prisma(): never {
    throw new Prisma.PrismaClientKnownRequestError('SQL SECRET_EXCEPTION_TEXT', {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: { target: 'SECRET_EXCEPTION_TEXT' },
    });
  }
  @Post('log') log(@Body() body: Record<string, unknown>) {
    this.logger.log(body, 'TOKEN_CONTEXT_SECRET');
    this.logger.error(
      new Error(JSON.stringify(body)),
      JSON.stringify(body),
      'TOKEN_CONTEXT_SECRET',
    );
    return { accepted: true };
  }
  @Get('rate') @Throttle({ default: { limit: 3, ttl: 1000 } }) rate() {
    return { accepted: true };
  }
  @Get('sensitive') @SensitiveRateLimit() sensitive() {
    return { accepted: true };
  }
}
@Controller('__private-test')
class PrivateFixtureController {
  @Get() value() {
    return { private: true };
  }
}
@Module({ imports: [AppModule], controllers: [FixtureController, PrivateFixtureController] })
class FixtureModule {}
const app = await createApplication(FixtureModule);
await app.listen(app.get(ConfigService).values.port, '127.0.0.1');
