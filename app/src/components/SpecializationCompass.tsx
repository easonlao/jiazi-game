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
    <div className="flex items-center justify-between gap-1 rounded-lg border border-wood-light/40 bg-white/60 px-2 py-1 shadow-xs">
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[11px] font-bold font-serif text-ink flex items-center gap-0.5">
          <span className="text-amber-600">☯</span>
          <span>五行专精</span>
        </span>
        {grandCycles > 0 && (
          <span className="text-[9px] font-bold text-amber-900 bg-amber-100 px-1 py-0.5 rounded border border-amber-300">
            混元×{grandCycles}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 min-w-0">
        {ELEMENT_METAS.map((meta) => {
          const mult = elemMultipliers[meta.key] ?? 1.0;
          const count = triadCounts[meta.key] ?? 0;
          const isBoosted = mult > 1.0;
          const pct = Math.round((mult - 1.0) * 100);

          return (
            <div
              key={meta.key}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono transition-all border ${
                isBoosted
                  ? `${meta.bg} ${meta.border} font-bold ${meta.text}`
                  : 'bg-slate-50/50 border-slate-200/60 text-slate-500 opacity-70'
              }`}
              title={`${meta.name}行专精: Lv.${count} (炼化/释灵 ×${mult.toFixed(2)})`}
            >
              <span className={`font-bold ${meta.color}`}>{meta.char}</span>
              <span className="tabular-nums leading-none">
                {isBoosted ? `+${pct}%` : '1.0x'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
