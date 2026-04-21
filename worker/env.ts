export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  SESSIONS: KVNamespace;

  APP_URL: string;

  FAL_KEY: string;

  WORKOS_API_KEY: string;
  WORKOS_CLIENT_ID: string;
  WORKOS_COOKIE_PASSWORD: string;

  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;

  OPENAI_API_KEY: string;
}

export type AppVariables = {
  userId: string;
  userEmail: string;
};
