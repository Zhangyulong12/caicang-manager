import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  type PipeTransform,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { TENANT_ROLES } from '@caicang/api-contract';
import { ApiDataResponse, ApiPageResponse } from '../../common/api-docs.js';
import { BusinessException } from '../../common/errors.js';
import type { ApiRequest } from '../../common/request-context.js';
import { CurrentTenant, type TenantContext } from '../../common/tenancy/tenant-context.js';
import {
  RequirePermissions,
  Roles,
  TenantEndpoint,
} from '../../common/tenancy/tenant.decorators.js';
import { PurchaseReturnsService } from './purchase-returns.service.js';
import {
  CreatePurchaseReturnDto,
  UpdatePurchaseReturnDto,
  ConfirmPurchaseReturnDto,
  PurchaseReturnIdDto,
  PurchaseReturnListQueryDto,
  PurchaseReturnDto,
  PurchaseReturnableDto,
} from './purchase-return.dto.js';
@Injectable()
class EmptyCancelPipe implements PipeTransform {
  transform(value: unknown) {
    if (
      value !== undefined &&
      (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length)
    )
      throw new BusinessException('BAD_REQUEST');
    return value;
  }
}
@ApiTags('purchase-returns')
@Controller()
@TenantEndpoint(...TENANT_ROLES)
export class PurchaseReturnsController {
  constructor(private readonly returns: PurchaseReturnsService) {}
  @Get('purchase-orders/:id/returnable')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('purchase:read')
  @ApiOperation({
    summary: '采购行实际入库量、已确认退货量、剩余可退量及原入库明细；草稿不占用可退量',
  })
  @ApiDataResponse(PurchaseReturnableDto)
  returnable(@CurrentTenant() context: TenantContext, @Param() params: PurchaseReturnIdDto) {
    return this.returns.returnable(context, params.id);
  }
  @Get('purchase-returns')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('purchase:read')
  @ApiPageResponse(PurchaseReturnDto)
  list(@CurrentTenant() context: TenantContext, @Query() query: PurchaseReturnListQueryDto) {
    return this.returns.list(context, query);
  }
  @Get('purchase-returns/:id')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('purchase:read')
  @ApiDataResponse(PurchaseReturnDto)
  detail(@CurrentTenant() context: TenantContext, @Param() params: PurchaseReturnIdDto) {
    return this.returns.detail(context, params.id);
  }
  @Post('purchase-returns')
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('purchase:write')
  @ApiDataResponse(PurchaseReturnDto, 201)
  @ApiOperation({ summary: '创建供应商退货草稿，关联已实际入库的采购行；不预留或扣库存' })
  create(
    @CurrentTenant() context: TenantContext,
    @Body() dto: CreatePurchaseReturnDto,
    @Req() request: ApiRequest,
  ) {
    return this.returns.create(context, dto, request.requestId);
  }
  @Patch('purchase-returns/:id')
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('purchase:write')
  @ApiDataResponse(PurchaseReturnDto)
  @ApiOperation({ summary: '仅修改采购退货草稿；原采购单不可换，已确认单金额与明细不可修改' })
  update(
    @CurrentTenant() context: TenantContext,
    @Param() params: PurchaseReturnIdDto,
    @Body() dto: UpdatePurchaseReturnDto,
    @Req() request: ApiRequest,
  ) {
    return this.returns.update(context, params.id, dto, request.requestId);
  }
  @Post('purchase-returns/:id/confirm')
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'WAREHOUSE')
  @RequirePermissions('inventory:write')
  @ApiDataResponse(PurchaseReturnDto, 201)
  @ApiDataResponse(PurchaseReturnDto, 200)
  @ApiOperation({
    summary:
      '确认退给供应商：同事务校验可退量/库存、扣库存、分配原入库、写流水及审计；首次201，同操作重放200',
  })
  async confirm(
    @CurrentTenant() context: TenantContext,
    @Param() params: PurchaseReturnIdDto,
    @Body() dto: ConfirmPurchaseReturnDto,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.returns.confirm(
      context,
      params.id,
      dto.clientOperationId,
      request.requestId,
    );
    response.status(result.created ? 201 : 200);
    return result.data;
  }
  @Post('purchase-returns/:id/cancel')
  @HttpCode(200)
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('purchase:write')
  @ApiDataResponse(PurchaseReturnDto)
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
  })
  @ApiOperation({ summary: '取消草稿，库存不变；重复取消无副作用，已确认不可取消' })
  cancel(
    @CurrentTenant() context: TenantContext,
    @Param() params: PurchaseReturnIdDto,
    @Req() request: ApiRequest,
    @Body(new EmptyCancelPipe()) body: unknown,
  ) {
    void body;
    return this.returns.cancel(context, params.id, request.requestId);
  }
}
