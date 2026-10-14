import * as Joi from 'joi';

/**
 * Secrets are required in every environment EXCEPT local development, where
 * individual services (JwtStrategy, RazorpayService) already throw at
 * construction time if they're missing — this schema adds one fail-fast
 * check at process startup so a misconfigured staging/production deploy
 * never gets as far as handling a request before surfacing the problem.
 */
const isDev = (process.env.NODE_ENV ?? 'development') === 'development';
// .allow('') on the dev branch: an unset-but-present "FOO=" in .env.example
// style scaffolding is common in dev and shouldn't fail startup — only
// non-dev environments actually require these to be non-empty.
const secretPresence = isDev ? Joi.string().optional().allow('') : Joi.string().required();

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: secretPresence,
  JWT_EXPIRES_IN: Joi.string().default('30d'),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  RAZORPAY_KEY_ID: secretPresence,
  RAZORPAY_KEY_SECRET: secretPresence,
  RAZORPAY_WEBHOOK_SECRET: secretPresence,
  PORT: Joi.number().default(4000),
  CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
  OTP_PROVIDER: Joi.string().default('console'),
}).unknown(true);
