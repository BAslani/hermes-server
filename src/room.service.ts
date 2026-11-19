import { Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';

export type Role = 'drone' | 'jet';

export interface Player {
  id: string;
  role: Role;
}

export interface Room {
  code: string;
  scenario: string;
  /** The creator. Its browser runs the game rules. */
  host: Player;
  guest: Player | null;
  /** Last create, join or relayed message, in ms. */
  lastActive: number;
}

export type JoinError = 'room-not-found' | 'room-full' | 'role-taken';

export interface LeaveResult {
  room: Room;
  /** The host left, so the room is gone. */
  closed: boolean;
  /** Whoever is still in the room (or was, if it closed). */
  peer: Player | null;
}

/** No 0/O or 1/I, so a code read aloud or off a screen can't be mistyped. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const ROOM_IDLE_MS = 10 * 60 * 1000;

export const normalizeCode = (code: string) => code.trim().toUpperCase();

/** In-memory rooms of at most two players: a host and a guest with different roles. */
@Injectable()
export class RoomService {
  private readonly rooms = new Map<string, Room>();

  get size() {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  create(scenario: string, role: Role, now = Date.now()) {
    const player: Player = { id: randomUUID(), role };
    const room: Room = {
      code: this.newCode(),
      scenario,
      host: player,
      guest: null,
      lastActive: now,
    };
    this.rooms.set(room.code, room);
    return { room, player };
  }

  join(
    code: string,
    role: Role,
    now = Date.now(),
  ): { room: Room; player: Player } | { error: JoinError } {
    const room = this.get(code);
    if (!room) return { error: 'room-not-found' };
    if (room.guest) return { error: 'room-full' };
    if (room.host.role === role) return { error: 'role-taken' };
    const player: Player = { id: randomUUID(), role };
    room.guest = player;
    room.lastActive = now;
    return { room, player };
  }

  /** Takes a player out. The host leaving closes the room. */
  leave(code: string, playerId: string): LeaveResult | null {
    const room = this.rooms.get(code);
    if (!room) return null;
    if (room.host.id === playerId) {
      this.rooms.delete(code);
      return { room, closed: true, peer: room.guest };
    }
    if (room.guest?.id === playerId) {
      room.guest = null;
      return { room, closed: false, peer: room.host };
    }
    return null;
  }

  peerOf(room: Room, playerId: string): Player | null {
    if (room.host.id === playerId) return room.guest;
    if (room.guest?.id === playerId) return room.host;
    return null;
  }

  touch(code: string, now = Date.now()) {
    const room = this.rooms.get(code);
    if (room) room.lastActive = now;
  }

  /** Removes and returns the rooms idle for longer than ROOM_IDLE_MS. */
  expire(now = Date.now()): Room[] {
    const expired: Room[] = [];
    for (const room of this.rooms.values()) {
      if (now - room.lastActive > ROOM_IDLE_MS) expired.push(room);
    }
    for (const room of expired) this.rooms.delete(room.code);
    return expired;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }
}
