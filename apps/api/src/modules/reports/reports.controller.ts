import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentTenant, type TenantContext } from '../../common/tenancy/tenant-context.js';
import {
  RequirePermissions,
  Roles,
  TenantEndpoint,
} from '../../common/tenancy/tenant.decorators.js';
import { ApiDataResponse } from '../../common/api-docs.js';
import { ReportsService } from './reports.service.js';
import {
  ReportOverviewDto,
  ReportOverviewQueryDto,
  ReportTableDto,
  ReportTableQueryDto,
  ReportExportDto,
  ReportExportQueryDto,
} from './report.dto.js';
@ApiTags('reports')
@Controller('reports')
@TenantEndpoint('OWNER', 'ADMIN', 'BUYER', 'VIEWER')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('overview')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('reports:read')
  @ApiDataResponse(ReportOverviewDto)
  @ApiOperation({
    summary: '采购/待入库/当前库存/出库/实际退款分口径概览；事件日期 Asia/Shanghai，当前库存不回溯',
  })
  overview(@CurrentTenant() context: TenantContext, @Query() query: ReportOverviewQueryDto) {
    return this.reports.overview(context, query);
  }
  @Get('table')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('reports:read')
  @ApiDataResponse(ReportTableDto)
  @ApiOperation({
    summary: '数据库聚合与分页：账号、平台、日期、原采购明细、待入库、当前库存、出库、退货退款',
  })
  table(@CurrentTenant() context: TenantContext, @Query() query: ReportTableQueryDto) {
    return this.reports.table(context, query);
  }
  @Get('export')
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN')
  @RequirePermissions('reports:export')
  @ApiDataResponse(ReportExportDto)
  @ApiOperation({
    summary:
      '安全 Web 导出：服务器生成 UTF-8 BOM CSV 内容和文件名，全部当前筛选行（上限10000），不按当前页截断',
  })
  export(@CurrentTenant() context: TenantContext, @Query() query: ReportExportQueryDto) {
    return this.reports.export(context, query);
  }
  @Get('export.csv')
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN')
  @RequirePermissions('reports:export')
  @ApiResponse({
    status: 200,
    description: 'UTF-8 BOM CSV 文件；错误仍为统一 JSON',
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  })
  async csv(
    @CurrentTenant() context: TenantContext,
    @Query() query: ReportExportQueryDto,
    @Res() response: Response,
  ) {
    const result = await this.reports.export(context, query);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    response.send(result.csv);
  }
}
