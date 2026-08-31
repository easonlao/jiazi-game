import { useState, useMemo, useEffect } from 'react';
import { CURRENT_RULES_VERSION, getDefaultBalanceProfileForRules, EA_DEFAULT_BALANCE_PROFILE } from '@core/index';
import { useGameStore } from '../store';
import {
  buildCultivationProfileSnapshot,
  type CultivationProfileMilestone,
  type CultivationProfileRecord,
} from '../lib/cultivationProfile';
import { readPendingTerminations } from '../lib/pendingTerminationStorage';

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
      {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-light">{description}</p>}
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

function RecentScoreTrend({ records }: { records: readonly CultivationProfileRecord[] }) {
  const scores = records
    .filter((record) => record.outcome === 'completed' && typeof record.finalScore === 'number')
    .slice(-8)
    .map((record) => ({
      score: record.finalScore as number,
      label: formatDate(record.endedAt ?? record.startedAt),
    }));

  if (scores.length < 2) {
    return (
      <div className="mt-2.5 rounded-[22px] border border-wood-light bg-white/85 px-4 py-4 text-center shadow-sm">
        <p className="font-serif text-sm font-bold text-ink">再完成一局，这里就能看见你的修为走势。</p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-light">曲线只比较当前玩法下最近完成的对局。</p>
      </div>
    );
  }

  const width = 300;
  const height = 126;
  const padding = { top: 18, right: 14, bottom: 26, left: 18 };
  const minScore = Math.min(...scores.map((point) => point.score));
  const maxScore = Math.max(...scores.map((point) => point.score));
  const scoreRange = Math.max(maxScore - minScore, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const points = scores.map((point, index) => {
    const x = padding.left + (plotWidth * index) / (scores.length - 1);
    const y = padding.top + ((maxScore - point.score) / scoreRange) * plotHeight;
    return { ...point, x, y };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `${padding.left},${height - padding.bottom} ${line} ${width - padding.right},${height - padding.bottom}`;

  return (
    <div className="mt-2.5 rounded-[22px] border border-wood-light bg-white/85 p-3.5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] text-ink-light">最近 {scores.length} 局 · 最低 {minScore.toFixed(1)}</p>
        <p className="shrink-0 text-[11px] font-semibold text-wood-dark">最高 {maxScore.toFixed(1)}</p>
      </div>
      <svg
        role="img"
        aria-label={`最近 ${scores.length} 局修为走势，从 ${minScore.toFixed(1)} 到 ${maxScore.toFixed(1)}`}
        viewBox={`0 0 ${width} ${height}`}
        className="mt-2 block h-32 w-full overflow-visible"
      >
        <defs>
          <linearGradient id="cultivation-score-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#B8742C" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#B8742C" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={height - padding.bottom}
          y2={height - padding.bottom}
          stroke="#D9C7A9"
          strokeWidth="1"
        />
        <polyline points={area} fill="url(#cultivation-score-area)" stroke="none" />
        <polyline points={line} fill="none" stroke="#A75C24" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle cx={point.x} cy={point.y} fill="#FCF6EA" r="4.5" stroke="#A75C24" strokeWidth="2.5" />
            {(index === 0 || index === points.length - 1) && (
              <text x={point.x} y={height - 7} fill="#8D745B" fontSize="9" textAnchor={index === 0 ? 'start' : 'end'}>
                {point.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <p className="sr-only">{scores.map((point) => `${point.label} ${point.score.toFixed(1)} 修为`).join('；')}</p>
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
  const localRecords = useGameStore((s) => s.cultivationLedgerRecords);
  const telemetryState = useGameStore((s) => s.telemetryState);
  const turnManager = useGameStore((s) => s.turnManager);
  const grantTelemetryConsent = useGameStore((s) => s.grantTelemetryConsent);
  const declineTelemetryConsent = useGameStore((s) => s.declineTelemetryConsent);
  const provisionPlayer = useGameStore((s) => s.provisionPlayer);
  const recoverPlayer = useGameStore((s) => s.recoverPlayer);
  const updatePlayerDisplayName = useGameStore((s) => s.updatePlayerDisplayName);

  const [nameDraft, setNameDraft] = useState('');
  const [recoverDraft, setRecoverDraft] = useState('');
  const [copied, setCopied] = useState(false);

  // 支持键盘 Esc 键关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, close]);

  const currentRulesVersion = turnManager?.getRulesVersion() ?? CURRENT_RULES_VERSION;
  const currentBalanceProfileId =
    turnManager?.getBalanceProfileId() ??
    telemetryState?.activeCloudSession?.rules_snapshot?.balanceProfileId ??
    telemetryState?.assignedBalanceProfileId ??
    getDefaultBalanceProfileForRules(currentRulesVersion)?.profileId ??
    EA_DEFAULT_BALANCE_PROFILE.profileId;
  const cloudRecords = telemetryState?.cultivationLedger?.records ?? null;
  const cloudError = telemetryState?.cultivationLedgerError ?? null;
  const identity = telemetryState?.identity ?? null;
  const consent = telemetryState?.consent ?? null;
  const recoveryCode = telemetryState?.recovery_code ?? null;
  const telemetryBusy = telemetryState?.busy ?? false;
  const telemetryError = telemetryState?.error ?? null;
  const consentGranted = consent?.granted ?? false;
  const telemetryEnabled = telemetryState?.telemetryEnabled ?? false;
  const hasCloudIdentity = Boolean(identity && consentGranted && telemetryEnabled);

  const profile = useMemo(
    () => buildCultivationProfileSnapshot(
      localRecords,
      cloudRecords,
      currentRulesVersion,
      hasCloudIdentity,
      currentBalanceProfileId,
    ),
    [localRecords, cloudRecords, currentRulesVersion, hasCloudIdentity, currentBalanceProfileId],
  );

  const pendingTerminations = useMemo(() => {
    if (!hasCloudIdentity || typeof window === 'undefined' || !identity?.player_id) return [];
    return readPendingTerminations(localStorage, identity.player_id);
  }, [hasCloudIdentity, identity?.player_id, telemetryState]);
  const pendingCount = pendingTerminations.length;

  if (!open) return null;

  // 当前修为表现：严格按当前平衡档案聚合（绝不退回按规则版本混入其他试验档案分数）
  const currentProfileSummary = profile.combinedSummary.currentProfileSummary ?? null;

  const currentProfileRecentRecords = profile.records.filter((record) => {
    return (record.balanceProfileId ?? `v${record.rulesVersion}_standard`) === currentBalanceProfileId;
  });

  const nextMilestone = profile.milestones.find((milestone) => !milestone.achieved) ?? null;
  const playerName = identity?.display_name && identity.display_name !== '玩家' ? identity.display_name : '你';
  const totalGames = profile.combinedSummary.totalGames;
  const completedGames = profile.combinedSummary.completedGames;
  const abandonedGames = profile.combinedSummary.abandonedGames;

  const handleCopy = async () => {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默忽略
    }
  };

  const handleUpdateName = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    await updatePlayerDisplayName(name);
    setNameDraft('');
  };

  const handleRecover = async () => {
    const code = recoverDraft.trim();
    if (!code) return;
    if (await recoverPlayer(code)) setRecoverDraft('');
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm overflow-hidden"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cultivation-profile-title"
        className="flex max-h-[88vh] sm:max-h-[85vh] w-full max-w-sm sm:max-w-md flex-col overflow-hidden rounded-[24px] sm:rounded-[28px] border border-[#DAC9A8] bg-[#F6EDDC] shadow-2xl my-auto"
      >
        {/* 固定顶栏：确保关闭按钮始终常驻可见 */}
        <header className="shrink-0 sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[#E6D7B8] bg-[#FCF6EA] px-4 py-3.5 sm:py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-bold tracking-wide text-wood-dark">修行之路</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${hasCloudIdentity ? 'bg-qi-full/15 text-qi-full' : 'bg-wood-light/40 text-ink-light'}`}>
                {hasCloudIdentity ? '已立档' : '本机试玩'}
              </span>
            </div>
            <h2 id="cultivation-profile-title" className="mt-0.5 font-serif text-lg sm:text-xl font-bold text-ink truncate">
              {hasCloudIdentity ? `${playerName}的成长` : '本机试玩成长'}
            </h2>
          </div>
          <button
            onClick={close}
            aria-label="关闭"
            className="shrink-0 rounded-full border border-wood-light bg-white px-3.5 py-1.5 text-xs sm:text-sm font-bold font-serif text-ink transition-colors hover:bg-wood-light/30 active:scale-95 shadow-sm cursor-pointer"
          >
            关闭
          </button>
        </header>

        {/* 滚动内容区 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-5 overscroll-contain">
          {/* 修行历程总览 */}
          <section className="rounded-[22px] sm:rounded-[24px] bg-ink px-4 py-4 text-parchment shadow-[0_12px_26px_rgba(74,48,33,0.2)]">
            <div className="flex items-center justify-between">
              <p className="text-xs text-parchment/75">修行历程 · 累计走过</p>
              <span className="text-[10px] text-parchment/60 font-mono">
                {hasCloudIdentity ? '账号档案' : '本机试玩'}
              </span>
            </div>
            <div className="mt-1 font-serif text-3xl sm:text-4xl font-black tabular-nums">{totalGames} 局</div>
            {hasCloudIdentity ? (
              totalGames > 0 ? (
                <div className="mt-2 text-xs leading-relaxed text-parchment/80">
                  <p>
                    已完整走完 {completedGames} 局
                    {abandonedGames > 0 ? `，另有 ${abandonedGames} 局未走到结算` : ''}。
                  </p>
                  {pendingCount > 0 && (
                    <p className="mt-1 text-[11px] text-parchment/60 font-mono">
                      （有 {pendingCount} 局中断待同步，网络就绪后自动确认）
                    </p>
                  )}
                </div>
              ) : (
                <div className="mt-2 text-xs leading-relaxed text-parchment/80">
                  <p>
                    新开对局将自动计入此账号，并在所有设备同步修行轨迹与印记。
                  </p>
                  {pendingCount > 0 && (
                    <p className="mt-1 text-[11px] text-parchment/60 font-mono">
                      （有 {pendingCount} 局中断待同步，网络就绪后自动确认）
                    </p>
                  )}
                </div>
              )
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-parchment/80">
                当前为本机试玩模式。立档后，新对局将自动累计至可跨设备查看的修行记录。
              </p>
            )}
          </section>

          {/* 修行坚持度与心性 */}
          <section>
            <SectionHeading
              title="道心坚持"
              description="专注走完一甲子，反映修行的心性与专注度；暂停与继续中不降低数值。"
            />
            <div className="mt-2.5 rounded-[22px] sm:rounded-[24px] border border-wood-light bg-white/85 p-3.5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] text-ink-light">道心坚持度</div>
                  <div className="mt-1 font-serif text-2xl sm:text-3xl font-black text-ink">
                    {profile.perseverance.evalStatus === 'evaluated'
                      ? `${profile.perseverance.perseveranceRate}%`
                      : '积累样本中'}
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-serif font-bold ${
                  profile.perseverance.evalStatus === 'evaluated'
                    ? 'bg-qi-full/15 text-qi-full'
                    : 'bg-wood-light/40 text-ink-light'
                }`}>
                  {profile.perseverance.ratingLabel}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-[#FBF8F0] px-3 py-2.5">
                  <div className="text-[11px] text-ink-light">当前连续完整</div>
                  <div className="mt-0.5 font-serif text-lg font-bold text-ink">
                    {profile.perseverance.currentStreak} 局
                  </div>
                </div>
                <div className="rounded-2xl bg-[#FBF8F0] px-3 py-2.5">
                  <div className="text-[11px] text-ink-light">历史最高连续</div>
                  <div className="mt-0.5 font-serif text-lg font-bold text-ink">
                    {profile.perseverance.bestStreak} 局
                  </div>
                </div>
              </div>

              <p className="mt-3 text-[11px] leading-relaxed text-ink-light">
                {profile.perseverance.description}
              </p>
            </div>
          </section>

          {/* 当前修为表现 */}
          <section>
            <SectionHeading title="当前修为" description="只和相同玩法下的自己比较，专注当前的修行领悟。" />
            <div className="mt-2.5 rounded-[22px] sm:rounded-[24px] border border-wood-light bg-white/85 p-3.5 shadow-sm">
              {currentProfileSummary && currentProfileSummary.completedGames > 0 ? (
                <>
                  <ScoreMetric label="目前最佳修为" value={formatScore(currentProfileSummary.highestScore)} featured />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <ScoreMetric label="平均修为" value={formatScore(currentProfileSummary.averageScore)} />
                    <ScoreMetric label="最低修为" value={formatScore(currentProfileSummary.lowestScore)} />
                  </div>
                  <p className="mt-3 text-center text-[11px] text-ink-light">
                    当前玩法下已完成 {currentProfileSummary.completedGames} 局
                  </p>
                </>
              ) : (
                <div className="rounded-2xl bg-[#FBF8F0] px-4 py-5 text-center">
                  <p className="font-serif text-sm font-bold text-ink">第一局完整结束后，这里会留下你的最好成绩。</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-light">成绩只和同一玩法下的自己比较。</p>
                </div>
              )}
            </div>
          </section>

          {/* 最近成绩走势 */}
          <section>
            <SectionHeading title="最近修为走势" description="只展示当前玩法下的走势，记录近期的修行状态。" />
            <RecentScoreTrend records={currentProfileRecentRecords} />
          </section>

          {/* 修行印记 */}
          <section>
            <SectionHeading title="修行印记" description={nextMilestone ? `下一步是「${nextMilestone.title}」。` : '所有印记都已点亮。'} />
            <ul className="mt-2.5 rounded-[22px] sm:rounded-[24px] border border-wood-light bg-white/85 px-3 py-1 shadow-sm">
              {profile.milestones.map((milestone) => (
                <MilestoneLine key={milestone.key} milestone={milestone} isNext={nextMilestone?.key === milestone.key} />
              ))}
            </ul>
          </section>

          {/* 身份与云端同步（统一整合） */}
          <section className="rounded-[22px] sm:rounded-[24px] border border-wood-light bg-[#FBF8F0] p-4">
            <SectionHeading
              title="把成长带到其他设备"
              description="管理你的修士称谓与跨设备同步凭据。"
            />

            {!consent ? (
              <div className="mt-3 rounded-2xl bg-white/85 p-3.5 text-xs leading-relaxed text-ink-light border border-wood-light">
                <p className="font-serif font-bold text-ink text-sm">完成立档（开启跨设备记录）</p>
                <p className="mt-1 text-[11px]">立档后，新对局将自动计入账号并累计修行记录与印记，支持跨设备同步与上榜；无需真实姓名与密码。</p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => void grantTelemetryConsent()}
                    disabled={telemetryBusy}
                    className="flex-1 py-2 rounded-xl bg-ink text-parchment text-xs font-bold font-serif hover:bg-wood-dark transition-colors active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    同意并生成玩家 ID
                  </button>
                  <button
                    onClick={declineTelemetryConsent}
                    className="py-2 px-3 rounded-xl border border-wood-light text-ink-light text-xs font-serif hover:bg-wood-light transition-colors cursor-pointer"
                  >
                    保持本机试玩
                  </button>
                </div>
                <div className="mt-2.5 border-t border-wood-light/60 pt-2.5">
                  <p className="mb-1.5 text-[11px]">已有恢复码？输入后找回你的云端身份：</p>
                  <div className="flex gap-1.5">
                    <input
                      value={recoverDraft}
                      onChange={(e) => setRecoverDraft(e.target.value)}
                      placeholder="输入恢复码"
                      className="min-w-0 flex-1 rounded-xl border border-wood-light bg-parchment px-2.5 py-1.5 text-xs text-ink outline-none focus:border-wood-mid"
                    />
                    <button
                      onClick={() => void grantTelemetryConsent(recoverDraft.trim())}
                      disabled={telemetryBusy || !recoverDraft.trim()}
                      className="shrink-0 px-3 py-1.5 rounded-xl bg-wood-mid text-parchment text-xs font-serif font-bold hover:bg-wood-dark transition-colors active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      找回
                    </button>
                  </div>
                </div>
              </div>
            ) : consent.granted === false ? (
              <div className="mt-3 rounded-2xl bg-white/85 p-3.5 text-xs leading-relaxed text-ink-light border border-wood-light flex items-center justify-between gap-2">
                <div>
                  <p className="font-serif font-bold text-ink">当前为本机试玩模式</p>
                  <p className="text-[11px]">对局仅供当前设备体验，不计入跨设备修行记录。</p>
                </div>
                <button
                  onClick={() => void grantTelemetryConsent()}
                  className="shrink-0 px-3 py-1.5 rounded-xl bg-wood-mid text-parchment text-xs font-serif font-bold hover:bg-wood-dark transition-colors active:scale-95 cursor-pointer"
                >
                  立即立档
                </button>
              </div>
            ) : !identity ? (
              <div className="mt-3 rounded-2xl bg-white/85 p-3.5 text-xs leading-relaxed text-ink-light border border-wood-light">
                {telemetryBusy ? <p>正在生成玩家 ID…</p> : <p>已同意记录，但云端身份尚未就绪。</p>}
                {telemetryError && <p className="mt-1 text-qi-critical">{telemetryError}</p>}
                <button
                  onClick={() => void provisionPlayer()}
                  disabled={telemetryBusy}
                  className="mt-2 w-full py-2 rounded-xl border border-wood-mid text-ink text-xs font-bold font-serif hover:bg-wood-light transition-colors active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {telemetryBusy ? '生成中…' : '重试生成玩家 ID'}
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {/* 身份卡片 */}
                <div className="rounded-2xl bg-white/85 p-3.5 shadow-sm border border-wood-light">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-serif text-base font-bold text-ink">{identity.display_name || '未命名修士'}</div>
                      <div className="font-mono text-[11px] tracking-wider text-ink-light">ID {identity.public_code}</div>
                    </div>
                    <span className={`shrink-0 rounded-full border border-wood-light bg-parchment px-2 py-0.5 text-[10px] font-semibold ${identity.leaderboard_eligible ? 'text-qi-full' : 'text-ink-light'}`}>
                      {identity.leaderboard_eligible ? '可进入云端榜' : '匿名模式'}
                    </span>
                  </div>

                  {telemetryError && <p className="mt-1.5 text-xs text-qi-critical">{telemetryError}</p>}

                  <div className="mt-2.5 flex gap-1.5">
                    <input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      placeholder="修改道号（1-12 字）"
                      className="min-w-0 flex-1 rounded-xl border border-wood-light bg-parchment px-2.5 py-1.5 text-xs text-ink outline-none focus:border-wood-mid"
                    />
                    <button
                      onClick={() => void handleUpdateName()}
                      disabled={!nameDraft.trim()}
                      className="shrink-0 px-3 py-1.5 rounded-xl bg-wood-mid text-parchment text-xs font-serif font-bold hover:bg-wood-dark transition-colors active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      保存
                    </button>
                  </div>
                </div>

                {/* 恢复码 */}
                {recoveryCode && (
                  <div className="rounded-2xl border border-gold/50 bg-gold/10 p-3">
                    <p className="font-serif text-xs font-bold text-ink">恢复码（换设备找回凭据，请妥善保存）</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink bg-white/70 px-2 py-1 rounded-lg">{recoveryCode}</code>
                      <button
                        onClick={() => void handleCopy()}
                        className="shrink-0 px-3 py-1 rounded-lg border border-wood-mid bg-white text-ink text-xs font-serif font-bold hover:bg-wood-light transition-colors cursor-pointer"
                      >
                        {copied ? '已复制' : '复制'}
                      </button>
                    </div>
                  </div>
                )}

                {/* 跨设备同步状态 */}
                <div className="rounded-2xl bg-white/85 p-3.5 shadow-sm border border-wood-light">
                  <div className="flex items-center justify-between text-xs text-ink mb-1">
                    <span className="font-serif font-bold">云端同步</span>
                    <span className="text-[11px] text-qi-full font-semibold">已连接 · 自动同步</span>
                  </div>
                  <p className="text-[11px] text-ink-light">
                    新对局完成时自动写入你的云端档案，换设备输入恢复码即可完整继承。
                  </p>
                  {cloudError && <p className="mt-1.5 text-xs text-qi-critical">{cloudError}</p>}
                </div>

                {/* 换设备恢复输入 */}
                <div className="rounded-2xl bg-white/85 p-3.5 shadow-sm border border-wood-light">
                  <p className="font-serif text-xs font-bold text-ink mb-0.5">在其他设备已有账号？</p>
                  <p className="text-[11px] text-ink-light mb-2">输入恢复码，在此设备找回你的修士档案：</p>
                  <div className="flex gap-1.5">
                    <input
                      value={recoverDraft}
                      onChange={(e) => setRecoverDraft(e.target.value)}
                      placeholder="输入已有恢复码"
                      className="min-w-0 flex-1 rounded-xl border border-wood-light bg-parchment px-2.5 py-1.5 text-xs text-ink outline-none focus:border-wood-mid"
                    />
                    <button
                      onClick={() => void handleRecover()}
                      disabled={!recoverDraft.trim()}
                      className="shrink-0 px-3 py-1.5 rounded-xl bg-wood-mid text-parchment text-xs font-serif font-bold hover:bg-wood-dark transition-colors active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      恢复
                    </button>
                  </div>
                </div>
              </div>
            )}

            <p className="mt-3 text-[10px] leading-relaxed text-ink-light text-center">
              进行中的对局会自动同步至云端，可在任意设备随时继续修行。
            </p>
          </section>

          {/* 底部便捷关闭按钮 */}
          <div className="pt-1 pb-2">
            <button
              onClick={close}
              className="w-full py-2.5 rounded-xl border border-wood-mid bg-white/90 text-ink text-xs font-serif font-bold hover:bg-wood-light transition-colors active:scale-95 shadow-sm cursor-pointer"
            >
              返回开始页
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
