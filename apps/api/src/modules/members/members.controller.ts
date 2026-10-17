import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiDataResponse, ApiPageResponse } from '../../common/api-docs.js';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import type { ApiRequest } from '../../common/request-context.js';
import { CurrentTenant, type TenantContext } from '../../common/tenancy/tenant-context.js';
import { RequirePermissions, TenantEndpoint } from '../../common/tenancy/tenant.decorators.js';
import { AddMemberDto, UpdateMemberDto, MembershipIdDto, MemberDto } from './member.dto.js';
import { MembersService } from './members.service.js';

@ApiTags('members')
@Controller('members')
@TenantEndpoint('OWNER', 'ADMIN')
export class MembersController {
  constructor(private readonly members: MembersService) {}
  @Get()
  @RequirePermissions('members:read')
  @ApiOperation({
    summary: '分页读取当前商家成员',
    description: '仅 OWNER/ADMIN；包含启用及停用关系，不返回其他商家成员或密码哈希。',
  })
  @ApiPageResponse(MemberDto)
  list(@CurrentTenant() context: TenantContext, @Query() query: PaginationQueryDto) {
    return this.members.list(context, query);
  }
  @Post()
  @RequirePermissions('members:manage')
  @ApiOperation({
    summary: '将已注册启用账号加入当前商家',
    description:
      '按 email 加入。OWNER 可授予非 OWNER 角色；ADMIN 只可授予 BUYER/WAREHOUSE/VIEWER。重复关系含停用关系返回 409。',
  })
  @ApiDataResponse(MemberDto, 201)
  add(
    @CurrentTenant() context: TenantContext,
    @Body() dto: AddMemberDto,
    @Req() request: ApiRequest,
  ) {
    return this.members.add(context, dto, request.requestId);
  }
  @Patch(':membershipId')
  @RequirePermissions('members:manage')
  @ApiOperation({
    summary: '修改当前商家成员角色或启停状态',
    description:
      '至少提交 role/isActive 一项；不允许 OWNER 变更，ADMIN 只能管理普通三类角色。跨商家/不存在的 membershipId 均为 404；变更与审计同事务。',
  })
  @ApiDataResponse(MemberDto)
  update(
    @CurrentTenant() context: TenantContext,
    @Param() params: MembershipIdDto,
    @Body() dto: UpdateMemberDto,
    @Req() request: ApiRequest,
  ) {
    return this.members.update(context, params.membershipId, dto, request.requestId);
  }
}
