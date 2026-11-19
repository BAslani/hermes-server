export const DEFAULT_PORT = 4000;
export const DEFAULT_ORIGINS = ['http://localhost:3000'];

export interface Config {
  port: number;
  allowedOrigins: string[];
}

/** Reads PORT and ALLOWED_ORIGINS (comma-separated) from the environment. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT);
  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return {
    port: Number.isInteger(port) && port >= 0 ? port : DEFAULT_PORT,
    allowedOrigins: origins.length > 0 ? origins : DEFAULT_ORIGINS,
  };
}

/** Browsers always send Origin on a WebSocket upgrade; anything else is refused. */
export function isAllowedOrigin(
  origin: string | undefined,
  allowed = loadConfig().allowedOrigins,
): boolean {
  return origin !== undefined && allowed.includes(origin);
}
