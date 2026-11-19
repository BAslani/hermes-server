import {
  CODE_ALPHABET,
  CODE_LENGTH,
  ROOM_IDLE_MS,
  RoomService,
} from './room.service.js';

describe('RoomService', () => {
  let rooms: RoomService;

  beforeEach(() => {
    rooms = new RoomService();
  });

  it('creates a room with a short unambiguous code, the creator as host', () => {
    const { room, player } = rooms.create('karaj-launchers', 'drone');
    expect(room.code).toHaveLength(CODE_LENGTH);
    expect(room.code).toMatch(new RegExp(`^[${CODE_ALPHABET}]+$`));
    expect(room.code).not.toMatch(/[0O1I]/);
    expect(room.host).toEqual(player);
    expect(room.guest).toBeNull();
    expect(room.scenario).toBe('karaj-launchers');
    expect(rooms.size).toBe(1);
  });

  it('gives every room its own code', () => {
    const codes = new Set(
      Array.from({ length: 200 }, () => rooms.create('s', 'jet').room.code),
    );
    expect(codes.size).toBe(200);
  });

  it('lets a second player join with the other role, case-insensitively', () => {
    const { room } = rooms.create('karaj-launchers', 'drone');
    const result = rooms.join(room.code.toLowerCase(), 'jet');
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.room).toBe(room);
    expect(room.guest).toEqual(result.player);
    expect(result.player.id).not.toBe(room.host.id);
    expect(rooms.peerOf(room, room.host.id)).toBe(room.guest);
    expect(rooms.peerOf(room, result.player.id)).toBe(room.host);
  });

  it('refuses a missing room', () => {
    expect(rooms.join('ABCDEF', 'jet')).toEqual({ error: 'room-not-found' });
  });

  it('refuses a full room', () => {
    const { room } = rooms.create('s', 'drone');
    rooms.join(room.code, 'jet');
    expect(rooms.join(room.code, 'jet')).toEqual({ error: 'room-full' });
  });

  it('refuses a role the host already has', () => {
    const { room } = rooms.create('s', 'drone');
    expect(rooms.join(room.code, 'drone')).toEqual({ error: 'role-taken' });
    expect(room.guest).toBeNull();
  });

  it('keeps the room when the guest leaves, and lets someone else join', () => {
    const { room } = rooms.create('s', 'drone');
    const joined = rooms.join(room.code, 'jet');
    if ('error' in joined) throw new Error(joined.error);
    expect(rooms.leave(room.code, joined.player.id)).toEqual({
      room,
      closed: false,
      peer: room.host,
    });
    expect(room.guest).toBeNull();
    expect(rooms.size).toBe(1);
    expect('error' in rooms.join(room.code, 'jet')).toBe(false);
  });

  it('closes the room when the host leaves', () => {
    const { room, player: host } = rooms.create('s', 'drone');
    const joined = rooms.join(room.code, 'jet');
    if ('error' in joined) throw new Error(joined.error);
    expect(rooms.leave(room.code, host.id)).toEqual({
      room,
      closed: true,
      peer: joined.player,
    });
    expect(rooms.size).toBe(0);
    expect(rooms.join(room.code, 'jet')).toEqual({ error: 'room-not-found' });
  });

  it('ignores a leave from someone not in the room', () => {
    const { room } = rooms.create('s', 'drone');
    expect(rooms.leave(room.code, 'stranger')).toBeNull();
    expect(rooms.leave('NOROOM', 'stranger')).toBeNull();
    expect(rooms.size).toBe(1);
  });

  it('expires rooms idle for more than 10 minutes', () => {
    const idle = rooms.create('s', 'drone', 0).room;
    const busy = rooms.create('s', 'jet', 0).room;
    rooms.touch(busy.code, ROOM_IDLE_MS);

    expect(rooms.expire(ROOM_IDLE_MS)).toEqual([]);
    expect(rooms.expire(ROOM_IDLE_MS + 1)).toEqual([idle]);
    expect(rooms.get(idle.code)).toBeUndefined();
    expect(rooms.get(busy.code)).toBe(busy);
    expect(rooms.size).toBe(1);
  });
});
