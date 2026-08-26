import { useMemo } from 'react';
import { useGameStore } from '../store';
import { buildCultivationProfileSnapshot } from '../lib/cultivationProfile';

function formatDateTime(value: string | null): string {
  if (!value) return '未记录';
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value.slice(0, 10);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts);
}

function StatCard({
  label,
  value,
  tone = 'ink',
}: {
  label: string;
  value: string | number;
  tone?: 'ink' | 'full' | 'critical' | 'gold';
}) {
  const toneClass =
    tone === 'full'
      ? 'text-qi-full'
      : tone === 'critical'
        ? 'text-qi-critical'
        : tone === 'gold'
          ? 'text-gold'
          : 'text-ink';

  return (
    <div className="rounded-2xl border border-wood-light bg-white/80 px-3 py-2.5 shadow-sm">
      <div className="text-[11px] text-ink-light">{label}</div>
      <div className={`mt-0.5 font-serif text-xl font-black tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function SectionTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h3 className="font-serif text-sm font-bold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-light">{subtitle}</p>}
      </div>
    </div>
  );
}

export function CultivationProfileModal() {
  const open = useGameStore((s) => s.cultivationProfileOpen);
  const close = useGameStore((s) => s.closeCultivationProfile);
  const claim = useGameStore((s) => s.claimCultivationLedger);
  const claimableCount = useGameStore((s) => s.cultivationLedgerClaimableCount);
  const localRecords = useGameStore((s) => s.cultivationLedgerRecords);
  const telemetryState = useGameStore((s) => s.telemetryState);
  const turnManager = useGameStore((s) => s.turnManager);

  const currentRulesVersion = turnManager?.getRulesVersion() ?? null;
  const cloudRecords = telemetryState?.cultivationLedger?.records ?? null;
  const cloudBusy = telemetryState?.cultivationLedgerBusy ?? false;
  const cloudError = telemetryState?.cultivationLedgerError ?? null;
  const identity = telemetryState?.identity ?? null;
  const consentGranted = telemetryState?.consent?.granted ?? false;
  const telemetryEnabled = telemetryState?.telemetryEnabled ?? false;

  const profile = useMemo(
    () => buildCultivationProfileSnapshot(localRecords, cloudRecords, currentRulesVersion),
    [localRecords, cloudRecords, currentRulesVersion],
  );

  if (!open) return null;

  const currentRuleSummary = profile.combinedSummary.byRulesVersion.find(
    (group) => group.rulesVersion === currentRulesVersion,
  ) ?? null;
  const cloudReady = Boolean(identity && consentGranted && telemetryEnabled && cloudRecords);

  return (
    <div className="modal-backdrop absolute inset-0 z-50 flex items-center justify-center bg-black/50 px-3 backdrop-blur-sm">
      <div className="flex w-full max-w-md max-h-[92%] flex-col overflow-hidden rounded-[28px] border border-[#DAC9A8] bg-[#F6EDDC] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[#E6D7B8] bg-gradient-to-r from-[#FCF6EA] to-[#F2E4C7] px-4 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-serif text-lg font-bold text-ink">修行档案</h2>
              <span className="rounded-full border border-wood-light bg-white/80 px-2 py-0.5 text-[10px] text-ink-light tabular-nums">
                V{currentRulesVersion ?? '?'}
              </span>
              <span className="rounded-full border border-wood-light bg-white/80 px-2 py-0.5 text-[10px] text-ink-light">
                {cloudReady ? '已同步云端' : '本机档案'}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-light">
              {cloudReady
                ? '档案按当前规则与云端可见记录汇总；本机新增记录认领后会并入云端。'
                : '先从本机账本开始，认领后会自动并入云端档案。'}
            </p>
          </div>
          <button
            onClick={close}
            className="shrink-0 rounded-full border border-wood-light bg-white/90 px-3 py-1.5 text-sm font-bold text-ink shadow-sm transition-colors hover:bg-wood-light/30"
          >
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <section className="space-y-3">
            <SectionTitle
              title="总览"
              subtitle="把整局成长拆成几个能一眼看懂的数字。"
            />
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="累计局数" value={profile.combinedSummary.totalGames} tone="gold" />
              <StatCard label="完成局数" value={profile.combinedSummary.completedGames} tone="full" />
              <StatCard label="主动放弃" value={profile.combinedSummary.abandonedGames} tone="critical" />
            </div>
            {profile.sourceBreakdown.localOnly + profile.sourceBreakdown.localClaim + profile.sourceBreakdown.verifiedSession > 0 && (
              <div className="flex flex-wrap gap-2 text-[11px] text-ink-light">
                <span className="rounded-full border border-wood-light bg-white/80 px-2.5 py-1">
                  本机记录 {profile.sourceBreakdown.localOnly}
                </span>
                <span className="rounded-full border border-wood-light bg-white/80 px-2.5 py-1">
                  本机认领 {profile.sourceBreakdown.localClaim}
                </span>
                <span className="rounded-full border border-wood-light bg-white/80 px-2.5 py-1">
                  云端校验 {profile.sourceBreakdown.verifiedSession}
                </span>
              </div>
            )}
          </section>

          <section className="mt-5 space-y-3">
            <SectionTitle
              title="当前规则统计"
              subtitle="只看当前规则版本的完成局，历史规则另起一栏，不混算。"
            />
            <div className="rounded-[22px] border border-wood-light bg-white/85 p-3 shadow-sm">
              {currentRuleSummary ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] text-ink-light">当前规则 V{currentRulesVersion ?? '?'}</div>
                      <div className="mt-0.5 font-serif text-base font-bold text-ink tabular-nums">
                        {currentRuleSummary.completedGames} 局完成
                      </div>
                    </div>
                    <span className="rounded-full bg-wood-light/60 px-2 py-1 text-[10px] text-ink">
                      仅完成局
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <StatCard label="平均修为" value={currentRuleSummary.averageScore?.toFixed(1) ?? '—'} tone="gold" />
                    <StatCard label="最高修为" value={currentRuleSummary.highestScore?.toFixed(1) ?? '—'} tone="full" />
                    <StatCard label="最低修为" value={currentRuleSummary.lowestScore?.toFixed(1) ?? '—'} tone="critical" />
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-wood-light bg-[#FBF8F0] px-3 py-4 text-center text-xs text-ink-light">
                  当前规则暂无完成局，完成第一局后这里会显示均分、最高和最低修为。
                </div>
              )}
              {profile.combinedSummary.byRulesVersion.length > 1 && (
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-ink-light">
                  {profile.combinedSummary.byRulesVersion
                    .filter((group) => group.rulesVersion !== currentRulesVersion)
                    .map((group) => (
                      <span
                        key={group.rulesVersion}
                        className="rounded-full border border-wood-light bg-[#FBF8F0] px-2.5 py-1 tabular-nums"
                      >
                        V{group.rulesVersion} {group.completedGames} 局 · 均 {group.averageScore?.toFixed(1) ?? '—'}
                      </span>
                    ))}
                </div>
              )}
            </div>
          </section>

          <section className="mt-5 space-y-3">
            <SectionTitle
              title="修行里程碑"
              subtitle="这些节点只反映真实进度，不奖励数值，也不公开给其他玩家。"
            />
            <div className="space-y-2.5">
              {profile.milestones.map((milestone) => (
                <div
                  key={milestone.key}
                  className="rounded-[22px] border border-wood-light bg-white/85 px-3 py-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-serif text-sm font-bold text-ink">{milestone.title}</div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-ink-light">{milestone.detail}</div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${
                        milestone.achieved ? 'bg-qi-full/10 text-qi-full' : 'bg-wood-light/40 text-ink-light'
                      }`}
                    >
                      {milestone.achieved ? '已达成' : '待解锁'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-light">
                    <span className="rounded-full bg-[#FBF8F0] px-2.5 py-1 tabular-nums">{milestone.progress}</span>
                    <span className="rounded-full bg-[#FBF8F0] px-2.5 py-1">{milestone.sourceLabel}</span>
                    <span className="rounded-full bg-[#FBF8F0] px-2.5 py-1">
                      {formatDateTime(milestone.achievedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-5 space-y-3">
            <SectionTitle
              title="认领同步"
              subtitle="本机新记录先留在这里，认领后会并入云端档案；同一条不会重复写入。"
            />
            <div className="rounded-[22px] border border-wood-light bg-white/85 p-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-light">
                <span>可认领本机终态记录 {claimableCount}</span>
                <span>云端档案 {cloudRecords?.length ?? 0} 条</span>
              </div>
              {cloudError && <p className="mt-2 text-xs text-qi-critical">{cloudError}</p>}
              {!identity || !consentGranted || !telemetryEnabled ? (
                <p className="mt-2 text-xs leading-relaxed text-ink-light">
                  先生成玩家 ID 并允许云端记录，才能把本机修行记录认领到云端。
                </p>
              ) : claimableCount > 0 ? (
                <button
                  onClick={() => void claim()}
                  disabled={cloudBusy}
                  className="mt-3 w-full rounded-2xl bg-ink px-4 py-3 text-sm font-bold text-parchment transition-colors hover:bg-wood-dark disabled:cursor-wait disabled:opacity-60"
                >
                  {cloudBusy ? '同步中…' : `认领并同步本机记录（${claimableCount}）`}
                </button>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-ink-light">
                  当前没有可认领的本机记录。完成新局后再来这里同步。
                </p>
              )}
            </div>
          </section>

          <section className="mt-5 rounded-[22px] border border-dashed border-wood-light bg-[#FBF8F0] px-3 py-3 text-[11px] leading-relaxed text-ink-light">
            档案统计遵循当前规则版本口径：平均、最高、最低修为只看当前规则的完成局；历史规则只作为独立分组展示，不与当前规则混算。
          </section>
        </div>
      </div>
    </div>
  );
}
