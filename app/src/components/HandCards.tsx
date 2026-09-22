import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import { HandCard } from './HandCard';
import { PublicCardHistoryModal } from './PublicCardHistoryModal';
import { SpecializationCompass } from './SpecializationCompass';
import { TriadCelebrationModal } from './TriadCelebrationModal';
import type { HandSlot } from '@core/HandSlot';
import { Element, type JiaziCard } from '@core/JiaziCard';

export function HandCards() {
  const [historyCard, setHistoryCard] = useState<JiaziCard | null>(null);
  const hand = useGameStore((s) => s.hand);
  const selectedHandCard = useGameStore((s) => s.selectedHandCard);
  const selectHandCard = useGameStore((s) => s.selectHandCard);
  const gameState = useGameStore((s) => s.gameState);
  const previewSellInfo = useGameStore((s) => s.previewSellInfo);
  const season = useGameStore((s) => s.season);
  const turnManager = useGameStore((s) => s.turnManager);
  const marginCallEvent = useGameStore((s) => s.marginCallEvent);
  const buySettlementEvent = useGameStore((s) => s.buySettlementEvent);
  const currentRound = useGameStore((s) => s.currentRound);
  // 跨回合买入飞行：目标槽位在飞行期间留空（飞行卡面从公共位飞入空槽位，
  // 到达后手牌显示）——全程只有「一张牌」，避免飞行卡面与真实手牌重叠成两层
  // （2026-08-14 用户反馈：两层叠加让玩家不觉得是同一张牌）。
  const flyingSlot = buySettlementEvent?.round === currentRound
    ? buySettlementEvent.slotIndex
    : null;

  // 反噬来源感：被反噬的丹田槽位（slotIndex）在反噬动画期间播"崩坏"效果，
  // 与中央反噬大卡片同屏——玩家看到"丹田第 N 格崩了"→ 中央弹出惩罚数字的因果链（issue 04）。
  const [shatteredSlots, setShatteredSlots] = useState<Set<number>>(new Set());
  const lastMarginCallId = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (marginCallEvent && marginCallEvent.id !== lastMarginCallId.current) {
      lastMarginCallId.current = marginCallEvent.id;
      const idxs = new Set<number>(
        (marginCallEvent.detail?.marginCallDetails ?? []).map((d) => d.slotIndex),
      );
      setShatteredSlots(idxs);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => {
        setShatteredSlots(new Set());
        clearTimer.current = null;
      }, 3200);
    }
  }, [marginCallEvent]);

  const leyline = useGameStore((s) => s.leyline);
  const maxLeyline = useGameStore((s) => s.maxLeyline);
  const selectedLeylineCard = useGameStore((s) => s.selectedLeylineCard);
  const selectLeylineCard = useGameStore((s) => s.selectLeylineCard);
  const moveToLeyline = useGameStore((s) => s.moveToLeyline);
  const moveToDantian = useGameStore((s) => s.moveToDantian);
  const sellLeyline = useGameStore((s) => s.sellLeyline);
  const qi = useGameStore((s) => s.qi);
  const availableTriads = useGameStore((s) => s.availableTriads);
  const claimTriad = useGameStore((s) => s.claimTriad);

  useEffect(() => {
    if (gameState === 'init') {
      setHistoryCard(null);
    }
  }, [gameState]);

  const hasDantianCards = hand.some((s) => s !== null);
  const isLeylineSoftCapped = leyline.filter((s) => s !== null).length >= maxLeyline;

  return (
    <div className="flex flex-col gap-2 px-4 py-1.5 max-md:py-1">
      {/* 三合大成仪式弹窗 */}
      <TriadCelebrationModal />

      {/* 五行道基专精罗盘 */}
      <SpecializationCompass />

      {/* 天象契合 · 引动三合横幅 */}
      {availableTriads.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-amber-400/70 bg-gradient-to-r from-amber-500/15 via-purple-500/15 to-indigo-500/15 p-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-900 flex items-center gap-1">
              <span>⚡</span>
              <span>天象契合 · 可引动三合大阵</span>
            </span>
            <span className="text-[10px] text-amber-800 bg-amber-100/90 px-1.5 py-0.5 rounded font-mono">
              神韵消解 · 槽位立刻腾空
            </span>
          </div>

          <div className="flex flex-col gap-1">
            {availableTriads.map((triad) => (
              <button
                key={triad.element}
                onClick={() => claimTriad(triad.element)}
                disabled={gameState !== 'player_action'}
                className={`w-full py-1.5 px-3 rounded shadow-xs flex items-center justify-between transition-all ${
                  gameState === 'player_action'
                    ? 'bg-gradient-to-r from-amber-600 via-amber-700 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-white font-bold text-xs active:scale-[0.99] cursor-pointer ring-1 ring-amber-400/40'
                    : 'bg-stone-300 text-stone-500 cursor-not-allowed text-xs'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-sm">🌟</span>
                  <span>引动【{triad.name}】({triad.triad.branches.join('·')})</span>
                </span>
                <span className="text-[10px] font-mono bg-black/20 px-2 py-0.5 rounded">
                  +{triad.bonus}修为 · 回满神识 · {triad.element}专精+25%
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 活跃丹田横带 */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold font-serif text-ink flex items-center gap-1.5">
            <span>活跃丹田</span>
            <span className="text-xs font-mono font-normal text-ink-light">
              {hand.filter((s) => s).length}/3
            </span>
            <span className="text-[10px] text-amber-800 bg-amber-100/90 px-1.5 py-0.5 rounded font-sans">
              明牌 · 每轮炼化
            </span>
          </h3>

          {selectedHandCard >= 0 && hand[selectedHandCard] && (
            <button
              onClick={() => moveToLeyline(selectedHandCard)}
              disabled={gameState !== 'player_action' || isLeylineSoftCapped || qi < 5}
              className={`text-[11px] px-2 py-0.5 rounded font-bold transition-all shadow-sm ${
                gameState === 'player_action' && !isLeylineSoftCapped && qi >= 5
                  ? 'bg-sky-600 text-white hover:bg-sky-700 active:scale-95'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
              title="下沉至潜伏地脉避风（消耗 5 点神识，推进 1 轮周天推演）"
            >
              下沉地脉 (-5神识)
            </button>
          )}
        </div>

        {!hasDantianCards ? (
          <div
            className="relative flex min-h-20 items-center justify-center text-center text-ink-light text-xs border border-dashed border-wood-light rounded-lg"
          >
            三丹田空置 · 纳灵公共灵气开始炼化
            {marginCallEvent?.detail?.marginCallDetails.length ? (
              <div
                className="pointer-events-none absolute inset-x-0 top-1/2 grid h-20 -translate-y-1/2 grid-cols-3 gap-1.5"
                aria-hidden="true"
              >
                {hand.map((_, index) => <span key={index} data-hand-card-slot={index} />)}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {hand.map((slot: HandSlot | null, i: number) => {
              if (flyingSlot === i) return <EmptySlot key={i} slotIndex={i} shattered={false} />;
              if (!slot) return <EmptySlot key={i} slotIndex={i} shattered={shatteredSlots.has(i)} />;
              const score = turnManager ? turnManager.getCardScore(slot.card, season) : slot.card.getSeasonScore(season);
              const sellPreview = selectedHandCard === i ? previewSellInfo(i) : null;
              const currentLeverage =
                slot.useLeverage
                  ? (turnManager ? turnManager.getLeverageMultiplier() : 1)
                  : 1;
              const settlementLeverage =
                slot.useLeverage
                  ? (turnManager ? turnManager.getNextLeverageNoSeasonChange() : 1)
                  : 1;
              const holdEarning = turnManager ? turnManager.previewHoldEarning(score, currentLeverage) : 0;
              const concentration = turnManager ? turnManager.getConcentrationInfo(slot.card) : undefined;
              const holdQiCost = turnManager ? turnManager.previewHoldQiCost(
                score,
                currentLeverage,
                slot.card.tianGanElement === Element.EARTH,
                concentration?.count ?? 0,
                turnManager.getConcentrationPremiumFactor(),
              ) : 0;

              return (
                <HandCard
                  key={i}
                  card={slot.card}
                  slotIndex={i}
                  score={score}
                  buyScore={slot.buyScore}
                  selected={selectedHandCard === i}
                  onClick={
                    gameState === 'player_action'
                      ? () => {
                          if (selectedHandCard !== i) selectHandCard(i);
                        }
                      : undefined
                  }
                  onOpenHistory={() => setHistoryCard(slot.card)}
                  leverage={currentLeverage}
                  settlementLeverage={settlementLeverage}
                  isLeverage={slot.useLeverage}
                  holdEarnings={slot.holdEarnings}
                  holdEarning={holdEarning}
                  holdQiCost={holdQiCost}
                  concentration={concentration}
                  sellPreview={sellPreview}
                  shattered={shatteredSlots.has(i)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* 潜伏地脉横带 */}
      <div className="flex flex-col gap-1 mt-1 pt-1.5 border-t border-wood-light/40">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold font-serif text-ink flex items-center gap-1.5">
            <span>潜伏地脉</span>
            <span className="text-xs font-mono font-normal text-ink-light">
              {leyline.filter((s) => s).length}/{maxLeyline}
            </span>
            <span className="text-[10px] text-sky-800 bg-sky-100/90 px-1.5 py-0.5 rounded font-sans">
              暗牌 · 0维持费 · 避巡视
            </span>
            {isLeylineSoftCapped && (
              <span className="text-[10px] text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded font-mono font-bold">
                ⚠️软超限拦截
              </span>
            )}
          </h3>

          {selectedLeylineCard >= 0 && leyline[selectedLeylineCard] && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => moveToDantian(selectedLeylineCard)}
                disabled={gameState !== 'player_action' || hand.filter(s => s !== null).length >= 3}
                className={`text-[11px] px-2 py-0.5 rounded font-bold transition-all shadow-sm ${
                  gameState === 'player_action' && hand.filter(s => s !== null).length < 3
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
                title="升腾入活跃丹田（0 耗神，推进 1 轮周天推演）"
              >
                升入丹田 (0神识)
              </button>
              <button
                onClick={() => sellLeyline(selectedLeylineCard)}
                disabled={gameState !== 'player_action'}
                className="text-[11px] px-2 py-0.5 rounded font-bold bg-qi-critical text-white hover:bg-red-600 active:scale-95 transition-all shadow-sm"
                title="在地脉直接释灵变现（按正统波段价差结算）"
              >
                释灵变现
              </button>
            </div>
          )}
        </div>

        {/* 地脉槽位渲染 */}
        <div className={`grid gap-1.5 ${maxLeyline >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {Array.from({ length: Math.max(maxLeyline, leyline.length) }).map((_, i) => {
            const slot = leyline[i] ?? null;
            if (!slot) {
              return <EmptyLeylineSlot key={i} index={i} />;
            }
            return (
              <LeylineCardView
                key={i}
                slot={slot}
                index={i}
                selected={selectedLeylineCard === i}
                season={season}
                turnManager={turnManager}
                onSelect={() => selectLeylineCard(i)}
                onOpenHistory={() => setHistoryCard(slot.card)}
                onMoveToDantian={() => moveToDantian(i)}
                onSell={() => sellLeyline(i)}
                canMoveToDantian={gameState === 'player_action' && hand.filter(s => s !== null).length < 3}
              />
            );
          })}
        </div>
      </div>

      {historyCard && turnManager && (
        <PublicCardHistoryModal
          card={historyCard}
          turnManager={turnManager}
          roundLog={turnManager.getRoundLog()}
          onClose={() => setHistoryCard(null)}
        />
      )}
    </div>
  );
}

function EmptySlot({ slotIndex, shattered = false }: { slotIndex: number; shattered?: boolean }) {
  return (
    <div
      data-hand-card-slot={slotIndex}
      className={`flex items-center justify-center rounded-lg border-2 border-dashed border-wood-light bg-white/50 h-24 ${
        shattered ? 'mc-shatter-slot' : 'slot-breathe'
      }`}
    >
      <span className="text-xs text-wood-light">{shattered ? '崩坏' : '丹田空位'}</span>
    </div>
  );
}

function EmptyLeylineSlot({ index }: { index: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-sky-800/30 bg-sky-950/5 h-20 text-center"
    >
      <span className="text-xs text-sky-800 font-medium">地脉 {index + 1} (空)</span>
      <span className="text-[9px] text-slate-500">潜伏冷库 · 避风避灾</span>
    </div>
  );
}

function LeylineCardView({
  slot,
  index,
  selected,
  season,
  turnManager,
  onSelect,
  onOpenHistory,
  onMoveToDantian,
  onSell,
  canMoveToDantian,
}: {
  slot: HandSlot;
  index: number;
  selected: boolean;
  season: string;
  turnManager: any;
  onSelect: () => void;
  onOpenHistory: () => void;
  onMoveToDantian: () => void;
  onSell: () => void;
  canMoveToDantian: boolean;
}) {
  const curScore = turnManager ? turnManager.getCardScore(slot.card, season) : slot.card.getSeasonScore(season);
  const buyScore = slot.buyScore;
  const delta = curScore - buyScore;

  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-lg border p-2 flex flex-col justify-between transition-all duration-150 ${
        selected
          ? 'border-sky-500 bg-sky-950/30 shadow-md ring-2 ring-sky-400'
          : 'border-slate-300 bg-slate-50 hover:border-slate-400'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-slate-900">{slot.card.name}</span>
          <span className="text-[9px] px-1 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">
            {slot.card.mainElement}
          </span>
        </div>
        <span className={`text-[10px] font-mono font-bold ${curScore >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
          {curScore >= 0 ? '+' : ''}{curScore}分
        </span>
      </div>

      <div className="flex items-center justify-between text-[10px] my-1 text-slate-600">
        <span>买入: {buyScore}</span>
        <span className={`font-mono font-bold ${delta >= 0 ? 'text-amber-700' : 'text-rose-700'}`}>
          Δ{delta >= 0 ? '+' : ''}{delta} (暗存)
        </span>
      </div>

      <div className="text-[9px] text-sky-800">
        暗牌深锁 · 0维持费 · 避巡视
      </div>
    </div>
  );
}
