import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore } from '../../app/src/store';
import { TurnManager } from '../../src/core/TurnManager';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { SeededRandomSource } from '../../src/core/RandomSource';

// TurnManager 依赖 localStorage（存档路径），mock 掉
class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
(globalThis as any).localStorage = new LocalStorageMock();

// Node 环境无 CardDataBank 的 JSON 资源：stub fetch 抛错走默认牌库 fallback
vi.stubGlobal('fetch', () => Promise.reject(new Error('no fetch in test env')));

const origLog = console.log;
const origWarn = console.warn;

/** 创建并注入固定 seed 的 TurnManager 到 store，返回干净开局 */
async function freshGame(seed: number) {
  const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(seed));
  await tm.initialize();
  useGameStore.setState({ turnManager: tm, lastSettlement: null });
  useGameStore.getState().startGame();
  useGameStore.getState()._sync();
  return tm;
}

describe('FX 事件生命周期（游戏结束与重新开始）', () => {
  beforeEach(() => {
    console.log = () => {};
    console.warn = () => {};
  });

  afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
  });

  it('最后一回合恰逢季末：终局推进不触发换季事件，引擎季节不再前进', async () => {
    const tm = await freshGame(1);
    // 构造季末：第 5 段（spring）第 12 回合，段长总和 60
    (tm as any).seasonCycle.loadState(4, 12, [12, 12, 12, 12, 12]);
    (tm as any).currentRound = 60;
    useGameStore.getState()._sync();
    expect(useGameStore.getState().season).toBe('spring');
    expect(useGameStore.getState().currentRound).toBe(60);

    // 清掉历史 FX 事件，只观察终局这次推进
    useGameStore.setState({
      seasonEvent: null, marginCallEvent: null, scoreDelta: null, qiDelta: null, roundEvent: null,
    });

    useGameStore.getState().executeWait();
    expect(useGameStore.getState().gameState).toBe('game_over');
    // 终局推进会跨到第 61 回合，但游戏已结束，不得产生换季事件
    expect(useGameStore.getState().seasonEvent).toBeNull();
    // 引擎季节保持最后一季，不再推进到下一季
    expect(useGameStore.getState().season).toBe('spring');
  });

  it('重置游戏：不因重置前后差异重发 FX 事件，新一局开局不误播上一局动画', async () => {
    const tm = await freshGame(2);
    // 伪造一局进行中的 store 状态：summer 第 3 回合、有分数与气量
    (tm as any).seasonCycle.loadState(1, 3, [12, 12, 12, 12, 12]);
    (tm as any).scoreManager.setScore(123, 100, 23);
    (tm as any).qiManager.setQi(42);
    useGameStore.getState()._sync();
    expect(useGameStore.getState().season).toBe('summer');
    expect(useGameStore.getState().score).toBe(123);

    useGameStore.getState().reset();
    expect(useGameStore.getState().gameState).toBe('init');
    expect(useGameStore.getState().season).toBe('spring');
    // 重置后 FX 事件必须为空：否则新一局开局会误播上一局的换季/得分/回气动画
    expect(useGameStore.getState().seasonEvent).toBeNull();
    expect(useGameStore.getState().scoreDelta).toBeNull();
    expect(useGameStore.getState().qiDelta).toBeNull();
    expect(useGameStore.getState().roundEvent).toBeNull();
    expect(useGameStore.getState().marginCallEvent).toBeNull();

    // 开局同步后不得出现上一局的残留动画事件（换季/得分必须为空）；
    // 第 1 回合的自然回气（50 → 60，+10）是正常事件，不在此列。
    useGameStore.getState().startGame();
    useGameStore.getState()._sync();
    expect(useGameStore.getState().gameState).toBe('player_action');
    expect(useGameStore.getState().seasonEvent).toBeNull();
    expect(useGameStore.getState().scoreDelta).toBeNull();
    expect(useGameStore.getState().qiDelta?.delta).toBe(10); // 合法首回合回气，而非残留的旧差值
    // 新一局必须能正常抽出公共牌，否则界面只剩季节、无牌可买，游戏卡死
    expect(useGameStore.getState().publicCards.length).toBe(2);
  });
});
