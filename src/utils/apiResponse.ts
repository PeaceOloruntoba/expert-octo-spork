import { Response } from 'express';

export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function created<T>(res: Response, data: T) {
  return ok(res, data, 201);
}

export function fail(res: Response, status: number, message: string, details?: unknown) {
  return res.status(status).json({ success: false, error: { message, details } });
}
