import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsUUID,
  MinLength,
  MaxLength,
  Matches,
  NotContains,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.dto.js';

const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const NullableTrim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  );
const QueryBoolean = () =>
  Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );
const present = (_object: unknown, value: unknown) => value !== undefined;
const nonNull = (_object: unknown, value: unknown) => value !== undefined && value !== null;

class ProductDetailsDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200, example: 'USB-C PD，白色' })
  @NullableTrim()
  @ValidateIf(nonNull)
  @IsString()
  @MaxLength(200)
  @NotContains('\u0000')
  specification?: string | null;

  @ApiPropertyOptional({ default: '件', maxLength: 20, example: '个' })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  unit?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 128,
    example: '0001234567890',
    description: '空白/null 表示无条码；保留大小写、内部字符与前导零',
  })
  @NullableTrim()
  @ValidateIf(nonNull)
  @IsString()
  @MaxLength(128)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  barcode?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '18.50',
    pattern: '^(0|[1-9][0-9]{0,15})(\\.[0-9]{1,2})?$',
    description: '仅非负十进制字符串，最多两位小数；null 为未知，不影响订单价格',
  })
  @ValidateIf(nonNull)
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)
  referencePurchasePrice?: string | null;

  @ApiPropertyOptional({ default: true })
  @ValidateIf(present)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000, example: '支持 PD 快充' })
  @NullableTrim()
  @ValidateIf(nonNull)
  @IsString()
  @MaxLength(2000)
  @NotContains('\u0000')
  remark?: string | null;
}
export class CreateProductDto extends ProductDetailsDto {
  @ApiProperty({ example: '20W 充电器', maxLength: 200 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  name!: string;
  @ApiProperty({ example: 'CHARGER-20W', maxLength: 80 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  sku!: string;
}
export class UpdateProductDto extends ProductDetailsDto {
  @ApiPropertyOptional({ example: '20W 充电器', maxLength: 200 })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  name?: string;
  @ApiPropertyOptional({ example: 'CHARGER-20W', maxLength: 80 })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  sku?: string;
}
export class ProductListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description: '名称/SKU/条码/规格的字面子串，不区分大小写',
  })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @NotContains('\u0000')
  search?: string;
  @ApiPropertyOptional({ type: Boolean, description: '省略则含启用与停用；只接受 true/false' })
  @QueryBoolean()
  @ValidateIf(present)
  @IsBoolean()
  isActive?: boolean;
  @ApiPropertyOptional({ type: Boolean })
  @QueryBoolean()
  @ValidateIf(present)
  @IsBoolean()
  hasBarcode?: boolean;
  @ApiPropertyOptional({ maxLength: 20 })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @NotContains('\u0000')
  unit?: string;
}
export class ProductLookupQueryDto {
  @ApiProperty({ example: 'CHARGER-20W', minLength: 1, maxLength: 128 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  code!: string;
}
export class ProductIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
}
export class ProductDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ example: '20W 充电器' }) name!: string;
  @ApiProperty({ example: 'CHARGER-20W' }) sku!: string;
  @ApiProperty({ type: String, nullable: true }) specification!: string | null;
  @ApiProperty({ example: '个' }) unit!: string;
  @ApiProperty({ type: String, nullable: true }) barcode!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '18.50' }) referencePurchasePrice!:
    string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ type: String, nullable: true }) remark!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
