import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '../config/env.js';
import { GlobalExceptionFilter } from './exception.filter.js';
import { SafeLogger } from './logging.js';
import { ResponseInterceptor } from './response.js';
import { createValidationPipe } from './validation.js';

@Global()
@Module({ providers: [ConfigService, SafeLogger], exports: [ConfigService, SafeLogger] })
class ConfigurationModule {}
@Global()
@Module({
  imports: [
    ConfigurationModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigurationModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        { ttl: config.values.rateTtlMs, limit: config.values.rateLimit },
      ],
    }),
  ],
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    GlobalExceptionFilter,
    { provide: APP_FILTER, useExisting: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [ConfigurationModule],
})
export class CommonModule {}
