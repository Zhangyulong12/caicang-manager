import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, Matches, NotContains, ValidateIf } from 'class-validator';

const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class CreateWarehouseDto {
  @ApiProperty({ example: '深圳二仓', minLength: 1, maxLength: 100 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  name!: string;

  @ApiProperty({
    example: 'SZ-02',
    minLength: 1,
    maxLength: 40,
    description: '商家内唯一；区分大小写，保留前导零',
  })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  code!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000, example: '小件商品存放区' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  @NotContains('\u0000')
  remark?: string | null;
}

export class WarehouseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ example: '深圳二仓' }) name!: string;
  @ApiProperty({ example: 'SZ-02' }) code!: string;
  @ApiProperty({ type: String, nullable: true }) remark!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
