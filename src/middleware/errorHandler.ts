import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../types';
import { isProduction } from '../config/env';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: { message: 'Validation failed', details: err.flatten() },
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false,
      error: { message: err.message, details: err.details },
    });
  }

  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  return res.status(500).json({
    success: false,
    error: {
      message: 'Internal server error',
      details: isProduction ? undefined : String((err as Error)?.stack ?? err),
    },
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, error: { message: `Not found: ${req.method} ${req.path}` } });
}
