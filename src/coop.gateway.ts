import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { WebSocket } from 'ws';
import { isAllowedOrigin } from './config.js';
import {
  ErrorCode,
  GUEST_ONLY,
  HOST_ONLY,
  parseMessage,
  RelayMessage,
} from './protocol.js';
import { JoinError, Player, Role, RoomService } from './room.service.js';

export const HEARTBEAT_MS = 15_000;
export const EXPIRY_SWEEP_MS = 60_000;
export const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 1000;

/** What the server knows about one socket. */
interface Connection {
  /** Answered the last ping. */
  alive: boolean;
  windowStart: number;
  count: number;
  code: string | null;
  player: Player | null;
}

const JOIN_ERRORS: Record<JoinError, string> = {
  'room-not-found': 'No room has that code.',
  'room-full': 'That room already has two players.',
  'role-taken': 'The other player already has that role.',
};

/** Hands every frame to `onMessage` as is; it parses and validates it. */
export const rawMessageParser = (data: unknown) => ({
  event: 'message',
  data,
});

/**
 * Rooms and relay for online co-op. The host's browser runs the game; this
 * only pairs two players and forwards what they send each other.
 */
@WebSocketGateway({
  path: '/ws',
  verifyClient: (
    info: { origin?: string },
    done: (ok: boolean, status?: number) => void,
  ) => done(isAllowedOrigin(info.origin), 403),
})
export class CoopGateway
  implements
    OnGatewayConnection<WebSocket>,
    OnGatewayDisconnect<WebSocket>,
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(CoopGateway.name);
  private readonly connections = new Map<WebSocket, Connection>();
  /** Player id → its socket. */
  private readonly sockets = new Map<string, WebSocket>();
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly rooms: RoomService) {}

  onModuleInit() {
    this.timers = [
      setInterval(() => this.heartbeat(), HEARTBEAT_MS),
      setInterval(() => this.expireRooms(), EXPIRY_SWEEP_MS),
    ];
    for (const timer of this.timers) timer.unref();
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearInterval(timer);
  }

  handleConnection(client: WebSocket) {
    const connection: Connection = {
      alive: true,
      windowStart: 0,
      count: 0,
      code: null,
      player: null,
    };
    this.connections.set(client, connection);
    client.on('pong', () => {
      connection.alive = true;
    });
  }

  handleDisconnect(client: WebSocket) {
    const connection = this.connections.get(client);
    if (connection) this.leaveRoom(connection);
    this.connections.delete(client);
  }

  @SubscribeMessage('message')
  onMessage(@ConnectedSocket() client: WebSocket, @MessageBody() raw: unknown) {
    try {
      this.handle(client, raw);
    } catch (err) {
      this.logger.error(err);
    }
  }

  private handle(client: WebSocket, raw: unknown) {
    const connection = this.connections.get(client);
    if (!connection || !this.withinRate(connection)) return;

    const parsed = parseMessage(raw);
    if (!parsed.ok) {
      this.sendError(client, 'bad-message', parsed.reason);
      return;
    }
    const message = parsed.message;
    switch (message.type) {
      case 'create':
        return this.create(client, connection, message.scenario, message.role);
      case 'join':
        return this.join(client, connection, message.code, message.role);
      case 'leave':
        return this.leaveRoom(connection);
      default:
        return this.relay(client, connection, message);
    }
  }

  private create(
    client: WebSocket,
    connection: Connection,
    scenario: string,
    role: Role,
  ) {
    if (connection.code) {
      return this.sendError(client, 'bad-message', 'Already in a room.');
    }
    const { room, player } = this.rooms.create(scenario, role);
    this.attach(client, connection, room.code, player);
    this.send(client, {
      type: 'created',
      code: room.code,
      playerId: player.id,
    });
  }

  private join(
    client: WebSocket,
    connection: Connection,
    code: string,
    role: Role,
  ) {
    if (connection.code) {
      return this.sendError(client, 'bad-message', 'Already in a room.');
    }
    const result = this.rooms.join(code, role);
    if ('error' in result) {
      return this.sendError(client, result.error, JOIN_ERRORS[result.error]);
    }
    const { room, player } = result;
    this.attach(client, connection, room.code, player);
    this.send(client, {
      type: 'joined',
      code: room.code,
      playerId: player.id,
      scenario: room.scenario,
      hostRole: room.host.role,
    });
    this.sendTo(room.host.id, { type: 'peer-joined', role: player.role });
    this.send(client, { type: 'peer-joined', role: room.host.role });
  }

  private relay(
    client: WebSocket,
    connection: Connection,
    message: RelayMessage,
  ) {
    const { code, player } = connection;
    const room = code ? this.rooms.get(code) : undefined;
    if (!room || !player) {
      return this.sendError(client, 'bad-message', 'Not in a room.');
    }
    const isHost = room.host.id === player.id;
    if (
      (HOST_ONLY.has(message.type) && !isHost) ||
      (GUEST_ONLY.has(message.type) && isHost)
    ) {
      this.logger.warn(
        `Dropped "${message.type}" from the ${isHost ? 'host' : 'guest'} of ${room.code}`,
      );
      return;
    }
    this.rooms.touch(room.code);
    const peer = this.rooms.peerOf(room, player.id);
    if (peer) this.sendTo(peer.id, { ...message, from: player.role });
  }

  /** Takes a connection out of its room and tells whoever is left. */
  private leaveRoom(connection: Connection) {
    const { code, player } = connection;
    if (!code || !player) return;
    this.detach(player.id);
    const result = this.rooms.leave(code, player.id);
    if (!result?.peer) return;
    if (result.closed) {
      this.sendTo(result.peer.id, { type: 'room-closed', reason: 'host-left' });
      this.detach(result.peer.id);
    } else {
      this.sendTo(result.peer.id, { type: 'peer-left', role: player.role });
    }
  }

  private expireRooms() {
    for (const room of this.rooms.expire()) {
      this.logger.log(`Room ${room.code} expired`);
      for (const player of [room.host, room.guest]) {
        if (!player) continue;
        this.sendTo(player.id, { type: 'room-closed', reason: 'expired' });
        this.detach(player.id);
      }
    }
  }

  /** Drops connections that missed the last ping; closing them leaves their room. */
  private heartbeat() {
    for (const [client, connection] of this.connections) {
      if (!connection.alive) {
        client.terminate();
        continue;
      }
      connection.alive = false;
      client.ping();
    }
  }

  private withinRate(connection: Connection, now = Date.now()) {
    if (now - connection.windowStart >= RATE_WINDOW_MS) {
      connection.windowStart = now;
      connection.count = 0;
    }
    connection.count++;
    if (connection.count === RATE_LIMIT + 1) {
      this.logger.warn(
        `Rate limit: dropping messages from ${connection.player?.id ?? 'a connection'}`,
      );
    }
    return connection.count <= RATE_LIMIT;
  }

  private attach(
    client: WebSocket,
    connection: Connection,
    code: string,
    player: Player,
  ) {
    connection.code = code;
    connection.player = player;
    this.sockets.set(player.id, client);
  }

  private detach(playerId: string) {
    const client = this.sockets.get(playerId);
    this.sockets.delete(playerId);
    const connection = client && this.connections.get(client);
    if (connection) {
      connection.code = null;
      connection.player = null;
    }
  }

  private sendTo(playerId: string, message: object) {
    const client = this.sockets.get(playerId);
    if (client) this.send(client, message);
  }

  private sendError(client: WebSocket, code: ErrorCode, message: string) {
    this.send(client, { type: 'error', code, message });
  }

  private send(client: WebSocket, message: object) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}
