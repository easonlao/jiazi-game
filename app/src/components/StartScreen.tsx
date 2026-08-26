import { useGameStore } from '../store';
import type { CultivationLedgerSummary } from '../lib/cultivationLedger';
import { PlayerIdentityPanel } from './PlayerIdentityPanel';

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
 * 启动加载/开始页：标题、玩法简介、开始按钮或加载中状态。
 * 检测到存档时显示"继续游戏"，否则显示"开始游戏"。
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
  const rulesVersion = turnManager?.getRulesVersion() ?? 0;
  const currentRuleSummary = cultivationLedgerSummary.byRulesVersion.find((group) => group.rulesVersion === rulesVersion) ?? null;
  const otherRuleSummaries = cultivationLedgerSummary.byRulesVersion.filter((group) => group.rulesVersion !== rulesVersion);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
      <div className="text-center shrink-0">
        <h1 className="text-3xl font-bold font-serif text-ink mb-1">甲子纪</h1>
        <p className="text-xs text-ink-light">Jiazi Chronicle · 六十甲子策略卡牌</p>
      </div>

      <div className="w-full max-w-xs rounded-lg border border-wood-light bg-[#faf6ee] px-3 py-2.5 text-xs leading-relaxed text-ink-light">
        <h3 className="mb-1 font-serif text-sm font-bold text-ink">玩法</h3>
        <p>一甲子（60 回合），春夏秋冬天时流转；每回合可纳灵、释灵或调息。</p>
        <p>丹田中的灵气每回合结算炼化修为与耗神，评分越高炼化越多，耗神也越多。</p>
        <p>燃灵会放大炼化与耗神，换季重置；神识不足时可能反噬。</p>
      </div>

      <div className="w-full max-w-xs rounded-2xl border border-wood-light bg-[#f7efdf] px-3 py-3 text-xs leading-relaxed text-ink-light shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-sm font-bold text-ink">本机修行账本</h3>
            <p className="mt-0.5 text-[11px] text-ink-light">仅保存在这台设备；从启用后开始统计，不回填旧局。</p>
          </div>
          <span className="shrink-0 rounded-full border border-wood-light bg-parchment px-2 py-0.5 text-[10px] text-ink-light">
            {`V${rulesVersion || '?'}`}
          </span>
        </div>

        {cultivationLedgerSummary.totalGames > 0 ? (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/80 px-2 py-2">
                <div className="text-[10px] text-ink-light">累计局数</div>
                <div className="mt-0.5 font-serif text-lg font-bold text-ink tabular-nums">{cultivationLedgerSummary.totalGames}</div>
              </div>
              <div className="rounded-xl bg-white/80 px-2 py-2">
                <div className="text-[10px] text-ink-light">完成</div>
                <div className="mt-0.5 font-serif text-lg font-bold text-qi-full tabular-nums">{cultivationLedgerSummary.completedGames}</div>
              </div>
              <div className="rounded-xl bg-white/80 px-2 py-2">
                <div className="text-[10px] text-ink-light">中断</div>
                <div className="mt-0.5 font-serif text-lg font-bold text-qi-critical tabular-nums">{cultivationLedgerSummary.abandonedGames}</div>
              </div>
            </div>

            <div className="mt-3 rounded-xl bg-white/75 px-2.5 py-2.5">
              <div className="flex items-center justify-between gap-2 text-[11px] text-ink-light">
                <span>当前规则完成局</span>
                <span className="rounded-full bg-wood-light/60 px-1.5 py-0.5 text-[10px] text-ink">{`V${rulesVersion || '?'}`}</span>
              </div>
              {currentRuleSummary ? (
                <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[11px] tabular-nums">
                  <div className="rounded-lg bg-parchment px-2 py-2">
                    <div className="text-ink-light">均值</div>
                    <div className="mt-0.5 font-semibold text-ink">{currentRuleSummary.averageScore?.toFixed(1)}</div>
                  </div>
                  <div className="rounded-lg bg-parchment px-2 py-2">
                    <div className="text-ink-light">最高</div>
                    <div className="mt-0.5 font-semibold text-ink">{currentRuleSummary.highestScore?.toFixed(1)}</div>
                  </div>
                  <div className="rounded-lg bg-parchment px-2 py-2">
                    <div className="text-ink-light">最低</div>
                    <div className="mt-0.5 font-semibold text-ink">{currentRuleSummary.lowestScore?.toFixed(1)}</div>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-ink-light">当前规则暂无完成局，第一局结束后会自动汇总。</p>
              )}
            </div>

            {otherRuleSummaries.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-ink-light">
                {otherRuleSummaries.map((group) => (
                  <span key={group.rulesVersion} className="rounded-full border border-wood-light bg-parchment px-2 py-1 tabular-nums">
                    {`V${group.rulesVersion} ${group.completedGames} 完成 · 均 ${group.averageScore?.toFixed(1) ?? '—'}`}
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={onOpenProfile}
              className="mt-3 w-full rounded-xl border border-wood-mid bg-white/80 px-3 py-2 text-sm font-bold font-serif text-ink transition-colors hover:bg-wood-light/30"
            >
              查看修行档案
            </button>
          </>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-wood-light bg-white/60 px-3 py-3 text-center text-xs text-ink-light">
            <p>账本已准备好，开始新局后会记录累计、完成与中断。</p>
            <button
              onClick={onOpenProfile}
              className="mt-2 w-full rounded-xl border border-wood-mid bg-white/80 px-3 py-2 text-sm font-bold font-serif text-ink transition-colors hover:bg-wood-light/30"
            >
              先看修行档案
            </button>
          </div>
        )}
      </div>

      <PlayerIdentityPanel />

      {turnManager ? (
        <div className="flex flex-col gap-2 w-full max-w-xs">
          {hasSave ? (
            <>
              <button
                onClick={onContinue}
                disabled={startingGame}
                className="w-full py-3 rounded-xl bg-ink text-parchment text-lg font-bold font-serif hover:bg-wood-dark transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-50"
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
              className="w-full py-3 rounded-xl bg-ink text-parchment text-lg font-bold font-serif hover:bg-wood-dark transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-50"
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
          <button
            onClick={onLeaderboard}
            className="w-full py-2.5 rounded-xl border border-wood-light text-ink-light text-sm font-serif hover:bg-wood-light transition-colors active:scale-95"
          >
            排行榜
          </button>
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
