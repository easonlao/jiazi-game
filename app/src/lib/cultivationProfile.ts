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
 * - 云端存在时，以云端记录为主，并补上本机仍在进行中的局内记录；
 * - 云端不存在时，直接使用本机账本；
 * - 统计与里程碑都基于去重后的展示序列，避免把已认领的本机记录重复算两次。
 */
export function buildCultivationProfileSnapshot(
  localRecords: readonly CultivationLedgerRecord[],
  cloudRecords: readonly CultivationLedgerEntry[] | null,
  currentRulesVersion: number | null,
): CultivationProfileSnapshot {
  const localSummary = summarizeCultivationLedger(localRecords);
  const cloudNormalized = cloudRecords?.map(mapCloudRecord) ?? null;
  // 已取得云端账本时，云端记录是跨设备去重的主记录；但尚未认领的
  // 本机终态记录仍属于玩家当前可见的成长，不能因为联网而暂时从档案消失。
  // 以 local_game_id 去重后保留它们，认领成功后自然收敛为云端来源。
  const localOnlyRecords = localRecords
    .filter((record) => !cloudNormalized?.some((cloudRecord) => cloudRecord.id === record.id))
    .map(mapLocalRecord);
  const combinedRecords = cloudNormalized
    ? [...cloudNormalized, ...localOnlyRecords]
    : localOnlyRecords;

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

  return {
    records,
    localSummary,
    cloudSummary,
    combinedSummary,
    sourceBreakdown,
    milestones,
  };
}
