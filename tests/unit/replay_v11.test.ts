import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CURRENT_REPLAY_RULES,
  RULES_VERSION_V11,
  V11_MACRO_ROGUELIKE_REPLAY_RULES,
  replayGame,
  replayGamePrefix,
  type ReplayAction,
  type ReplayRequest,
} from '../../src/core';

const CARD_DATA = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => CARD_DATA }));

function v11Request(seed: number, actions: readonly ReplayAction[], requireCompleted: boolean = false): ReplayRequest {
  return {
    seed,
    actions,
    rulesVersion: RULES_VERSION_V11,
    volatility: V11_MACRO_ROGUELIKE_REPLAY_RULES.volatility,
    scoreRules: V11_MACRO_ROGUELIKE_REPLAY_RULES.scoreRules,
    requireCompleted,
  };
}

describe('V11 Macro Roguelike Deterministic Replay (V11 宏观重放确定性与长线大考闭环)', () => {
  it('V11 规则快照已就绪且为生产默认规则', () => {
    expect(V11_MACRO_ROGUELIKE_REPLAY_RULES.rulesVersion).toBe(11);
    expect(CURRENT_REPLAY_RULES.rulesVersion).toBe(RULES_VERSION_V11);
    expect(V11_MACRO_ROGUELIKE_REPLAY_RULES.volatility.model).toBe('relationship_response');
  });

  it('相同种子与动作流重放两次，产出完全一致的年岁、终局分值与状态', async () => {
    // 10 回合纯等待推进
    const actions: ReplayAction[] = Array.from({ length: 10 }, () => ({ type: 'wait' as const }));

    try {
      const res1 = await replayGame(v11Request(88888, actions, false));
      const res2 = await replayGame(v11Request(88888, actions, false));

      expect(res1.score).toBe(res2.score);
      expect(res1.finalQi).toBe(res2.finalQi);
      expect(res1.year).toBe(res2.year);
      expect(res1.turn).toBe(res2.turn);
      expect(res1.state).toBe(res2.state);
      expect(res1.totalYearsSurvived).toBe(res2.totalYearsSurvived);
    } catch (err: any) {
      console.error('Replay error details:', err?.message, 'actionIndex:', err?.actionIndex);
      throw err;
    }
  });

  it('前缀重放支持 V11 地脉下沉与升级动作链，双端状态逐字节咬合', async () => {
    const actions: ReplayAction[] = [
      { type: 'wait' },
      { type: 'buy_to_leyline', cardIndex: 0, leverage: false },
      { type: 'wait' },
      { type: 'move_to_dantian', slotIndex: 0 },
      { type: 'wait' },
    ];

    const prefix1 = await replayGamePrefix(v11Request(99999, actions));
    const prefix2 = await replayGamePrefix(v11Request(99999, actions));

    expect(prefix1).toEqual(prefix2);
    expect(prefix1.rounds).toBe(5);
    expect(prefix1.turn).toBe(6);
    expect(prefix1.year).toBe(1);
  });
});
