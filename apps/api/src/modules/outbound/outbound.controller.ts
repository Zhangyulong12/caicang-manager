import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { TENANT_ROLES } from '@caicang/api-contract';
import { ApiDataResponse, ApiPageResponse } from '../../common/api-docs.js';
import type { ApiRequest } from '../../common/request-context.js';
import { CurrentTenant, type TenantContext } from '../../common/tenancy/tenant-context.js';
import {
  RequirePermissions,
  Roles,
  TenantEndpoint,
} from '../../common/tenancy/tenant.decorators.js';
import { OutboundOrdersService } from './outbound.service.js';
import {
  CancelOutboundResultDto,
  CreateOutboundOrderDto,
  OutboundOrderIdDto,
  OutboundOrderListQueryDto,
  OutboundOrderResultDto,
  ShipOutboundOrderDto,
  UpdateOutboundOrderDto,
} from './outbound.dto.js';

@ApiTags('outbound-orders')
@Controller('outbound-orders')
@TenantEndpoint(...TENANT_ROLES)
export class OutboundOrdersController {
  constructor(private readonly outbound: OutboundOrdersService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'WAREHOUSE')
  @RequirePermissions('outbound:write')
  @ApiOperation({
    summary: '创建出库草稿：只写单与明细，不动库存；收件信息可留到发货前补齐',
  })
  @ApiDataResponse(OutboundOrderResultDto, 201)
  create(
    @CurrentTenant() context: TenantContext,
    @Body() dto: CreateOutboundOrderDto,
    @Req() request: ApiRequest,
  ) {
    return this.outbound.create(context, dto, request.requestId);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: '出库单分页列表，可按仓库/状态/商品/日期/单号运单收件人搜索' })
  @ApiPageResponse(OutboundOrderResultDto)
  list(@CurrentTenant() context: TenantContext, @Query() query: OutboundOrderListQueryDto) {
    return this.outbound.list(context, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: '出库单详情：明细、成本快照、收件信息与当前可出库数量' })
  @ApiDataResponse(OutboundOrderResultDto)
  detail(@CurrentTenant() context: TenantContext, @Param() params: OutboundOrderIdDto) {
    return this.outbound.detail(context, params.id);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'WAREHOUSE')
  @RequirePermissions('outbound:write')
  @ApiOperation({
    summary: '修改草稿；给了 items 就整单替换明细，已发货/已取消的单不允许修改',
  })
  @ApiDataResponse(OutboundOrderResultDto)
  update(
    @CurrentTenant() context: TenantContext,
    @Param() params: OutboundOrderIdDto,
    @Body() dto: UpdateOutboundOrderDto,
    @Req() request: ApiRequest,
  ) {
    return this.outbound.update(context, params.id, dto, request.requestId);
  }

  @Post(':id/ship')
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'WAREHOUSE')
  @RequirePermissions('outbound:write')
  @ApiOperation({
    summary:
      '确认发货：同事务锁单锁余额、校验库存、按移动平均快照扣减、写 OUTBOUND 流水与审计；clientOperationId 幂等',
  })
  @ApiDataResponse(OutboundOrderResultDto, 201)
  @ApiDataResponse(OutboundOrderResultDto, 200)
  async ship(
    @CurrentTenant() context: TenantContext,
    @Param() params: OutboundOrderIdDto,
    @Body() dto: ShipOutboundOrderDto,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.outbound.ship(context, params.id, dto, request.requestId);
    // 201 首次发货；200 为完全相同幂等重放，库存不会被再次扣减。
    response.status(result.created ? 201 : 200);
    return result.data;
  }

  @Post(':id/cancel')
  // 取消是"把草稿置为已取消"，不是新建资源，所以用 200 而不是 POST 默认的 201。
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'WAREHOUSE')
  @RequirePermissions('outbound:write')
  @ApiOperation({ summary: '取消草稿：只改状态，不触碰库存；重复取消返回 200 且 cancelled=false' })
  @ApiDataResponse(CancelOutboundResultDto)
  cancel(
    @CurrentTenant() context: TenantContext,
    @Param() params: OutboundOrderIdDto,
    @Req() request: ApiRequest,
  ) {
    return this.outbound.cancel(context, params.id, request.requestId);
  }
}
