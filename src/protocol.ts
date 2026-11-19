import { z } from 'zod';

/** Messages larger than this get an error reply and are not handled. */
export const MAX_MESSAGE_BYTES = 32 * 1024;
/** Frames larger than this close the connection (ws close code 1009). */
export const MAX_FRAME_BYTES = 64 * 1024;

const role = z.enum(['drone', 'jet']);
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const quat = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const scenario = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/);
/** Opaque to the server: only the host's game knows its shape. */
const opaque = z.record(z.string(), z.unknown());

export const clientMessage = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('create'), scenario, role }),
  z.strictObject({
    type: z.literal('join'),
    code: z.string().trim().length(6),
    role,
  }),
  z.strictObject({ type: z.literal('leave') }),
  z.strictObject({
    type: z.literal('state'),
    position: vec3,
    velocity: vec3,
    orientation: quat,
    t: z.number(),
  }),
  z.strictObject({
    type: z.literal('fire'),
    weapon: z.enum(['missile', 'gun']),
    /** Launch point, game frame. */
    position: vec3,
    /** The shooter's velocity. */
    velocity: vec3,
    forward: vec3,
    /** Threat id of a missile lock; absent or null flies straight. */
    target: z.number().int().nullable().optional(),
    /** Launcher index a missile steers for instead of a threat. */
    launcher: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({ type: z.literal('snapshot'), state: opaque }),
  z.strictObject({ type: z.literal('event'), event: opaque }),
  z.strictObject({
    type: z.literal('start'),
    seed: z.number().int(),
    scenario,
  }),
  z.strictObject({
    type: z.literal('restart'),
    seed: z.number().int(),
    scenario,
  }),
]);

export type ClientMessage = z.infer<typeof clientMessage>;
export type RelayMessage = Extract<
  ClientMessage,
  { type: 'state' | 'fire' | 'snapshot' | 'event' | 'start' | 'restart' }
>;

/** Only the host may send these. */
export const HOST_ONLY = new Set<ClientMessage['type']>([
  'snapshot',
  'event',
  'start',
  'restart',
]);
/** Only the guest may send these. */
export const GUEST_ONLY = new Set<ClientMessage['type']>(['fire']);

export type ErrorCode =
  'room-not-found' | 'room-full' | 'role-taken' | 'bad-message';

/** Parses a raw frame. Returns the message, or why it was refused. */
export function parseMessage(
  raw: unknown,
): { ok: true; message: ClientMessage } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: 'expected text' };
  if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) {
    return { ok: false, reason: `larger than ${MAX_MESSAGE_BYTES} bytes` };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  const result = clientMessage.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return { ok: false, reason: path + issue.message };
  }
  return { ok: true, message: result.data };
}
