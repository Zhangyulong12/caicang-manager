import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  IsInt,
  Min,
  Max,
  MinLength,
  MaxLength,
  Matches,
  ValidateIf,
  ValidateNested,
  IsDefined,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsIn,
  IsDateString,
  IsObject,
  NotContains,
} from 'class-validator';
import {
  PURCHASE_PLATFORMS,
  PURCHASE_STATUSES,
  type PurchasePlatform,
  type PurchaseStatus,
} from '@caicang/api-contract';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const NullableTrim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  );
const present = (_: unknown, value: unknown) => value !== undefined;
const nonNull = (_: unknown, value: unknown) => value !== undefined && value !== null;
const money = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
export class PurchaseRecipientDto {
  @ApiProperty({ maxLength: 100 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  name!: string;
  @ApiProperty({ maxLength: 50, example: '13800000000' })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^(?=.*\d)[+\d() -]+$/)
  phone!: string;
  @ApiProperty({ maxLength: 1000 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  @NotContains('\u0000')
  address!: string;
}
export class PurchaseLineInputDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productId!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647, example: 10 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
  @ApiProperty({
    type: String,
    example: '18.50',
    description: '元，非负十进制字符串，最多两位小数',
  })
  @IsString()
  @Matches(money)
  unitPrice!: string;
  @ApiPropertyOptional({ type: String, default: '0.00' })
  @ValidateIf(present)
  @IsString()
  @Matches(money)
  discountAmount?: string;
}
export class CreatePurchaseDto {
  @ApiPropertyOptional({
    maxLength: 50,
    description: '商家内唯一；可省略，由服务端生成随机采购单号',
  })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  orderNo?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() warehouseId!: string;
  @ApiProperty({ enum: PURCHASE_PLATFORMS }) @IsIn(PURCHASE_PLATFORMS) platform!: PurchasePlatform;
  @ApiProperty({ example: '2026-10-21', format: 'date', description: '真实日历日期 YYYY-MM-DD' })
  @IsString()
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  purchaseDate!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @NullableTrim()
  @ValidateIf(nonNull)
  @IsString()
  @MaxLength(100)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  platformOrderNo?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @NullableTrim()
  @ValidateIf(nonNull)
  @IsString()
  @MaxLength(200)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  supplierName?: string | null;
  @ApiProperty({ type: PurchaseRecipientDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PurchaseRecipientDto)
  recipient!: PurchaseRecipientDto;
  @ApiPropertyOptional({ type: String, default: '0.00', example: '10.00' })
  @ValidateIf(present)
  @IsString()
  @Matches(money)
  freightAmount?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @NullableTrim()
  @ValidateIf(nonNull)
  @IsString()
  @MaxLength(2000)
  @NotContains('\u0000')
  remark?: string | null;
  @ApiProperty({ type: [PurchaseLineInputDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((line: PurchaseLineInputDto) =>
    typeof line?.productId === 'string' ? line.productId.toLowerCase() : line?.productId,
  )
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineInputDto)
  items!: PurchaseLineInputDto[];
}
// Undefined skips validation; null still fails required fields, unlike the default PartialType behavior.
export class UpdatePurchaseDto extends PartialType(CreatePurchaseDto, {
  skipNullProperties: false,
}) {}
export class PurchaseIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
}
export class PurchaseListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description: '单号、平台订单号、店铺、商品快照的字面子串',
  })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @NotContains('\u0000')
  search?: string;
  @ApiPropertyOptional({ enum: PURCHASE_STATUSES })
  @ValidateIf(present)
  @IsIn(PURCHASE_STATUSES)
  status?: PurchaseStatus;
  @ApiPropertyOptional({ enum: PURCHASE_PLATFORMS })
  @ValidateIf(present)
  @IsIn(PURCHASE_PLATFORMS)
  platform?: PurchasePlatform;
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf(present) @IsUUID() warehouseId?: string;
}
export class PurchaseItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty({ type: Number, nullable: true }) lineNo!: number | null;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() receivedQuantity!: number;
  @ApiProperty({ example: '18.50' }) unitPrice!: string;
  @ApiProperty() discountAmount!: string;
  @ApiProperty() lineNet!: string;
  @ApiProperty({ type: String, nullable: true }) freightAllocated!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '19.5000' }) landedUnitCost!: string | null;
}
export class PurchaseRecipientResultDto {
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
}
export class PurchaseOrderDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() orderNo!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ enum: PURCHASE_PLATFORMS }) platform!: PurchasePlatform;
  @ApiProperty({ type: String, nullable: true }) platformOrderNo!: string | null;
  @ApiProperty({ type: String, nullable: true }) supplierName!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) purchaseDate!: string | null;
  @ApiProperty({ enum: PURCHASE_STATUSES }) status!: PurchaseStatus;
  @ApiProperty({ type: PurchaseRecipientResultDto }) recipient!: PurchaseRecipientResultDto;
  @ApiProperty() recipientMasked!: boolean;
  @ApiProperty() freightAmount!: string;
  @ApiProperty() goodsAmount!: string;
  @ApiProperty() discountAmount!: string;
  @ApiProperty({ example: '195.00' }) totalCost!: string;
  @ApiProperty({ type: String, nullable: true }) remark!: string | null;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) placedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: [PurchaseItemDto] }) items!: PurchaseItemDto[];
}
