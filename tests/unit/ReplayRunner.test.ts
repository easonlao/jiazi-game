import { describe, expect, it } from 'vitest';
import {
  BAND_FACTOR,
  MAX_REPLAY_ACTIONS,
  replayGame,
  ReplayValidationError,
  RULES_VERSION_TRADE,
  TRADE_SCORE_RULES,
  type ReplayAction,
  type ReplayRequest,
} from '../../src/core';

const tradeVolatility = {
  model: 'conflict_banded' as const,
  scale: 4,
  bandFactors: { ...BAND_FACTOR, conflict: 6 },
};

function request(actions: readonly ReplayAction[]): ReplayRequest {
  return {
    seed: 42,
    actions,
    rulesVersion: RULES_VERSION_TRADE,
    volatility: tradeVolatility,
    scoreRules: TRADE_SCORE_RULES,
  };
}

const waits = (count: number): ReplayAction[] =>
  Array.from({ length: count }, () => ({ type: 'wait' as const }));

describe('ReplayRunner', () => {
  it('uses the same seed and actions to produce the same result', async () => {
    const actions = waits(60);
    const first = await replayGame(request(actions));
    const second = await replayGame(request(actions));

    expect(second).toEqual(first);
    expect(first).toMatchObject({ state: 'game_over', completed: true, rounds: 60 });
  });

  it('replays an accepted buy action through the real engine', async () => {
    const result = await replayGame(request([
      { type: 'buy', cardIndex: 0, leverage: false },
      ...waits(59),
    ]));

    expect(result).toMatchObject({ state: 'game_over', completed: true, rounds: 60 });
  });

  it('rejects an incomplete action sequence', async () => {
    await expect(replayGame(request(waits(59)))).rejects.toMatchObject({
      name: 'ReplayValidationError',
      actionIndex: null,
    });
  });

  it.each([
    { type: 'buy', cardIndex: 99, leverage: false },
    { type: 'sell', slotIndex: 99 },
    { type: 'lock', cardIndex: 99 },
    { type: 'unlock', cardIndex: 0 },
  ] as ReplayAction[])('rejects an action the engine does not accept: %o', async (action) => {
    await expect(replayGame(request([action]))).rejects.toBeInstanceOf(ReplayValidationError);
  });

  it('rejects a client-controlled unsupported rules version', async () => {
    await expect(replayGame({
      ...request(waits(60)),
      rulesVersion: 999 as never,
    })).rejects.toMatchObject({
      name: 'ReplayValidationError',
      actionIndex: null,
    });
  });

  it('rejects an unsafe seed and an oversized action sequence', async () => {
    await expect(replayGame({
      ...request(waits(60)),
      seed: 1.5,
    })).rejects.toMatchObject({ name: 'ReplayValidationError', actionIndex: null });

    await expect(replayGame({
      ...request([]),
      actions: Array.from({ length: MAX_REPLAY_ACTIONS + 1 }, () => ({ type: 'wait' as const })),
    })).rejects.toMatchObject({ name: 'ReplayValidationError', actionIndex: null });
  });
});
