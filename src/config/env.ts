import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  apiBasePath: process.env.API_BASE_PATH ?? '/api/v1',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',

  databaseUrl: required('DATABASE_URL', 'postgres://user:password@localhost:5432/fertility_marketplace'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX ?? 10),

  jwtAccessSecret: required('JWT_ACCESS_SECRET', 'dev_access_secret_change_me_please_32ch'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'dev_refresh_secret_change_me_please_32c'),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',

  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpFrom: process.env.SMTP_FROM ?? 'Bunzi Fertility Marketplace <no-reply@example.com>',

  appUrl: process.env.APP_URL ?? 'http://localhost:5173',

  kycMockMode: process.env.KYC_MOCK_MODE !== 'false',
  escrowMockMode: process.env.ESCROW_MOCK_MODE !== 'false',
  geneticLabMockMode: process.env.GENETIC_LAB_MOCK_MODE !== 'false',
};

export const isProduction = env.nodeEnv === 'production';
