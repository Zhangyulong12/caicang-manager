import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotContains,
  NotEquals,
  ValidateIf,
} from 'class-validator';
import {
  ADJUSTMENT_REASONS,
  type AdjustmentCostSource,
  type AdjustmentReason,
} from '@caicang/api-contract';
import { PaginationQueryDto } from '../../common/pagination.dto.js';

const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const present = (_: unknown, value: unknown) => value !== undefined;

/**
 * 登记一次库存调整。余额、成本、单号、流水都由服务端推导：
 * 客户端提交 quantityOnHand / totalCost / unitCost 会被全局白名单拒绝（400）。
 */
export class CreateAdjustmentDto {
  @ApiProperty({ format: 'uuid', description: '调整发生的仓库，必须属于当前商家' })
  @IsUUID()
  warehouseId!: string;
  @ApiProperty({ format: 'uuid', description: '被调整的商品，必须属于当前商家' })
  @IsUUID()
  productId!: string;
  @ApiProperty({
    type: Number,
    example: -2,
    minimum: -2147483647,
    maximum: 2147483647,
    description: '调整数量：正数增加、负数减少，不能为 0。减少后的余额不能为负。',
  })
  @IsInt()
  @NotEquals(0)
  @Min(-2147483647)
  @Max(2147483647)
  quantityDelta!: number;
  @ApiProperty({
    enum: ADJUSTMENT_REASONS,
    example: 'STOCKTAKE_LOSS',
    description:
      '调整原因：盘点盘盈 / 盘点盘亏 / 商品损坏 / 商品丢失 / 其他原因。' +
      '盘盈只能为正、盘亏/损坏/丢失只能为负，其他原因两个方向都可以。',
  })
  @IsIn(ADJUSTMENT_REASONS)
  reason!: AdjustmentReason;
  @ApiPropertyOptional({
    maxLength: 500,
    description: '备注。选择「其他原因」时必填，其余原因选填；空白按未填写处理。',
  })
  @Trim()
  @ValidateIf((dto: CreateAdjustmentDto) => dto.reason === 'OTHER' || dto.remark !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @NotContains('\u0000')
  remark?: string;
  @ApiProperty({
    format: 'uuid',
    description: '客户端操作号。同一商家内重复提交同一操作号不会重复调整；内容不同则 409。',
  })
  @IsUUID()
  clientOperationId!: string;
}

export class AdjustmentListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(present)
  @IsUUID()
  warehouseId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(present)
  @IsUUID()
  productId?: string;
  @ApiPropertyOptional({ enum: ADJUSTMENT_REASONS })
  @ValidateIf(present)
  @IsIn(ADJUSTMENT_REASONS)
  reason?: AdjustmentReason;
  @ApiPropertyOptional({ maxLength: 128, description: '调整单号/商品名称/SKU 的字面子串' })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(128)
  @NotContains('\u0000')
  search?: string;
  @ApiPropertyOptional({ format: 'date', description: '创建日期起（含当天）' })
  @ValidateIf(present)
  @IsDateString({ strict: true })
  from?: string;
  @ApiPropertyOptional({ format: 'date', description: '创建日期止（含当天）' })
  @ValidateIf(present)
  @IsDateString({ strict: true })
  to?: string;
}

export class StockAdjustmentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ example: 'ADJ-20261024-1A2B3C4D' }) adjustmentNo!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() unit!: string;
  @ApiProperty({ example: -2 }) quantityDelta!: number;
  @ApiProperty({ example: 10 }) quantityBefore!: number;
  @ApiProperty({ example: 8 }) quantityAfter!: number;
  @ApiProperty({ enum: ADJUSTMENT_REASONS }) reason!: AdjustmentReason;
  @ApiProperty({ example: '盘点盘亏' }) reasonLabel!: string;
  @ApiProperty({ type: String, nullable: true }) remark!: string | null;
  @ApiProperty({ example: '18.5000', description: '本次调整采用的单位成本，四位小数' })
  unitCost!: string;
  @ApiProperty({ example: '-37.0000', description: '成本变动；增加为正、减少为负' })
  costDelta!: string;
  @ApiProperty({ example: '185.0000' }) totalCostBefore!: string;
  @ApiProperty({ example: '148.0000' }) totalCostAfter!: string;
  @ApiProperty({
    enum: ['AVERAGE', 'REFERENCE', 'ZERO'],
    description: '成本来源：移动加权平均 / 商品参考进货价 / 无依据记 0',
  })
  costSource!: AdjustmentCostSource;
  @ApiProperty({ format: 'uuid' }) clientOperationId!: string;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty() createdByName!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
