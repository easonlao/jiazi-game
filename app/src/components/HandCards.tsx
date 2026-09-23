import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import { HandCard } from './HandCard';
import { CardVisual } from './CardVisual';
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
    <div className="flex flex-col gap-1 px-3 py-1">
      {/* 三合大成仪式弹窗 */}
      <TriadCelebrationModal />

      {/* 五行道基专精罗盘 */}
      <SpecializationCompass />

      {/* 天象契合 · 引动三合横幅 */}
      {availableTriads.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-gold/60 bg-gold/10 p-1.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-serif text-amber-900 flex items-center gap-1">
              <span>⚡</span>
              <span>天象契合 · 可引动三合大阵</span>
            </span>
            <span className="text-[10px] text-wood-dark font-serif">
              神韵圆融 · 槽位立刻腾空
            </span>
          </div>

          <div className="flex flex-col gap-1">
            {availableTriads.map((triad) => (
              <button
                key={triad.element}
                onClick={() => claimTriad(triad.element)}
                disabled={gameState !== 'player_action'}
                className={`w-full py-1 px-2.5 rounded shadow-2xs flex items-center justify-between transition-all ${
                  gameState === 'player_action'
                    ? 'bg-[#8b261e] hover:bg-[#a12e25] text-parchment font-serif font-bold text-xs active:scale-[0.99] cursor-pointer border border-gold/40'
                    : 'bg-stone-300 text-stone-500 cursor-not-allowed text-xs'
                }`}
              >
                <span className="flex items-center gap-1">
                  <span className="text-xs">🌟</span>
                  <span>引动【{triad.name}】({triad.triad.branches.join('·')})</span>
                </span>
                <span className="text-[9px] font-mono font-bold bg-black/25 px-1.5 py-0.5 rounded">
                  +{triad.bonus}修为 · 回满神识 · {triad.element}+25%
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 活跃丹田横带 */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold font-serif text-ink flex items-center gap-1">
            <span>活跃丹田</span>
            <span className="text-[11px] font-mono font-normal text-ink-light">
              {hand.filter((s) => s).length}/3
            </span>
            <span className="text-[9px] text-wood-dark bg-gold/15 border border-gold/30 px-1.5 py-0.2 rounded font-serif">
              明牌 · 每轮炼化
            </span>
          </h3>

          {selectedHandCard >= 0 && hand[selectedHandCard] && (
            <button
              onClick={() => moveToLeyline(selectedHandCard)}
              disabled={gameState !== 'player_action' || isLeylineSoftCapped || qi < 5}
              className={`text-[10px] px-2 py-0.5 rounded font-serif font-bold transition-all shadow-2xs ${
                gameState === 'player_action' && !isLeylineSoftCapped && qi >= 5
                  ? 'bg-wood-dark text-parchment hover:bg-wood-mid active:scale-95 cursor-pointer'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
              title="下沉至潜伏地脉避灾（消耗 5 点神识，推进 1 轮周天推演）"
            >
              下沉地脉 (-5神识)
            </button>
          )}
        </div>

        {!hasDantianCards ? (
          <div
            className="relative flex h-14 items-center justify-center text-center text-ink-light text-xs border border-dashed border-wood-light rounded-lg"
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
      <div className="flex flex-col gap-0.5 mt-0.5 pt-1 border-t border-wood-light/40">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold font-serif text-ink flex items-center gap-1">
            <span>潜伏地脉</span>
            <span className="text-[11px] font-mono font-normal text-ink-light">
              {leyline.filter((s) => s).length}/{maxLeyline}
            </span>
            <span className="text-[9px] text-wood-dark bg-wood-light/25 border border-wood-light/60 px-1.5 py-0.2 rounded font-serif">
              潜伏暗牌 · 辟巡视
            </span>
            {leyline.filter((s) => s).length > maxLeyline ? (
              <span
                className="text-[9px] text-rose-800 bg-rose-100/90 border border-rose-300 px-1 py-0.2 rounded font-mono font-bold animate-pulse"
                data-testid="leyline-overflow-badge"
              >
                ⚠️超限 ({leyline.filter((s) => s).length}/{maxLeyline})
              </span>
            ) : isLeylineSoftCapped ? (
              <span
                className="text-[9px] text-amber-800 bg-amber-100/90 border border-amber-300 px-1 py-0.2 rounded font-mono font-bold"
                data-testid="leyline-full-badge"
              >
                ⚠️满仓 ({maxLeyline}/{maxLeyline})
              </span>
            ) : null}
          </h3>

          {selectedLeylineCard >= 0 && leyline[selectedLeylineCard] && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => moveToDantian(selectedLeylineCard)}
                disabled={gameState !== 'player_action' || hand.filter(s => s !== null).length >= 3}
                className={`text-[10px] px-2 py-0.5 rounded font-serif font-bold transition-all shadow-2xs ${
                  gameState === 'player_action' && hand.filter(s => s !== null).length < 3
                    ? 'bg-[#2d5a3f] text-parchment hover:bg-[#386d4d] active:scale-95 cursor-pointer'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
                title="升腾入活跃丹田（推进 1 轮周天推演）"
              >
                升入丹田
              </button>
              <button
                onClick={() => sellLeyline(selectedLeylineCard)}
                disabled={gameState !== 'player_action'}
                className="text-[10px] px-2 py-0.5 rounded font-serif font-bold bg-[#8b261e] text-parchment hover:bg-[#a12e25] active:scale-95 transition-all shadow-2xs cursor-pointer"
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
      className={`flex items-center justify-center rounded-lg border-2 border-dashed border-wood-light bg-white/50 h-16 ${
        shattered ? 'mc-shatter-slot' : 'slot-breathe'
      }`}
    >
      <span className="text-xs text-wood-light font-serif">{shattered ? '崩坏' : '丹田空位'}</span>
    </div>
  );
}

function EmptyLeylineSlot({ index }: { index: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-wood-light/70 bg-white/40 h-16 text-center select-none"
    >
      <span className="text-xs text-wood-mid font-serif">地脉空位</span>
      <span className="text-[9px] text-wood-light font-serif">潜脉暗存 · 避灾</span>
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
    <div data-leyline-card-slot={index} className="rounded-lg">
      <CardVisual
        card={slot.card}
        score={curScore}
        scoreMode="position"
        buyScore={buyScore}
        selected={selected}
        onClick={onSelect}
        badges={
          <span
            className="text-[9px] px-1 py-0.2 rounded font-serif bg-wood-mid/20 text-wood-dark border border-wood-mid/40"
            title="潜伏地脉暗牌：不消耗神识维持费，避除古宗巡检"
          >
            地脉
          </span>
        }
      >
        {/* 底部单行：仅展示释灵浮动真元与修为，无无谓的运转耗费显示 */}
        <div className="flex items-center justify-between gap-1 px-2 py-0.5 text-[11px] max-md:text-[10px]">
          <span className="text-[9px] text-ink-light font-serif shrink-0">浮动真元</span>
          <span className={`font-bold font-mono tabular-nums whitespace-nowrap ${delta >= 0 ? 'text-qi-full' : 'text-qi-critical'}`}>
            {delta >= 0 ? '+' : ''}{delta.toFixed(1)} <span className="font-serif font-normal text-[9px] text-wood-dark">({delta >= 0 ? '+' : ''}{Math.round(delta * 6)}修为)</span>
          </span>
        </div>
      </CardVisual>
    </div>
  );
}
