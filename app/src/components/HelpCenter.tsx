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

        <div className="space-y-2 overflow-y-auto px-4 py-3 text-xs leading-relaxed text-ink-light">
          <HelpSection title="一局怎么玩" defaultOpen>
            <p>一局共 60 回合，经历春、夏、秋、冬四季。你的目标是在神识有限的情况下，让最终修为尽可能高。</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>观察周遭灵气，比较卡牌当前的评分和变化。</li>
              <li>选择纳灵、释灵或调息，确认后结束本回合。</li>
              <li>回合结束时，丹田中的卡牌结算炼化收益，并回复神识。</li>
            </ol>
          </HelpSection>

          <HelpSection title="每回合怎么选">
            <div className="space-y-2">
              <HelpTerm title="纳灵">将公共牌收入丹田。纳灵会消耗神识，之后可以继续持有它获取炼化收益。</HelpTerm>
              <HelpTerm title="释灵">将丹田中的卡牌释放。系统会比较纳灵时的评分和当前评分，当前更高则获得修为，当前更低则可能损失修为。</HelpTerm>
              <HelpTerm title="调息">本回合不纳灵也不释灵，换取下回合额外回神，适合恢复神识或等待变化。</HelpTerm>
              <HelpTerm title="燃灵">纳灵时可以开启燃灵。它会放大炼化收益，也会放大神识消耗和失控风险。</HelpTerm>
            </div>
          </HelpSection>

          <HelpSection title="怎么看卡牌">
            <div className="space-y-2">
              <p>卡牌名字中的天干、地支各有五行属性。四季会改变不同卡牌的评分，同一张牌在不同季节可能有高低变化。</p>
              <p><span className="font-bold text-ink">公共牌</span>显示现在纳灵时能得到的评分；旁边的变化数值表示近期评分变化的方向和幅度，不是下一季的确定结果。</p>
              <p><span className="font-bold text-ink">丹田手牌</span>显示“纳灵评分 → 当前评分”。左边是纳灵时记下的评分，右边是现在的评分，两者的差距会影响释灵结果。</p>
              <p>换季时卡牌会重新适应新的天时，评分可能出现明显变化；季节之内也会有短期变化，需要根据当下信息判断。</p>
            </div>
          </HelpSection>

          <HelpSection title="持有还是释灵">
            <div className="space-y-2">
              <p><span className="font-bold text-ink">持有</span>适合看好当前评分，或希望让卡牌继续产生炼化收益。持有时间越长，越要留意神识是否够用。</p>
              <p><span className="font-bold text-ink">主动释灵（释灵）</span>适合在当前评分比纳灵时更好时落袋为安，也可以在评分转弱前及时止损。它结算的是“纳灵时到现在的变化”，不是卡牌的固定卖出价格；燃灵会进一步放大这次变化带来的收益或损失。</p>
              <p>例如：纳灵时评分为 +10，现在变成 +18，主动释灵通常会带来正收益；如果现在变成 +5，则可能产生负收益。最终数字以行动前的结算预览为准。</p>
              <p>卡牌名字的颜色表示五行属性；卡面下方炼化和结算数字的绿色表示收益、红色表示损失。</p>
            </div>
          </HelpSection>

          <HelpSection title="燃灵与失控风险">
            <div className="space-y-2">
              <p>燃灵倍率会随着季内回合逐步提高，最高可到 3.5×；换季后回到 1.0×。倍率越高，炼化收益和神识压力越大。</p>
              <p>神识不足时，燃灵可能引发失控反噬并强制结束一部分持仓。高收益也意味着更高风险，不要只看倍率。</p>
              <p>土牌受四季影响较小，更适合作为稳定的持有选择；但燃灵仍会增加它的神识消耗。</p>
            </div>
          </HelpSection>

          <HelpSection title="名词解释">
            <div className="space-y-2">
              <HelpTerm title="神识">进行纳灵、持有和燃灵所需的资源。归零时可能触发失控。</HelpTerm>
              <HelpTerm title="修为">本局最终得分，越高越好。</HelpTerm>
              <HelpTerm title="当前评分">卡牌在当前季节、当前状态下的评分，决定现在持有和主动释灵时的收益。</HelpTerm>
              <HelpTerm title="纳灵评分">卡牌进入丹田那一刻记录的评分，是之后释灵比较变化的起点。</HelpTerm>
              <HelpTerm title="炼化">持有丹田卡牌到回合结束时获得的收益。</HelpTerm>
              <HelpTerm title="主动释灵">释放丹田中的卡牌，按当前评分相对纳灵评分的变化结算修为。</HelpTerm>
              <HelpTerm title="强平">燃灵失控后的保护机制，会强制结束持仓并扣除修为。</HelpTerm>
            </div>
          </HelpSection>
        </div>
      </div>
    </div>
  );
}

function HelpSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-lg border border-wood-mid/60 bg-white/20 px-3 py-2">
      <summary className="cursor-pointer list-none pr-4 font-bold text-ink marker:hidden">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function HelpTerm({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="font-bold text-ink">{title}：</span>
      {children}
    </p>
  );
}
