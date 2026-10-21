import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TENANT_ROLES, type PublicUser } from '@caicang/api-contract';
import { CurrentUser } from '../auth/access-token.guard.js';
import { ApiDataResponse, ApiPageResponse } from '../../common/api-docs.js';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import { SensitiveRateLimit } from '../../common/rate-limit.js';
import type { ApiRequest } from '../../common/request-context.js';
import { CurrentTenant, type TenantContext } from '../../common/tenancy/tenant-context.js';
import {
  GlobalAccount,
  RequirePermissions,
  TenantEndpoint,
} from '../../common/tenancy/tenant.decorators.js';
import {
  CreateTenantDto,
  CreatedTenantDto,
  CurrentTenantDto,
  TenantChoiceDto,
} from './tenant.dto.js';
import { TenantsService } from './tenants.service.js';

@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}
  @Get()
  @GlobalAccount()
  @ApiBearerAuth()
  @ApiOperation({
    summary: '分页列出本人具有启用成员关系的商家',
    description: '仅按认证账号查询，不接受 userId/tenantId；不需要商家头。',
  })
  @ApiPageResponse(TenantChoiceDto)
  list(@CurrentUser() user: PublicUser, @Query() query: PaginationQueryDto) {
    return this.tenants.list(user.id, query);
  }
  @Post()
  @GlobalAccount()
  @SensitiveRateLimit()
  @ApiBearerAuth()
  @ApiOperation({
    summary: '创建自己的商家、OWNER 与默认仓库',
    description:
      '仅需登录，无需 X-Tenant-Id；事务创建并审计，不接受客户端 userId/role。每次调用新建独立商家。',
  })
  @ApiDataResponse(CreatedTenantDto, 201)
  create(
    @CurrentUser() user: PublicUser,
    @Body() dto: CreateTenantDto,
    @Req() request: ApiRequest,
  ) {
    return this.tenants.create(user.id, dto, request.requestId);
  }
  @Get('current')
  @TenantEndpoint(...TENANT_ROLES)
  @RequirePermissions('tenant:read')
  @ApiOperation({
    summary: '读取当前商家、本人角色及权限',
    description: '只能读取 X-Tenant-Id 对应且自己具有启用成员关系的商家。',
  })
  @ApiDataResponse(CurrentTenantDto)
  current(@CurrentTenant() context: TenantContext) {
    return this.tenants.current(context);
  }
}
