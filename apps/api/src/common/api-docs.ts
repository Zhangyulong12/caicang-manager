import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiProperty, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { API_ERROR_CODES } from '@caicang/api-contract';

export class ApiTraceDto {
  @ApiProperty({ format: 'uuid' }) requestId!: string;
}
export class ApiEnvelopeDto extends ApiTraceDto {
  @ApiProperty({ nullable: true, type: Object }) data!: unknown;
}
export class PaginationDto {
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
  @ApiProperty({ minimum: 0 }) total!: number;
}
export class ApiErrorDto {
  @ApiProperty({ enum: API_ERROR_CODES }) code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ type: Object, additionalProperties: true }) details!: Record<string, unknown>;
}
export class ApiErrorResponseDto {
  @ApiProperty({ type: ApiErrorDto }) error!: ApiErrorDto;
  @ApiProperty({ format: 'uuid' }) requestId!: string;
}
export function ApiDataResponse(model: Type<unknown>, status = 200) {
  return applyDecorators(
    ApiExtraModels(ApiEnvelopeDto, model),
    ApiResponse({
      status,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiEnvelopeDto) },
          { properties: { data: { $ref: getSchemaPath(model) } } },
        ],
      },
    }),
  );
}
export function ApiPageResponse(model: Type<unknown>) {
  return applyDecorators(
    ApiExtraModels(ApiTraceDto, PaginationDto, model),
    ApiResponse({
      status: 200,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiTraceDto) },
          {
            required: ['data', 'pagination'],
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(model) } },
              pagination: { $ref: getSchemaPath(PaginationDto) },
            },
          },
        ],
      },
    }),
  );
}

export function ApiArrayResponse(model: Type<unknown>, maxItems?: number) {
  return applyDecorators(
    ApiExtraModels(ApiTraceDto, model),
    ApiResponse({
      status: 200,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiTraceDto) },
          {
            required: ['data'],
            properties: {
              data: {
                type: 'array',
                items: { $ref: getSchemaPath(model) },
                ...(maxItems === undefined ? {} : { maxItems }),
              },
            },
          },
        ],
      },
    }),
  );
}
