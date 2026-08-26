import { useMemo } from 'react';
import { CURRENT_RULES_VERSION } from '@core/index';
import { useGameStore } from '../store';
import { buildCultivationProfileSnapshot, type CultivationProfileMilestone } from '../lib/cultivationProfile';

function formatDate(value: string | null): string {
  if (!value) return '';
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value.slice(0, 10);
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(ts);
}

function formatScore(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toFixed(1) : '暂无';
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h3 className="font-serif text-base font-bold text-ink">{title}</h3>
      {description && <p className="mt-1 text-xs leading-relaxed text-ink-light">{description}</p>}
    </div>
  );
}

function ScoreMetric({ label, value, featured = false }: { label: string; value: string; featured?: boolean }) {
  return (
    <div className={featured ? 'rounded-2xl bg-[#F1E2C4] px-4 py-3' : 'rounded-2xl bg-[#FBF8F0] px-3 py-3'}>
      <div className="text-[11px] text-ink-light">{label}</div>
      <div className={`mt-1 font-serif font-black tabular-nums text-ink ${featured ? 'text-3xl' : 'text-xl'}`}>
        {value}
      </div>
    </div>
  );
}

function MilestoneLine({ milestone, isNext }: { milestone: CultivationProfileMilestone; isNext: boolean }) {
  const state = milestone.achieved ? '已点亮' : isNext ? '下一步' : '未解锁';
  const detail = isNext || !milestone.achieved ? milestone.detail : formatDate(milestone.achievedAt);
  const stateClass = milestone.achieved
    ? 'bg-qi-full/10 text-qi-full'
    : isNext
      ? 'bg-gold/15 text-wood-dark'
      : 'bg-wood-light/35 text-ink-light';

  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className={`mt-0.5 rounded-full px-2 py-1 text-[10px] font-bold ${stateClass}`}>{state}</span>
      <div className="min-w-0 flex-1">
        <div className="font-serif text-sm font-bold text-ink">{milestone.title}</div>
        {detail && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-light">{detail}</p>}
      </div>
      <span className="shrink-0 text-[11px] text-ink-light">{milestone.progress}</span>
    </li>
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

  const currentRulesVersion = turnManager?.getRulesVersion() ?? CURRENT_RULES_VERSION;
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
  const nextMilestone = profile.milestones.find((milestone) => !milestone.achieved) ?? null;
  const hasCloudIdentity = Boolean(identity && consentGranted && telemetryEnabled);
  const playerName = identity?.display_name && identity.display_name !== '玩家' ? identity.display_name : '你';
  const totalGames = profile.combinedSummary.totalGames;
  const completedGames = profile.combinedSummary.completedGames;
  const abandonedGames = profile.combinedSummary.abandonedGames;

  return (
    <div className="modal-backdrop absolute inset-0 z-50 flex items-center justify-center bg-black/50 px-3 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cultivation-profile-title"
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-[28px] border border-[#DAC9A8] bg-[#F6EDDC] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#E6D7B8] bg-[#FCF6EA] px-4 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-wide text-wood-dark">修行之路</p>
            <h2 id="cultivation-profile-title" className="mt-0.5 font-serif text-xl font-bold text-ink">
              {playerName}的成长
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-light">每一局都是下一次更从容的落子。</p>
          </div>
          <button
            onClick={close}
            className="shrink-0 rounded-full border border-wood-light bg-white px-3 py-1.5 text-sm font-bold text-ink transition-colors hover:bg-wood-light/30 active:translate-y-px"
          >
            关闭
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <section className="rounded-[24px] bg-ink px-4 py-4 text-parchment shadow-[0_12px_26px_rgba(74,48,33,0.2)]">
            <p className="text-xs text-parchment/75">已走过</p>
            <div className="mt-1 font-serif text-4xl font-black tabular-nums">{totalGames} 局</div>
            {totalGames > 0 ? (
              <p className="mt-2 text-xs leading-relaxed text-parchment/80">
                已完整走完 {completedGames} 局
                {abandonedGames > 0 ? `，另有 ${abandonedGames} 局未走到结算` : ''}。
              </p>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-parchment/80">从第一局开始，慢慢留下属于你的修行轨迹。</p>
            )}
          </section>

          <section className="mt-5">
            <SectionHeading title="这套玩法的成绩" description="只和相同玩法下的自己比较。" />
            <div className="mt-3 rounded-[24px] border border-wood-light bg-white/85 p-3 shadow-sm">
              {currentRuleSummary ? (
                <>
                  <ScoreMetric label="目前最佳修为" value={formatScore(currentRuleSummary.highestScore)} featured />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <ScoreMetric label="平均修为" value={formatScore(currentRuleSummary.averageScore)} />
                    <ScoreMetric label="最低修为" value={formatScore(currentRuleSummary.lowestScore)} />
                  </div>
                  <p className="mt-3 text-center text-[11px] text-ink-light">已完成 {currentRuleSummary.completedGames} 局</p>
                </>
              ) : (
                <div className="rounded-2xl bg-[#FBF8F0] px-4 py-5 text-center">
                  <p className="font-serif text-sm font-bold text-ink">第一局完整结束后，这里会留下你的最好成绩。</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-light">每种玩法会分开计算，成绩只和同一套规则下的自己比较。</p>
                </div>
              )}
            </div>
          </section>

          <section className="mt-5">
            <SectionHeading title="修行印记" description={nextMilestone ? `下一步是「${nextMilestone.title}」。` : '所有印记都已点亮。'} />
            <ul className="mt-3 rounded-[24px] border border-wood-light bg-white/85 px-3 py-1 shadow-sm">
              {profile.milestones.map((milestone) => (
                <MilestoneLine key={milestone.key} milestone={milestone} isNext={nextMilestone?.key === milestone.key} />
              ))}
            </ul>
          </section>

          <section className="mt-5 rounded-[24px] border border-wood-light bg-[#FBF8F0] p-4">
            <SectionHeading
              title="把成长带到其他设备"
              description={
                hasCloudIdentity
                  ? claimableCount > 0
                    ? `这台设备有 ${claimableCount} 局完成记录等待保存到你的账号。`
                    : '这台设备暂时没有等待保存的完成记录。'
                  : '登录并允许云端记录后，已完成的对局可以由你决定是否保存到账号。'
              }
            />
            {cloudError && <p className="mt-3 text-xs text-qi-critical">{cloudError}</p>}
            {hasCloudIdentity && claimableCount > 0 && (
              <button
                onClick={() => void claim()}
                disabled={cloudBusy}
                className="mt-3 w-full rounded-2xl bg-ink px-4 py-3 text-sm font-bold text-parchment transition-colors hover:bg-wood-dark active:translate-y-px disabled:cursor-wait disabled:opacity-60"
              >
                {cloudBusy ? '正在保存…' : `保存这 ${claimableCount} 局成长记录`}
              </button>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-ink-light">进行中的对局始终留在当前设备，不会被带到其他设备。</p>
          </section>
        </div>
      </div>
    </div>
  );
}
