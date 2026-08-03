import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SeededRandomSource, TurnManager } from '../../src/core';

type TraceAction =
  | { type: 'buy'; cardIndex: number; leverage: boolean }
  | { type: 'sell'; slotIndex: number }
  | { type: 'wait' }
  | { type: 'set_qi'; value: number };

type Snapshot = {
  round: number;
  season: string;
  seasonRound: number;
  qi: number;
  score: number;
  hand: ({ id: number; lockedQi: number; useLeverage: boolean } | null)[];
  deckIds: number[];
  publicIds: number[];
  marginCallCount: number;
};

// 2026-08-03：季节最小段长 4（SeasonCycle 方案B），旧 20×3 非法。
// 12 段 × 5 = 60，合法且接近真实分布（段数 4 的倍数保证四季均衡）。
const seasonLengths = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
const trace: TraceAction[] = [
  { type: 'buy', cardIndex: 0, leverage: false },
  { type: 'wait' },
  // 第 3 回合买入杠杆，验证季内边界；推进后进入下一季第 1 回合。
  { type: 'buy', cardIndex: 0, leverage: true },
  // 低气后等待，下一次结算触发杠杆仓位强平。
  { type: 'set_qi', value: 0.1 },
  { type: 'wait' },
  // 强平只移除杠杆仓位，剩余普通仓位继续卖出。
  { type: 'sell', slotIndex: 0 },
];

function normalizeSnapshot(manager: TurnManager): Snapshot {
  const cardPool = (manager as any).cardPoolManager;
  const seasonCycle = (manager as any).seasonCycle;
  return {
    round: manager.getCurrentRound(),
    season: manager.getCurrentSeason(),
    seasonRound: manager.getCurrentRoundInSeason(),
    qi: manager.getQi(),
    score: manager.getScore(),
    hand: manager.getHand().map((slot) => slot ? {
      id: slot.card.id,
      lockedQi: slot.lockedQi,
      useLeverage: slot.useLeverage,
    } : null),
    deckIds: cardPool.getDeck().map((card: any) => card.id),
    publicIds: manager.getPublicCards().map((card) => card.id),
    marginCallCount: manager.getMarginCallCount(),
  };
}

async function runTypeScriptTraceAsync(): Promise<Snapshot[]> {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => cardData }));
  // skipSeasonGenerate：跳过 SeasonCycle 的随机消耗（避免 generateSeasonLengths 的
  // while 循环改变后续牌池序列，导致与 Python 端（直接用传入 lengths）随机序列不匹配）
  const manager = new TurnManager(undefined, new SeededRandomSource(20260801), { skipSeasonGenerate: true });
  await manager.initialize();
  (manager as any).seasonCycle.loadState(0, 1, seasonLengths);
  manager.startGame();
  const snapshots: Snapshot[] = [normalizeSnapshot(manager)];
  for (const action of trace) {
    if (action.type === 'set_qi') {
      (manager as any).qiManager.setQi(action.value);
      continue;
    }
    const ok = action.type === 'buy'
      ? manager.executeBuy(action.cardIndex, action.leverage)
      : action.type === 'wait'
        ? manager.executeWait()
        : manager.executeSell(action.slotIndex);
    expect(ok, `TypeScript trace action failed: ${JSON.stringify(action)}`).toBe(true);
    snapshots.push(normalizeSnapshot(manager));
  }
  return snapshots;
}

function runPythonTrace(): { snapshots: Snapshot[] } {
  // 2026-08-03：官方 simulator.py 已归档，改用 scripts/three_strategy_mix.py 的 trace 模式
  //（docs/analysis 不进 git，CI 只能拿到 repo 内副本；改 docs 版后运行 npm run sync:simulator）
  const result = execFileSync('python', ['scripts/three_strategy_mix.py', '--trace-stdin'], {
    cwd: process.cwd(),
    input: JSON.stringify({ seed: 20260801, season_lengths: seasonLengths, actions: trace }),
    encoding: 'utf-8',
  });
  return JSON.parse(result);
}

describe('Python simulator ↔ TypeScript TurnManager parity', () => {
  it('固定 seed/action trace 逐步对照可观察状态', async () => {
    const typeScriptSnapshots = await runTypeScriptTraceAsync();
    const pythonTrace = runPythonTrace();
    expect(pythonTrace.snapshots).toHaveLength(typeScriptSnapshots.length);
    expect(typeScriptSnapshots.some((snapshot) => snapshot.marginCallCount > 0)).toBe(true);

    for (let index = 0; index < typeScriptSnapshots.length; index += 1) {
      const expected = typeScriptSnapshots[index];
      const actual = pythonTrace.snapshots[index];
      expect(actual.round).toBe(expected.round);
      expect(actual.season).toBe(expected.season);
      expect(actual.seasonRound).toBe(expected.seasonRound);
      expect(actual.qi).toBeCloseTo(expected.qi, 8);
      expect(actual.score).toBeCloseTo(expected.score, 8);
      expect(actual.hand).toEqual(expected.hand);
      expect(actual.deckIds).toEqual(expected.deckIds);
      expect(actual.publicIds).toEqual(expected.publicIds);
      expect(actual.marginCallCount).toBe(expected.marginCallCount);
    }
    // 触发过强平是 trace 覆盖爆仓分支的最低要求。
    expect(pythonTrace.snapshots.some((snapshot) => snapshot.marginCallCount > 0)).toBe(true);
  });
});
