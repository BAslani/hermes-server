# hermes-server

The online co-op relay for Hermes. Two players share a room: one flies the
interceptor drone, the other the F-14. The host's browser runs the game rules;
this server only pairs the players and forwards what they send each other. It
never runs game logic and keeps nothing on disk.

## Run

```sh
pnpm install
pnpm start:dev        # watch mode, http://localhost:4000
pnpm build && pnpm start:prod
```

```sh
pnpm test             # unit tests (room service, message parsing)
pnpm test:e2e         # two real ws clients through a running server
pnpm lint
```

Docker:

```sh
docker build -t hermes-server .
docker run -p 4000:4000 -e ALLOWED_ORIGINS=https://hermes.example hermes-server
```

## Environment

| Variable                | Default                                       | Meaning                                                                                                                                                             |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                  | `4000`                                        | HTTP and WebSocket port.                                                                                                                                            |
| `ALLOWED_ORIGINS`       | `http://localhost:3000`                       | Comma-separated origins allowed to open a WebSocket (others get a 403).                                                                                             |
| `ALLOW_PRIVATE_NETWORK` | `true`, or `false` when `NODE_ENV=production` | Also allow pages served from this machine or the local network (localhost, 127.x, 10.x, 172.16–31.x, 192.168.x) on any port, for playing over Wi-Fi in development. |

## Endpoints

- `GET /health` → `{ "ok": true, "rooms": <number> }`
- `ws://<host>:<port>/ws`: the co-op socket (plain WebSocket, not socket.io).

## Protocol

Every message is a JSON text frame shaped `{ "type": ..., ...payload }`.
Vectors are `[x, y, z]` and quaternions `[x, y, z, w]`, in metres from the
target (the game frame).

### Rooms

| Type          | Direction        | Payload                                             |
| ------------- | ---------------- | --------------------------------------------------- |
| `create`      | client → server  | `{ scenario, role }` (`role`: `"drone"` or `"jet"`) |
| `created`     | server → creator | `{ code, playerId }`. The creator is the host.      |
| `join`        | client → server  | `{ code, role }`                                    |
| `joined`      | server → joiner  | `{ code, playerId, scenario, hostRole }`            |
| `leave`       | client → server  | `{}`: leave the room but keep the socket            |
| `peer-joined` | server → both    | `{ role }`: the other player's role                 |
| `peer-left`   | server → host    | `{ role }`: the guest left; the room stays open     |
| `room-closed` | server → players | `{ reason: "host-left" \| "expired" }`              |
| `error`       | server → sender  | `{ code, message }`                                 |

Room codes are 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O
or 1/I); `join` accepts lower case. A room holds a host and a guest with
different roles. If the host leaves, the room closes. Rooms idle for 10
minutes (no create, join or relayed message) expire.

Error codes: `room-not-found`, `room-full`, `role-taken`, `bad-message` (bad
JSON or shape, over 32 KB, already in a room, or not in a room).

### Relay

The server forwards these to the other player unchanged, adding
`from: "drone" | "jet"` (the sender's role). Nothing is sent back to the
sender. Without a peer in the room, the message is dropped.

| Type       | Direction      | Rate     | Payload                                                                           |
| ---------- | -------------- | -------- | --------------------------------------------------------------------------------- |
| `state`    | either → other | ~15 Hz   | `{ position, velocity, orientation, t }`                                          |
| `fire`     | guest → host   | on fire  | `{ weapon: "missile" \| "gun", position, velocity, forward, target?, launcher? }` |
| `snapshot` | host → guest   | ~10 Hz   | `{ state }`: the match state, any JSON object                                     |
| `event`    | host → guest   | on event | `{ event }`: a game event, any JSON object                                        |
| `start`    | host → guest   | once     | `{ seed, scenario }`                                                              |
| `restart`  | host → guest   | once     | `{ seed, scenario }`                                                              |

In `fire`, `position` is the launch point and `velocity` the shooter's
velocity (`from` is taken by the sender role). `target` is a threat id or
null; `launcher` is a launcher index for a missile aimed at one.

The server drops (and logs) `snapshot`, `event`, `start` and `restart` from the
guest and `fire` from the host.

### Limits

- Messages over 32 KB get a `bad-message` error; frames over 64 KB close the
  socket (code 1009).
- Unknown fields are refused, so add them to `src/protocol.ts` before sending
  them.
- 60 messages per second per connection; the rest of that second is dropped.
- The server pings every 15 s. A connection that misses a pong is closed and
  leaves its room.
