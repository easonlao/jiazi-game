import type { StorageProvider } from '@core/index';

export const CULTIVATION_LEDGER_VERSION = 1 as const;
const CULTIVATION_LEDGER_KEY = 'jiazi_cultivation_ledger';
const LEADERBOARD_KEY = 'jiazi_leaderboard';

export type CultivationLedgerOutcome = 'active' | 'completed' | 'abandoned';

export interface CultivationLedgerRecord {
  id: string;
  rulesVersion: number;
  balanceProfileId?: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: CultivationLedgerOutcome;
  finalScore: number | null;
}

export interface CultivationRuleSummary {
  rulesVersion: number;
  completedGames: number;
  averageScore: number | null;
  highestScore: number | null;
  lowestScore: number | null;
}

export interface CultivationProfileSummary {
  profileId: string;
  rulesVersion: number;
  completedGames: number;
  averageScore: number | null;
  highestScore: number | null;
  lowestScore: number | null;
}

export interface CultivationLedgerSummary {
  totalGames: number;
  completedGames: number;
  abandonedGames: number;
  byRulesVersion: CultivationRuleSummary[];
  byBalanceProfile?: CultivationProfileSummary[];
  currentProfileSummary?: CultivationProfileSummary | null;
}

export type CultivationLedgerSummarySource = Pick<
  CultivationLedgerRecord,
  'rulesVersion' | 'outcome' | 'finalScore'
> & {
  balanceProfileId?: string | null;
};

interface CultivationLedgerState {
  version: number;
  activeGameId: string | null;
  records: CultivationLedgerRecord[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function newGameId(): string {
  const crypto = globalThis.crypto as Crypto | undefined;
  return crypto?.randomUUID?.() ?? `ledger_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function createEmptyState(): CultivationLedgerState {
  return {
    version: CULTIVATION_LEDGER_VERSION,
    activeGameId: null,
    records: [],
  };
}

function readLegacyLeaderboardRecords(storage: StorageProvider): CultivationLedgerRecord[] {
  try {
    const raw = storage.getItem(LEADERBOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const validEntries = parsed.filter((entry): entry is { score: number; date: string; rulesVersion?: number; balanceProfileId?: string } => (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { score?: unknown }).score === 'number' &&
      Number.isFinite((entry as { score?: unknown }).score) &&
      typeof (entry as { date?: unknown }).date === 'string' &&
      ((entry as { rulesVersion?: unknown }).rulesVersion === undefined ||
        Number.isInteger((entry as { rulesVersion?: unknown }).rulesVersion))
    ));
    return validEntries.map((entry, index) => {
      const rulesVersion = typeof entry.rulesVersion === 'number' ? entry.rulesVersion : 1;
      const score = Math.round(entry.score * 10) / 10;
      const startedAt = entry.date.includes('T') ? entry.date : `${entry.date}T00:00:00.000Z`;
      return {
        id: `legacy_lb_${rulesVersion}_${entry.date}_${score}_${index}`,
        rulesVersion,
        balanceProfileId: entry.balanceProfileId ?? null,
        startedAt,
        endedAt: startedAt,
        outcome: 'completed' as const,
        finalScore: score,
      };
    });
  } catch {
    return [];
  }
}

function readJson(storage: StorageProvider): CultivationLedgerState {
  try {
    const raw = storage.getItem(CULTIVATION_LEDGER_KEY);
    if (!raw) {
      const legacyRecords = readLegacyLeaderboardRecords(storage);
      const initialState: CultivationLedgerState = {
        version: CULTIVATION_LEDGER_VERSION,
        activeGameId: null,
        records: legacyRecords,
      };
      if (legacyRecords.length > 0) {
        writeJson(storage, initialState);
      }
      return initialState;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return createEmptyState();

    let records = Array.isArray((parsed as { records?: unknown }).records)
      ? (parsed as { records: unknown[] }).records.filter((record): record is CultivationLedgerRecord => (
          typeof record === 'object' &&
          record !== null &&
          typeof (record as CultivationLedgerRecord).id === 'string' &&
          typeof (record as CultivationLedgerRecord).rulesVersion === 'number' &&
          typeof (record as CultivationLedgerRecord).startedAt === 'string' &&
          ((record as CultivationLedgerRecord).outcome === 'active' ||
            (record as CultivationLedgerRecord).outcome === 'completed' ||
            (record as CultivationLedgerRecord).outcome === 'abandoned') &&
          ((record as CultivationLedgerRecord).endedAt === null || typeof (record as CultivationLedgerRecord).endedAt === 'string') &&
          ((record as CultivationLedgerRecord).finalScore === null || typeof (record as CultivationLedgerRecord).finalScore === 'number') &&
          ((record as CultivationLedgerRecord).balanceProfileId === undefined ||
            (record as CultivationLedgerRecord).balanceProfileId === null ||
            typeof (record as CultivationLedgerRecord).balanceProfileId === 'string')
        ))
      : [];

    if (records.length === 0) {
      const legacyRecords = readLegacyLeaderboardRecords(storage);
      if (legacyRecords.length > 0) {
        records = legacyRecords;
        writeJson(storage, {
          version: typeof (parsed as { version?: unknown }).version === 'number'
            ? (parsed as { version: number }).version
            : CULTIVATION_LEDGER_VERSION,
          activeGameId: null,
          records,
        });
      }
    }

    const activeGameId = typeof (parsed as { activeGameId?: unknown }).activeGameId === 'string'
      ? (parsed as { activeGameId: string }).activeGameId
      : null;
    const activeRecord = activeGameId
      ? records.find((record) => record.id === activeGameId && record.outcome === 'active') ?? null
      : null;
    return {
      version: typeof (parsed as { version?: unknown }).version === 'number'
        ? (parsed as { version: number }).version
        : CULTIVATION_LEDGER_VERSION,
      activeGameId: activeRecord?.id ?? null,
      records,
    };
  } catch {
    return createEmptyState();
  }
}

function writeJson(storage: StorageProvider, state: CultivationLedgerState): void {
  storage.setItem(CULTIVATION_LEDGER_KEY, JSON.stringify(state));
}

function finalizeActiveRecord(
  state: CultivationLedgerState,
  outcome: Exclude<CultivationLedgerOutcome, 'active'>,
  finalScore: number | null,
): CultivationLedgerState {
  if (!state.activeGameId) return state;
  const endedAt = nowIso();
  let changed = false;
  const records = state.records.map((record) => {
    if (record.id !== state.activeGameId) return record;
    if (record.outcome !== 'active') return record;
    changed = true;
    return {
      ...record,
      outcome,
      endedAt,
      finalScore,
    };
  });
  return changed
    ? {
        version: CULTIVATION_LEDGER_VERSION,
        activeGameId: null,
        records,
      }
    : {
        ...state,
        activeGameId: null,
      };
}

function createActiveRecord(
  rulesVersion: number,
  id = newGameId(),
  balanceProfileId?: string | null,
): CultivationLedgerRecord {
  return {
    id,
    rulesVersion,
    balanceProfileId: balanceProfileId ?? null,
    startedAt: nowIso(),
    endedAt: null,
    outcome: 'active',
    finalScore: null,
  };
}

export function summarizeCultivationLedger(
  records: readonly CultivationLedgerSummarySource[],
  currentProfileId?: string | null,
): CultivationLedgerSummary {
  const abandonedGames = records.filter((record) => record.outcome === 'abandoned').length;
  const groups = new Map<number, { completedGames: number; totalScore: number; highestScore: number; lowestScore: number }>();
  const profileGroups = new Map<string, { rulesVersion: number; completedGames: number; totalScore: number; highestScore: number; lowestScore: number }>();
  let completedGames = 0;

  for (const record of records) {
    if (record.outcome !== 'completed') continue;
    const finalScore = record.finalScore;
    if (typeof finalScore !== 'number') continue;

    // 按规则版本聚合
    const stats = groups.get(record.rulesVersion) ?? {
      completedGames: 0,
      totalScore: 0,
      highestScore: Number.NEGATIVE_INFINITY,
      lowestScore: Number.POSITIVE_INFINITY,
    };
    stats.completedGames += 1;
    stats.totalScore += finalScore;
    stats.highestScore = Math.max(stats.highestScore, finalScore);
    stats.lowestScore = Math.min(stats.lowestScore, finalScore);
    groups.set(record.rulesVersion, stats);

    // 按平衡档案独立聚合
    const profileKey = record.balanceProfileId ?? `v${record.rulesVersion}_standard`;
    const pStats = profileGroups.get(profileKey) ?? {
      rulesVersion: record.rulesVersion,
      completedGames: 0,
      totalScore: 0,
      highestScore: Number.NEGATIVE_INFINITY,
      lowestScore: Number.POSITIVE_INFINITY,
    };
    pStats.completedGames += 1;
    pStats.totalScore += finalScore;
    pStats.highestScore = Math.max(pStats.highestScore, finalScore);
    pStats.lowestScore = Math.min(pStats.lowestScore, finalScore);
    profileGroups.set(profileKey, pStats);

    completedGames += 1;
  }

  const byBalanceProfile: CultivationProfileSummary[] = [...profileGroups.entries()]
    .map(([profileId, stats]) => ({
      profileId,
      rulesVersion: stats.rulesVersion,
      completedGames: stats.completedGames,
      averageScore: stats.completedGames > 0 ? Math.round((stats.totalScore / stats.completedGames) * 10) / 10 : null,
      highestScore: stats.completedGames > 0 ? stats.highestScore : null,
      lowestScore: stats.completedGames > 0 ? stats.lowestScore : null,
    }))
    .sort((a, b) => b.rulesVersion - a.rulesVersion);

  const currentProfileSummary = currentProfileId
    ? byBalanceProfile.find((p) => p.profileId === currentProfileId) ?? null
    : null;
  const hasExplicitProfile = records.some((r) => r.balanceProfileId !== undefined && r.balanceProfileId !== null);
  const includeProfiles = Boolean(currentProfileId || hasExplicitProfile);

  return {
    totalGames: records.length,
    completedGames,
    abandonedGames,
    byRulesVersion: [...groups.entries()]
      .map(([rulesVersion, stats]) => ({
        rulesVersion,
        completedGames: stats.completedGames,
        averageScore: stats.completedGames > 0 ? Math.round((stats.totalScore / stats.completedGames) * 10) / 10 : null,
        highestScore: stats.completedGames > 0 ? stats.highestScore : null,
        lowestScore: stats.completedGames > 0 ? stats.lowestScore : null,
      }))
      .sort((a, b) => b.rulesVersion - a.rulesVersion),
    ...(includeProfiles ? { byBalanceProfile, currentProfileSummary } : {}),
  };
}

export class CultivationLedgerService {
  private readonly storage: StorageProvider;

  constructor(provider?: StorageProvider) {
    this.storage = provider ?? (globalThis as { localStorage?: StorageProvider }).localStorage!;
  }

  private readState(): CultivationLedgerState {
    return readJson(this.storage);
  }

  private writeState(state: CultivationLedgerState): void {
    writeJson(this.storage, state);
  }

  private getActiveRecord(state: CultivationLedgerState): CultivationLedgerRecord | null {
    if (!state.activeGameId) return null;
    return state.records.find((record) => record.id === state.activeGameId && record.outcome === 'active') ?? null;
  }

  private ensureActiveRecord(
    state: CultivationLedgerState,
    rulesVersion: number,
    explicitId?: string,
    balanceProfileId?: string | null,
  ): { state: CultivationLedgerState; record: CultivationLedgerRecord } {
    const active = this.getActiveRecord(state);
    if (active) return { state, record: active };
    const record = createActiveRecord(rulesVersion, explicitId, balanceProfileId);
    return {
      state: {
        version: CULTIVATION_LEDGER_VERSION,
        activeGameId: record.id,
        records: [...state.records, record],
      },
      record,
    };
  }

  /**
   * 开始一局新的本机修行记录。若已有进行中记录，会先标记为中断，再开启新记录。
   */
  startNewGame(
    rulesVersion: number,
    explicitId?: string,
    balanceProfileId?: string | null,
  ): CultivationLedgerRecord {
    const state = this.readState();
    const active = this.getActiveRecord(state);
    const nextState = active
      ? finalizeActiveRecord(state, 'abandoned', null)
      : state;
    const record = createActiveRecord(rulesVersion, explicitId, balanceProfileId);
    this.writeState({
      version: CULTIVATION_LEDGER_VERSION,
      activeGameId: record.id,
      records: [...nextState.records, record],
    });
    return record;
  }

  /**
   * 续接当前局；若没有进行中记录，则创建一条新的进行中记录，用于账本启用后的 prospective tracking。
   */
  resumeActiveGame(
    rulesVersion: number,
    explicitId?: string,
    balanceProfileId?: string | null,
  ): CultivationLedgerRecord {
    const state = this.readState();
    const { state: nextState, record } = this.ensureActiveRecord(
      state,
      rulesVersion,
      explicitId,
      balanceProfileId,
    );
    if (nextState !== state) this.writeState(nextState);
    return record;
  }

  completeActiveGame(finalScore: number): CultivationLedgerRecord | null {
    const state = this.readState();
    const active = this.getActiveRecord(state);
    if (!active) return null;
    const score = Math.round(finalScore * 10) / 10;
    const nextState = finalizeActiveRecord(state, 'completed', score);
    this.writeState(nextState);
    const endedAt = nextState.records.find((record) => record.id === active.id)?.endedAt ?? nowIso();
    return { ...active, outcome: 'completed', endedAt, finalScore: score };
  }

  abandonActiveGame(): CultivationLedgerRecord | null {
    const state = this.readState();
    const active = this.getActiveRecord(state);
    if (!active) return null;
    const nextState = finalizeActiveRecord(state, 'abandoned', null);
    this.writeState(nextState);
    const endedAt = nextState.records.find((record) => record.id === active.id)?.endedAt ?? nowIso();
    return { ...active, outcome: 'abandoned', endedAt, finalScore: null };
  }

  /**
   * 免惩罚清理当前进行中对局（用于技术异常恢复、受损存档重置等场景）。
   * 从记录中移除当前未完成的 active 记录，不标记为 abandoned，不计入坚持度未完成惩罚。
   */
  discardActiveGameWithoutPenalty(): void {
    const state = this.readState();
    if (!state.activeGameId) return;
    const nextRecords = state.records.filter((record) => record.id !== state.activeGameId);
    this.writeState({
      ...state,
      activeGameId: null,
      records: nextRecords,
    });
  }

  getSummary(currentProfileId?: string | null): CultivationLedgerSummary {
    return summarizeCultivationLedger(this.readState().records, currentProfileId);
  }

  getRecords(): readonly CultivationLedgerRecord[] {
    return this.readState().records;
  }

  getTerminalRecords(): readonly CultivationLedgerRecord[] {
    return this.readState().records.filter((record) => record.outcome !== 'active');
  }
}
