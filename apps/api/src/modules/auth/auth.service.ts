import { Injectable, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { PublicUser, RegisterData, LoginData } from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConfigService } from '../../config/env.js';
import { BusinessException } from '../../common/errors.js';
import type { LoginDto, RegisterDto } from './auth.dto.js';

export const TOKEN_ISSUER = 'caicang-api';
export const TOKEN_AUDIENCE = 'caicang-clients';
const publicSelect = {
  id: true,
  email: true,
  displayName: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
type UserRecord = Prisma.UserGetPayload<{ select: typeof publicSelect }>;
type LoginRecord = UserRecord & { passwordHash: string };
const toPublicUser = (user: UserRecord): PublicUser => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  isActive: user.isActive,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}
  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(randomBytes(32).toString('hex'), 12);
  }

  async register(dto: RegisterDto): Promise<RegisterData> {
    const passwordHash = await hash(dto.password, 12);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          displayName: dto.displayName ?? dto.email.split('@')[0]!,
          isActive: true,
        },
        select: publicSelect,
      });
      return { user: toPublicUser(user) };
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new BusinessException('EMAIL_ALREADY_EXISTS');
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<LoginData> {
    // Matches the normalized expression index, including legacy mixed-case/space-padded emails.
    const rows = await this.prisma.$queryRaw<
      LoginRecord[]
    >`SELECT id, email, display_name AS "displayName", password_hash AS "passwordHash", is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt" FROM users WHERE lower(btrim(email)) = ${dto.email} LIMIT 1`;
    const user = rows[0];
    const valid = await compare(dto.password, user?.passwordHash ?? this.dummyHash);
    if (!user || !valid || !user.isActive) throw new BusinessException('INVALID_CREDENTIALS');
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      type: 'access',
      jti: randomUUID(),
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.values.jwtAccessTtlSeconds,
      user: toPublicUser(user),
    };
  }

  async authenticate(token: string): Promise<PublicUser> {
    let claims: Record<string, unknown>;
    try {
      claims = await this.jwt.verifyAsync<Record<string, unknown>>(token);
      const now = Math.floor(Date.now() / 1000);
      if (
        typeof claims.sub !== 'string' ||
        !isUUID(claims.sub) ||
        claims.type !== 'access' ||
        typeof claims.jti !== 'string' ||
        !isUUID(claims.jti) ||
        !Number.isInteger(claims.iat) ||
        !Number.isInteger(claims.exp) ||
        Number(claims.iat) > now ||
        Number(claims.exp) <= Number(claims.iat) ||
        Number(claims.exp) - Number(claims.iat) > 900
      )
        throw new Error('Invalid claims');
    } catch {
      throw new BusinessException('INVALID_ACCESS_TOKEN');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub as string },
      select: publicSelect,
    });
    if (!user || !user.isActive) throw new BusinessException('UNAUTHENTICATED');
    return toPublicUser(user);
  }
}
