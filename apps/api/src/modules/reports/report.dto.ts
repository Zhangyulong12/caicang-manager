import { ApiProperty, ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { REPORT_DATASETS, type ReportDataset } from '@caicang/api-contract';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
const present = (_: unknown, value: unknown) => value !== undefined;
export class ReportOverviewQueryDto {
  @ApiPropertyOptional({ format: 'date', description: '业务日期（Asia/Shanghai），包含边界' })
  @ValidateIf(present)
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from?: string;
  @ApiPropertyOptional({ format: 'date' })
  @ValidateIf(present)
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf(present) @IsUUID() warehouseId?: string;

  @ApiPropertyOptional({
    description: 'UUID 或 UNASSIGNED（原采购未指定账号）；仅采购/退款相关报表',
  })
  @ValidateIf(present)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.toUpperCase() === 'UNASSIGNED' ? 'UNASSIGNED' : value,
  )
  @Matches(/^(?:UNASSIGNED|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  purchaseAccountId?: string;
  @ApiPropertyOptional({ enum: ['TAOBAO', 'JD', 'PDD', 'OTHER'] })
  @ValidateIf(present)
  @IsIn(['TAOBAO', 'JD', 'PDD', 'OTHER'])
  platform?: string;
  @ApiPropertyOptional({
    maxLength: 80,
    description: '精确 SKU；仅采购明细/待入库/库存/出库，采购按历史快照',
  })
  @ValidateIf(present)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  @MaxLength(80)
  sku?: string;
  @ApiPropertyOptional({ maxLength: 80, description: '精确货号，使用范围同 SKU' })
  @ValidateIf(present)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  @MaxLength(80)
  articleNo?: string;
}
export class ReportExportQueryDto extends ReportOverviewQueryDto {
  @ApiProperty({ enum: REPORT_DATASETS }) @IsIn(REPORT_DATASETS) dataset!: ReportDataset;
}
export class ReportTableQueryDto extends IntersectionType(
  ReportExportQueryDto,
  PaginationQueryDto,
) {}
export class ReportColumnDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: ['text', 'money', 'quantity'] }) kind!: string;
  @ApiPropertyOptional({ enum: [2, 4] }) digits?: number;
}
export class ReportPaginationDto {
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
}
export class ReportTableDto {
  @ApiProperty({ enum: REPORT_DATASETS }) dataset!: string;
  @ApiProperty({ type: [ReportColumnDto] }) columns!: ReportColumnDto[];
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: { type: 'string', nullable: true } },
  })
  rows!: Record<string, string | null>[];
  @ApiProperty({ type: ReportPaginationDto }) pagination!: ReportPaginationDto;
  @ApiProperty() generatedAt!: string;
  @ApiProperty() scopeNote!: string;
}
export class ReportOverviewDto {
  @ApiProperty({ type: String, nullable: true }) purchaseAmount!: string | null;
  @ApiProperty() monthPurchaseAmount!: string;
  @ApiProperty() missingAllocationCount!: string;
  @ApiProperty() pendingPackageCount!: string;
  @ApiProperty() receivedQuantity!: string;
  @ApiProperty() receivedCost!: string;
  @ApiProperty() scopeNote!: string;
  @ApiProperty() purchaseQuantity!: string;
  @ApiProperty() purchaseOrderCount!: string;
  @ApiProperty() pendingQuantity!: string;
  @ApiProperty({ type: String, nullable: true }) pendingAmount!: string | null;
  @ApiProperty() inventoryQuantity!: string;
  @ApiProperty() inventoryCost!: string;
  @ApiProperty() outboundQuantity!: string;
  @ApiProperty() outboundCost!: string;
  @ApiProperty() returnRefundAmount!: string;
  @ApiProperty() returnStockCost!: string;
  @ApiProperty() returnQuantity!: string;
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ enum: ['Asia/Shanghai'] }) timeZone!: string;
}
export class ReportExportDto {
  @ApiProperty() fileName!: string;
  @ApiProperty({ description: '服务器生成的完整 CSV，首字符 U+FEFF；UTF-8 编码后为 BOM' })
  csv!: string;
  @ApiProperty() rowCount!: number;
  @ApiProperty() generatedAt!: string;
}
