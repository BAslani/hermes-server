import { MAX_MESSAGE_BYTES, parseMessage } from './protocol.js';

describe('parseMessage', () => {
  it('accepts a state message', () => {
    const raw = JSON.stringify({
      type: 'state',
      position: [1, 2, 3],
      velocity: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      t: 12.5,
    });
    expect(parseMessage(raw)).toMatchObject({
      ok: true,
      message: { type: 'state' },
    });
  });

  it.each([
    ['not JSON', '{'],
    ['an unknown type', JSON.stringify({ type: 'nope' })],
    ['a missing field', JSON.stringify({ type: 'create', role: 'jet' })],
    [
      'a bad role',
      JSON.stringify({ type: 'create', scenario: 'a', role: 'tank' }),
    ],
    ['an extra field', JSON.stringify({ type: 'leave', sneaky: true })],
    [
      'a short vector',
      JSON.stringify({
        type: 'state',
        position: [1, 2],
        velocity: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        t: 0,
      }),
    ],
    ['an array', '[]'],
    ['null', 'null'],
  ])('refuses %s', (_, raw) => {
    expect(parseMessage(raw).ok).toBe(false);
  });

  it('refuses messages over 32 KB', () => {
    const raw = JSON.stringify({
      type: 'snapshot',
      state: { pad: 'x'.repeat(MAX_MESSAGE_BYTES) },
    });
    expect(parseMessage(raw)).toEqual({
      ok: false,
      reason: `larger than ${MAX_MESSAGE_BYTES} bytes`,
    });
  });

  it('refuses binary frames', () => {
    expect(parseMessage(Buffer.from('{}')).ok).toBe(false);
  });
});
