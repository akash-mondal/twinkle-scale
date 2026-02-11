import type { ErrorHandler } from 'hono';

export const errorHandler: ErrorHandler = (err, c) => {
  console.error(`[error] ${err.message}`);
  const status = (err as any).status || 500;
  return c.json({
    error: err.name || 'InternalServerError',
    message: err.message,
    status,
  }, status);
};
