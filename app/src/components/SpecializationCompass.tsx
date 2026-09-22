import { useGameStore } from '../store';
import { Element } from '@core/JiaziCard';

interface ElementMeta {
  key: string;
  name: string;
  char: string;
  color: string;
  bg: string;
  border: string;
  text: string;
}

const ELEMENT_METAS: ElementMeta[] = [
  { key: Element.WOOD, name: '木', char: '木', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-800' },
  { key: Element.FIRE, name: '火', char: '火', color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-800' },
  { key: Element.EARTH, name: '土', char: '土', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800' },
  { key: Element.METAL, name: '金', char: '金', color: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-800' },
  { key: Element.WATER, name: '水', char: '水', color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-300', text: 'text-sky-800' },
];

export function SpecializationCompass() {
  const elemMultipliers = useGameStore((s) => s.elemMultipliers);
  const triadCounts = useGameStore((s) => s.triadCounts);
  const grandCycles = useGameStore((s) => s.grandCycles);

  const hasAnyBoost = Object.values(elemMultipliers).some((m) => m > 1.0) || grandCycles > 0;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-wood-light/40 bg-white/60 px-2.5 py-1.5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold font-serif text-ink flex items-center gap-1">
            <span className="text-amber-600">☯</span>
            <span>五行道基专精</span>
          </span>
          <span className="text-[10px] text-ink-light">
            {hasAnyBoost ? '炼化与释灵正向增幅' : '暂无增益 (引动三合成就专精)'}
          </span>
        </div>

        {grandCycles > 0 && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gradient-to-r from-amber-500/20 to-purple-500/20 border border-amber-400/50 shadow-xs animate-pulse">
            <span className="text-[10px]">🎆</span>
            <span className="text-[10px] font-bold text-amber-900">
              混元大圆满 ×{grandCycles}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-5 gap-1 pt-0.5">
        {ELEMENT_METAS.map((meta) => {
          const mult = elemMultipliers[meta.key] ?? 1.0;
          const count = triadCounts[meta.key] ?? 0;
          const isBoosted = mult > 1.0;
          const pct = Math.round((mult - 1.0) * 100);

          return (
            <div
              key={meta.key}
              className={`flex flex-col items-center justify-center rounded p-1 transition-all border ${
                isBoosted
                  ? `${meta.bg} ${meta.border} shadow-xs font-medium`
                  : 'bg-slate-50/50 border-slate-200/60 opacity-70'
              }`}
              title={`${meta.name}行专精: Lv.${count} (炼化/释灵正向收益 ×${mult.toFixed(2)})`}
            >
              <div className="flex items-center gap-0.5">
                <span className={`text-xs font-bold ${meta.color}`}>{meta.char}</span>
                {count > 0 && (
                  <span className="text-[9px] font-mono font-bold text-amber-800 bg-amber-100/80 px-0.5 rounded">
                    L{count}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] font-mono tabular-nums leading-none mt-0.5 ${
                  isBoosted ? `${meta.text} font-bold` : 'text-slate-400'
                }`}
              >
                {isBoosted ? `+${pct}%` : '1.0x'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
