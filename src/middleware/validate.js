import { ApiError } from '../utils/ApiError.js';

/**
 * Validates req.body against a zod schema and replaces it with the parsed
 * (coerced, stripped) result.
 */
export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const details = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || 'body';
      if (!details[key]) details[key] = issue.message;
    }
    return next(ApiError.badRequest('Please check the highlighted fields', details));
  }
  req.body = result.data;
  next();
};

export const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    return next(ApiError.badRequest('Invalid query parameters'));
  }
  req.validatedQuery = result.data;
  next();
};
