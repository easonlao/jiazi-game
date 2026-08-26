import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore, bindTurnManagerCallbacks } from '../../app/src/store';
import { TurnManager } from '../../src/core/TurnManager';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { SeededRandomSource } from '../../src/core/RandomSource';

class LocalStorageMock {
  private store = new Map<string, string>();

  getItem(k: string) {
    return this.store.get(k) ?? null;
  }

  setItem(k: string, v: string) {
    this.store.set(k, v);
  }

  removeItem(k: string) {
    this.store.delete(k);
  }

  clear() {
    this.store.clear();
  }
}

(globalThis as any).localStorage = new LocalStorageMock();
vi.stubGlobal('fetch', () => Promise.reject(new Error('no fetch in test env')));

async function freshGame(seed: number) {
  const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(seed));
  await tm.initialize();
  bindTurnManagerCallbacks(tm, useGameStore.setState, () => useGameStore.getState());
  useGameStore.setState({ turnManager: tm, lastSettlement: null });
  useGameStore.getState().startGame();
  useGameStore.getState()._sync();
  return tm;
}

describe('本机修行账本与 store 接线', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
    useGameStore.setState({ toast: null });
  });

  afterEach(() => {
    useGameStore.setState({ toast: null });
  });

  it('终局卖出路径会在 onGameEnd 统一完成账本记录，只记一次完成', async () => {
    const tm = await freshGame(21);
    expect(useGameStore.getState().cultivationLedgerSummary).toEqual({
      totalGames: 1,
      completedGames: 0,
      abandonedGames: 0,
      byRulesVersion: [],
    });

    useGameStore.getState().selectPublicCard(0);
    expect(useGameStore.getState().executeBuy()).toBe(true);

    const snapshot = tm.exportSnapshot();
    snapshot.currentRound = 60;
    snapshot.state = 'player_action';
    snapshot.season = { index: 3, roundInSeason: 12, lengths: [12, 12, 12, 12] };
    tm.importSnapshot(snapshot);
    useGameStore.getState()._sync();

    useGameStore.getState().selectHandCard(0);
    expect(useGameStore.getState().executeSell()).toBe(true);
    expect(useGameStore.getState().gameState).toBe('game_over');
    expect(useGameStore.getState().cultivationLedgerSummary).toEqual({
      totalGames: 1,
      completedGames: 1,
      abandonedGames: 0,
      byRulesVersion: expect.any(Array),
    });
    const summary = useGameStore.getState().cultivationLedgerSummary;
    expect(summary.byRulesVersion).toHaveLength(1);
    expect(summary.byRulesVersion[0]).toMatchObject({
      rulesVersion: tm.getRulesVersion(),
      completedGames: 1,
    });
    expect(summary.byRulesVersion[0]?.averageScore).toEqual(expect.any(Number));
    expect(summary.byRulesVersion[0]?.highestScore).toEqual(expect.any(Number));
    expect(summary.byRulesVersion[0]?.lowestScore).toEqual(expect.any(Number));
  });

  it('continue 和 reset 基础路径不会重复建档，reset 才会记为中断', async () => {
    const tm = await freshGame(33);
    useGameStore.getState().executeWait();
    const afterWait = useGameStore.getState().cultivationLedgerSummary;
    expect(afterWait.totalGames).toBe(1);
    expect(afterWait.completedGames).toBe(0);
    expect(afterWait.abandonedGames).toBe(0);

    const activeLedgerBefore = JSON.parse((globalThis as any).localStorage.getItem('jiazi_cultivation_ledger') as string) as {
      activeGameId: string | null;
      records: Array<{ id: string; outcome: string }>;
    };

    expect(useGameStore.getState().loadGameFromSave()).toBe(true);
    expect(useGameStore.getState().cultivationLedgerSummary.totalGames).toBe(1);

    useGameStore.getState().reset();
    const summary = useGameStore.getState().cultivationLedgerSummary;
    expect(summary.totalGames).toBe(1);
    expect(summary.completedGames).toBe(0);
    expect(summary.abandonedGames).toBe(1);

    const ledgerAfterReset = JSON.parse((globalThis as any).localStorage.getItem('jiazi_cultivation_ledger') as string) as {
      activeGameId: string | null;
      records: Array<{ id: string; outcome: string }>;
    };
    expect(ledgerAfterReset.activeGameId).toBeNull();
    expect(ledgerAfterReset.records).toHaveLength(1);
    expect(ledgerAfterReset.records[0]?.id).toBe(activeLedgerBefore.records[0]?.id);
    expect(ledgerAfterReset.records[0]?.outcome).toBe('abandoned');
    void tm;
  });
});
