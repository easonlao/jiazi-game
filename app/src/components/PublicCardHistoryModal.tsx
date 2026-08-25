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

const ACTION_LABEL = {
  buy: '纳灵',
  sell: '释灵',
  settle: '终局出清',
} as const;

function formatScore(score: number) {
  return `${score >= 0 ? '+' : ''}${score.toFixed(1)}`;
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
  const path = normalized.length > 0
    ? normalized.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
    : '';
  const areaPath = normalized.length > 0
    ? `${path} L ${normalized[normalized.length - 1].x.toFixed(1)} ${chart.bottom} L ${normalized[0].x.toFixed(1)} ${chart.bottom} Z`
    : '';
  const firstPoint = normalized[0] ?? null;
  const latestPoint = normalized[normalized.length - 1] ?? null;

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

            <div className="overflow-hidden rounded-2xl border border-wood-light/65 bg-white/65 px-2 pb-1 pt-2 shadow-sm">
              <svg
                viewBox="0 0 320 150"
                className="block h-auto min-h-40 w-full"
                role="img"
                aria-label={`${card.name} 本局评分曲线`}
                data-testid="public-card-history-chart"
              >
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
                {path && (
                  <g className={elementScoreColor[card.mainElement]}>
                    <path d={areaPath} fill="currentColor" fillOpacity="0.12" />
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
                        <title>第 {point.round} 回合，评分 {formatScore(point.score)}</title>
                      </circle>
                    ))}
                  </g>
                )}
              </svg>
            </div>
          </section>

          {view.earlyHistoryUnavailable && (
            <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
              这份旧存档只保留了当前回合起的评分，较早曲线无法补回。
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
