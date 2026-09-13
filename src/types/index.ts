export type UserRole = 'donor' | 'recipient' | 'clinic_staff' | 'admin' | 'ethics_reviewer';

export interface AuthUser {
  id: string;
  role: UserRole;
  jurisdiction: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
