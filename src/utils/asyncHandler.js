/**
 * Wraps an async express handler so rejected promises reach the error middleware
 * instead of hanging the request.
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
