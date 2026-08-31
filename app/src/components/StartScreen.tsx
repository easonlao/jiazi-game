import { useState } from 'react';
import { useGameStore } from '../store';
import type { CultivationLedgerSummary } from '../lib/cultivationLedger';
import { CURRENT_RULES_VERSION, getDefaultBalanceProfileForRules, EA_DEFAULT_BALANCE_PROFILE } from '@core/index';

interface StartScreenProps {
  turnManager: ReturnType<typeof useGameStore.getState>['turnManager'];
  hasSave: boolean;
  startingGame: boolean;
  startGameError: string | null;
  cultivationLedgerSummary: CultivationLedgerSummary;
  onStart: () => Promise<void>;
  onStartLocal: () => Promise<void>;
  onContinue: () => void;
  onLeaderboard: () => void;
  onOpenProfile: () => void;
}

/**
 * 启动加载/开始页：
 * - 简洁优雅的标题与玩法导引；
 * - 统一的修行档案卡片（点击打开完整的修行与身份档案）；
 * - 开始游戏 / 继续游戏 / 排行榜操作；
 * - 已有继续中对局时，开启新局必须先让玩家确认，防止误触静默覆盖。
 */
export function StartScreen({
  turnManager,
  hasSave,
  startingGame,
  startGameError,
  cultivationLedgerSummary,
  onStart,
  onStartLocal,
  onContinue,
  onLeaderboard,
  onOpenProfile,
}: StartScreenProps) {
  const rulesVersion = turnManager?.getRulesVersion() ?? CURRENT_RULES_VERSION;
  const telemetryState = useGameStore((s) => s.telemetryState);
  const terminateGame = useGameStore((s) => s.terminateGame);
  const recoveringCorruptedGame = useGameStore((s) => s.recoveringCorruptedGame);
  const corruptedRecoveryError = useGameStore((s) => s.corruptedRecoveryError);
  const retryCorruptedRecovery = useGameStore((s) => s.retryCorruptedRecovery);
  const identity = telemetryState?.identity ?? null;
  const consent = telemetryState?.consent ?? null;
  const consentGranted = consent?.granted ?? false;
  const telemetryEnabled = telemetryState?.telemetryEnabled ?? false;
  const hasCloudIdentity = Boolean(identity && consentGranted && telemetryEnabled);
  const playerName = identity?.display_name && identity.display_name !== '玩家' ? identity.display_name : '你';
  const totalGames = cultivationLedgerSummary.totalGames;
  const currentBalanceProfileId =
    turnManager?.getBalanceProfileId() ??
    telemetryState?.activeCloudSession?.rules_snapshot?.balanceProfileId ??
    telemetryState?.assignedBalanceProfileId ??
    getDefaultBalanceProfileForRules(rulesVersion)?.profileId ??
    EA_DEFAULT_BALANCE_PROFILE.profileId;
  const currentProfileSummary =
    cultivationLedgerSummary.byBalanceProfile?.find((p) => p.profileId === currentBalanceProfileId) ?? null;
  const activeCloudSession = telemetryState?.activeCloudSession ?? null;
  const hasActiveCloudGame = Boolean(hasCloudIdentity && activeCloudSession && activeCloudSession.rounds_completed < 60);
  const hasContinuableGame = hasSave || hasActiveCloudGame;

  const [confirmOverrideOpen, setConfirmOverrideOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'cloud' | 'local'>('cloud');

  const handleStartClick = (action: 'cloud' | 'local') => {
    if (recoveringCorruptedGame || corruptedRecoveryError) return;
    if (hasContinuableGame) {
      setPendingAction(action);
      setConfirmOverrideOpen(true);
    } else {
      if (action === 'local') {
        void onStartLocal();
      } else {
        void onStart();
      }
    }
  };

  const handleConfirmOverride = async () => {
    setConfirmOverrideOpen(false);
    terminateGame('new_game_override');
    if (pendingAction === 'local') {
      await onStartLocal();
    } else {
      await onStart();
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
      {/* 标题 */}
      <div className="text-center shrink-0">
        <h1 className="text-3xl font-bold font-serif text-ink mb-1">甲子纪</h1>
        <p className="text-xs text-ink-light">Jiazi Chronicle · 六十甲子策略卡牌</p>
      </div>

      {/* 玩法简介 */}
      <div className="w-full max-w-xs rounded-xl border border-wood-light bg-[#faf6ee] px-3.5 py-3 text-xs leading-relaxed text-ink-light">
        <h3 className="mb-1 font-serif text-sm font-bold text-ink">玩法</h3>
        <p>一甲子（60 回合），春夏秋冬天时流转；每回合可纳灵、释灵或调息。</p>
        <p className="mt-1">丹田中的灵气每回合结算炼化修为与耗神，燃灵会放大炼化与耗神，换季重置。</p>
      </div>

      {/* 统一的修行档案入口卡片 */}
      <button
        onClick={onOpenProfile}
        aria-label="查看修行档案"
        className="w-full max-w-xs rounded-2xl border border-wood-light bg-[#f7efdf] p-3 text-left transition-all hover:bg-[#f3e8d2] active:scale-[0.99] shadow-sm flex items-center justify-between gap-3 group cursor-pointer"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-serif text-sm font-bold text-ink truncate">
              {hasCloudIdentity ? `${playerName}的修行档案` : '本机试玩（未立档）'}
            </span>
            <span className={`shrink-0 rounded-full border border-wood-light bg-parchment px-2 py-0.5 text-[10px] font-mono ${hasCloudIdentity ? 'text-qi-full font-semibold' : 'text-ink-light'}`}>
              {hasCloudIdentity ? (totalGames > 0 ? `${totalGames} 局` : '已立档') : '未立档'}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-ink-light truncate">
            {hasCloudIdentity
              ? totalGames > 0
                ? currentProfileSummary?.highestScore
                  ? `最好 ${currentProfileSummary.highestScore.toFixed(1)} 修为 · 自动同步`
                  : `已走过 ${totalGames} 局 · 自动同步`
                : '已立档 · 自动累计跨设备修行档案 →'
              : '未立档，对局仅供本机试玩；立档后可累计跨设备修行档案 →'}
          </p>
        </div>
        <span className="text-wood-mid font-bold text-lg group-hover:translate-x-0.5 transition-transform shrink-0 px-1">
          ›
        </span>
      </button>

      {/* 操作按钮区 */}
      {turnManager ? (
        <div className="flex flex-col gap-2.5 w-full max-w-xs mt-1">
          {/* 异常恢复告警：常驻 role="alert" 与 aria-live 区域，确保动态错误与重试入口被屏幕阅读器播报 */}
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className={corruptedRecoveryError ? 'w-full rounded-xl border border-qi-critical/30 bg-[#fbf0ee] p-3 text-center mb-1' : 'hidden'}
          >
            {corruptedRecoveryError && (
              <>
                <p className="text-xs text-qi-critical mb-2 leading-relaxed">{corruptedRecoveryError}</p>
                <button
                  onClick={() => void retryCorruptedRecovery()}
                  disabled={recoveringCorruptedGame}
                  className="py-1.5 px-4 rounded-lg bg-qi-critical text-parchment text-xs font-bold font-serif hover:opacity-90 active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {recoveringCorruptedGame ? '正在重试…' : '重试同步'}
                </button>
              </>
            )}
          </div>

          {hasContinuableGame ? (
            <>
              <button
                onClick={onContinue}
                disabled={startingGame || recoveringCorruptedGame || Boolean(corruptedRecoveryError)}
                className="w-full py-3.5 rounded-xl bg-ink text-parchment text-lg font-bold font-serif hover:bg-wood-dark transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-50 shadow-md cursor-pointer"
              >
                {recoveringCorruptedGame ? '正在安全恢复对局…' : '继续修行'}
              </button>
              <button
                onClick={() => handleStartClick('cloud')}
                disabled={startingGame || recoveringCorruptedGame || Boolean(corruptedRecoveryError)}
                className="w-full py-3 rounded-xl border-2 border-wood-mid text-ink text-base font-bold font-serif hover:bg-wood-light transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-50 cursor-pointer"
              >
                {recoveringCorruptedGame ? '正在安全恢复对局…' : startingGame ? '正在连接云端…' : '新游戏'}
              </button>
            </>
          ) : (
            <button
              onClick={() => handleStartClick('cloud')}
              disabled={startingGame || recoveringCorruptedGame || Boolean(corruptedRecoveryError)}
              className="w-full py-3.5 rounded-xl bg-ink text-parchment text-lg font-bold font-serif hover:bg-wood-dark transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-50 shadow-md cursor-pointer"
            >
              {recoveringCorruptedGame ? '正在安全恢复对局…' : startingGame ? '正在连接云端…' : '开始游戏'}
            </button>
          )}

          {startGameError && (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-center text-xs text-qi-critical">
                {startGameError}
              </p>
              <button
                onClick={() => handleStartClick('local')}
                disabled={startingGame || recoveringCorruptedGame || Boolean(corruptedRecoveryError)}
                className="w-full py-2.5 rounded-xl border border-wood-mid text-ink-light text-sm font-serif hover:bg-wood-light transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-50 cursor-pointer"
              >
                本地开局（不上云端榜）
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onLeaderboard}
              className="py-2.5 rounded-xl border border-wood-light bg-[#faf6ee] text-ink text-xs font-serif font-bold hover:bg-wood-light transition-colors active:scale-95 cursor-pointer"
            >
              🏆 排行榜
            </button>
            <button
              onClick={onOpenProfile}
              className="py-2.5 rounded-xl border border-wood-light bg-[#faf6ee] text-ink text-xs font-serif font-bold hover:bg-wood-light transition-colors active:scale-95 cursor-pointer"
            >
              📜 修行档案
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-wood-mid border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-ink-light">加载牌库中...</p>
        </div>
      )}

      {/* 已有进行中对局时的开新局确认弹窗 */}
      {confirmOverrideOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmOverrideOpen(false);
          }}
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-hidden"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="override-modal-title"
            className="flex w-full max-w-sm flex-col overflow-hidden rounded-[24px] border border-[#DAC9A8] bg-[#F6EDDC] p-5 shadow-2xl animate-fade-in my-auto"
          >
            <h3 id="override-modal-title" className="font-serif text-lg font-bold text-ink">
              发现进行中的修行
            </h3>
            <div className="mt-3 rounded-2xl border border-wood-light bg-white/80 p-3 text-xs leading-relaxed text-ink">
              <p>当前已有进行中的对局。若开始新修行，当前对局将被主动终止且无法继续。</p>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => {
                  setConfirmOverrideOpen(false);
                  onContinue();
                }}
                className="w-full py-3 rounded-xl bg-ink text-parchment text-sm font-serif font-bold hover:bg-wood-dark transition-colors active:scale-95 cursor-pointer shadow-sm"
              >
                继续当前修行
              </button>
              <button
                onClick={handleConfirmOverride}
                className="w-full py-2.5 rounded-xl border border-qi-critical/40 bg-qi-critical/10 text-qi-critical text-xs font-serif font-bold hover:bg-qi-critical hover:text-white transition-colors active:scale-95 cursor-pointer"
              >
                放弃当前局并开启新修行
              </button>
              <button
                onClick={() => setConfirmOverrideOpen(false)}
                className="w-full py-2 rounded-xl border border-wood-light bg-white text-ink text-xs font-serif hover:bg-wood-light/30 transition-colors active:scale-95 cursor-pointer"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
