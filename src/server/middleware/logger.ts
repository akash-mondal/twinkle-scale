import type { MiddlewareHandler } from 'hono';

export const logger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const status = c.res.status;
  const method = c.req.method;
  const path = c.req.path;
  console.log(`  ${method} ${path} → ${status} (${ms}ms)`);
};
