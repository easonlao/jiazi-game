import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import type { SettlementDetail } from '@core/index';

/**
 * 反噬独立全屏动画（z-80，盖过回合幕布 z-70）。
 *
 * 2026-08-05 重构（用户反馈"画面太繁杂，看不清哪张卡被反噬、罚多少"）：
 * - 精简为 3 层：一次红闪 + "反噬"印章 + 被反噬卡大卡片
 * - 去掉：红色脉冲、屏幕震动、副标题长文案（信息被装饰淹没）
 * - 被反噬卡改大卡片：卡名大字 + 评分/杠杆小字 + 惩罚特大数字（penaltyScore 结构化字段）
 * - 每张被反噬的牌独立卡片，不截断，一眼看清"哪张牌、罚多少"
 * 约 2.3s 后撤去，露出其下已就位的结算弹窗明细。
 */
export function MarginCallOverlay() {
  const marginCallEvent = useGameStore((s) => s.marginCallEvent);
  const [visible, setVisible] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const lastId = useRef(0);

  useEffect(() => {
    if (marginCallEvent && marginCallEvent.id !== lastId.current) {
      lastId.current = marginCallEvent.id;
      setDetail(marginCallEvent.detail);
      setAnimKey((k) => k + 1);
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 2350);
      return () => clearTimeout(t);
    }
  }, [marginCallEvent]);

  if (!visible || !detail) return null;

  const items = detail.marginCallDetails ?? [];

  return (
    <div key={animKey} className="absolute inset-0 z-[80] pointer-events-none overflow-hidden" aria-hidden>
      {/* 全屏红色闪光（一次，最快最刺眼） */}
      <div className="mc-flash absolute inset-0 bg-qi-critical" />

      {/* 中央：印章 + 被反噬卡大卡片 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center px-5 w-full max-w-[340px]">
          <div className="mc-stamp inline-block px-8 py-3 bg-qi-critical text-white rounded-xl border-2 border-red-200/60">
            <span className="text-3xl font-bold font-serif tracking-[0.25em]">反噬</span>
          </div>

          {/* 被反噬卡大卡片：卡名大字 + 评分/杠杆 + 惩罚特大数字 */}
          <div className="mt-4 space-y-2">
            {items.map((d, i) => (
              <div
                key={i}
                className="mc-card rounded-xl bg-white/95 border border-red-300 px-4 py-3 text-left shadow-md"
                style={{ animationDelay: `${0.4 + i * 0.15}s` }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xl font-bold font-serif text-red-700">{d.cardName}</span>
                  <span className="text-[11px] text-red-500/80 shrink-0">
                    评分 {d.cardScore > 0 ? '+' : ''}{d.cardScore} · 燃灵 {d.leverage.toFixed(1)}x
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-[28px] font-bold leading-none text-qi-critical tabular-nums">
                    {d.penaltyScore > 0 ? '-' : ''}{d.penaltyScore}
                  </span>
                  <span className="text-xs text-red-600 font-medium">修为</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
