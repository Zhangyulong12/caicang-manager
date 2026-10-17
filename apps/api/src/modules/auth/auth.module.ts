import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '../../config/env.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthController, MeController } from './auth.controller.js';
import { AuthService, TOKEN_ISSUER, TOKEN_AUDIENCE } from './auth.service.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { TenantGuard, RolesGuard } from '../../common/tenancy/tenant.guards.js';

@Module({
  imports: [
    PrismaModule,
    TenancyModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.values.jwtAccessSecret,
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.values.jwtAccessTtlSeconds,
          issuer: TOKEN_ISSUER,
          audience: TOKEN_AUDIENCE,
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: TOKEN_ISSUER,
          audience: TOKEN_AUDIENCE,
          maxAge: config.values.jwtAccessTtlSeconds,
        },
      }),
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
