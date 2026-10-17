import { Body, Controller, Get, Post, HttpCode, Header } from '@nestjs/common';
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
  RefreshTokenDto,
  LogoutResultDto,
} from './auth.dto.js';
import { Public } from './public.decorator.js';
import { CurrentUser } from './access-token.guard.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('register')
  @Header('Cache-Control', 'no-store')
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
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @Public()
  @SensitiveRateLimit()
  @ApiOperation({
    summary: '登录获取短期 Access Token 与独立会话 Refresh Token',
    description:
      '复制 data.accessToken 到 Swagger Authorize 的 bearer 栏，再调用 GET /api/v1/me；保留 data.refreshToken 用于刷新或退出。',
  })
  @ApiDataResponse(LoginResultDto)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @Public()
  @SensitiveRateLimit()
  @ApiOperation({
    summary: '轮换 Refresh Token 并签发短期 Access Token',
    description:
      '无需有效 Access Token。旧 refreshToken 仅能使用一次；重复使用会撤销整个登录会话，必须重新登录。客户端应串行刷新。',
  })
  @ApiDataResponse(LoginResultDto)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @Public()
  @SensitiveRateLimit()
  @ApiOperation({
    summary: '撤销当前 Refresh Token 所属登录会话',
    description:
      '无需有效 Access Token。传 refreshToken；已轮换的旧值也可撤销会话。重复退出或未知凭据同样返回 loggedOut:true；其他设备会话不受影响。',
  })
  @ApiDataResponse(LogoutResultDto)
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken);
  }
}
@ApiTags('account')
@Controller('me')
export class MeController {
  @Get()
  @Header('Cache-Control', 'no-store')
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
