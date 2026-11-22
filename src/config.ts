export const DEFAULT_PORT = 4000;
export const DEFAULT_ORIGINS = ['http://localhost:3000'];

export interface Config {
  port: number;
  allowedOrigins: string[];
  /**
   * Also allow any page served from this machine or the local network
   * (localhost, 127.x, 10.x, 172.16–31.x, 192.168.x), on any port. On by
   * default outside production, so the game works on the laptop alone and
   * from another device on the same Wi-Fi without listing addresses that
   * change from network to network.
   */
  allowPrivateNetwork: boolean;
}

/**
 * Reads PORT, ALLOWED_ORIGINS (comma-separated) and ALLOW_PRIVATE_NETWORK
 * ("true" or "false"; unset, true unless NODE_ENV is production).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT);
  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const privateNetwork = env.ALLOW_PRIVATE_NETWORK?.trim().toLowerCase();
  return {
    port: Number.isInteger(port) && port >= 0 ? port : DEFAULT_PORT,
    allowedOrigins: origins.length > 0 ? origins : DEFAULT_ORIGINS,
    allowPrivateNetwork: privateNetwork
      ? privateNetwork === 'true'
      : env.NODE_ENV !== 'production',
  };
}

/** Whether an origin is a page on this machine or the local network (http or https, any port). */
export function isPrivateNetworkOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]')
    return true;
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p)))
    return false;
  const [a, b] = parts.map(Number);
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** Browsers always send Origin on a WebSocket upgrade; anything else is refused. */
export function isAllowedOrigin(
  origin: string | undefined,
  config: Pick<Config, 'allowedOrigins' | 'allowPrivateNetwork'> = loadConfig(),
): boolean {
  if (origin === undefined) return false;
  if (config.allowedOrigins.includes(origin)) return true;
  return config.allowPrivateNetwork && isPrivateNetworkOrigin(origin);
}
