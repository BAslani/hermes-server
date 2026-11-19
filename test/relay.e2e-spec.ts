import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config.js';
import { configureApp } from '../src/setup.js';

const ORIGIN = 'http://localhost:3000';

/** A ws client that queues what it receives, so a test can await by type. */
class Client {
  private readonly inbox: any[] = [];
  private waiting: { type: string; resolve: (m: any) => void }[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(String(data as Buffer));
      const i = this.waiting.findIndex((w) => w.type === message.type);
      if (i >= 0) this.waiting.splice(i, 1)[0].resolve(message);
      else this.inbox.push(message);
    });
  }

  static async connect(url: string, origin = ORIGIN) {
    const socket = new WebSocket(url, { origin });
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new Client(socket);
  }

  send(message: object) {
    this.socket.send(JSON.stringify(message));
  }

  next(type: string): Promise<any> {
    const i = this.inbox.findIndex((m) => m.type === type);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve) => this.waiting.push({ type, resolve }));
  }
}

describe('co-op relay (e2e)', () => {
  let app: INestApplication;
  let url: string;
  const clients: Client[] = [];

  const connect = async () => {
    const client = await Client.connect(url);
    clients.push(client);
    return client;
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(moduleRef.createNestApplication(), loadConfig({}));
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `ws://localhost:${port}/ws`;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.socket.terminate();
    await app.close();
  });

  it('pairs two players and relays a state message with the sender role', async () => {
    const host = await connect();
    const guest = await connect();

    host.send({ type: 'create', scenario: 'karaj-launchers', role: 'drone' });
    const created = await host.next('created');
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    guest.send({ type: 'join', code: created.code, role: 'jet' });
    expect(await guest.next('joined')).toMatchObject({
      code: created.code,
      scenario: 'karaj-launchers',
      hostRole: 'drone',
    });
    expect(await host.next('peer-joined')).toEqual({
      type: 'peer-joined',
      role: 'jet',
    });

    const state = {
      position: [100, -250, 1200],
      velocity: [170, 0, 0],
      orientation: [0, 0, 0, 1],
      t: 42.5,
    };
    guest.send({ type: 'state', ...state });
    expect(await host.next('state')).toEqual({
      type: 'state',
      ...state,
      from: 'jet',
    });

    const health = await request(app.getHttpServer()).get('/health');
    expect(health.body).toEqual({ ok: true, rooms: 1 });

    host.socket.close();
    expect(await guest.next('room-closed')).toEqual({
      type: 'room-closed',
      reason: 'host-left',
    });
  });

  it('answers bad input with an error and keeps the connection', async () => {
    const client = await connect();
    client.send({ type: 'join', code: 'ABCDEF', role: 'jet' });
    expect(await client.next('error')).toMatchObject({
      code: 'room-not-found',
    });
    client.socket.send('not json');
    expect(await client.next('error')).toMatchObject({ code: 'bad-message' });
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('refuses upgrades from other origins', async () => {
    await expect(Client.connect(url, 'https://other.example')).rejects.toThrow(
      /403/,
    );
  });
});
