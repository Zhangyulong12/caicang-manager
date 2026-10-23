import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotContains,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.dto.js';

const present = (_: unknown, value: unknown) => value !== undefined;
const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class ReceiptItemInputDto {
  @ApiProperty({ format: 'uuid', description: '必须属于包裹所在采购单的采购明细行' })
  @IsUUID()
  purchaseOrderItemId!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647, example: 6, description: '本次实际验收数量' })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  receivedQty!: number;
}
/**
 * Only acceptance facts are accepted from clients. Warehouse, cost, balances and totals are
 * derived on the server; unknown fields are rejected by the global whitelist pipe.
 */
export class CreateReceiptDto {
  @ApiProperty({ format: 'uuid', description: '已扫描并确认的包裹 ID' })
  @IsUUID()
  packageId!: string;
  @ApiProperty({
    format: 'uuid',
    description: '客户端幂等操作 ID；同 ID 同请求返回原入库结果，同 ID 不同请求返回 409',
  })
  @IsUUID()
  clientOperationId!: string;
  @ApiProperty({ type: [ReceiptItemInputDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((row: ReceiptItemInputDto) =>
    typeof row?.purchaseOrderItemId === 'string'
      ? row.purchaseOrderItemId.toLowerCase()
      : row?.purchaseOrderItemId,
  )
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemInputDto)
  items!: ReceiptItemInputDto[];
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @Trim()
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  @NotContains('\u0000')
  remark?: string | null;
}
export class ReceiptListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: '仅列出该包裹的入库单' })
  @ValidateIf(present)
  @IsUUID()
  packageId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '仅列出该采购单的入库单' })
  @ValidateIf(present)
  @IsUUID()
  purchaseOrderId?: string;
  @ApiPropertyOptional({
    maxLength: 200,
    description: '入库单号、采购单号或运单号的字面子串（不区分大小写）',
  })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  @MinLength(1)
  @MaxLength(200)
  @NotContains('\u0000')
  search?: string;

  @ApiPropertyOptional({
    description: '入库时间下界（ISO 8601，含边界）；只写日期表示当天 00:00:00Z',
  })
  @ValidateIf(present)
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: '入库时间上界（ISO 8601，含边界）；只写日期表示当天 23:59:59.999Z',
  })
  @ValidateIf(present)
  @IsDateString()
  to?: string;
}
export class ReceiptIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
}
export class ReceiptItemResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) purchaseOrderItemId!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ description: '采购行到岸单位成本快照，四位小数' }) landedUnitCost!: string;
  @ApiProperty({ description: '数量 × 到岸单位成本，四位小数' }) lineCost!: string;
}
export class ReceiptResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() receiptNo!: string;
  @ApiProperty({ format: 'uuid' }) purchaseOrderId!: string;
  @ApiProperty() purchaseOrderNo!: string;
  @ApiProperty({ format: 'uuid' }) packageId!: string;
  @ApiProperty({ type: String, nullable: true }) trackingNo!: string | null;
  @ApiProperty({ type: String, nullable: true }) carrierCode!: string | null;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty({ enum: ['CONFIRMED'] }) status!: string;
  @ApiProperty({ format: 'uuid', description: '幂等操作 ID' }) clientOperationId!: string;
  @ApiProperty({ format: 'uuid' }) receivedBy!: string;
  @ApiProperty() receivedByName!: string;
  @ApiProperty({ type: String, nullable: true }) remark!: string | null;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty() totalQuantity!: number;
  @ApiProperty({ description: '本单入库总成本，四位小数' }) totalCost!: string;
  @ApiProperty({ type: [ReceiptItemResultDto] }) items!: ReceiptItemResultDto[];
}
