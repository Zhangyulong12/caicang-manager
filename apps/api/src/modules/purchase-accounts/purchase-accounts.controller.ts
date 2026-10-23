import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TENANT_ROLES } from '@caicang/api-contract';
import { ApiDataResponse, ApiPageResponse } from '../../common/api-docs.js';
import type { ApiRequest } from '../../common/request-context.js';
import { CurrentTenant, type TenantContext } from '../../common/tenancy/tenant-context.js';
import {
  RequirePermissions,
  Roles,
  TenantEndpoint,
} from '../../common/tenancy/tenant.decorators.js';
import {
  CreatePurchaseAccountDto,
  PurchaseAccountDeletedDto,
  PurchaseAccountDto,
  PurchaseAccountIdDto,
  PurchaseAccountQueryDto,
  UpdatePurchaseAccountDto,
} from './purchase-account.dto.js';
import { PurchaseAccountsService } from './purchase-accounts.service.js';

@ApiTags('purchase-accounts')
@Controller('purchase-accounts')
@TenantEndpoint(...TENANT_ROLES)
export class PurchaseAccountsController {
  constructor(private readonly accounts: PurchaseAccountsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('purchase:read')
  @ApiOperation({
    summary: '当前商家采购账号分页查询',
    description: '只含平台、别名、备注与启停用状态；不保存也不返回任何平台登录凭据。',
  })
  @ApiPageResponse(PurchaseAccountDto)
  list(@CurrentTenant() context: TenantContext, @Query() query: PurchaseAccountQueryDto) {
    return this.accounts.list(context, query);
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('purchase:write')
  @ApiOperation({ summary: '创建采购账号', description: '同一平台下别名唯一。' })
  @ApiDataResponse(PurchaseAccountDto, 201)
  create(
    @CurrentTenant() context: TenantContext,
    @Body() dto: CreatePurchaseAccountDto,
    @Req() request: ApiRequest,
  ) {
    return this.accounts.save(context, dto, request.requestId);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('purchase:write')
  @ApiOperation({
    summary: '编辑别名、备注或启停用',
    description: '有关联采购记录后禁止修改平台；停用不影响历史查询，也不能用于新采购。',
  })
  @ApiDataResponse(PurchaseAccountDto)
  update(
    @CurrentTenant() context: TenantContext,
    @Param() params: PurchaseAccountIdDto,
    @Body() dto: UpdatePurchaseAccountDto,
    @Req() request: ApiRequest,
  ) {
    return this.accounts.save(context, dto, request.requestId, params.id);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('purchase:write')
  @ApiOperation({
    summary: '删除从未被采购单引用的账号',
    description:
      '有采购记录的账号返回 409 PURCHASE_ACCOUNT_HAS_ORDERS，不级联删除订单；需要保留历史时改为停用。',
  })
  @ApiDataResponse(PurchaseAccountDeletedDto)
  remove(
    @CurrentTenant() context: TenantContext,
    @Param() params: PurchaseAccountIdDto,
    @Req() request: ApiRequest,
  ) {
    return this.accounts.remove(context, params.id, request.requestId);
  }
}
