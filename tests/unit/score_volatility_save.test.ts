/**
 * 波动状态持久化测试（阶段 1：规则版本化存档）。
 *
 * 覆盖"规则随存档走"的运行时行为：
 * - 显式 volatile 局（构造函数 volatility enabled）→ exportSnapshot 产出
 *   rulesVersion=2 + scoreVolatility；round-trip 后 remainingRounds / deltaByDiZhi
 *   正确还原，下一回合评分与结算与还原前一致（固定 SeededRandomSource 流）。
 * - 未启用波动的局 → 存档无 scoreVolatility 字段，读档后波动状态为 null。
 * - 波动生效时 getCardScore 对当前季叠加 deltaByDiZhi；base 规则不叠加。
 *
 * 使用真实 TurnManager（真引擎），不用 Python 复刻（AGENTS.md 退役约束）。
 */
import { describe, it, expect, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { SeededRandomSource } from '../../src/core/RandomSource';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { CURRENT_SCHEMA_VERSION, RULES_BASE, RULES_VERSION_TRADE, RULES_VERSION_VOLATILE } from '../../src/core/GameSaveService';
import { BAND_FACTOR, cardAmplitude, relationBand } from '../../src/core/ScoreVolatility';
import type { ScoreVolatilityConfig } from '../../src/core/ScoreVolatility';
import type { GameSnapshot } from '../../src/core/GameSaveService';
import type { StorageProvider } from '../../src/core/StorageProvider';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CARD_DATA = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));

/**
 * 注入的内存 StorageProvider（模拟 localStorage 介质），供真实
 * GameSaveService.save / load 链路使用。
 */
function makeMemoryStorage(): StorageProvider {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };
}

/**
 * 构造确定性的 TurnManager。
 * @param opts.volSeed 传时开启波动（显式实验模式），否则 base 规则。
 * @param opts.storage 注入存储介质（真实 save/load 链路用）。
 */
async function makeTm(mainSeed: number, opts?: {
  volSeed?: number;
  storage?: StorageProvider;
  volatility?: Partial<ScoreVolatilityConfig>;
  rulesVersion?: 1 | 2 | 3;
  scoreRules?: { holdBonus: number; sellMultiplier: number };
}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => CARD_DATA }));
  const random = new SeededRandomSource(mainSeed);
  const options: {
    volatility?: Partial<ScoreVolatilityConfig>;
    volatilityRandom?: SeededRandomSource;
    storage?: StorageProvider;
    rulesVersion?: 1 | 2 | 3;
    scoreRules?: { holdBonus: number; sellMultiplier: number };
  } = {};
  if (opts?.volSeed !== undefined || opts?.volatility) {
    options.volatility = { enabled: true, ...opts.volatility };
    if (opts?.volSeed !== undefined) options.volatilityRandom = new SeededRandomSource(opts.volSeed);
  }
  if (opts?.storage) options.storage = opts.storage;
  if (opts?.rulesVersion !== undefined) options.rulesVersion = opts.rulesVersion;
  if (opts?.scoreRules) options.scoreRules = opts.scoreRules;
  const tm = new TurnManager(undefined, random, options);
  await tm.initialize();
  return tm;
}

describe('波动状态持久化（scoreVolatility save → load → continue）', () => {
  it('v3 交易规则冻结牌区因子与卖出倍率，round-trip 后结算口径一致', async () => {
    const scoreRules = { holdBonus: 1.2, sellMultiplier: 14 };
    const bandFactors = { ...BAND_FACTOR, conflict: 6 };
    const v3Volatility = { model: 'conflict_banded' as const, scale: 4, bandFactors };
    const tm1 = await makeTm(42, {
      volSeed: 7,
      rulesVersion: RULES_VERSION_TRADE,
      scoreRules,
      volatility: v3Volatility,
    });
    tm1.startGame();
    expect(tm1.executeBuy(0, false)).toBe(true);
    const snapshot = tm1.exportSnapshot();

    expect(snapshot.rulesVersion).toBe(RULES_VERSION_TRADE);
    expect(snapshot.scoreRules).toEqual(scoreRules);
    expect(snapshot.scoreVolatility?.model).toBe('conflict_banded');
    expect(snapshot.scoreVolatility?.scale).toBe(4);
    expect(snapshot.scoreVolatility?.bandFactors).toEqual(bandFactors);

    const tm2 = await makeTm(42, { volSeed: 7 });
    tm2.importSnapshot(snapshot);
    expect(tm2.exportSnapshot().rulesVersion).toBe(RULES_VERSION_TRADE);
    expect(tm2.exportSnapshot().scoreRules).toEqual(scoreRules);
    expect(tm2.getScoreVolatilityState()?.bandFactors).toEqual(bandFactors);

    const season = tm1.getCurrentSeason();
    for (const card of tm1.getPublicCards()) {
      expect(tm2.getCardScore(card, season)).toBe(tm1.getCardScore(card, season));
    }
    expect(tm2.previewSettlement({ type: 'sell', slotIndex: 0 }))
      .toEqual(tm1.previewSettlement({ type: 'sell', slotIndex: 0 }));
  });

  it('v3 存档缺少交易计分参数时拒绝读档', async () => {
    const tm = await makeTm(42, {
      volSeed: 7,
      rulesVersion: RULES_VERSION_TRADE,
      scoreRules: { holdBonus: 1.2, sellMultiplier: 14 },
      volatility: { model: 'conflict_banded', scale: 4, bandFactors: { ...BAND_FACTOR, conflict: 6 } },
    });
    tm.startGame();
    const snapshot = tm.exportSnapshot();
    delete snapshot.scoreRules;
    expect(() => tm.importSnapshot(snapshot)).toThrowError(/scoreRules/);
  });

  it('波动局：snapshot 携带 rulesVersion=2 与 scoreVolatility，round-trip 后状态一致', async () => {
    const tm1 = await makeTm(42, { volSeed: 7 });
    tm1.startGame();
    // 买入一张牌 + 两个等待：让波动倒计时真实推进（可能跨 refresh 边界）
    tm1.executeBuy(0, false);
    tm1.executeWait();
    tm1.executeWait();

    const s1 = tm1.getScoreVolatilityState()!;
    expect(s1).not.toBeNull();
    const snapshot = tm1.exportSnapshot();
    expect(snapshot.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(snapshot.rulesVersion).toBe(RULES_VERSION_VOLATILE);
    expect(snapshot.scoreVolatility).toEqual({
      remainingRounds: s1.remainingRounds,
      deltaByDiZhi: s1.deltaByDiZhi,
    });

    // round-trip 到全新 volatile 实例（相同种子 → 后续波动随机流可复现）
    const tm2 = await makeTm(42, { volSeed: 7 });
    tm2.importSnapshot(snapshot);
    const s2 = tm2.getScoreVolatilityState()!;
    expect(s2.remainingRounds).toBe(s1.remainingRounds);
    expect(s2.deltaByDiZhi).toEqual(s1.deltaByDiZhi);
    // 公共牌 / 季节完整还原
    expect(tm2.getPublicCards().map((c) => c.id)).toEqual(tm1.getPublicCards().map((c) => c.id));
    expect(tm2.getCurrentSeason()).toBe(tm1.getCurrentSeason());

    // 当前季评分一致：波动偏移随档还原
    const season = tm2.getCurrentSeason();
    for (const card of tm1.getPublicCards()) {
      expect(tm2.getCardScore(card, season)).toBe(tm1.getCardScore(card, season));
    }

    // 下一回合卖出结算预览一致（还原前 vs 还原后）
    const preview1 = tm1.previewSettlement({ type: 'sell', slotIndex: 0 });
    const preview2 = tm2.previewSettlement({ type: 'sell', slotIndex: 0 });
    expect(preview2).toEqual(preview1);
  });

  it('读档后继续游戏：sell 的评分 / 气 / 回合与还原前一致（不跨换季）', async () => {
    const tm1 = await makeTm(42, { volSeed: 7 });
    tm1.startGame();
    tm1.executeBuy(0, false);
    const snapshot = tm1.exportSnapshot();

    const tm2 = await makeTm(42, { volSeed: 7 });
    tm2.importSnapshot(snapshot);

    // 还原前状态一致
    expect(tm2.getCurrentRound()).toBe(tm1.getCurrentRound());
    expect(tm2.getScore()).toBe(tm1.getScore());
    expect(tm2.getQi()).toBe(tm1.getQi());
    expect(tm2.getCurrentSeason()).toBe(tm1.getCurrentSeason());
    // 确保卖出不跨换季：跨季会触发 refreshScoreVolatility 用各自波动随机流重掷，产生分歧
    expect(tm1.getCurrentRoundInSeason()).toBeLessThan(12);

    const scoreBefore1 = tm1.getScore();
    const scoreBefore2 = tm2.getScore();
    expect(tm1.executeSell(0)).toBe(true);
    expect(tm2.executeSell(0)).toBe(true);

    expect(tm2.getScore()).toBe(tm1.getScore());
    expect(tm2.getQi()).toBe(tm1.getQi());
    expect(tm2.getCurrentRound()).toBe(tm1.getCurrentRound());
    expect(tm2.getTotalSells()).toBe(tm1.getTotalSells());
    expect(tm2.getScore() - scoreBefore2).toBe(tm1.getScore() - scoreBefore1);
  });

  it('未启用波动的局：存档无 scoreVolatility 字段，读档后波动状态为 null', async () => {
    const tm1 = await makeTm(99); // 无 volatility → base 规则
    tm1.startGame();
    tm1.executeBuy(0, false);

    const snapshot = tm1.exportSnapshot();
    expect(snapshot.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(snapshot.rulesVersion).toBe(RULES_BASE);
    expect(snapshot.scoreVolatility).toBeUndefined();

    const tm2 = await makeTm(99);
    tm2.importSnapshot(snapshot);
    expect(tm2.getScoreVolatilityState()).toBeNull();
  });

  it('volatile 规则生效时 getCardScore 叠加 deltaByDiZhi；base 规则不叠加', async () => {
    const tm = await makeTm(42, { volSeed: 7 });
    tm.startGame();
    const state = tm.getScoreVolatilityState()!;
    const season = tm.getCurrentSeason();
    for (const card of tm.getPublicCards()) {
      const base = card.getSeasonScore(season, DEFAULT_BALANCE_CONFIG);
      const withDelta = base + (state.deltaByDiZhi[card.diZhi] ?? 0);
      expect(tm.getCardScore(card, season)).toBe(withDelta);
    }

    const baseTm = await makeTm(99);
    baseTm.startGame();
    for (const card of baseTm.getPublicCards()) {
      expect(baseTm.getCardScore(card, baseTm.getCurrentSeason()))
        .toBe(card.getSeasonScore(baseTm.getCurrentSeason(), DEFAULT_BALANCE_CONFIG));
    }
  });

  it('conflict_banded 按关系档位与共享方向计算牌级波动', async () => {
    const tm = await makeTm(42, {
      volSeed: 7,
      volatility: { model: 'conflict_banded', scale: 2 },
    });
    tm.startGame();

    const state = tm.getScoreVolatilityState()!;
    expect(state.model).toBe('conflict_banded');
    expect(state.scale).toBe(2);
    expect(Object.keys(state.directionByDiZhi ?? {})).toHaveLength(12);

    const cardData = CARD_DATA.find((item: { name: string }) => item.name === '壬午');
    const card = tm.getCardById(cardData.id)!;
    const season = tm.getCurrentSeason();
    const base = card.getSeasonScore(season, DEFAULT_BALANCE_CONFIG);
    const direction = state.directionByDiZhi![card.diZhi];
    expect(relationBand(card)).toBe('conflict');
    expect(tm.getCardScore(card, season)).toBe(
      Math.round(base + direction * cardAmplitude(card, 2, base)),
    );

    // 未来季预览仍返回基础分，波动只作用于当前季。
    const nextSeason = tm.getFollowingSeason();
    expect(tm.getCardScore(card, nextSeason)).toBe(card.getSeasonScore(nextSeason, DEFAULT_BALANCE_CONFIG));
  });

  it('conflict_banded 存档加载到 base 构造实例后仍按存档模型继续刷新', async () => {
    const tm1 = await makeTm(42, {
      volSeed: 7,
      volatility: { model: 'conflict_banded', scale: 2 },
    });
    tm1.startGame();
    const snapshot = tm1.exportSnapshot();
    expect(snapshot.scoreVolatility?.model).toBe('conflict_banded');
    expect(snapshot.scoreVolatility?.scale).toBe(2);

    const tm2 = await makeTm(42);
    tm2.importSnapshot(snapshot);
    expect(tm2.getScoreVolatilityState()?.model).toBe('conflict_banded');
    expect(tm2.getScoreVolatilityState()?.scale).toBe(2);

    const season = tm1.getCurrentSeason();
    for (const card of tm1.getPublicCards()) {
      expect(tm2.getCardScore(card, season)).toBe(tm1.getCardScore(card, season));
    }
  });

  it('未知波动模型不静默按 uniform 运行', async () => {
    const tm = await makeTm(42, { volSeed: 7, volatility: { model: 'conflict_banded', scale: 2 } });
    tm.startGame();
    const snapshot = tm.exportSnapshot();
    (snapshot.scoreVolatility as any).model = 'future_model';

    expect(() => tm.importSnapshot(snapshot)).toThrowError(/不支持的波动模型/);
    expect(tm.exportSnapshot().scoreVolatility?.model).toBe('conflict_banded');
  });

  it('真实 GameSaveService save/load（注入内存 StorageProvider）：volatile 档经 localStorage 完整往返', async () => {
    const storage = makeMemoryStorage();
    const tm1 = await makeTm(42, { volSeed: 7, storage });
    tm1.startGame();
    tm1.executeBuy(0, false);
    tm1.executeWait();
    tm1.executeWait();

    const s1 = tm1.getScoreVolatilityState()!;
    expect(s1).not.toBeNull();
    expect(tm1.saveGame()).toBe(true);

    // 存档真实落在存储介质中：声明 volatile 规则 + 携带波动状态
    const raw = JSON.parse(storage.getItem('jiazi_game_save')!) as GameSnapshot;
    expect(raw.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(raw.rulesVersion).toBe(RULES_VERSION_VOLATILE);
    expect(raw.scoreVolatility).toEqual({ remainingRounds: s1.remainingRounds, deltaByDiZhi: s1.deltaByDiZhi });

    // 全新 volatile 实例经 loadGame 从存储还原
    const tm2 = await makeTm(42, { volSeed: 7, storage });
    expect(tm2.loadGame()).toBe(true);
    expect(tm2.getLastLoadError()).toBeNull(); // 成功后失败原因清空
    const s2 = tm2.getScoreVolatilityState()!;
    expect(s2.remainingRounds).toBe(s1.remainingRounds);
    expect(s2.deltaByDiZhi).toEqual(s1.deltaByDiZhi);
    // 当前卡评分 / 季节 / 回合一致
    expect(tm2.getCurrentRound()).toBe(tm1.getCurrentRound());
    expect(tm2.getCurrentSeason()).toBe(tm1.getCurrentSeason());
    const season = tm2.getCurrentSeason();
    for (const card of tm1.getPublicCards()) {
      expect(tm2.getCardScore(card, season)).toBe(tm1.getCardScore(card, season));
    }

    // 可执行卖出结果一致：还原前后对同一张牌执行卖出，分差 / 气 / 回合一致
    // （不跨换季，避免 refreshScoreVolatility 用各自波动随机流重掷产生分歧）
    expect(tm1.getCurrentRoundInSeason()).toBeLessThan(12);
    const scoreBefore1 = tm1.getScore();
    const scoreBefore2 = tm2.getScore();
    expect(tm1.executeSell(0)).toBe(true);
    expect(tm2.executeSell(0)).toBe(true);
    expect(tm2.getScore()).toBe(tm1.getScore());
    expect(tm2.getQi()).toBe(tm1.getQi());
    expect(tm2.getCurrentRound()).toBe(tm1.getCurrentRound());
    expect(tm2.getScore() - scoreBefore2).toBe(tm1.getScore() - scoreBefore1);
  });

  it('真实 GameSaveService save/load：conflict_banded 档在 base 构造实例中恢复模型与牌级评分', async () => {
    const storage = makeMemoryStorage();
    const tm1 = await makeTm(42, {
      volSeed: 7,
      storage,
      volatility: { model: 'conflict_banded', scale: 2 },
    });
    tm1.startGame();
    expect(tm1.saveGame()).toBe(true);

    const raw = JSON.parse(storage.getItem('jiazi_game_save')!) as GameSnapshot;
    expect(raw.rulesVersion).toBe(RULES_VERSION_VOLATILE);
    expect(raw.scoreVolatility?.model).toBe('conflict_banded');

    const tm2 = await makeTm(42, { storage });
    expect(tm2.loadGame()).toBe(true);
    expect(tm2.getScoreVolatilityState()?.model).toBe('conflict_banded');
    expect(tm2.getScoreVolatilityState()?.scale).toBe(2);
    const season = tm1.getCurrentSeason();
    for (const card of tm1.getPublicCards()) {
      expect(tm2.getCardScore(card, season)).toBe(tm1.getCardScore(card, season));
    }
  });

  it('rulesVersion=2 缺少波动状态：loadGame 拒绝并保留存档', async () => {
    const storage = makeMemoryStorage();
    const source = await makeTm(42, { storage });
    source.startGame();
    const raw = source.exportSnapshot();
    raw.rulesVersion = RULES_VERSION_VOLATILE;
    delete raw.scoreVolatility;
    storage.setItem('jiazi_game_save', JSON.stringify(raw));

    const tm = await makeTm(42, { storage });
    expect(tm.loadGame()).toBe(false);
    expect(tm.getLastLoadError()).toBe('invalid_or_import_failed');
    expect(storage.getItem('jiazi_game_save')).not.toBeNull();
  });

  it('未知波动模型：loadGame 拒绝并保留存档', async () => {
    const storage = makeMemoryStorage();
    const source = await makeTm(42, {
      volSeed: 7,
      storage,
      volatility: { model: 'conflict_banded', scale: 2 },
    });
    source.startGame();
    expect(source.saveGame()).toBe(true);
    const raw = JSON.parse(storage.getItem('jiazi_game_save')!) as GameSnapshot;
    (raw.scoreVolatility as any).model = 'future_model';
    storage.setItem('jiazi_game_save', JSON.stringify(raw));

    const tm = await makeTm(42, { storage });
    expect(tm.loadGame()).toBe(false);
    expect(tm.getLastLoadError()).toBe('invalid_or_import_failed');
    expect(storage.getItem('jiazi_game_save')).not.toBeNull();
  });

  it('未知 rulesVersion（99）不再静默按 base 运行：loadGame 返回 false 且保留存档', async () => {
    const storage = makeMemoryStorage();
    const tm = await makeTm(42, { volSeed: 7, storage });
    tm.startGame();
    tm.executeBuy(0, false);
    expect(tm.saveGame()).toBe(true);

    // 篡改存档为未来未知规则版本（scoreVolatility 数据保持在场）
    const raw = JSON.parse(storage.getItem('jiazi_game_save')!) as GameSnapshot;
    raw.rulesVersion = 99;
    storage.setItem('jiazi_game_save', JSON.stringify(raw));

    // 全新 volatile 实例读未知规则档：必须明确失败（false），不按 base 静默继续，
    // 且存档被保留（不清理），供未来版本升级解析。
    const tm2 = await makeTm(42, { volSeed: 7, storage });
    expect(tm2.loadGame()).toBe(false);
    expect(storage.getItem('jiazi_game_save')).not.toBeNull();
    // TurnManager 向 app 暴露失败原因：未知规则版本（供 UI 提示"存档版本过新，请更新游戏"）
    expect(tm2.getLastLoadError()).toBe('rules_version_unsupported');
    // 引擎未被未知规则档改动：波动状态仍是构造默认（volatile 局），未进入 base
    expect(tm2.getScoreVolatilityState()).not.toBeNull();
  });

  it('未知 rulesVersion（99）经 importSnapshot 直接调用：抛明确错误，不还原波动、不写回未知版本', async () => {
    const tm = await makeTm(42, { volSeed: 7 }); // 构造开启波动，读未知版本档也必须被挡掉
    tm.startGame();
    tm.executeBuy(0, false);
    const snapshot = tm.exportSnapshot();
    snapshot.rulesVersion = 99; // 模拟未来未知规则版本（scoreVolatility 数据保持在场）

    expect(() => tm.importSnapshot(snapshot)).toThrowError(/不支持的规则版本 rulesVersion=99/);
    // 读档失败即止：引擎保持读档前状态——波动状态未被改动、未知版本未写回引擎规则归属
    expect(tm.getScoreVolatilityState()).not.toBeNull();
    expect(tm.exportSnapshot().rulesVersion).toBe(RULES_VERSION_VOLATILE);
  });
});

describe('rulesVersion=2 波动存档完整校验（importSnapshot 改动引擎状态前拒绝坏档）', () => {
  /**
   * 在内存存储中写入一份 scoreVolatility 被篡改的 volatile 存档，并经真实
   * GameSaveService.load 链路验证：loadGame 返回 false、失败原因分类为
   * invalid_or_import_failed、原始存档被保留（不清理）。
   */
  async function expectLoadRejects(corrupt: (raw: GameSnapshot) => void | string) {
    const storage = makeMemoryStorage();
    const source = await makeTm(42, { volSeed: 7, storage });
    source.startGame();
    source.executeBuy(0, false);
    expect(source.saveGame()).toBe(true);

    const raw = JSON.parse(storage.getItem('jiazi_game_save')!) as GameSnapshot;
    raw.rulesVersion = RULES_VERSION_VOLATILE;
    // 统一构造一份合法的 uniform 波动快照，再由各用例破坏字段
    raw.scoreVolatility = { remainingRounds: 2, deltaByDiZhi: { 子: 1, 丑: -1 } };

    const written = corrupt(raw);
    storage.setItem('jiazi_game_save', typeof written === 'string' ? written : JSON.stringify(raw));

    const tm = await makeTm(42, { storage });
    expect(tm.loadGame()).toBe(false);
    expect(tm.getLastLoadError()).toBe('invalid_or_import_failed');
    expect(storage.getItem('jiazi_game_save')).not.toBeNull();
  }

  const malformedCases: [string, (raw: GameSnapshot) => void | string][] = [
    ['scoreVolatility 非对象（number）', (raw) => { (raw as any).scoreVolatility = 42; }],
    ['remainingRounds 为负', (raw) => { (raw.scoreVolatility as any).remainingRounds = -1; }],
    ['remainingRounds 非整数', (raw) => { (raw.scoreVolatility as any).remainingRounds = 1.5; }],
    ['remainingRounds 非数字', (raw) => { (raw.scoreVolatility as any).remainingRounds = '2'; }],
    ['deltaByDiZhi 缺失', (raw) => { delete (raw.scoreVolatility as any).deltaByDiZhi; }],
    ['deltaByDiZhi 为 null', (raw) => { (raw.scoreVolatility as any).deltaByDiZhi = null; }],
    ['deltaByDiZhi 值为非数字', (raw) => { (raw.scoreVolatility as any).deltaByDiZhi = { 子: 'high' }; }],
    [
      'deltaByDiZhi 值为非有限数字（1e999 溢出 → Infinity）',
      (raw) => {
        (raw.scoreVolatility as any).deltaByDiZhi = { 子: 1234567, 丑: -1 };
        // JSON.stringify(Infinity) 会序列化成 null，故直接写入含溢出字面量的原始字符串
        return JSON.stringify(raw).replace('1234567', '1e999');
      },
    ],
  ];

  it.each(malformedCases)(
    '%s：loadGame 拒绝、invalid_or_import_failed、保留原始存档',
    async (_name, corrupt) => {
      await expectLoadRejects(corrupt);
    },
  );

  const malformedConflictCases: [string, (vol: any) => void][] = [
    ['scale 为负', (vol) => { vol.scale = -1; }],
    ['scale 非数字', (vol) => { vol.scale = '2'; }],
    ['scale 非有限（1e999 溢出 → Infinity）', (vol) => { vol.scale = 1234567; }],
    ['directionByDiZhi 缺失', (vol) => { delete vol.directionByDiZhi; }],
    ['directionByDiZhi 为 null', (vol) => { vol.directionByDiZhi = null; }],
    ['directionByDiZhi 值超出 [-1, 1]', (vol) => { vol.directionByDiZhi = { 子: 5 }; }],
    ['directionByDiZhi 值为非数字', (vol) => { vol.directionByDiZhi = { 子: 'up' }; }],
  ];

  it.each(malformedConflictCases)(
    'conflict_banded：%s：loadGame 拒绝、invalid_or_import_failed、保留原始存档',
    async (_name, corrupt) => {
      await expectLoadRejects((raw) => {
        const vol = raw.scoreVolatility as any;
        vol.model = 'conflict_banded';
        vol.scale = 2;
        vol.directionByDiZhi = { 子: 1, 丑: -1 };
        corrupt(vol);
        if (vol.scale === 1234567) {
          // 溢出字面量：直接写入原始字符串，JSON.parse 后得到 Infinity（非有限数字）
          return JSON.stringify(raw).replace('1234567', '1e999');
        }
      });
    },
  );

  it('valid conflict_banded 存档（含 scale / directionByDiZhi）：正常读档还原', async () => {
    const storage = makeMemoryStorage();
    const source = await makeTm(42, { volSeed: 7, storage });
    source.startGame();
    expect(source.saveGame()).toBe(true);

    const raw = JSON.parse(storage.getItem('jiazi_game_save')!) as GameSnapshot;
    raw.rulesVersion = RULES_VERSION_VOLATILE;
    raw.scoreVolatility = {
      model: 'conflict_banded',
      scale: 2,
      remainingRounds: 1,
      deltaByDiZhi: {},
      directionByDiZhi: { 子: 1, 丑: -0.5 },
    };
    storage.setItem('jiazi_game_save', JSON.stringify(raw));

    const tm = await makeTm(42, { storage });
    expect(tm.loadGame()).toBe(true);
    expect(tm.getScoreVolatilityState()?.model).toBe('conflict_banded');
    expect(tm.getScoreVolatilityState()?.scale).toBe(2);
    expect(tm.getScoreVolatilityState()?.remainingRounds).toBe(1);
  });

  it('direct importSnapshot 校验失败：不改动读档前已有的规则/波动状态', async () => {
    const tm = await makeTm(42, { volSeed: 7 }); // volatile 构造：有预置波动状态
    tm.startGame();
    tm.executeBuy(0, false);
    const beforeVol = tm.getScoreVolatilityState()!;
    expect(beforeVol).not.toBeNull();
    const beforeRound = tm.getCurrentRound();
    const beforeScore = tm.getScore();
    const beforeQi = tm.getQi();

    const snapshot = tm.exportSnapshot();
    expect(snapshot.rulesVersion).toBe(RULES_VERSION_VOLATILE);
    (snapshot.scoreVolatility as any).remainingRounds = -5;

    expect(() => tm.importSnapshot(snapshot)).toThrowError(/remainingRounds/);
    // 读档失败即止：引擎保持读档前状态——波动状态原样、规则归属未写回、基础数值未动
    expect(tm.getScoreVolatilityState()).toEqual(beforeVol);
    expect(tm.getScoreVolatilityState()).not.toBeNull();
    expect(tm.exportSnapshot().rulesVersion).toBe(RULES_VERSION_VOLATILE);
    expect(tm.getCurrentRound()).toBe(beforeRound);
    expect(tm.getScore()).toBe(beforeScore);
    expect(tm.getQi()).toBe(beforeQi);
  });
});

describe('卡牌短期趋势辅助方法', () => {
  async function makeConflictTrendTm() {
    const tm = await makeTm(42, {
      volSeed: 7,
      volatility: { model: 'conflict_banded', scale: 2 },
    });
    tm.startGame();
    return tm;
  }

  it('base 规则未启用波动时返回 null', async () => {
    const tm = await makeTm(42);
    tm.startGame();
    expect(tm.getCardVolatilityTrend(tm.getPublicCards()[0]!)).toBeNull();
  });

  it.each([
    [1, 'rising'],
    [-1, 'falling'],
    [0, 'steady'],
  ] as const)('conflict_banded 方向 %s 映射为 %s', async (direction, expected) => {
    const tm = await makeConflictTrendTm();
    const card = tm.getPublicCards()[0]!;
    const snapshot = tm.exportSnapshot();
    const volatility = snapshot.scoreVolatility!;
    volatility.directionByDiZhi = {
      ...volatility.directionByDiZhi,
      [card.diZhi]: direction,
    };
    tm.importSnapshot(snapshot);
    expect(tm.getCardVolatilityTrend(card)).toBe(expected);
  });
});
