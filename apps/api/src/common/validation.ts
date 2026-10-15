import { ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { BusinessException } from './errors.js';

function validationFields(
  errors: ValidationError[],
  parent = '',
): { field: string; rules: string[] }[] {
  return errors
    .slice(0, 50)
    .flatMap((error) => {
      const property =
        error.constraints?.whitelistValidation || !/^[\w]{1,64}$/.test(error.property)
          ? '[unknown]'
          : error.property;
      const path = parent ? `${parent}.${property}` : property;
      return [
        ...(error.constraints ? [{ field: path, rules: Object.keys(error.constraints) }] : []),
        ...validationFields(error.children ?? [], path),
      ];
    })
    .slice(0, 50);
}
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new BusinessException('VALIDATION_ERROR', { fields: validationFields(errors) }),
  });
}
