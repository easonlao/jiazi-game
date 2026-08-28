import type {
  CultivationLedgerOutcome,
  CultivationLedgerRecord,
  CultivationLedgerSummary,
} from './cultivationLedger';
import type { CultivationLedgerEntry } from './analyticsBackend';
import { summarizeCultivationLedger } from './cultivationLedger';

export type CultivationProfileRecordSource = 'local' | 'local_claim' | 'verified_session';

export interface CultivationProfileRecord {
  id: string;
  rulesVersion: number;
  startedAt: string;
  endedAt: string | null;
  outcome: CultivationLedgerOutcome;
  finalScore: number | null;
  source: CultivationProfileRecordSource;
  sourceLabel: string;
}

export interface CultivationPerseveranceSummary {
  completedGames: number;
  abandonedGames: number;
  activeGames: number;
  terminalGames: number;
  perseveranceRate: number | null;
  currentStreak: number;
  bestStreak: number;
  evalStatus: 'accumulating' | 'evaluated';
  ratingLabel: string;
  description: string;
}

export interface CultivationProfileMilestone {
  key: 'first_start' | 'first_completion' | 'completion_count' | 'current_rule_record';
  title: string;
  detail: string;
  progress: string;
  achievedAt: string | null;
  sourceLabel: string;
  achieved: boolean;
}

export interface CultivationProfileSnapshot {
  records: CultivationProfileRecord[];
  localSummary: CultivationLedgerSummary;
  cloudSummary: CultivationLedgerSummary | null;
  combinedSummary: CultivationLedgerSummary;
  sourceBreakdown: {
    localOnly: number;
    localClaim: number;
    verifiedSession: number;
  };
  milestones: CultivationProfileMilestone[];
  perseverance: CultivationPerseveranceSummary;
}

function stripTime(date: string): number {
  const ts = Date.parse(date);
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

function mapLocalRecord(record: CultivationLedgerRecord): CultivationProfileRecord {
  return {
    ...record,
    source: 'local',
    sourceLabel: record.outcome === 'active' ? '本机进行中' : '本机记录',
  };
}

function mapCloudRecord(record: CultivationLedgerEntry): CultivationProfileRecord {
  return {
    id: record.local_game_id,
    rulesVersion: record.rules_version,
    startedAt: record.started_at,
    endedAt: record.ended_at,
    outcome: record.outcome,
    finalScore: record.final_score,
    source: record.record_source,
    sourceLabel: record.record_source === 'verified_session' ? '云端校验' : '本机认领',
  };
}

function toSummarySource(record: CultivationProfileRecord): Pick<
  CultivationLedgerRecord,
  'rulesVersion' | 'outcome' | 'finalScore'
> {
  return {
    rulesVersion: record.rulesVersion,
    outcome: record.outcome,
    finalScore: record.finalScore,
  };
}

function sortRecords(records: readonly CultivationProfileRecord[]): CultivationProfileRecord[] {
  return [...records].sort((a, b) => {
    const startDiff = stripTime(a.startedAt) - stripTime(b.startedAt);
    if (startDiff !== 0) return startDiff;
    const endDiff = stripTime(a.endedAt ?? a.startedAt) - stripTime(b.endedAt ?? b.startedAt);
    if (endDiff !== 0) return endDiff;
    return a.id.localeCompare(b.id);
  });
}

function findFirst(records: readonly CultivationProfileRecord[], predicate: (record: CultivationProfileRecord) => boolean): CultivationProfileRecord | null {
  return sortRecords(records).find(predicate) ?? null;
}

function findBestCurrentRuleRecord(
  records: readonly CultivationProfileRecord[],
  currentRulesVersion: number | null,
): CultivationProfileRecord | null {
  if (currentRulesVersion === null) return null;
  let best: CultivationProfileRecord | null = null;
  for (const record of records) {
    if (record.outcome !== 'completed') continue;
    if (record.rulesVersion !== currentRulesVersion) continue;
    if (typeof record.finalScore !== 'number') continue;
    if (!best || record.finalScore > (best.finalScore ?? Number.NEGATIVE_INFINITY)) {
      best = record;
    }
  }
  return best;
}

function formatSourceCount(
  localOnly: number,
  localClaim: number,
  verifiedSession: number,
): CultivationProfileSnapshot['sourceBreakdown'] {
  return { localOnly, localClaim, verifiedSession };
}

/**
 * 把本机账本与云端账本归一化为档案视图数据。
 * - 已立档玩家：以云端记录为主，并合并未在云端的历史/本地对局；
 * - 游客（未立档）：本地试玩局不计入账号成长，既有云端记录保持可见；
 * - 统计与里程碑均基于去重后的账号修行记录序列。
 */
export function calculatePerseveranceSummary(
  records: readonly CultivationProfileRecord[]
): CultivationPerseveranceSummary {
  const terminalRecords = records.filter(
    (r) => r.outcome === 'completed' || r.outcome === 'abandoned'
  );
  const activeGames = records.filter((r) => r.outcome === 'active').length;
  const completedGames = records.filter((r) => r.outcome === 'completed').length;
  const abandonedGames = records.filter((r) => r.outcome === 'abandoned').length;
  const terminalGames = completedGames + abandonedGames;

  let currentStreak = 0;
  let bestStreak = 0;
  let runningStreak = 0;

  for (const rec of terminalRecords) {
    if (rec.outcome === 'completed') {
      runningStreak += 1;
      if (runningStreak > bestStreak) {
        bestStreak = runningStreak;
      }
    } else {
      runningStreak = 0;
    }
  }

  for (let i = terminalRecords.length - 1; i >= 0; i--) {
    if (terminalRecords[i].outcome === 'completed') {
      currentStreak += 1;
    } else {
      break;
    }
  }

  if (terminalGames === 0) {
    return {
      completedGames: 0,
      abandonedGames: 0,
      activeGames,
      terminalGames: 0,
      perseveranceRate: null,
      currentStreak: 0,
      bestStreak: 0,
      evalStatus: 'accumulating',
      ratingLabel: '道心初启',
      description: '暂无已完结的修行，完整走完一甲子开启道心记录。',
    };
  }

  if (terminalGames < 3) {
    return {
      completedGames,
      abandonedGames,
      activeGames,
      terminalGames,
      perseveranceRate: null,
      currentStreak,
      bestStreak,
      evalStatus: 'accumulating',
      ratingLabel: '道心初启',
      description: `当前已完成 ${completedGames} 局、主动终止 ${abandonedGames} 局。正在积累道心样本（需满 3 局）。`,
    };
  }

  const rawRate = (completedGames / terminalGames) * 100;
  const perseveranceRate = Math.round(rawRate * 10) / 10;

  let ratingLabel = '持之以恒';
  if (perseveranceRate >= 90) {
    ratingLabel = '道心恒固';
  } else if (perseveranceRate >= 75) {
    ratingLabel = '持之以恒';
  } else if (perseveranceRate >= 50) {
    ratingLabel = '随缘自适';
  } else {
    ratingLabel = '行止由心';
  }

  return {
    completedGames,
    abandonedGames,
    activeGames,
    terminalGames,
    perseveranceRate,
    currentStreak,
    bestStreak,
    evalStatus: 'evaluated',
    ratingLabel,
    description: `已完成 ${completedGames} 局，主动终止 ${abandonedGames} 局。坚持度 ${perseveranceRate}%，反映专注走完一甲子的修养节奏。`,
  };
}

export function buildCultivationProfileSnapshot(
  localRecords: readonly CultivationLedgerRecord[],
  cloudRecords: readonly CultivationLedgerEntry[] | null,
  currentRulesVersion: number | null,
  isAccountEstablished: boolean = true,
): CultivationProfileSnapshot {
  const localSummary = summarizeCultivationLedger(localRecords);
  const cloudNormalized = cloudRecords?.map(mapCloudRecord) ?? null;

  // 账号优先边界：无论游客还是已立档玩家，账号档案（局数、修为、里程碑、走势与坚持度）均仅统计云端记录，本机试玩/未上云局绝不计入
  const combinedRecords: CultivationProfileRecord[] = cloudNormalized
    ? [...cloudNormalized]
    : [];

  const records = sortRecords(combinedRecords);
  const combinedSummary = summarizeCultivationLedger(records.map(toSummarySource));
  const cloudSummary = cloudRecords
    ? summarizeCultivationLedger(
        cloudRecords.map((record) => ({
          rulesVersion: record.rules_version,
          outcome: record.outcome,
          finalScore: record.final_score,
        })),
      )
    : null;

  const sourceBreakdown = formatSourceCount(
    records.filter((record) => record.source === 'local').length,
    records.filter((record) => record.source === 'local_claim').length,
    records.filter((record) => record.source === 'verified_session').length,
  );

  const firstStart = records.length > 0 ? records[0] ?? null : null;
  const firstCompletion = findFirst(records, (record) => record.outcome === 'completed');
  const completedCount = combinedSummary.completedGames;
  const bestCurrentRuleRecord = findBestCurrentRuleRecord(records, currentRulesVersion);

  const bestCurrentRuleScore = bestCurrentRuleRecord?.finalScore;

  const milestones: CultivationProfileMilestone[] = [
    {
      key: 'first_start',
      title: '首次开局',
      detail: firstStart
        ? `最早记录于 ${firstStart.startedAt.slice(0, 10)}，开启了第一段修行`
        : '尚未开始任何一局',
      progress: firstStart ? '已达成' : '等待第一局开始',
      achievedAt: firstStart?.startedAt ?? null,
      sourceLabel: firstStart?.sourceLabel ?? '未记录',
      achieved: Boolean(firstStart),
    },
    {
      key: 'first_completion',
      title: '首次完成一甲子',
      detail: firstCompletion
        ? `第一局完整完成于 ${firstCompletion.endedAt?.slice(0, 10) ?? firstCompletion.startedAt.slice(0, 10)}`
        : '完成第一局后会自动解锁',
      progress: firstCompletion ? '已达成' : '等待首局完赛',
      achievedAt: firstCompletion?.endedAt ?? firstCompletion?.startedAt ?? null,
      sourceLabel: firstCompletion?.sourceLabel ?? '未记录',
      achieved: Boolean(firstCompletion),
    },
    {
      key: 'completion_count',
      title: '累计完成局数',
      detail: `当前已完成 ${completedCount} 局，记录会随着新对局继续增长`,
      progress: completedCount > 0 ? `已完成 ${completedCount} 局` : '尚无完成局',
      achievedAt: null,
      sourceLabel: cloudSummary ? '云端档案' : '本机账本',
      achieved: completedCount > 0,
    },
    {
      key: 'current_rule_record',
      title: '当前规则个人纪录',
      detail: currentRulesVersion === null
        ? '规则版本尚未就绪'
        : `只统计当前规则 V${currentRulesVersion} 的完成局，不和旧规则混比`,
      progress: typeof bestCurrentRuleScore === 'number'
        ? `最好 ${bestCurrentRuleScore.toFixed(1)} 修为`
        : '当前规则暂无完成局',
      achievedAt: bestCurrentRuleRecord?.endedAt ?? bestCurrentRuleRecord?.startedAt ?? null,
      sourceLabel: bestCurrentRuleRecord?.sourceLabel ?? '当前规则',
      achieved: Boolean(bestCurrentRuleRecord),
    },
  ];

  const perseverance = calculatePerseveranceSummary(records);

  return {
    records,
    localSummary,
    cloudSummary,
    combinedSummary,
    sourceBreakdown,
    milestones,
    perseverance,
  };
}
