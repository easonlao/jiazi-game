import { useEffect, useRef, useState } from 'react';
import { useGameStore, seasonDisplay } from '../store';
import { BRANCH_ROLL_DI_ZHI, ALL_SECTS, SEASON_ACTIVE_SECTS, SINGLE_YEAR_BOONS, Element } from '@core/index';

const TRIAD_COLUMNS = [
  { element: Element.WATER, label: '申子辰 · 水局', color: 'text-sky-800', activeBg: 'bg-sky-100 border-sky-500 text-sky-900' },
  { element: Element.WOOD, label: '亥卯未 · 木局', color: 'text-emerald-800', activeBg: 'bg-emerald-100 border-emerald-500 text-emerald-900' },
  { element: Element.FIRE, label: '寅午戌 · 火局', color: 'text-red-800', activeBg: 'bg-red-100 border-red-500 text-red-900' },
  { element: Element.METAL, label: '巳酉丑 · 金局', color: 'text-amber-800', activeBg: 'bg-amber-100 border-amber-500 text-amber-900' },
] as const;

const roundAnimStyle = {
  animation: 'roundPop 0.4s ease-out',
} as const;

interface Floater {
  id: number;
  delta: number;
}

const SEASON_THEME: Record<string, { text: string; bar: string }> = {
  spring: { text: 'text-emerald-700', bar: 'bg-emerald-500/80' },
  summer: { text: 'text-red-700', bar: 'bg-red-500/80' },
  autumn: { text: 'text-amber-700', bar: 'bg-amber-500/80' },
  winter: { text: 'text-sky-700', bar: 'bg-sky-500/80' },
};

interface TriadBranchItem {
  dz: string;
  triadName: string;
  triadElem: string;
  isGroupEnd: boolean;
}

/**
 * 四大正统地支三合局顺序与组合：
 * 申子辰水局、亥卯未木局、寅午戌火局、巳酉丑金局
 */
const TRIAD_BRANCH_ITEMS: readonly TriadBranchItem[] = [
  // 水局：申子辰
  { dz: '申', triadName: '水局', triadElem: '水', isGroupEnd: false },
  { dz: '子', triadName: '水局', triadElem: '水', isGroupEnd: false },
  { dz: '辰', triadName: '水局', triadElem: '水', isGroupEnd: true },
  // 木局：亥卯未
  { dz: '亥', triadName: '木局', triadElem: '木', isGroupEnd: false },
  { dz: '卯', triadName: '木局', triadElem: '木', isGroupEnd: false },
  { dz: '未', triadName: '木局', triadElem: '木', isGroupEnd: true },
  // 火局：寅午戌
  { dz: '寅', triadName: '火局', triadElem: '火', isGroupEnd: false },
  { dz: '午', triadName: '火局', triadElem: '火', isGroupEnd: false },
  { dz: '戌', triadName: '火局', triadElem: '火', isGroupEnd: true },
  // 金局：巳酉丑
  { dz: '巳', triadName: '金局', triadElem: '金', isGroupEnd: false },
  { dz: '酉', triadName: '金局', triadElem: '金', isGroupEnd: false },
  { dz: '丑', triadName: '金局', triadElem: '金', isGroupEnd: false },
] as const;

/** 分数变化飘字：金色 +X.X / 红色 -X.X */
export function TopPanel() {
  const season = useGameStore((s) => s.season);
  const currentRound = useGameStore((s) => s.currentRound);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const roundInSeason = useGameStore((s) => s.roundInSeason);
  const year = useGameStore((s) => s.year);
  const turn = useGameStore((s) => s.turn);
  const quota = useGameStore((s) => s.quota);
  const activeBoon = useGameStore((s) => s.activeBoon);
  const score = useGameStore((s) => s.score);
  const scoreDelta = useGameStore((s) => s.scoreDelta);
  // V6 地支偏移条（票 03）：12 地支效果值；非 V6 为 null → 整条不渲染（V5 零回归）
  const branchRollDeltas = useGameStore((s) => s.branchRollDeltas);
  const sectCountdowns = useGameStore((s) => s.sectCountdowns);
  const activeSectIds = (SEASON_ACTIVE_SECTS as Record<string, readonly string[]>)[season] ?? [];
  const seasonTheme = SEASON_THEME[season] ?? SEASON_THEME.spring;
  const openDashboard = useGameStore((s) => s.openDashboard);
  const openCultivationProfile = useGameStore((s) => s.openCultivationProfile);
  const openPauseModal = useGameStore((s) => s.openPauseModal);
  const gameState = useGameStore((s) => s.gameState);
  const hand = useGameStore((s) => s.hand);
  const leyline = useGameStore((s) => s.leyline);
  const availableTriads = useGameStore((s) => s.availableTriads);
  const claimTriad = useGameStore((s) => s.claimTriad);

  const turnManager = useGameStore((s) => s.turnManager);
  const isV11 = (turnManager?.getRulesVersion() ?? 11) >= 11;

  // 丹田与地脉持有的地支集合（用于触发点亮）
  const dantianBranches = new Set(
    hand.filter((s): s is NonNullable<typeof s> => Boolean(s?.card)).map((s) => s.card.diZhi),
  );
  const leylineBranches = new Set(
    leyline.filter((s): s is NonNullable<typeof s> => Boolean(s?.card)).map((s) => s.card.diZhi),
  );

  const [floaters, setFloaters] = useState<Floater[]>([]);
  const lastEventId = useRef(0);
  const floaterSeq = useRef(0);

  useEffect(() => {
    if (scoreDelta && scoreDelta.id !== lastEventId.current && scoreDelta.delta !== 0) {
      lastEventId.current = scoreDelta.id;
      const id = ++floaterSeq.current;
      setFloaters((f) => [...f, { id, delta: scoreDelta.delta }]);
      const t = setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 1350);
      return () => clearTimeout(t);
    }
  }, [scoreDelta]);

  return (
    <div className="flex flex-col bg-[#faf6ee] border-b border-wood-light">
      {/* 行 1：主要状态、天时、年岁与操作、修为 */}
      <div className="flex items-center justify-between gap-1.5 px-3 pt-1.5 pb-1 max-md:py-1">
        {/* 左侧：天时 + 机缘 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <h1 className={`text-lg sm:text-xl font-bold font-serif ${seasonTheme.text} leading-none whitespace-nowrap`}>
            {/* key 变化触发切换动画，提示回合推进 */}
            <span key={currentRound} className="inline-block" style={roundAnimStyle}>
              {seasonDisplay(season)} · 天时
            </span>
          </h1>
          {activeBoon && activeBoon !== 'none' && SINGLE_YEAR_BOONS[activeBoon as keyof typeof SINGLE_YEAR_BOONS] && (
            <span
              className="text-[11px] font-bold text-teal-800 bg-teal-100/90 px-2 py-0.5 rounded-full border border-teal-300/80 shadow-xs whitespace-nowrap"
              title={SINGLE_YEAR_BOONS[activeBoon as keyof typeof SINGLE_YEAR_BOONS]?.description}
              data-testid="active-boon-badge"
            >
              ✨【{SINGLE_YEAR_BOONS[activeBoon as keyof typeof SINGLE_YEAR_BOONS]?.name}】
            </span>
          )}
        </div>

        {/* 右侧：功能按钮 + 修为面板 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {gameState === 'player_action' && (
            <div className="flex items-center gap-1">
              <button
                onClick={openDashboard}
                className="px-2 py-0.5 rounded bg-white/90 border border-wood-mid text-wood-dark text-[11px] sm:text-xs font-serif hover:bg-wood-light/20 transition-all cursor-pointer shadow-2xs"
                aria-label="打开交易看板"
              >
                行迹
              </button>
              <button
                onClick={openCultivationProfile}
                className="px-2 py-0.5 rounded bg-white/90 border border-wood-mid text-wood-dark text-[11px] sm:text-xs font-serif hover:bg-wood-light/20 transition-all cursor-pointer shadow-2xs"
                aria-label="打开修行档案"
              >
                档案
              </button>
              <button
                onClick={openPauseModal}
                className="px-2 py-0.5 rounded bg-white/90 border border-wood-mid text-wood-dark text-[11px] sm:text-xs font-serif hover:bg-wood-light/20 transition-all cursor-pointer shadow-2xs"
                aria-label="暂停修行"
              >
                暂停
              </button>
            </div>
          )}
          <div data-score-panel className="score-panel relative shrink-0 rounded-lg border border-gold/40 bg-gold/10 px-2 py-0.5 text-right flex flex-col justify-center">
            <div className="text-base sm:text-lg font-black leading-tight text-gold tabular-nums font-mono flex items-baseline justify-end gap-1">
              <span>{score.toFixed(1)}</span>
              <span className="text-xs font-serif font-bold text-wood-dark">修为</span>
            </div>
            {scoreDelta && (
              <div className={`mt-0.5 whitespace-nowrap text-[10px] font-bold leading-none tabular-nums ${scoreDelta.delta >= 0 ? 'text-qi-full' : 'text-qi-critical'}`}>
                本回合 {scoreDelta.delta >= 0 ? '+' : ''}{scoreDelta.delta.toFixed(1)} 修为
              </div>
            )}
            {/* 分数飘字 */}
            {floaters.map((f, idx) => (
              <span
                key={f.id}
                className={`float-up absolute right-0 bottom-full mb-0.5 text-xs font-bold pointer-events-none whitespace-nowrap ${
                  f.delta >= 0 ? 'text-qi-full' : 'text-qi-critical'
                }`}
                style={{ right: `${idx * 20}px` }}
              >
                {f.delta >= 0 ? '+' : ''}{f.delta.toFixed(1)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 行 2：年岁回合与天劫道基大考进度条（独占一行，绝不重叠折行） */}
      <div className="flex items-center justify-between gap-2 px-3 py-0.5 border-t border-wood-light/30 text-xs">
        <div className="flex items-center gap-1.5 font-serif text-ink whitespace-nowrap">
          {isV11 ? (
            <>
              <span className="font-bold text-amber-900">第 {year} 年</span>
              <span className="text-wood-mid">·</span>
              <span>{turn}/20 轮</span>
              <span className="text-wood-mid">·</span>
              <span>季内第 {roundInSeason} 轮</span>
            </>
          ) : (
            <>
              <span>第 {currentRound} 回合 / {totalRounds}</span>
              <span className="text-wood-mid">·</span>
              <span>季内第 {roundInSeason} 回合</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-1 max-w-[200px] justify-end" title={`天劫门槛目标: ${score.toFixed(0)} / ${quota}`}>
          <span className="text-[11px] text-wood-dark font-serif font-medium whitespace-nowrap">天劫道基:</span>
          <div className="h-1.5 flex-1 rounded-full bg-wood-light/60 overflow-hidden min-w-[50px]">
            <div
              className={`h-full rounded-full transition-all duration-300 ${score >= quota ? 'bg-emerald-500' : 'bg-gold'}`}
              style={{ width: `${Math.min(100, Math.max(0, (score / quota) * 100))}%` }}
            />
          </div>
          <span className={`text-[11px] font-mono font-bold whitespace-nowrap ${score >= quota ? 'text-emerald-700' : 'text-amber-800'}`}>
            {score.toFixed(0)}/{quota}
          </span>
        </div>
      </div>

      {/* V6/V11 地支三合局偏移罗盘 */}
      {branchRollDeltas && (
        <div className="flex flex-col border-t border-wood-light/40 bg-[#f9f5ec]">
          {/* 四大三合局分组抬头：申子辰水、亥卯未木、寅午戌火、巳酉丑金 */}
          <div className="grid grid-cols-4 gap-1 px-3 pt-0.5 text-[10px] font-serif text-center leading-tight">
            {TRIAD_COLUMNS.map((col) => {
              const readyTriad = availableTriads.find((t) => t.element === col.element);
              if (readyTriad) {
                return (
                  <button
                    key={col.element}
                    type="button"
                    onClick={() => claimTriad(readyTriad.element)}
                    disabled={gameState !== 'player_action'}
                    className={`rounded border px-1 py-0.5 font-bold shadow-2xs transition-all ${
                      gameState === 'player_action'
                        ? `${col.activeBg} hover:brightness-95 active:scale-95 cursor-pointer ring-1 ring-amber-400/60 animate-pulse`
                        : 'bg-stone-200 border-stone-300 text-stone-500 cursor-not-allowed'
                    }`}
                    title={`可引动【${readyTriad.name}】（+${readyTriad.bonus}修为 · 回满神识 · 专精+25%）`}
                  >
                    {col.label} · 可引动
                  </button>
                );
              }
              return (
                <span key={col.element} className={`${col.color} font-bold py-0.5`}>
                  {col.label}
                </span>
              );
            })}
          </div>

          <div
            className="grid grid-cols-12 gap-0.5 px-3 pb-0.5 pt-0.5 text-center"
            aria-label="本季地支偏移与三合命盘"
            data-testid="branch-roll-bar"
          >
            {TRIAD_BRANCH_ITEMS.map((item) => {
              const v = branchRollDeltas[item.dz] ?? 0;
              const isDantian = dantianBranches.has(item.dz);
              const isLeyline = !isDantian && leylineBranches.has(item.dz);

              return (
                <div
                  key={item.dz}
                  className={`relative flex flex-col items-center justify-center py-0.5 rounded transition-all duration-150 ${
                    isDantian
                      ? 'bg-amber-200/95 border border-amber-500 text-amber-950 font-bold shadow-2xs scale-[1.04] z-1'
                      : isLeyline
                      ? 'bg-wood-light/25 border border-wood-mid/50 text-wood-dark shadow-2xs'
                      : 'bg-white/40 border border-transparent'
                  } ${item.isGroupEnd ? 'border-r-wood-light/60 mr-0.5 pr-0.5' : ''}`}
                  title={
                    isDantian
                      ? `【${item.dz}】活跃丹田已温养 · 属${item.triadName}`
                      : isLeyline
                      ? `【${item.dz}】潜伏地脉暗存 · 属${item.triadName}`
                      : `【${item.dz}】属${item.triadName} · 季内偏移 ${v > 0 ? `+${v}` : v}`
                  }
                >
                  <div className="flex items-center gap-0.5 leading-none">
                    <span className={`text-[11px] font-serif ${isDantian ? 'font-black text-amber-950' : isLeyline ? 'font-bold text-wood-dark' : 'text-ink-light/80'}`}>
                      {item.dz}
                    </span>
                    {isDantian && (
                      <span className="text-[7px] text-amber-600 leading-none">✦</span>
                    )}
                  </div>
                  <div
                    className={`text-[10px] leading-tight tabular-nums font-mono ${
                      isDantian
                        ? 'font-black text-amber-950'
                        : isLeyline
                        ? 'font-bold text-wood-dark'
                        : v > 0
                        ? 'font-bold text-red-600'
                        : v < 0
                        ? 'font-bold text-sky-600'
                        : 'text-gray-400'
                    }`}
                  >
                    {v > 0 ? `+${v}` : v}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* V11 古宗巡视倒计时警示栏 */}
      {activeSectIds.length > 0 && (
        <div
          className="flex items-center justify-between px-3 py-0.5 bg-[#faf6ee] text-[10px] border-t border-wood-light/40"
          data-testid="sect-patrol-bar"
        >
          <div className="flex items-center gap-1.5 font-serif text-wood-dark">
            <span className="font-bold text-[11px]">古宗巡视:</span>
            {activeSectIds.map((sid: string) => {
              const sect = ALL_SECTS[sid];
              if (!sect) return null;
              const cd = sectCountdowns?.[sid] ?? '-';
              const isUrgent = typeof cd === 'number' && cd <= 1;
              return (
                <span
                  key={sid}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded border text-[10px] font-serif ${
                    isUrgent
                      ? 'bg-rose-50 border-rose-400 text-rose-800 font-bold animate-pulse'
                      : 'bg-white/80 border-wood-light text-ink'
                  }`}
                  title={`${sect.name} · ${sect.intentDesc}`}
                >
                  <span>{sect.name}</span>
                  <span className="font-mono font-bold">{cd}轮</span>
                </span>
              );
            })}
          </div>
          <span className="text-[10px] text-wood-dark/80 font-serif whitespace-nowrap">地脉暗牌避灾</span>
        </div>
      )}
    </div>
  );
}
