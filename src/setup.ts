import { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Config, isAllowedOrigin } from './config.js';
import { rawMessageParser } from './coop.gateway.js';
import { MAX_FRAME_BYTES } from './protocol.js';

/** Shared by main.ts and the e2e test, so both run the same server. */
export function configureApp(app: INestApplication, config: Config) {
  app.useWebSocketAdapter(
    new WsAdapter(app, {
      messageParser: rawMessageParser,
      maxPayload: MAX_FRAME_BYTES,
    }),
  );
  // The same origins as the socket, for /health.
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) =>
      callback(null, origin === undefined || isAllowedOrigin(origin, config)),
  });
  app.enableShutdownHooks();
  return app;
}
