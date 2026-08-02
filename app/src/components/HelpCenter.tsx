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
          <HelpSection title="目标与回合">单局共 60 回合，春夏秋冬会随机换季。每回合结束后结算持仓，再恢复气；总分越高越好。</HelpSection>
          <HelpSection title="一回合怎么做">先选公共牌，再选择买入、卖出或等待。买入会持有并每回合结算；卖出结算买入与当前评分的差价；等待不交易，但下回合额外回气。</HelpSection>
          <HelpSection title="怎么看卡牌">卡名中天干、地支的颜色代表各自五行。卡面评分显示“当季 → 下一季”；评分越高，持仓收益越高，同时气耗也越高。</HelpSection>
          <HelpSection title="杠杆与气">开启杠杆买入后，倍率按当季回合逐档提高，换季重置为 1.0×；倍率同时放大收益和持仓气耗。气归零时，杠杆仓位可能被强制卖出。</HelpSection>
        </div>
      </div>
    </div>
  );
}

function HelpSection({ title, children }: { title: string; children: string }) {
  return (
    <section>
      <h3 className="mb-0.5 font-bold text-ink">{title}</h3>
      <p>{children}</p>
    </section>
  );
}
