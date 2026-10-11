import type { ValidationIssue } from '@arabat/contracts';
import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../errors/app-error.js';

/**
 * Validates and parses a request part with a Zod schema from `@arabat/contracts`.
 * Usage: `@Body(new ZodPipe(createBranchSchema)) body: CreateBranch`.
 */
export class ZodPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw AppError.validation(toIssues(result.error));
  }
}

export function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}
