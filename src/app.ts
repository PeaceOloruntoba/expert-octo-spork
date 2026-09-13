import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isProduction } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
import donorsRoutes from './modules/donors/donors.routes';
import searchRoutes from './modules/search/search.routes';
import verificationRoutes from './modules/verification/verification.routes';
import screeningRoutes from './modules/screening/screening.routes';
import consentRoutes from './modules/consent/consent.routes';
import messagingRoutes from './modules/messaging/messaging.routes';
import transactionsRoutes from './modules/transactions/transactions.routes';
import disputesRoutes from './modules/disputes/disputes.routes';
import rulesRoutes from './modules/rules/rules.routes';
import trustSafetyRoutes from './modules/trustsafety/trustsafety.routes';
import clinicRoutes from './modules/clinic/clinic.routes';
import adminRoutes from './modules/admin/admin.routes';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((o) => o.trim()),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan(isProduction ? 'combined' : 'dev'));

  app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  const base = env.apiBasePath;
  app.use(`${base}/auth`, authRoutes);
  app.use(`${base}/users`, usersRoutes);
  app.use(`${base}/donors`, donorsRoutes);
  app.use(`${base}/search`, searchRoutes);
  app.use(`${base}/verification`, verificationRoutes);
  app.use(`${base}/screening`, screeningRoutes);
  app.use(`${base}/consent`, consentRoutes);
  app.use(`${base}/messaging`, messagingRoutes);
  app.use(`${base}/transactions`, transactionsRoutes);
  app.use(`${base}/disputes`, disputesRoutes);
  app.use(`${base}/jurisdictions`, rulesRoutes);
  app.use(`${base}/trust-safety`, trustSafetyRoutes);
  app.use(`${base}/clinic`, clinicRoutes);
  app.use(`${base}/admin`, adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
