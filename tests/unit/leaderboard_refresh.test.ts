import { describe, expect, it } from 'vitest';
import { LeaderboardRefreshGate } from '../../app/src/lib/leaderboardRefresh';

describe('LeaderboardRefreshGate', () => {
  it('新的读取请求会使旧请求失效', () => {
    const gate = new LeaderboardRefreshGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });
});
