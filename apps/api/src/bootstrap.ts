import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import type { Response } from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, getSchemaPath } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ConfigService } from './config/env.js';
import { BusinessException } from './common/errors.js';
import { SafeLogger } from './common/logging.js';
import { requestContext, type ApiRequest } from './common/request-context.js';
import { GlobalExceptionFilter } from './common/exception.filter.js';
import { ApiErrorResponseDto } from './common/api-docs.js';

/** The single bootstrap used by production and isolated HTTP test applications. */
export async function createApplication(
  root: Type<unknown> = AppModule,
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(root, {
    bodyParser: false,
    logger: new SafeLogger(),
    abortOnError: false,
  });
  const config = app.get(ConfigService).values;
  app.useSecurityHeaders({
    strictTransportSecurity: config.nodeEnv === 'production',
    xFrameOptions: { action: 'deny' },
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: config.nodeEnv === 'production' ? true : null },
    },
  });
  app.set('trust proxy', config.trustedProxies.length ? config.trustedProxies : false);
  app.use(requestContext(app.get(SafeLogger)));
  app.enableCors(
    (
      request: ApiRequest,
      callback: (error: Error | null, options: Record<string, unknown>) => void,
    ) => {
      const origin = request.headers.origin;
      const sameOrigin = origin === `${request.protocol}://${request.get('host')}`;
      if (origin && !sameOrigin && !config.origins.includes(origin)) {
        callback(new BusinessException('FORBIDDEN'), { origin: false });
        return;
      }
      callback(null, {
        origin: Boolean(origin),
        methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Request-Id', 'Accept'],
        exposedHeaders: [
          'X-Request-Id',
          'Retry-After',
          'X-RateLimit-Limit',
          'X-RateLimit-Remaining',
          'X-RateLimit-Reset',
        ],
        credentials: false,
        optionsSuccessStatus: 204,
        maxAge: 600,
      });
    },
  );
  app.useBodyParser('json', { limit: config.bodyLimitBytes });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  if (config.swaggerEnabled) {
    const builder = new DocumentBuilder()
      .setTitle('采仓管家 API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Tenant-Id' }, 'tenant')
      .addGlobalParameters({
        in: 'header',
        name: 'X-Request-Id',
        required: false,
        schema: { type: 'string', format: 'uuid' },
      })
      .build();
    const document = SwaggerModule.createDocument(app, builder, {
      extraModels: [ApiErrorResponseDto],
    });
    for (const path of Object.values(document.paths)) {
      if (!path) continue;
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const) {
        const operation = path[method];
        if (!operation) continue;
        for (const status of [
          '400',
          '401',
          '403',
          '404',
          '405',
          '409',
          '413',
          '415',
          '422',
          '429',
          '500',
          '503',
        ]) {
          operation.responses[status] ??= {
            description: '统一错误响应',
            content: {
              'application/json': { schema: { $ref: getSchemaPath(ApiErrorResponseDto) } },
            },
          };
        }
      }
    }
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: false },
    });
  }
  await app.init();
  // Nest 12 scopes its 404 handler to api/v1. Root/documentation misses also use the same filter.
  app.use((request: ApiRequest, response: Response) => {
    app.get(GlobalExceptionFilter).respond(new BusinessException('NOT_FOUND'), request, response);
  });
  return app;
}
