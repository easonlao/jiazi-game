import { useGameStore } from '../store';
import type { CultivationLedgerSummary } from '../lib/cultivationLedger';

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
 * - 开始游戏 / 继续游戏 / 排行榜操作。
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
  const rulesVersion = turnManager?.getRulesVersion() ?? 7;
  const telemetryState = useGameStore((s) => s.telemetryState);
  const identity = telemetryState?.identity ?? null;
  const playerName = identity?.display_name && identity.display_name !== '玩家' ? identity.display_name : '你';
  const totalGames = cultivationLedgerSummary.totalGames;
  const currentRuleSummary = cultivationLedgerSummary.byRulesVersion.find((g) => g.rulesVersion === rulesVersion) ?? null;

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
        className="w-full max-w-xs rounded-2xl border border-wood-light bg-[#f7efdf] p-3 text-left transition-all hover:bg-[#f3e8d2] active:scale-[0.99] shadow-sm flex items-center justify-between gap-3 group"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-serif text-sm font-bold text-ink truncate">
              {playerName}的修行档案
            </span>
            <span className="shrink-0 rounded-full border border-wood-light bg-parchment px-2 py-0.5 text-[10px] text-ink-light font-mono">
              {totalGames > 0 ? `${totalGames} 局` : `V${rulesVersion}`}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-ink-light truncate">
            {totalGames > 0
              ? currentRuleSummary?.highestScore
                ? `最好 ${currentRuleSummary.highestScore.toFixed(1)} 修为 · 查看详情与印记`
                : `已走过 ${totalGames} 局 · 查看详情与印记`
              : '记录对局累计、最好成绩与修行印记 →'}
          </p>
        </div>
        <span className="text-wood-mid font-bold text-lg group-hover:translate-x-0.5 transition-transform shrink-0 px-1">
          ›
        </span>
      </button>

      {/* 操作按钮区 */}
      {turnManager ? (
        <div className="flex flex-col gap-2.5 w-full max-w-xs mt-1">
          {hasSave ? (
            <>
              <button
                onClick={onContinue}
                disabled={startingGame}
                className="w-full py-3.5 rounded-xl bg-ink text-parchment text-lg font-bold font-serif hover:bg-wood-dark transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-50 shadow-md"
              >
                继续本地游戏
              </button>
              <button
                onClick={onStart}
                disabled={startingGame}
                className="w-full py-3 rounded-xl border-2 border-wood-mid text-ink text-base font-bold font-serif hover:bg-wood-light transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-50"
              >
                {startingGame ? '正在连接云端…' : '新游戏'}
              </button>
            </>
          ) : (
            <button
              onClick={onStart}
              disabled={startingGame}
              className="w-full py-3.5 rounded-xl bg-ink text-parchment text-lg font-bold font-serif hover:bg-wood-dark transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-50 shadow-md"
            >
              {startingGame ? '正在连接云端…' : '开始游戏'}
            </button>
          )}

          {startGameError && (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-center text-xs text-qi-critical">
                {startGameError}
              </p>
              <button
                onClick={onStartLocal}
                disabled={startingGame}
                className="w-full py-2.5 rounded-xl border border-wood-mid text-ink-light text-sm font-serif hover:bg-wood-light transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-50"
              >
                本地开局（不上云端榜）
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onLeaderboard}
              className="py-2.5 rounded-xl border border-wood-light bg-[#faf6ee] text-ink text-xs font-serif font-bold hover:bg-wood-light transition-colors active:scale-95"
            >
              🏆 排行榜
            </button>
            <button
              onClick={onOpenProfile}
              className="py-2.5 rounded-xl border border-wood-light bg-[#faf6ee] text-ink text-xs font-serif font-bold hover:bg-wood-light transition-colors active:scale-95"
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
    </div>
  );
}
