import serverless from 'serverless-http';
import { createApp } from '../src/app';

const app = createApp();

// Wraps the Express app as a single Vercel serverless function. vercel.json rewrites
// all /api/* traffic here (see rewrites), so this file's path segment is arbitrary.
export default serverless(app);
