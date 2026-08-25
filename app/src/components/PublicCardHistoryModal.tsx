import { useEffect, useMemo } from 'react';
import type { JiaziCard, TurnManager } from '@core/index';
import type { RoundLogEntry } from '@core/index';
import { buildPublicCardHistoryView } from '../lib/publicCardHistory';

const SEASON_LABEL: Record<string, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
};

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const points = view.points;
  const height = 100;
  const minScore = points.length > 0 ? Math.min(...points.map((p) => p.score)) : 0;
  const maxScore = points.length > 0 ? Math.max(...points.map((p) => p.score)) : 1;
  const range = Math.max(1, maxScore - minScore);
  const normalized = points.map((point, index) => {
    const x = points.length <= 1 ? 50 : 6 + (index / (points.length - 1)) * 88;
    const y = height - 12 - ((point.score - minScore) / range) * 76;
    return { ...point, x, y };
  });
  const path = normalized.length > 0
    ? normalized.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
    : '';
  const latest = normalized[normalized.length - 1] ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-2 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-wood-light bg-parchment shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={`${card.name} 行迹弹窗`}
        data-testid="public-card-history-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-wood-light/60 px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-ink">单牌行迹</div>
            <div className="truncate text-base font-serif font-bold text-ink-dark">{card.name}</div>
            <div className="mt-0.5 text-[11px] text-ink-light">
              当前第 {view.currentRound} 回合 · 当前评分 {view.currentScore >= 0 ? '+' : ''}{view.currentScore.toFixed(1)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-wood-light/80 bg-white px-2.5 py-1 text-xs font-medium text-ink-light"
            data-testid="public-card-history-close"
          >
            关闭
          </button>
        </div>

        <div className="space-y-3 px-3 py-3">
          <div className="rounded-xl border border-wood-light/60 bg-white/70 p-2">
            <svg
              viewBox="0 0 100 100"
              className="h-40 w-full"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${card.name} 本局评分曲线`}
              data-testid="public-card-history-chart"
            >
              <defs>
                <linearGradient id={`history-gradient-${card.id}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgb(59 130 246)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="rgb(59 130 246)" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <line x1="6" y1="88" x2="94" y2="88" stroke="rgba(100,116,139,0.3)" strokeWidth="0.8" />
              <line x1="6" y1="12" x2="6" y2="88" stroke="rgba(100,116,139,0.18)" strokeWidth="0.8" />
              {path && (
                <>
                  <path d={`${path} L 94 88 L 6 88 Z`} fill={`url(#history-gradient-${card.id})`} />
                  <path d={path} fill="none" stroke="rgb(37 99 235)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
                </>
              )}
              {normalized.map((point, index) => (
                <g key={point.round}>
                  <circle cx={point.x} cy={point.y} r="1.7" fill="rgb(37 99 235)" />
                  {(index === 0 || index === normalized.length - 1 || point.round % 10 === 0) && (
                    <text x={point.x} y="96" textAnchor="middle" fontSize="4.5" fill="rgb(100 116 139)">
                      {point.round}
                    </text>
                  )}
                </g>
              ))}
              {latest && (
                <text x="7" y="9" fontSize="4.5" fill="rgb(71 85 105)">
                  {latest.score >= 0 ? '+' : ''}{latest.score.toFixed(1)}
                </text>
              )}
            </svg>
          </div>

          {view.earlyHistoryUnavailable && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900">
              这份存档只保留了当前回合起的历史，较早回合的曲线没有被记录。
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-bold text-ink">买卖记录</div>
            {view.transactions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-wood-light/70 bg-white/50 px-3 py-4 text-center text-xs text-ink-light">
                目前没有纳灵、释灵或终局出清记录
              </div>
            ) : (
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {view.transactions.map((item) => (
                  <div
                    key={`${item.kind}-${item.actionRound}-${item.round}`}
                    className="rounded-lg border border-wood-light/60 bg-white px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink-dark">
                          {item.kind === 'buy' ? '纳灵' : item.kind === 'sell' ? '释灵' : '终局出清'}
                        </div>
                        <div className="mt-0.5 text-[11px] text-ink-light">
                          第 {item.actionRound} 回合 · {SEASON_LABEL[item.season] ?? item.season}
                        </div>
                      </div>
                      <div className={`text-sm font-bold tabular-nums ${item.kind === 'buy' ? 'text-sky-700' : 'text-qi-full'}`}>
                        {item.kind === 'buy'
                          ? `-${Math.abs(item.qiCost)} 神识`
                          : `+${item.earnings.toFixed(1)} 修为`}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-ink-light">
                      <div>回合记录：{item.round}</div>
                      <div className="text-right">{item.kind === 'buy' ? `买价 ${item.value >= 0 ? '+' : ''}${item.value.toFixed(1)}` : `卖价 ${item.value >= 0 ? '+' : ''}${item.value.toFixed(1)}`}</div>
                      {item.buyScore !== null && (
                        <div>买入评分：{item.buyScore >= 0 ? '+' : ''}{item.buyScore.toFixed(1)}</div>
                      )}
                      <div className={item.kind === 'buy' ? 'text-right' : 'text-right'}>
                        {item.kind === 'buy' ? '本次纳灵' : '本次结算'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
