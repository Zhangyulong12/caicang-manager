import { Injectable, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { PublicUser, RegisterData, LoginData, LogoutData } from '@caicang/api-contract';
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
const refreshHash = (token: string): string => createHash('sha256').update(token).digest('hex');

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
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: user.id }, select: publicSelect });
      if (!current?.isActive) throw new BusinessException('INVALID_CREDENTIALS');
      const session = await tx.authSession.create({
        data: {
          userId: current.id,
          expiresAt: new Date(Date.now() + this.config.values.refreshTokenTtlSeconds * 1000),
        },
      });
      return this.issueTokens(tx, current, session.id, session.expiresAt);
    });
  }

  private async issueTokens(
    tx: Prisma.TransactionClient,
    user: UserRecord,
    sessionId: string,
    expiresAt: Date,
  ): Promise<LoginData> {
    const refreshToken = randomBytes(32).toString('base64url');
    // Signing and persistence are inside the transaction: failures cannot consume an old token.
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      sid: sessionId,
      type: 'access',
      jti: randomUUID(),
    });
    await tx.refreshToken.create({ data: { sessionId, tokenHash: refreshHash(refreshToken) } });
    return {
      accessToken,
      refreshToken,
      refreshExpiresIn: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
      tokenType: 'Bearer',
      expiresIn: this.config.values.jwtAccessTtlSeconds,
      user: toPublicUser(user),
    };
  }

  async refresh(token: string): Promise<LoginData> {
    const result = await this.prisma.$transaction(async (tx) => {
      const credential = await tx.refreshToken.findUnique({
        where: { tokenHash: refreshHash(token) },
      });
      if (!credential) return null;
      // Refresh, replay revocation and logout all lock the same session across API processes.
      await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${credential.sessionId}::uuid FOR UPDATE`;
      const session = await tx.authSession.findUnique({
        where: { id: credential.sessionId },
        include: { user: { select: publicSelect } },
      });
      if (!session || session.revokedAt) return null;
      const current = await tx.refreshToken.findUnique({ where: { id: credential.id } });
      if (
        !current ||
        current.usedAt ||
        session.expiresAt.getTime() <= Date.now() ||
        !session.user.isActive
      ) {
        await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        // Return, do not throw here: revocation must COMMIT before the standard 401 is raised.
        return null;
      }
      await tx.refreshToken.update({ where: { id: current.id }, data: { usedAt: new Date() } });
      return this.issueTokens(tx, session.user, session.id, session.expiresAt);
    });
    if (!result) throw new BusinessException('INVALID_REFRESH_TOKEN');
    return result;
  }

  async logout(token: string): Promise<LogoutData> {
    await this.prisma.$transaction(async (tx) => {
      const credential = await tx.refreshToken.findUnique({
        where: { tokenHash: refreshHash(token) },
      });
      if (!credential) return;
      await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${credential.sessionId}::uuid FOR UPDATE`;
      await tx.authSession.updateMany({
        where: { id: credential.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { loggedOut: true };
  }

  async authenticate(token: string): Promise<PublicUser> {
    let claims: Record<string, unknown>;
    try {
      claims = await this.jwt.verifyAsync<Record<string, unknown>>(token);
      const now = Math.floor(Date.now() / 1000);
      if (
        typeof claims.sub !== 'string' ||
        !isUUID(claims.sub) ||
        typeof claims.sid !== 'string' ||
        !isUUID(claims.sid) ||
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
    const session = await this.prisma.authSession.findUnique({
      where: { id: claims.sid as string },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (
      !session ||
      session.userId !== user.id ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    )
      throw new BusinessException('INVALID_ACCESS_TOKEN');
    return toPublicUser(user);
  }
}
