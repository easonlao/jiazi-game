import { useGameStore } from '../store';
import { PublicCard } from './PublicCard';
import { HelpButton } from './HelpCenter';
import type { JiaziCard } from '@core/JiaziCard';

export function PublicCards({ onHelp }: { onHelp: () => void }) {
  const publicCards = useGameStore((s) => s.publicCards);
  const selectedPublicCard = useGameStore((s) => s.selectedPublicCard);
  const selectPublicCard = useGameStore((s) => s.selectPublicCard);
  const gameState = useGameStore((s) => s.gameState);
  const turnManager = useGameStore((s) => s.turnManager);
  const lockedCardIds = useGameStore((s) => s.lockedCardIds);
  const toggleLockCard = useGameStore((s) => s.toggleLockCard);
  // 空亡触发动画期间：空亡牌展示在真实公共牌池的该槽位（与真实公共牌并列），
  // 让玩家看到「空亡是一张从公共牌池现出的牌」（2026-08-14 用户反馈 v3）。
  const voidPoolSlot = useGameStore((s) => s.voidPoolSlot);

  if (gameState === 'init') {
    return (
      <div className="px-4 py-8 text-center text-ink-light text-sm">
        正在加载牌库...
      </div>
    );
  }

  if (publicCards.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-ink-light text-sm">
        周遭暂无灵气浮现
      </div>
    );
  }

  // 空亡牌占槽位时，牌池显示 = 空亡牌 + 其余真实公共牌（引擎 publicCards 取满 3 张槽位；
  // 若槽位越界则忽略空亡牌，回退纯真实牌池）。
  const slot = voidPoolSlot !== null && voidPoolSlot >= 0 && voidPoolSlot < 3 ? voidPoolSlot : null;
  const poolCards: (JiaziCard | 'void')[] = slot === null
    ? publicCards
    : publicCards.map((card, i) => (i === slot ? 'void' as const : card));

  return (
    <div className="flex flex-col gap-1 px-4 py-1.5 max-md:py-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold font-serif text-ink">周遭灵气</h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-light">
            {gameState === 'player_action' ? '选灵气后操作' : gameState === 'void_round' ? '空亡吞噬中...' : '天时流转中...'}
          </span>
          <HelpButton onClick={onHelp} />
        </div>
      </div>
      {/* 当季提示 */}
      <SeasonHint
        season={useGameStore((s) => s.season)}
        volatilityActive={turnManager?.getScoreVolatilityState() !== null}
      />
      <div className="grid grid-cols-3 gap-1.5">
        {poolCards
          // 2026-08-07 防「影子牌」：同一种牌只渲染一张（重复 id 是底层残留/异常，
          // 直接渲染会出现无法选中操作的幽灵卡——用户实测公共区 4 张、5 张且有重复乙卯）。
          // key 用「位置-名字」复合，避免 React 同 id 冲突导致重复卡渲染异常。
          .filter((card, i, arr) => card === 'void' || arr.findIndex((c) => c !== 'void' && c.id === card.id) === i)
          .map((card: JiaziCard | 'void', i: number) => {
          if (card === 'void') {
            // 空亡牌：不可买入、不可锁定的纯事件牌（动画阶段由覆盖层负责吞噬特效）
            return (
              <div key="void-slot" data-public-card-index={i} data-void-slot className="min-w-0">
                <VoidPoolCard />
              </div>
            );
          }
          // 需要从 store 实时读 cost（因为 useLeverage 可能变了）
          return (
            <div key={`${i}-${card.id}`} data-public-card-index={i} className="min-w-0">
              <PublicCardItem
                card={card}
                index={i}
                selected={selectedPublicCard === i}
                onSelect={() => selectPublicCard(i)}
                disabled={gameState !== 'player_action'}
                locked={lockedCardIds.includes(card.id)}
                onToggleLock={gameState === 'player_action' ? () => toggleLockCard(i) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 空亡牌（纯事件牌）在公共牌池中的卡面。
 * 与真实公共牌同骨架同尺寸（顶部干支行 + 评分区 + 三行信息），用浅紫灰虚空配色
 * 区分——玩家看到「空亡是一张与其他牌并列的牌」，而非形状突兀的异块（2026-08-14 反馈）。
 * 内容去重（v3.1 反馈）：牌名「空亡」不重复标签；评分区与真实牌平行显示「当前评分 ——」；
 * 底部三行为不重复的机制描述（触发/吞噬/交易）。
 * 吞噬阶段（voidSwallowing）自身播放溶解动画，并从牌位中心扩散吞噬环（环定位在
 * 牌自身容器内，天然与真实牌对齐）。
 */
function VoidPoolCard() {
  const swallowing = useGameStore((s) => s.voidSwallowing);
  return (
    <div className={`card-in relative overflow-hidden rounded-lg border-2 border-violet-300 bg-violet-50/70 select-none min-w-0 ${swallowing ? 'void-swallow-card' : 'void-slot-drop'}`}>
      {/* 顶部：牌名（虚空紫） + ☰ 徽章（纯符号，不与牌名重复文字；位置与真实牌阴阳徽章一致） */}
      <div className="flex items-center justify-between gap-1 px-2 pt-1.5 pb-0.5">
        <span className="text-base max-md:text-[15px] leading-none font-bold truncate min-w-0 text-violet-900">空亡</span>
        <span className="text-[10px] max-md:text-[9px] px-1.5 py-0.5 rounded font-bold bg-violet-200 text-violet-800" title="空亡 · 纯事件牌">
          ☰
        </span>
      </div>

      {/* 评分区：与真实牌完全平行（同高：label 上行 + 数值下行），空亡无评分显示 —— */}
      <div className="flex items-end justify-between gap-1 border-y border-violet-200/70 bg-violet-50/60 px-2 py-1.5 max-md:py-1">
        <div className="min-w-0 flex-1">
          <span className="block text-[10px] max-md:text-[9px] leading-tight text-violet-400">当前评分</span>
          <span className="block text-[14px] max-md:text-[13px] leading-tight font-bold tabular-nums whitespace-nowrap text-violet-700">
            ——
          </span>
        </div>
      </div>

      {/* 三行信息：与真实牌（耗神/炼化/炼耗）同结构同高度；内容去重，每行一个机制点 */}
      <div className="divide-y divide-violet-100/60 text-[11px] max-md:text-[10px]">
        <div className="flex items-center justify-between gap-1 px-2 py-1 max-md:py-0.5">
          <span className="text-[9px] text-violet-400 shrink-0">触发</span>
          <span className="font-bold whitespace-nowrap text-violet-600">抽入即现</span>
        </div>
        <div className="flex items-center justify-between gap-1 px-2 py-1 max-md:py-0.5">
          <span className="text-[9px] text-violet-400 shrink-0">吞噬</span>
          <span className="font-bold whitespace-nowrap text-violet-600">时令流逝</span>
        </div>
        <div className="flex items-center justify-between gap-1 px-2 py-1 max-md:py-0.5">
          <span className="text-[9px] text-violet-400 shrink-0">交易</span>
          <span className="font-bold whitespace-nowrap text-violet-600">不可买入</span>
        </div>
      </div>

      {/* 吞噬阶段：暗色环从牌位中心向外扩散（0.7s，定位在牌自身容器内） */}
      {swallowing && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden>
          <div className="void-swallow-ring absolute left-1/2 top-1/2 h-36 w-36 rounded-full border-2 border-violet-400/60 bg-slate-800/30" />
          <div
            className="void-swallow-ring absolute left-1/2 top-1/2 h-[11rem] w-[11rem] rounded-full border border-violet-300/40 bg-slate-900/25"
            style={{ animationDelay: '0.18s' }}
          />
          <div
            className="void-swallow-ring absolute left-1/2 top-1/2 h-[14rem] w-[14rem] rounded-full bg-slate-950/50"
            style={{ animationDelay: '0.36s' }}
          />
        </div>
      )}
    </div>
  );
}

function PublicCardItem({
  card,
  index,
  selected,
  onSelect,
  disabled,
  locked,
  onToggleLock,
}: {
  card: JiaziCard;
  index: number;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
  locked: boolean;
  onToggleLock?: () => void;
}) {
  const previewBuyCost = useGameStore((s) => s.previewBuyCost);
  const previewHoldEarning = useGameStore((s) => s.previewHoldEarning);
  const previewHoldQiCost = useGameStore((s) => s.previewHoldQiCost);
  const useLeverage = useGameStore((s) => s.useLeverage);
  const qi = useGameStore((s) => s.qi);
  const season = useGameStore((s) => s.season);
  const turnManager = useGameStore((s) => s.turnManager);
  const score = turnManager ? turnManager.getCardScore(card, season) : card.getSeasonScore(season);
  const nextScore = turnManager ? turnManager.getCardScore(card, turnManager.getFollowingSeason()) : score;

  const cost = previewBuyCost(index);
  const canAfford = cost <= qi;
  const holdEarning = previewHoldEarning(index);
  const holdQiCost = previewHoldQiCost(index);
  const volatilityDelta = turnManager?.getCardVolatilityDelta(card) ?? undefined;

  return (
    <PublicCard
      card={card}
      score={score}
      nextScore={nextScore}
      selected={selected}
      onClick={disabled ? undefined : onSelect}
      buyCost={cost}
      canAfford={canAfford}
      holdEarning={holdEarning}
      holdQiCost={holdQiCost}
      volatilityDelta={volatilityDelta}
      locked={locked}
      onToggleLock={onToggleLock}
    />
  );
}

/** 当季元素提示：告诉玩家当前季节哪种元素的牌评分最高 */
function SeasonHint({ season, volatilityActive }: { season: string; volatilityActive: boolean }) {
  const map: Record<string, { element: string; cls: string; text: string }> = {
    spring: { element: '木', cls: 'text-emerald-700', text: '当前是春季，木牌评分最高' },
    summer: { element: '火', cls: 'text-red-600', text: '当前是夏季，火牌评分最高' },
    autumn: { element: '金', cls: 'text-slate-600', text: '当前是秋季，金牌评分最高' },
    winter: { element: '水', cls: 'text-sky-600', text: '当前是冬季，水牌评分最高' },
  };
  const info = map[season];
  if (!info) return null;
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1">
      <div className={`text-xs font-medium ${info.cls} bg-white/60 border border-wood-light rounded px-2 py-1`}>
        {info.text} · 土牌四季稳定
      </div>
      {volatilityActive && (
        <span
          data-volatility-experiment
          className="rounded border border-wood-light/70 bg-white/60 px-1.5 py-1 text-[10px] text-ink-light"
        >
          短期波动 · 括号内为相对基础评分变化，换季重算
        </span>
      )}
    </div>
  );
}
