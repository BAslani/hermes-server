import { describe, expect, it } from 'vitest';
import {
  isAllowedOrigin,
  isPrivateNetworkOrigin,
  loadConfig,
} from './config.js';

describe('origins', () => {
  it('accepts pages on this machine and the local network, on any port', () => {
    for (const origin of [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://10.168.83.23:3000',
      'http://172.20.1.5:3000',
      'http://192.168.1.191:3000',
      'https://192.168.0.2',
    ])
      expect(isPrivateNetworkOrigin(origin), origin).toBe(true);
    for (const origin of [
      'https://hermes.example',
      'http://172.32.0.1:3000',
      'http://8.8.8.8:3000',
      'http://192.168.1.191.evil.example',
      'file://',
      'null',
    ])
      expect(isPrivateNetworkOrigin(origin), origin).toBe(false);
  });

  it('allows the local network by default in development, not in production', () => {
    expect(loadConfig({}).allowPrivateNetwork).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production' }).allowPrivateNetwork).toBe(
      false,
    );
    expect(
      loadConfig({ NODE_ENV: 'production', ALLOW_PRIVATE_NETWORK: 'true' })
        .allowPrivateNetwork,
    ).toBe(true);
    expect(
      loadConfig({ ALLOW_PRIVATE_NETWORK: 'false' }).allowPrivateNetwork,
    ).toBe(false);
  });

  it('checks the listed origins first, then the local network when allowed', () => {
    const strict = loadConfig({
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: 'https://hermes.example',
    });
    expect(isAllowedOrigin('https://hermes.example', strict)).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000', strict)).toBe(false);
    const dev = loadConfig({});
    expect(isAllowedOrigin('http://10.168.83.23:3000', dev)).toBe(true);
    expect(isAllowedOrigin('https://other.example', dev)).toBe(false);
    expect(isAllowedOrigin(undefined, dev)).toBe(false);
  });
});
