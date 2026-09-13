import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../types';
import { UserRole } from '../types';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new ApiError(401, 'Authentication required'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, `Requires one of roles: ${roles.join(', ')}`));
    }
    next();
  };
}
