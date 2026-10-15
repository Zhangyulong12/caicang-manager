import { Body, Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { PublicUser } from '@caicang/api-contract';
import { ApiDataResponse } from '../../common/api-docs.js';
import { SensitiveRateLimit } from '../../common/rate-limit.js';
import { AuthService } from './auth.service.js';
import {
  LoginDto,
  RegisterDto,
  LoginResultDto,
  RegisterResultDto,
  PublicUserDto,
} from './auth.dto.js';
import { Public } from './public.decorator.js';
import { CurrentUser } from './access-token.guard.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('register')
  @Public()
  @SensitiveRateLimit()
  @ApiOperation({
    summary: '邮箱密码注册',
    description:
      '邮箱去空格/转小写；密码至少 12 字符并含大小写字母、数字、符号，最多 72 个 UTF-8 字节。创建账号后调用 login。',
  })
  @ApiDataResponse(RegisterResultDto, 201)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @Public()
  @SensitiveRateLimit()
  @ApiOperation({
    summary: '登录获取短期 Access Token',
    description: '复制 data.accessToken 到 Swagger Authorize 的 bearer 栏，再调用 GET /api/v1/me。',
  })
  @ApiDataResponse(LoginResultDto)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
}
@ApiTags('account')
@Controller('me')
export class MeController {
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: '读取当前用户',
    description: '仅需 Bearer Token，不要求 X-Tenant-Id；不返回其他用户或商家数据。',
  })
  @ApiDataResponse(PublicUserDto)
  me(@CurrentUser() user: PublicUser) {
    return user;
  }
}
