import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TurnManager } from '../../src/core/TurnManager';
import { SeededRandomSource } from '../../src/core/RandomSource';
import {
  BalanceProfile,
  getBalanceProfileById,
  getDefaultBalanceProfileForRules,
  SUPPORTED_BALANCE_PROFILES,
  V9_STANDARD_PROFILE,
  V8_STANDARD_PROFILE,
  V7_STANDARD_PROFILE,
  V6_STANDARD_PROFILE,
  V5_STANDARD_PROFILE,
  V4_STANDARD_PROFILE,
  V9_EA_TUNED_PROFILE,
} from '../../src/core/BalanceProfile';
import {
  createReplayRulesSnapshotForProfile,
  validateRulesSnapshotContract,
  cloneReplayRulesSnapshot,
  SINGLE_VOID_REPLAY_RULES,
  BALANCED_TRADE_REPLAY_RULES,
  TREND_WINDOW_REPLAY_RULES,
} from '../../src/core/ReplayRules';
import {
  GameSaveService,
  RULES_VERSION_SINGLE_VOID,
  RULES_VERSION_CLEAN_POOL,
  RULES_VERSION_TREND_WINDOW,
  RULES_VERSION_BALANCED_TRADE,
  type GameSnapshot,
} from '../../src/core/GameSaveService';
import { replayGame, type ReplayAction } from '../../src/core/ReplayRunner';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';

class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
(globalThis as any).localStorage = new LocalStorageMock();

async function makeTm(seed = 42, options: Record<string, unknown> = {}) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => cardData }));
  const tm = new TurnManager(undefined, new SeededRandomSource(seed), {
    rulesVersion: RULES_VERSION_SINGLE_VOID,
    volatility: SINGLE_VOID_REPLAY_RULES.volatility,
    scoreRules: SINGLE_VOID_REPLAY_RULES.scoreRules,
    ...options,
  });
  await tm.initialize();
  return tm;
}

const waits = (count: number): ReplayAction[] =>
  Array.from({ length: count }, () => ({ type: 'wait' as const }));

describe('BalanceProfile Registry and Profiles', () => {
  it('registers standard profiles for all supported rules versions with immutable snapshots', () => {
    expect(SUPPORTED_BALANCE_PROFILES.length).toBeGreaterThanOrEqual(7);
    expect(getBalanceProfileById('v9_standard')).toEqual(V9_STANDARD_PROFILE);
    expect(getBalanceProfileById('v8_standard')).toEqual(V8_STANDARD_PROFILE);
    expect(getBalanceProfileById('v7_standard')).toEqual(V7_STANDARD_PROFILE);
    expect(getBalanceProfileById('v6_standard')).toEqual(V6_STANDARD_PROFILE);
    expect(getBalanceProfileById('v5_standard')).toEqual(V5_STANDARD_PROFILE);
    expect(getBalanceProfileById('v4_standard')).toEqual(V4_STANDARD_PROFILE);
    expect(getBalanceProfileById('v9_ea_tuned')).toEqual(V9_EA_TUNED_PROFILE);

    for (const p of SUPPORTED_BALANCE_PROFILES) {
      expect(p.balanceConfig).toBeDefined();
      expect((p as any).config).toBeUndefined();
      expect(Object.isFrozen(p.balanceConfig)).toBe(true);
    }
  });

  it('maps rulesVersion to default balance profile correctly', () => {
    expect(getDefaultBalanceProfileForRules(RULES_VERSION_SINGLE_VOID).profileId).toBe('v9_standard');
    expect(getDefaultBalanceProfileForRules(RULES_VERSION_CLEAN_POOL).profileId).toBe('v8_standard');
    expect(getDefaultBalanceProfileForRules(RULES_VERSION_TREND_WINDOW).profileId).toBe('v7_standard');
  });

  it('returns undefined for non-existent profile ID', () => {
    expect(getBalanceProfileById('non_existent_profile')).toBeUndefined();
  });
});

describe('BalanceProfile Replay Snapshot and Strict Contract Validation', () => {
  it('creates frozen replay rules snapshot with complete profile metadata', () => {
    const snapshot = createReplayRulesSnapshotForProfile(V9_STANDARD_PROFILE);
    expect(snapshot.balanceProfileId).toBe('v9_standard');
    expect(snapshot.balanceProfileVersion).toBe(1);
    expect(snapshot.rulesVersion).toBe(RULES_VERSION_SINGLE_VOID);
    expect(snapshot.balanceConfig).toBeDefined();

    const validation = validateRulesSnapshotContract(snapshot);
    expect(validation).toEqual({ valid: true });
  });

  it('validates legacy snapshots without balanceProfileId seamlessly', () => {
    const legacySnapshot = cloneReplayRulesSnapshot(SINGLE_VOID_REPLAY_RULES);
    expect(legacySnapshot.balanceProfileId).toBeUndefined();
    expect(legacySnapshot.balanceProfileVersion).toBeUndefined();
    expect(legacySnapshot.balanceConfig).toBeUndefined();

    const validation = validateRulesSnapshotContract(legacySnapshot);
    expect(validation.valid).toBe(true);
  });

  it('rejects modern profile snapshot when missing balanceProfileVersion or balanceConfig', () => {
    const missingVersion = {
      ...createReplayRulesSnapshotForProfile(V9_STANDARD_PROFILE),
      balanceProfileVersion: undefined,
    };
    expect(validateRulesSnapshotContract(missingVersion)).toEqual({
      valid: false,
      reason: 'Missing or invalid balanceProfileVersion in modern profile snapshot',
    });

    const missingConfig = {
      ...createReplayRulesSnapshotForProfile(V9_STANDARD_PROFILE),
      balanceConfig: undefined,
    };
    expect(validateRulesSnapshotContract(missingConfig)).toEqual({
      valid: false,
      reason: 'Missing or invalid balanceConfig in modern profile snapshot',
    });
  });

  it('rejects tampered balanceConfig or voidCardCount in modern snapshot', () => {
    const tamperedConfig = {
      ...createReplayRulesSnapshotForProfile(V9_STANDARD_PROFILE),
      balanceConfig: {
        ...V9_STANDARD_PROFILE.balanceConfig,
        concentrationPremiumFactor: 999,
      },
    };
    const res = validateRulesSnapshotContract(tamperedConfig);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('balanceConfig mismatch with profile v9_standard');

    const tamperedVoid = {
      ...createReplayRulesSnapshotForProfile(V9_STANDARD_PROFILE),
      voidCardCount: 99,
    };
    expect(validateRulesSnapshotContract(tamperedVoid)).toEqual({
      valid: false,
      reason: 'voidCardCount mismatch: expected 1, got 99',
    });
  });

  it('rejects invalid or mismatched balanceProfileId', () => {
    const invalidProfileSnapshot = {
      ...createReplayRulesSnapshotForProfile(V9_STANDARD_PROFILE),
      balanceProfileId: 'unknown_profile',
    };
    expect(validateRulesSnapshotContract(invalidProfileSnapshot)).toEqual({
      valid: false,
      reason: 'Unsupported balanceProfileId: unknown_profile',
    });

    const mismatchedSnapshot = {
      ...createReplayRulesSnapshotForProfile(V9_STANDARD_PROFILE),
      rulesVersion: 7, // requires rulesVersion 9, but snapshot is 7
    };
    expect(validateRulesSnapshotContract(mismatchedSnapshot)).toEqual({
      valid: false,
      reason: 'balanceProfileId v9_standard requires rulesVersion 9, got 7',
    });
  });
});

describe('TurnManager and GameSaveService Balance Profile Integration', () => {
  it('exports and restores balanceProfileId and balanceProfileVersion in save snapshot', async () => {
    const tm = await makeTm(42, {
      balanceProfileId: 'v9_standard',
      balanceProfileVersion: 1,
    });
    tm.startGame();

    const snapshot = tm.exportSnapshot();
    expect(snapshot.balanceProfileId).toBe('v9_standard');
    expect(snapshot.balanceProfileVersion).toBe(1);
    expect(snapshot.balanceConfig).toBeDefined();

    const newTm = await makeTm(99);
    newTm.importSnapshot(snapshot);
    expect(newTm.getBalanceProfileId()).toBe('v9_standard');
    expect(newTm.getBalanceProfileVersion()).toBe(1);
  });

  it('safely restores legacy saves missing balance profile info without corruption', async () => {
    const tm = await makeTm(42);
    tm.startGame();

    const snapshot = tm.exportSnapshot();
    delete (snapshot as any).balanceProfileId;
    delete (snapshot as any).balanceProfileVersion;
    delete (snapshot as any).balanceConfig;

    const newTm = await makeTm(100);
    newTm.importSnapshot(snapshot);
    expect(newTm.getBalanceProfileId()).toBe('v9_standard');
    expect(newTm.getBalanceProfileVersion()).toBe(1);
    expect(newTm.getBalanceConfig()).toEqual(DEFAULT_BALANCE_CONFIG);
  });

  it('replays game accurately using balance profile metadata and config', async () => {
    const result = await replayGame({
      seed: 42,
      actions: waits(60),
      rulesVersion: RULES_VERSION_BALANCED_TRADE,
      volatility: BALANCED_TRADE_REPLAY_RULES.volatility,
      scoreRules: BALANCED_TRADE_REPLAY_RULES.scoreRules,
      balanceProfileId: 'v4_standard',
      balanceProfileVersion: 1,
      balanceConfig: { ...V4_STANDARD_PROFILE.balanceConfig },
    });

    expect(result.completed).toBe(true);
    expect(result.rounds).toBe(60);
    expect(result.rulesVersion).toBe(RULES_VERSION_BALANCED_TRADE);
  });

  it('new games without explicit profile options always freeze and export complete balance profile', async () => {
    const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => cardData }));

    const tm = await makeTm(77);
    tm.startGame();

    const snapshot = tm.exportSnapshot();
    expect(snapshot.balanceProfileId).toBe('v9_standard');
    expect(snapshot.balanceProfileVersion).toBe(1);
    expect(snapshot.balanceConfig).toEqual(V9_STANDARD_PROFILE.balanceConfig);

    const storage = new LocalStorageMock();
    const service = new GameSaveService(storage);
    expect(service.save(() => snapshot)).toBe(true);

    const newTm = await makeTm(88);
    const loadSuccess = service.load((data) => newTm.importSnapshot(data));
    expect(loadSuccess).toBe(true);
    expect(newTm.getBalanceProfileId()).toBe('v9_standard');
    expect(newTm.getBalanceProfileVersion()).toBe(1);
    expect(newTm.getBalanceConfig()).toEqual(V9_STANDARD_PROFILE.balanceConfig);
  });
});
