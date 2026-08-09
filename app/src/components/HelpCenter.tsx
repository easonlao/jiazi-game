export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-md border border-wood-mid px-2 py-1 text-[11px] font-bold text-wood-dark hover:bg-wood-light/20 focus:outline-none focus:ring-2 focus:ring-gold/60"
      aria-label="打开帮助"
    >
      帮助
    </button>
  );
}

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="modal-backdrop absolute inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-4">
      <div className="flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-xl bg-parchment shadow-2xl">
        <div className="flex items-center justify-between bg-ink px-4 py-3 text-parchment">
          <h2 className="font-serif text-base font-bold">玩法帮助</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs opacity-80 hover:bg-white/10 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-gold/60"
            aria-label="关闭帮助"
          >
            关闭
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-3 text-xs leading-relaxed text-ink-light">
          <HelpSection title="甲子与天时">一局便是一甲子（60 回合），春夏秋冬四季天时流转。每回合结束，丹田中的灵气结算炼化，再回复神识；修为越高越好。</HelpSection>
          <HelpSection title="一回合怎么做">先看周遭浮现的灵气（公共牌），再选择纳灵、释灵或调息。纳灵将灵气收入丹田炼化；释灵按当前评分与纳灵时的差价结算修为；调息不纳灵不释灵，但下回合额外回神。</HelpSection>
          <HelpSection title="怎么看灵气">灵气名中天干、地支的颜色代表各自五行。普通模式卡面显示“当季 → 下一季”评分；波动模式只显示已含短期波动的当前评分，并用“↑/↓/—”标记当期方向，换季后会重新计算。</HelpSection>
          <HelpSection title="燃灵与神识">纳灵时开启燃灵（杠杆），倍率按当季天时逐档提高，换季重置为 1.0×；倍率同时放大炼化收益和耗神。神识归零时，燃灵的灵气可能失控反噬（强平）。</HelpSection>
          <HelpSection title="颜色怎么看">
            神识消耗（纳灵、炼化耗神）统一用<span className="mx-0.5 font-bold text-sky-600">水蓝</span>；修为收益用红绿表示——<span className="mx-0.5 font-bold text-qi-full">绿色</span>为正、<span className="mx-0.5 font-bold text-qi-critical">红色</span>为负。土牌四季稳定，不随天时起伏。
          </HelpSection>
        </div>
      </div>
    </div>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-0.5 font-bold text-ink">{title}</h3>
      <p>{children}</p>
    </section>
  );
}
