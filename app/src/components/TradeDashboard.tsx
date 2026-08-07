import { useMemo, useState } from 'react';
import { useGameStore, seasonDisplay } from '../store';
import { Element, YinYang, type RoundLogEntry } from '@core/index';
import { aggregateCardSummaries, countSettled, type CardSummary } from '../lib/cardSummary';

/** 五行色点（与 CardVisual 同源口径，看板回合卡用） */
const elementDot: Record<Element, string> = {
  [Element.WOOD]: 'bg-emerald-500',
  [Element.FIRE]: 'bg-red-500',
  [Element.EARTH]: 'bg-amber-500',
  [Element.METAL]: 'bg-slate-400',
  [Element.WATER]: 'bg-sky-500',
};

/** 行动徽章样式：释灵红 / 纳灵蓝 / 调息木纹 / 炼化橙（结算专用） */
const actionBadge: Record<string, { bg: string; label: string }> = {
  buy: { bg: 'bg-sky-600', label: '纳灵' },
  sell: { bg: 'bg-red-500', label: '释灵' },
  wait: { bg: 'bg-[#8B7355]', label: '调息' },
  lock: { bg: 'bg-amber-600', label: '锁' },
  unlock: { bg: 'bg-amber-500', label: '解锁' },
};

/** 筛选 tab：全部 + 三种行动 */
type TabFilter = 'all' | 'buy' | 'sell' | 'wait';

const TABS: { key: TabFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'buy', label: '纳灵' },
  { key: 'sell', label: '释灵' },
  { key: 'wait', label: '调息' },
];

/** 金额格式化：修为一位小数，神识整数 */
function fmtScore(n: number): string {
  return n.toFixed(1);
}

/**
 * 交易看板（行迹）
 *
 * 局中随时可开的"交易记录"：逐回合展示行动 + 结算。数据源全部来自 roundLog
 * （已发生事实快照），不引入任何预测/推演字段——天然满足 docs/ui-information-boundary.md。
 */
export function TradeDashboard() {
  const open = useGameStore((s) => s.dashboardOpen);
  const closeDashboard = useGameStore((s) => s.closeDashboard);
  const roundLog = useGameStore((s) => s.roundLog);
  const currentRound = useGameStore((s) => s.currentRound);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const season = useGameStore((s) => s.season);
  const score = useGameStore((s) => s.score);
  const qi = useGameStore((s) => s.qi);
  const maxQi = useGameStore((s) => s.maxQi);
  const totalBuys = useGameStore((s) => s.totalBuys);
  const totalSells = useGameStore((s) => s.totalSells);
  const marginCallCount = useGameStore((s) => s.marginCallCount);
  const [filter, setFilter] = useState<TabFilter>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return roundLog;
    return roundLog.filter((e) => e.action === filter);
  }, [roundLog, filter]);

  // 倒序：最新回合在上（翻交易记录习惯）
  const reversed = useMemo(() => [...filtered].reverse(), [filtered]);

  // 经手卡牌：整局操作过的卡片总结（纯前端聚合，数据源 roundLog）
  const cardSummaries = useMemo(() => aggregateCardSummaries(roundLog), [roundLog]);
  const settledCount = useMemo(() => countSettled(cardSummaries), [cardSummaries]);

  if (!open) return null;

  return (
    <div className="modal-backdrop absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-3 w-full max-w-sm bg-parchment rounded-2xl shadow-2xl flex flex-col max-h-[92%] overflow-hidden">
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-wood-light">
          <button
            onClick={closeDashboard}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-[#E9E1CE] text-ink text-lg font-bold hover:bg-wood-light/30 transition-colors"
            aria-label="关闭看板"
          >
            ←
          </button>
          <h2 className="text-lg font-bold font-serif text-ink">行迹 · 交易看板</h2>
          <span className="px-3 py-1 rounded-full bg-wood-mid text-parchment text-xs font-medium">
            {seasonDisplay(season)} · 天时
          </span>
        </div>

        {/* Hero 卡：当前状态 + 回合进度 */}
        <div className="px-4 pt-3">
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-light">当前修为</span>
              <span className="px-2.5 py-1 rounded-full bg-sky-600 text-white text-xs font-bold">
                神识 {qi}/{maxQi}
              </span>
            </div>
            <div className="text-4xl font-black font-serif text-ink mt-1 tabular-nums">
              {fmtScore(score)}
            </div>
            {/* 回合进度 */}
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold font-serif text-ink tabular-nums">
                  第 {currentRound} 回合 / {totalRounds}
                </span>
              </div>
              <div className="w-28 h-1.5 rounded-full bg-[#E9E1CE] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gold"
                  style={{ width: `${Math.min(100, (currentRound / totalRounds) * 100)}%` }}
                />
              </div>
            </div>
            {/* 经手统计：整局操作过的卡 */}
            <div className="flex items-center justify-between mt-2 text-[11px] text-ink-light">
              <span>经手 <span className="font-bold text-ink tabular-nums">{cardSummaries.length}</span> 张</span>
              <span>了结 <span className="font-bold text-ink tabular-nums">{settledCount}</span> 张</span>
            </div>
            {/* 三栏统计：全部来自 store 真实计数 */}
            <div className="mt-3 pt-3 border-t border-[#E9E1CE] grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[11px] text-ink-light">纳灵次数</div>
                <div className="text-base font-bold text-ink tabular-nums">{totalBuys}</div>
              </div>
              <div>
                <div className="text-[11px] text-ink-light">释灵次数</div>
                <div className="text-base font-bold text-ink tabular-nums">{totalSells}</div>
              </div>
              <div>
                <div className="text-[11px] text-ink-light">反噬次数</div>
                <div className="text-base font-bold text-qi-critical tabular-nums">{marginCallCount}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 经手卡牌：整局操作过的卡片总结（总体行为，独立于逐回合流水） */}
        {cardSummaries.length > 0 && (
          <div className="px-4 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold font-serif text-ink">经手卡牌</span>
              <span className="text-[11px] text-ink-light">整局操作 · 按最后操作倒序</span>
            </div>
            <div className="space-y-2">
              {cardSummaries.map((s) => (
                <CardSummaryRow key={s.name} summary={s} />
              ))}
            </div>
          </div>
        )}

        {/* 筛选 tabs：shrink-0 固定 + 底部留白，不与滚动列表粘连 */}
        <div className="shrink-0 px-4 pt-3 pb-2.5 flex gap-2 border-b border-[#E9E1CE]">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`
                px-4 h-8 rounded-full text-sm font-medium transition-colors
                ${filter === t.key ? 'bg-ink text-parchment' : 'bg-[#E9E1CE] text-ink-light hover:bg-wood-light/40'}
              `}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 回合卡列表：独立滚动区，顶部留白与 tabs 分隔 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4 space-y-2.5">
          {reversed.length === 0 && (
            <div className="text-center text-sm text-ink-light py-10">
              {filter === 'all' ? '尚无回合记录' : `暂无「${TABS.find((t) => t.key === filter)?.label}」记录`}
            </div>
          )}
          {reversed.map((entry) => (
            <RoundCard key={entry.round} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 经手卡牌单行：五行色点 + 干支 + 阴阳 + 买/卖次数 + 收益明细 + 总收益 + 状态 */
function CardSummaryRow({ summary }: { summary: CardSummary }) {
  const dot = elementDot[summary.mainElement];
  const isYang = summary.yinYang === YinYang.YANG;
  const pnlClass = summary.total >= 0 ? 'text-qi-full' : 'text-qi-critical';
  const detClass = (v: number) => (v >= 0 ? 'text-qi-full' : 'text-qi-critical');

  return (
    <div className="bg-white rounded-xl p-3 shadow-sm">
      <div className="flex items-center gap-2.5">
        {/* 卡名：五行色点 + 干支 + 阴阳徽章 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`w-2 h-2 rounded-sm shrink-0 ${dot}`} aria-hidden />
          <span className="text-[15px] font-bold font-serif text-ink">{summary.name}</span>
          <span
            className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-bold text-parchment ${
              isYang ? 'bg-orange-500' : 'bg-violet-500'
            }`}
            title={isYang ? '阳 · 波动较大' : '阴 · 较稳'}
          >
            {isYang ? '阳' : '阴'}
          </span>
        </div>

        {/* 次数与收益明细 */}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-ink tabular-nums">
            买 <span className="font-bold">{summary.buys}</span> 次 · 卖 <span className="font-bold">{summary.sells}</span> 次
          </div>
          <div className="text-[10px] text-ink-light mt-0.5 truncate tabular-nums">
            {summary.sells > 0 && (
              <span className={detClass(summary.sellEarnings)}>卖出 {fmtScore(summary.sellEarnings)}</span>
            )}
            {summary.sells > 0 && summary.holdEarnings !== 0 && <span className="text-ink-light"> · </span>}
            {summary.holdEarnings !== 0 && (
              <span className={detClass(summary.holdEarnings)}>炼化 {fmtScore(summary.holdEarnings)}</span>
            )}
            {summary.penalty > 0 && (
              <>
                <span className="text-ink-light"> · </span>
                <span className="text-qi-critical">反噬 -{fmtScore(summary.penalty)}</span>
              </>
            )}
            {summary.sells === 0 && summary.holdEarnings === 0 && summary.penalty === 0 && (
              <span>暂无收益</span>
            )}
          </div>
        </div>

        {/* 总收益 + 状态 */}
        <div className="text-right shrink-0">
          <div className={`text-base font-bold tabular-nums ${pnlClass}`}>
            {summary.total >= 0 ? '+' : ''}{fmtScore(summary.total)}
          </div>
          <div className={`text-[10px] ${summary.holding ? 'text-amber-600' : 'text-ink-light'}`}>
            {summary.holding ? '持有中' : '已了结'}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 单回合卡片：回合头 + 行动层 + 结算层 */
function RoundCard({ entry }: { entry: RoundLogEntry }) {
  const badge = entry.action ? actionBadge[entry.action] : null;
  const seasonText = seasonDisplay(entry.season);

  return (
    <div className="bg-white rounded-xl p-3.5 shadow-sm">
      {/* 回合头 */}
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-bold font-serif text-ink">
          第 {entry.round} 回合 · {seasonText}
        </span>
        <span className="text-xs text-ink-light tabular-nums">
          季内第 {entry.roundInSeason} 回合
        </span>
      </div>

      {/* 行动层：本回合玩家操作（首回合/无行动则显示"开局"） */}
      {entry.action && badge ? (
        <div className="flex items-center gap-2.5 bg-[#FAF6EE] rounded-lg p-2.5">
          <span className={`w-10 h-10 shrink-0 flex items-center justify-center rounded-lg text-parchment text-xs font-bold font-serif ${badge.bg}`}>
            {badge.label}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {entry.actionCardName && (
                <span className="text-[15px] font-bold font-serif text-ink truncate">
                  {entry.actionCardName}
                </span>
              )}
              {entry.action === 'buy' || entry.action === 'sell' ? (
                <ActionDetail entry={entry} />
              ) : (
                <span className="text-xs text-ink-light">无操作 · 静候天时</span>
              )}
            </div>
            <div className="text-[11px] text-ink-light mt-0.5">
              {entry.action === 'buy' && `评分 ${entry.actionCardScore} · 耗神 ${fmtScore(entry.actionQiChange)}`}
              {entry.action === 'sell' && (
                <>评分 {entry.buyScore} → {entry.actionCardScore} · 价差 {fmtScore((entry.actionCardScore ?? 0) - (entry.buyScore ?? 0))}</>
              )}
              {entry.action === 'wait' && `回气 +${fmtScore(entry.settlement.baseQiRecover + entry.settlement.waitQiRecover)}`}
            </div>
          </div>
          <ActionResult entry={entry} />
        </div>
      ) : (
        <div className="flex items-center justify-between bg-[#FAF6EE] rounded-lg p-2.5 text-xs text-ink-light">
          <span>开局 · 天机初启</span>
          <span className="tabular-nums">修为 {fmtScore(entry.scoreAfter)}</span>
        </div>
      )}

      {/* 结算层：炼化/耗神/回气/反噬 */}
      <div className="flex items-center gap-3 mt-2 text-xs">
        <SettleItem label="炼化" value={`${entry.settlement.holdEarnings >= 0 ? '+' : ''}${fmtScore(entry.settlement.holdEarnings)}`} color={entry.settlement.holdEarnings >= 0 ? 'text-qi-full' : 'text-qi-critical'} />
        <SettleItem label="耗神" value={fmtScore(-entry.settlement.holdQiCost)} color="text-sky-600" />
        <SettleItem label="回气" value={`+${fmtScore(entry.settlement.baseQiRecover + entry.settlement.waitQiRecover)}`} color="text-sky-600" />
        {entry.settlement.marginCallTriggered && (
          <span className="ml-auto text-[11px] font-bold text-qi-critical">
            反噬 {entry.settlement.marginCallDetails.length} 张
          </span>
        )}
      </div>
    </div>
  );
}

/** 行动明细：买入/卖出时显示卡牌评分上下文 */
function ActionDetail({ entry }: { entry: RoundLogEntry }) {
  if (entry.action === 'sell') {
    return (
      <span className="text-xs text-ink-light ml-1">
        {entry.buyScore != null && entry.actionCardScore != null
          ? `${entry.buyScore} → ${entry.actionCardScore}`
          : ''}
      </span>
    );
  }
  return null;
}

/** 行动结果：卖出=收益（红绿），买入=耗神（水蓝） */
function ActionResult({ entry }: { entry: RoundLogEntry }) {
  if (entry.action === 'sell') {
    const sell = entry.sellScore ?? 0;
    return (
      <div className="text-right shrink-0">
        <div className={`text-base font-bold tabular-nums ${sell >= 0 ? 'text-qi-full' : 'text-qi-critical'}`}>
          {sell >= 0 ? '+' : ''}{fmtScore(sell)}
        </div>
        <div className="text-[10px] text-ink-light">卖出收益</div>
      </div>
    );
  }
  if (entry.action === 'buy') {
    return (
      <div className="text-right shrink-0">
        <div className="text-base font-bold text-sky-600 tabular-nums">{fmtScore(entry.actionQiChange)}</div>
        <div className="text-[10px] text-ink-light">神识</div>
      </div>
    );
  }
  return (
    <div className="text-right shrink-0">
      <div className="text-base font-bold text-qi-full tabular-nums">
        +{fmtScore(entry.settlement.holdEarnings + entry.settlement.baseQiRecover + entry.settlement.waitQiRecover)}
      </div>
      <div className="text-[10px] text-ink-light">净变动</div>
    </div>
  );
}

/** 结算项小标签 */
function SettleItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-ink-light">{label}</span>
      <span className={`font-bold tabular-nums ${color}`}>{value}</span>
    </span>
  );
}
