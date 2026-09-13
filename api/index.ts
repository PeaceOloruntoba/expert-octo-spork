import { createApp } from '../src/app';

// Vercel's Node runtime calls exported handlers as (req, res) — the same signature
// an Express app already has, so we export it directly. (Previously this wrapped
// the app in `serverless-http`, which expects AWS Lambda's (event, context) shape
// instead and doesn't work as a Vercel handler.)
export default createApp();