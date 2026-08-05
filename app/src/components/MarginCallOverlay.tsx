import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import type { SettlementDetail } from '@core/index';

/**
 * 反噬独立全屏动画（z-80，盖过回合幕布 z-70）。
 * 反噬发生时独占视觉焦点：全屏红闪 + 脉冲 + "反噬"印章大字 + 被反噬灵气逐条滑入。
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
      {/* 红色警报脉冲（两次呼吸，持续施压） */}
      <div className="mc-pulse absolute inset-0 bg-qi-critical" />

      {/* 中央爆仓印章 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="mc-stamp inline-block px-9 py-4 bg-qi-critical text-white rounded-xl shadow-[0_10px_40px_rgba(229,57,53,0.6)] border-2 border-red-200/60">
            <span className="text-4xl font-bold font-serif tracking-[0.25em]">反噬</span>
          </div>

          <div className="mc-sub mt-4 text-sm font-bold text-red-700 tracking-widest">
            心神耗尽 · 燃灵灵气失控反噬
          </div>

          {/* 被强平卡名单，逐条滑入 */}
          <div className="mt-3 space-y-1.5 max-w-[260px] mx-auto">
            {detail.marginCallDetails.map((d, i) => (
              <div
                key={i}
                className="mc-card flex items-center justify-between gap-2 bg-white/90 border border-red-300 rounded-lg px-3 py-1.5 text-sm font-bold text-red-700 shadow-md"
                style={{ animationDelay: `${0.5 + i * 0.18}s` }}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-red-400 text-xs">💥</span>
                  {d.cardName}
                </span>
                <span className="text-[11px] text-red-400 font-medium truncate max-w-[130px]">
                  {d.reason}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
