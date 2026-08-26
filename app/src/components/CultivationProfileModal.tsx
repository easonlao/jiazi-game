import { useState, useMemo } from 'react';
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
  const grantTelemetryConsent = useGameStore((s) => s.grantTelemetryConsent);
  const declineTelemetryConsent = useGameStore((s) => s.declineTelemetryConsent);
  const provisionPlayer = useGameStore((s) => s.provisionPlayer);
  const recoverPlayer = useGameStore((s) => s.recoverPlayer);
  const updatePlayerDisplayName = useGameStore((s) => s.updatePlayerDisplayName);

  const [nameDraft, setNameDraft] = useState('');
  const [recoverDraft, setRecoverDraft] = useState('');
  const [copied, setCopied] = useState(false);

  const currentRulesVersion = turnManager?.getRulesVersion() ?? CURRENT_RULES_VERSION;
  const cloudRecords = telemetryState?.cultivationLedger?.records ?? null;
  const cloudBusy = telemetryState?.cultivationLedgerBusy ?? false;
  const cloudError = telemetryState?.cultivationLedgerError ?? null;
  const identity = telemetryState?.identity ?? null;
  const consent = telemetryState?.consent ?? null;
  const recoveryCode = telemetryState?.recovery_code ?? null;
  const telemetryBusy = telemetryState?.busy ?? false;
  const telemetryError = telemetryState?.error ?? null;
  const consentGranted = consent?.granted ?? false;
  const telemetryEnabled = telemetryState?.telemetryEnabled ?? false;

  const profile = useMemo(
    () => buildCultivationProfileSnapshot(localRecords, cloudRecords, currentRulesVersion),
    [localRecords, cloudRecords, currentRulesVersion],
  );

  if (!open) return null;

  const currentRuleSummary = profile.combinedSummary.byRulesVersion.find(
    (group) => group.rulesVersion === currentRulesVersion,
  ) ?? null;
  const otherRuleSummaries = profile.combinedSummary.byRulesVersion.filter(
    (group) => group.rulesVersion !== currentRulesVersion,
  );
  const nextMilestone = profile.milestones.find((milestone) => !milestone.achieved) ?? null;
  const hasCloudIdentity = Boolean(identity && consentGranted && telemetryEnabled);
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* 成长总览 */}
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

          {/* 这套玩法的成绩 */}
          <section>
            <SectionHeading title="这套玩法的成绩" description="只和相同玩法下的自己比较。" />
            <div className="mt-3 rounded-[24px] border border-wood-light bg-white/85 p-3.5 shadow-sm">
              {currentRuleSummary ? (
                <>
                  <ScoreMetric label="目前最佳修为" value={formatScore(currentRuleSummary.highestScore)} featured />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <ScoreMetric label="平均修为" value={formatScore(currentRuleSummary.averageScore)} />
                    <ScoreMetric label="最低修为" value={formatScore(currentRuleSummary.lowestScore)} />
                  </div>
                  <p className="mt-3 text-center text-[11px] text-ink-light">已完成 {currentRuleSummary.completedGames} 局（当前规则 V{currentRulesVersion}）</p>
                </>
              ) : (
                <div className="rounded-2xl bg-[#FBF8F0] px-4 py-5 text-center">
                  <p className="font-serif text-sm font-bold text-ink">第一局完整结束后，这里会留下你的最好成绩。</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-light">每种玩法会分开计算，成绩只和同一套规则下的自己比较。</p>
                </div>
              )}

              {/* 历史其他规则集标签 */}
              {otherRuleSummaries.length > 0 && (
                <div className="mt-3 border-t border-wood-light/50 pt-2.5">
                  <p className="text-[11px] text-ink-light mb-1.5">历史规则成绩：</p>
                  <div className="flex flex-wrap gap-1.5 text-[10px] text-ink-light">
                    {otherRuleSummaries.map((group) => (
                      <span key={group.rulesVersion} className="rounded-full border border-wood-light bg-parchment px-2.5 py-1 tabular-nums">
                        {`V${group.rulesVersion} ${group.completedGames} 完成 · 均 ${group.averageScore?.toFixed(1) ?? '—'} · 最优 ${group.highestScore?.toFixed(1) ?? '—'}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 修行印记 */}
          <section>
            <SectionHeading title="修行印记" description={nextMilestone ? `下一步是「${nextMilestone.title}」。` : '所有印记都已点亮。'} />
            <ul className="mt-3 rounded-[24px] border border-wood-light bg-white/85 px-3 py-1 shadow-sm">
              {profile.milestones.map((milestone) => (
                <MilestoneLine key={milestone.key} milestone={milestone} isNext={nextMilestone?.key === milestone.key} />
              ))}
            </ul>
          </section>

          {/* 身份与云端同步（统一整合） */}
          <section className="rounded-[24px] border border-wood-light bg-[#FBF8F0] p-4">
            <SectionHeading
              title="把成长带到其他设备"
              description="管理你的修士称谓与跨设备同步凭据。"
            />

            {!consent ? (
              <div className="mt-3 rounded-2xl bg-white/85 p-3.5 text-xs leading-relaxed text-ink-light border border-wood-light">
                <p className="font-serif font-bold text-ink text-sm">开启云端同步（可选）</p>
                <p className="mt-1 text-[11px]">记录对局与修为，支持跨设备同步与上榜；无需真实姓名与密码。</p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => void grantTelemetryConsent()}
                    disabled={telemetryBusy}
                    className="flex-1 py-2 rounded-xl bg-ink text-parchment text-xs font-bold font-serif hover:bg-wood-dark transition-colors active:scale-95 disabled:opacity-50"
                  >
                    同意并生成玩家 ID
                  </button>
                  <button
                    onClick={declineTelemetryConsent}
                    className="py-2 px-3 rounded-xl border border-wood-light text-ink-light text-xs font-serif hover:bg-wood-light transition-colors"
                  >
                    暂不开启
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
                      className="shrink-0 px-3 py-1.5 rounded-xl bg-wood-mid text-parchment text-xs font-serif font-bold hover:bg-wood-dark transition-colors active:scale-95 disabled:opacity-50"
                    >
                      找回
                    </button>
                  </div>
                </div>
              </div>
            ) : consent.granted === false ? (
              <div className="mt-3 rounded-2xl bg-white/85 p-3.5 text-xs leading-relaxed text-ink-light border border-wood-light flex items-center justify-between gap-2">
                <div>
                  <p className="font-serif font-bold text-ink">当前为纯本地模式</p>
                  <p className="text-[11px]">对局与成长仅保存在这台设备。</p>
                </div>
                <button
                  onClick={() => void grantTelemetryConsent()}
                  className="shrink-0 px-3 py-1.5 rounded-xl bg-wood-mid text-parchment text-xs font-serif font-bold hover:bg-wood-dark transition-colors active:scale-95"
                >
                  开启云端同步
                </button>
              </div>
            ) : !identity ? (
              <div className="mt-3 rounded-2xl bg-white/85 p-3.5 text-xs leading-relaxed text-ink-light border border-wood-light">
                {telemetryBusy ? <p>正在生成玩家 ID…</p> : <p>已同意记录，但云端身份尚未就绪。</p>}
                {telemetryError && <p className="mt-1 text-qi-critical">{telemetryError}</p>}
                <button
                  onClick={() => void provisionPlayer()}
                  disabled={telemetryBusy}
                  className="mt-2 w-full py-2 rounded-xl border border-wood-mid text-ink text-xs font-bold font-serif hover:bg-wood-light transition-colors active:scale-95 disabled:opacity-50"
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
                      className="shrink-0 px-3 py-1.5 rounded-xl bg-wood-mid text-parchment text-xs font-serif font-bold hover:bg-wood-dark transition-colors active:scale-95 disabled:opacity-50"
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
                        className="shrink-0 px-3 py-1 rounded-lg border border-wood-mid bg-white text-ink text-xs font-serif font-bold hover:bg-wood-light transition-colors"
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
                    <span className="text-[11px] text-qi-full font-semibold">已连接</span>
                  </div>
                  <p className="text-[11px] text-ink-light">
                    {hasCloudIdentity
                      ? claimableCount > 0
                        ? `这台设备有 ${claimableCount} 局完成记录等待保存到你的账号。`
                        : '这台设备暂时没有等待保存的完成记录。'
                      : '登录并允许云端记录后，已完成的对局可以由你决定是否保存到账号。'}
                  </p>
                  {cloudError && <p className="mt-1.5 text-xs text-qi-critical">{cloudError}</p>}
                  {hasCloudIdentity && claimableCount > 0 && (
                    <button
                      onClick={() => void claim()}
                      disabled={cloudBusy}
                      className="mt-2.5 w-full rounded-xl bg-ink px-4 py-2.5 text-xs font-bold font-serif text-parchment transition-colors hover:bg-wood-dark active:translate-y-px disabled:cursor-wait disabled:opacity-60"
                    >
                      {cloudBusy ? '正在保存…' : `保存这 ${claimableCount} 局成长记录`}
                    </button>
                  )}
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
                      className="shrink-0 px-3 py-1.5 rounded-xl bg-wood-mid text-parchment text-xs font-serif font-bold hover:bg-wood-dark transition-colors active:scale-95 disabled:opacity-50"
                    >
                      恢复
                    </button>
                  </div>
                </div>
              </div>
            )}

            <p className="mt-3 text-[10px] leading-relaxed text-ink-light text-center">
              进行中的对局始终留在当前设备，不会被带到其他设备。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
