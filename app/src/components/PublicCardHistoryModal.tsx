import { useEffect, useMemo, useRef } from 'react';
import type { JiaziCard, TurnManager } from '@core/index';
import type { RoundLogEntry } from '@core/index';
import { buildPublicCardHistoryView } from '../lib/publicCardHistory';
import { elementScoreColor } from './CardVisual';

const SEASON_LABEL: Record<string, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
};

const SEASON_BAND_STYLES: Record<string, { fill: string; text: string; label: string }> = {
  spring: { fill: '#10b981', text: '#047857', label: '春' },
  summer: { fill: '#f43f5e', text: '#b91c1c', label: '夏' },
  autumn: { fill: '#f59e0b', text: '#b45309', label: '秋' },
  winter: { fill: '#0ea5e9', text: '#0369a1', label: '冬' },
};

const ACTION_LABEL = {
  buy: '纳灵',
  sell: '释灵',
  settle: '终局出清',
} as const;

function formatScore(score: number) {
  return `${score >= 0 ? '+' : ''}${score.toFixed(1)}`;
}

interface ChartMarkerItem {
  key: string;
  kind: 'buy' | 'sell' | 'settle';
  actionRound: number;
  value: number;
  earnings: number;
  x: number;
  y: number;
}

export function PublicCardHistoryModal({
  card,
  turnManager,
  roundLog,
  onClose,
}: {
  card: JiaziCard;
  turnManager: TurnManager;
  roundLog: readonly RoundLogEntry[];
  onClose: () => void;
}) {
  const view = useMemo(() => buildPublicCardHistoryView(card, turnManager, roundLog), [card, roundLog, turnManager]);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const points = view.points;
  const minScore = points.length > 0 ? Math.min(...points.map((point) => point.score)) : 0;
  const maxScore = points.length > 0 ? Math.max(...points.map((point) => point.score)) : 0;
  const flatSeries = Math.abs(maxScore - minScore) < 0.001;
  const range = Math.max(1, maxScore - minScore);
  const chart = { left: 34, right: 304, top: 18, bottom: 112 };
  const normalized = points.map((point, index) => {
    const x = points.length <= 1
      ? (chart.left + chart.right) / 2
      : chart.left + (index / (points.length - 1)) * (chart.right - chart.left);
    const y = flatSeries
      ? (chart.top + chart.bottom) / 2
      : chart.bottom - ((point.score - minScore) / range) * (chart.bottom - chart.top);
    return { ...point, x, y };
  });

  const bandRects = view.seasonBands.map((band) => {
    const xStart = points.length <= 1 || band.startIndex === 0
      ? chart.left
      : (normalized[band.startIndex - 1].x + normalized[band.startIndex].x) / 2;
    const xEnd = points.length <= 1 || band.endIndex === normalized.length - 1
      ? chart.right
      : (normalized[band.endIndex].x + normalized[band.endIndex + 1].x) / 2;
    const style = SEASON_BAND_STYLES[band.season] ?? { fill: '#94a3b8', text: '#475569', label: band.season };
    return {
      ...band,
      xStart,
      xEnd,
      width: Math.max(0, xEnd - xStart),
      style,
    };
  });

  const tradeMarkers = useMemo(() => {
    const byRound = new Map<number, typeof view.transactions>();
    for (const tx of view.transactions) {
      const r = tx.actionRound;
      const list = byRound.get(r) ?? [];
      list.push(tx);
      byRound.set(r, list);
    }

    const markers: ChartMarkerItem[] = [];
    for (const [round, txList] of byRound.entries()) {
      const pt = normalized.find((p) => p.round === round);
      if (!pt) continue;
      const count = txList.length;
      txList.forEach((tx, idx) => {
        const offsetX = count > 1 ? (idx - (count - 1) / 2) * 8 : 0;
        markers.push({
          key: `${tx.kind}-${tx.actionRound}-${tx.round}-${idx}`,
          kind: tx.kind,
          actionRound: tx.actionRound,
          value: tx.value,
          earnings: tx.earnings,
          x: pt.x + offsetX,
          y: pt.y,
        });
      });
    }
    return markers;
  }, [normalized, view.transactions]);

  const voidMarkers = useMemo(() => {
    const map = new Map<number, (typeof normalized)[number]>();
    normalized.forEach((p) => map.set(p.round, p));
    return view.voidEvents
      .map((ev) => {
        const pt = map.get(ev.round);
        if (!pt) return null;
        return {
          ...ev,
          x: pt.x,
          y: pt.y,
          key: `void-${ev.round}`,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [normalized, view.voidEvents]);

  const path = normalized.length > 0
    ? normalized.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
    : '';
  const firstPoint = normalized[0] ?? null;
  const latestPoint = normalized[normalized.length - 1] ?? null;

  const tradeSummaryText = useMemo(() => {
    if (view.transactions.length === 0) {
      return '本局尚无买卖记录';
    }
    const parts = view.transactions.map((t) => {
      const seasonText = SEASON_LABEL[t.season] ? `${SEASON_LABEL[t.season]}季` : '';
      const resultText = t.kind === 'buy'
        ? `消耗 ${Math.abs(t.qiCost)} 神识`
        : `收益 ${t.earnings >= 0 ? '+' : ''}${t.earnings.toFixed(1)} 修为`;
      return `第 ${t.actionRound} 回合${seasonText}${ACTION_LABEL[t.kind]}（评分 ${formatScore(t.value)}，${resultText}）`;
    });
    return `包含买卖标记：${parts.join('；')}`;
  }, [view.transactions]);

  const voidSummaryText = useMemo(() => {
    if (view.voidEvents.length === 0) return '';
    const parts = view.voidEvents.map(
      (e) => `第 ${e.round} 回合空亡吞噬推进 ${e.totalK} 步（${e.count} 张空亡牌${e.swallowed > 0 ? `，跨过 ${e.swallowed} 个季节` : ''}）`,
    );
    return `包含空亡吞噬：${parts.join('；')}`;
  }, [view.voidEvents]);

  const chartAriaLabel = `${card.name} 本局评分曲线，覆盖第 ${firstPoint?.round ?? 1} 至 ${latestPoint?.round ?? 1} 回合。${tradeSummaryText}。${voidSummaryText ? ' ' + voidSummaryText + '。' : ''}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/55 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] border border-wood-light/80 bg-parchment shadow-2xl sm:max-h-[88dvh] sm:rounded-[24px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-history-title"
        data-testid="public-card-history-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex-none px-4 pb-3 pt-2 sm:pt-4">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-wood-light/70 sm:hidden" aria-hidden="true" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 pt-0.5">
              <div className="text-[11px] font-bold tracking-[0.18em] text-ink-light">单牌行迹</div>
              <h2 id="card-history-title" className="mt-1 truncate font-serif text-xl font-bold leading-none text-ink-dark">
                {card.name}
              </h2>
              <p className="mt-1.5 text-xs text-ink-light">本局第 {view.currentRound} 回合</p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="关闭牌面行迹"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-wood-light/80 bg-white/70 text-ink-light transition-colors hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/55 active:bg-wood-light/15"
              data-testid="public-card-history-close"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </div>
        </div>

        <div className="grid flex-none grid-cols-3 border-y border-wood-light/55 bg-white/35">
          <div className="px-3 py-2.5">
            <div className="text-[10px] text-ink-light">当前评分</div>
            <div className={`mt-0.5 text-base font-bold tabular-nums ${elementScoreColor[card.mainElement]}`}>
              {formatScore(view.currentScore)}
            </div>
          </div>
          <div className="border-x border-wood-light/45 px-3 py-2.5">
            <div className="text-[10px] text-ink-light">本局高 / 低</div>
            <div className="mt-0.5 whitespace-nowrap text-sm font-bold tabular-nums text-ink">
              {formatScore(maxScore)} <span className="font-normal text-ink-light">/</span> {formatScore(minScore)}
            </div>
          </div>
          <div className="px-3 py-2.5">
            <div className="text-[10px] text-ink-light">买卖次数</div>
            <div className="mt-0.5 text-base font-bold tabular-nums text-ink">{view.transactions.length}</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-5 pt-4">
          <section aria-labelledby="card-history-chart-title">
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <h3 id="card-history-chart-title" className="text-sm font-bold text-ink">评分波动</h3>
                <p className="mt-0.5 text-[11px] text-ink-light">每回合结算后的实际评分</p>
              </div>
              {firstPoint && latestPoint && (
                <span className="shrink-0 rounded-full border border-wood-light/60 bg-white/60 px-2 py-1 text-[10px] text-ink-light">
                  第 {firstPoint.round} 至 {latestPoint.round} 回合
                </span>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border border-wood-light/65 bg-white/65 px-2 pb-2 pt-2 shadow-sm">
              <svg
                viewBox="0 0 320 150"
                className="block h-auto min-h-40 w-full"
                role="img"
                aria-label={chartAriaLabel}
                aria-describedby="card-history-chart-desc"
                data-testid="public-card-history-chart"
              >
                <desc id="card-history-chart-desc">{chartAriaLabel}</desc>
                {/* 1. 四季背景分段 */}
                <g className="season-bands" aria-hidden="true">
                  {bandRects.map((b) => (
                    <g key={`band-${b.season}-${b.startRound}-${b.endRound}`}>
                      <rect
                        x={b.xStart}
                        y={chart.top}
                        width={b.width}
                        height={chart.bottom - chart.top}
                        fill={b.style.fill}
                        fillOpacity="0.10"
                        data-testid={`season-band-${b.season}`}
                      />
                      {b.width >= 16 && (
                        <text
                          x={(b.xStart + b.xEnd) / 2}
                          y={chart.top + 10}
                          textAnchor="middle"
                          fill={b.style.text}
                          fillOpacity="0.75"
                          fontSize="9"
                          fontWeight="bold"
                        >
                          {b.style.label}
                        </text>
                      )}
                    </g>
                  ))}
                </g>

                {/* 2. 背景网格线 */}
                {[chart.top, (chart.top + chart.bottom) / 2, chart.bottom].map((y) => (
                  <line
                    key={y}
                    x1={chart.left}
                    y1={y}
                    x2={chart.right}
                    y2={y}
                    stroke="currentColor"
                    className="text-wood-light/50"
                    strokeWidth="1"
                    strokeDasharray={y === chart.bottom ? undefined : '3 5'}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}

                {/* 3. 刻度与轴文本 */}
                <g className="text-ink-light" fill="currentColor" fontSize="10">
                  {flatSeries ? (
                    <text x="3" y={(chart.top + chart.bottom) / 2 + 3}>{formatScore(maxScore)}</text>
                  ) : (
                    <>
                      <text x="3" y={chart.top + 3}>{formatScore(maxScore)}</text>
                      <text x="3" y={chart.bottom + 3}>{formatScore(minScore)}</text>
                    </>
                  )}
                  {firstPoint && <text x={firstPoint.x} y="139" textAnchor="middle">{firstPoint.round}</text>}
                  {latestPoint && latestPoint.round !== firstPoint?.round && (
                    <text x={latestPoint.x} y="139" textAnchor="middle">{latestPoint.round}</text>
                  )}
                </g>

                {/* 4. 纯净折线与评分点（无面积蒙版，透出清晰四季色带） */}
                {path && (
                  <g className={elementScoreColor[card.mainElement]}>
                    <path
                      d={path}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    {normalized.map((point) => (
                      <circle
                        key={point.round}
                        cx={point.x}
                        cy={point.y}
                        r="3.2"
                        fill="currentColor"
                        stroke="white"
                        strokeWidth="1.5"
                        vectorEffect="non-scaling-stroke"
                      >
                        <title>第 {point.round} 回合{point.season ? `（${SEASON_LABEL[point.season] ?? point.season}季）` : ''}，评分 {formatScore(point.score)}</title>
                      </circle>
                    ))}
                  </g>
                )}

                {/* 5. 空亡吞噬标记（紫罗兰色环与推进步数角标） */}
                {voidMarkers.map((marker) => {
                  const { round, totalK, count, swallowed, x, y, key } = marker;
                  const label = `第 ${round} 回合空亡吞噬推进 ${totalK} 步（${count} 张空亡牌${swallowed > 0 ? `，跨过 ${swallowed} 个季节` : ''}）`;
                  const badgeY = Math.max(chart.top + 2, y - 18);
                  return (
                    <g
                      key={key}
                      role="graphics-symbol"
                      aria-label={label}
                      data-testid={`chart-marker-void-${round}`}
                    >
                      <circle
                        cx={x}
                        cy={y}
                        r="6"
                        fill="none"
                        stroke="#8b5cf6"
                        strokeWidth="1.6"
                        strokeDasharray="2 2"
                        vectorEffect="non-scaling-stroke"
                      />
                      <rect
                        x={x - 11}
                        y={badgeY}
                        width="22"
                        height="12"
                        rx="3"
                        fill="#7c3aed"
                        stroke="#ffffff"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x={x}
                        y={badgeY + 8.5}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="8"
                        fontWeight="bold"
                      >
                        {`+${totalK}`}
                      </text>
                      <title>{label}</title>
                    </g>
                  );
                })}

                {/* 6. 纳灵/释灵/终局出清标记 */}
                {tradeMarkers.map((marker) => {
                  const { kind, actionRound, value, earnings, x, y, key } = marker;
                  const txItem = view.transactions.find((t) => t.actionRound === actionRound && t.kind === kind);
                  const seasonName = txItem && SEASON_LABEL[txItem.season] ? `${SEASON_LABEL[txItem.season]}季` : '';
                  if (kind === 'buy') {
                    const label = `第 ${actionRound} 回合${seasonName}纳灵，评分 ${formatScore(value)}`;
                    return (
                      <g key={key} role="graphics-symbol" aria-label={label} data-testid={`chart-marker-buy-${actionRound}`}>
                        <polygon
                          points={`${x},${y - 6.5} ${x - 5},${y + 3.5} ${x + 5},${y + 3.5}`}
                          fill="#0284c7"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                          vectorEffect="non-scaling-stroke"
                        >
                          <title>{label}</title>
                        </polygon>
                      </g>
                    );
                  }
                  if (kind === 'sell') {
                    const label = `第 ${actionRound} 回合${seasonName}释灵，评分 ${formatScore(value)}，收益 ${earnings >= 0 ? '+' : ''}${earnings.toFixed(1)} 修为`;
                    return (
                      <g key={key} role="graphics-symbol" aria-label={label} data-testid={`chart-marker-sell-${actionRound}`}>
                        <polygon
                          points={`${x},${y - 5.5} ${x + 5.5},${y} ${x},${y + 5.5} ${x - 5.5},${y}`}
                          fill="#059669"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                          vectorEffect="non-scaling-stroke"
                        >
                          <title>{label}</title>
                        </polygon>
                      </g>
                    );
                  }
                  if (kind === 'settle') {
                    const label = `第 ${actionRound} 回合${seasonName}终局出清，评分 ${formatScore(value)}，收益 ${earnings >= 0 ? '+' : ''}${earnings.toFixed(1)} 修为`;
                    return (
                      <g key={key} role="graphics-symbol" aria-label={label} data-testid={`chart-marker-settle-${actionRound}`}>
                        <rect
                          x={x - 4}
                          y={y - 4}
                          width="8"
                          height="8"
                          rx="1.5"
                          fill="#d97706"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                          vectorEffect="non-scaling-stroke"
                        >
                          <title>{label}</title>
                        </rect>
                      </g>
                    );
                  }
                  return null;
                })}
              </svg>

              {/* 图例栏 */}
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-wood-light/40 px-1 pt-1.5 text-[10px] text-ink-light">
                <div className="flex items-center gap-2" data-testid="card-history-season-legend">
                  <span className="font-medium text-ink-dark/70">四季</span>
                  <span className="flex items-center gap-0.5"><span className="inline-block h-2 w-2 rounded-[2px] bg-emerald-500/70" />春</span>
                  <span className="flex items-center gap-0.5"><span className="inline-block h-2 w-2 rounded-[2px] bg-rose-500/70" />夏</span>
                  <span className="flex items-center gap-0.5"><span className="inline-block h-2 w-2 rounded-[2px] bg-amber-500/70" />秋</span>
                  <span className="flex items-center gap-0.5"><span className="inline-block h-2 w-2 rounded-[2px] bg-sky-500/70" />冬</span>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  {view.voidEvents.length > 0 && (
                    <div className="flex items-center gap-1 text-[10px] text-purple-700" data-testid="card-history-void-legend">
                      <span className="inline-flex h-3 items-center justify-center rounded bg-purple-600 px-1 text-[8.5px] font-bold text-white leading-none">
                        +K
                      </span>
                      <span>空亡吞噬</span>
                    </div>
                  )}
                  {view.transactions.length > 0 && (
                    <div className="flex items-center gap-2" data-testid="card-history-trade-legend">
                      <span className="font-medium text-ink-dark/70">交易</span>
                      <span className="flex items-center gap-0.5"><span className="font-bold leading-none text-sky-600">▲</span>纳灵</span>
                      <span className="flex items-center gap-0.5"><span className="font-bold leading-none text-emerald-600">◆</span>释灵</span>
                      {view.transactions.some((t) => t.kind === 'settle') && (
                        <span className="flex items-center gap-0.5"><span className="font-bold leading-none text-amber-600">■</span>出清</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {view.earlyHistoryUnavailable && (
            <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
              这份旧存档只保留了当前回合起的评分，较早曲线无法补回。
            </div>
          )}

          {view.hasUnknownSeasons && !view.earlyHistoryUnavailable && (
            <div className="rounded-xl border border-wood-light/70 bg-white/50 px-3 py-2 text-xs leading-relaxed text-ink-light">
              部分历史回合未记录确切季节，未标注确定背景。
            </div>
          )}

          <section aria-labelledby="card-history-trades-title">
            <div className="mb-2">
              <h3 id="card-history-trades-title" className="text-sm font-bold text-ink">买卖记录</h3>
              <p className="mt-0.5 text-[11px] text-ink-light">纳灵、释灵与终局出清都会留在这里</p>
            </div>

            {view.transactions.length === 0 ? (
              <div className="flex min-h-20 items-center gap-3 rounded-2xl border border-dashed border-wood-light/75 bg-white/40 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wood-light/15 text-ink-light" aria-hidden="true">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 15V8m6 7V4m6 11v-5" />
                  </svg>
                </div>
                <div>
                  <div className="text-xs font-bold text-ink">本局尚无买卖</div>
                  <div className="mt-0.5 text-[11px] text-ink-light">纳灵或释灵后，记录会显示在这里</div>
                </div>
              </div>
            ) : (
              <ol className="overflow-hidden rounded-2xl border border-wood-light/65 bg-white/55">
                {view.transactions.map((item) => (
                  <li
                    key={`${item.kind}-${item.actionRound}-${item.round}`}
                    className="flex gap-3 border-b border-wood-light/45 px-3 py-3 last:border-b-0"
                  >
                    <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-full border border-wood-light/65 bg-parchment text-ink">
                      <span className="text-[9px] leading-none text-ink-light">回合</span>
                      <span className="mt-0.5 text-sm font-bold leading-none tabular-nums">{item.actionRound}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-ink-dark">{ACTION_LABEL[item.kind]}</div>
                          <div className="mt-0.5 text-[11px] text-ink-light">{SEASON_LABEL[item.season] ?? item.season}季 · 评分 {formatScore(item.value)}</div>
                        </div>
                        <div className={`shrink-0 text-sm font-bold tabular-nums ${item.kind === 'buy' ? 'text-sky-700' : 'text-qi-full'}`}>
                          {item.kind === 'buy'
                            ? `-${Math.abs(item.qiCost)} 神识`
                            : `+${item.earnings.toFixed(1)} 修为`}
                        </div>
                      </div>
                      {item.kind !== 'buy' && item.buyScore !== null && (
                        <div className="mt-1.5 text-[11px] text-ink-light">纳灵评分 {formatScore(item.buyScore)}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
