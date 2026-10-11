import { loadEnv } from './config/env.js';
import { API_PREFIX, createApp } from './bootstrap.js';

const env = loadEnv();
const app = await createApp(env);
await app.listen({ host: env.HOST, port: env.PORT });
app
  .getHttpAdapter()
  .getInstance()
  .log.info(
    `API listening on http://${env.HOST}:${env.PORT}/${API_PREFIX}${env.SERVE_WEB ? ' (serving web apps)' : ''}`,
  );
