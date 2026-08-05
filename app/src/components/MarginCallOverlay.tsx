import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import type { SettlementDetail } from '@core/index';

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${value}`;
}

/**
 * 反噬独立全屏动画（z-80，盖过回合幕布 z-70）。
 * 信息优先 3 层（2026-08-05 反噬流程重设计 §8）：一次红闪 + "反噬"印章 + 被反噬卡大卡片。
 * 去掉脉冲/屏幕震动/副标题长文案——装饰不再淹没信息。
 * 每张被反噬卡：卡名大字（衬线）+ 评分/杠杆小字 + 罚分特大数字（penaltyScore 结构化字段，不解析 reason）。
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

  return (
    <div key={animKey} className="absolute inset-0 z-[80] pointer-events-none overflow-hidden" aria-hidden>
      {/* 全屏红色闪光（一次，最快最刺眼） */}
      <div className="mc-flash absolute inset-0 bg-qi-critical" />

      {/* 中央：反噬印章 + 被反噬卡大卡片 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="mc-stamp inline-block px-9 py-4 bg-qi-critical text-white rounded-xl shadow-[0_10px_40px_rgba(229,57,53,0.6)] border-2 border-red-200/60">
            <span className="text-4xl font-bold font-serif tracking-[0.25em]">反噬</span>
          </div>

          <div className="mt-4 space-y-2.5 max-w-[300px] mx-auto">
            {detail.marginCallDetails.map((d, i) => (
              <div
                key={i}
                className="mc-card flex items-center justify-between gap-3 bg-white/95 border border-red-300 rounded-xl px-4 py-3 shadow-lg"
                style={{ animationDelay: `${0.5 + i * 0.18}s` }}
              >
                {/* 左：卡名 + 状态 */}
                <div className="text-left min-w-0">
                  <div className="text-xl font-bold font-serif text-red-800 leading-tight">{d.cardName}</div>
                  <div className="text-[11px] text-red-400 font-medium mt-0.5">
                    评分 {signed(d.cardScore)} · 燃灵 {d.leverage.toFixed(1)}x
                  </div>
                </div>
                {/* 右：罚分特大数字（tabular 数字用无衬线，与中文衬线区分但不混用同一串） */}
                <div className="text-right shrink-0">
                  <div className="text-[26px] leading-none font-bold text-qi-critical tabular-nums">
                    {d.penaltyScore > 0 ? '-' : ''}{d.penaltyScore}
                  </div>
                  <div className="text-[11px] text-red-400 font-medium mt-0.5">修为</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
