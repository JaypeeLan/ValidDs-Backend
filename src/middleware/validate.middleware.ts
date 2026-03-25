import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from './error.middleware';

/**
 * Request validation middleware factory.
 *
 * Wraps a Zod schema and validates the specified part of the request.
 * On failure, throws a ValidationError with structured field-level errors
 * that get caught by the global error handler.
 *
 * Usage:
 *   router.get('/products', validate(GetProductsSchema, 'query'), controller.list);
 *   router.post('/products', validate(CreateProductSchema, 'body'), controller.create);
 */

type RequestPart = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, part: RequestPart = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      return next(new ValidationError(errors));
    }

    // Replace the request part with the parsed (and coerced) data
    // so downstream handlers get clean typed values
    (req as any)[part] = result.data;
    next();
  };
}

function formatZodErrors(error: ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.join('.') || 'root';
    if (!formatted[field]) formatted[field] = [];
    formatted[field].push(issue.message);
  }

  return formatted;
}
