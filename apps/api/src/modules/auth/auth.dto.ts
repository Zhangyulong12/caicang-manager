import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
  NotContains,
  IsStrongPassword,
  ValidateIf,
  registerDecorator,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const BcryptPassword =
  () =>
  (object: object, propertyName: string): void =>
    registerDecorator({
      name: 'bcryptPassword',
      target: object.constructor,
      propertyName,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          Buffer.byteLength(value) <= 72 &&
          [...value].every((character) => {
            const point = character.codePointAt(0) ?? 0;
            return point >= 32 && point !== 127 && !(point >= 0xd800 && point <= 0xdfff);
          }),
      },
    });

class EmailDto {
  @ApiProperty({ example: 'new-user@example.com', format: 'email', maxLength: 320 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class LoginDto extends EmailDto {
  @ApiProperty({
    example: 'CaicangDemo!2026',
    format: 'password',
    writeOnly: true,
    maxLength: 72,
    description: '密码原样验证，不去空格；最多 72 个 UTF-8 字节',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  @BcryptPassword()
  password!: string;
}
export class RegisterDto extends EmailDto {
  @ApiProperty({
    example: 'CaicangDemo!2026',
    format: 'password',
    writeOnly: true,
    minLength: 12,
    maxLength: 72,
    description: '至少 12 字符，包含大小写字母、数字、符号；最多 72 个 UTF-8 字节',
  })
  @IsStrongPassword({
    minLength: 12,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
  @IsString()
  @MaxLength(72)
  @BcryptPassword()
  password!: string;

  @ApiPropertyOptional({
    example: '新用户',
    maxLength: 100,
    description: '可省略，默认使用邮箱 @ 前的部分',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @NotContains('\u0000')
  displayName?: string;
}
export class PublicUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class RegisterResultDto {
  @ApiProperty({ type: PublicUserDto }) user!: PublicUserDto;
}
export class LoginResultDto {
  @ApiProperty({ description: '短期 JWT，只用于 Authorization: Bearer 请求头' })
  accessToken!: string;
  @ApiProperty({ enum: ['Bearer'] }) tokenType!: 'Bearer';
  @ApiProperty({ example: 900, minimum: 60, maximum: 900 }) expiresIn!: number;
  @ApiProperty({ type: PublicUserDto }) user!: PublicUserDto;
}
