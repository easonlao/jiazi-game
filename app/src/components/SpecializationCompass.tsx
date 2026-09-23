import { useGameStore } from '../store';
import { Element } from '@core/JiaziCard';

interface ElementMeta {
  key: string;
  name: string;
  char: string;
  activeColor: string;
  activeBg: string;
  activeBorder: string;
}

const ELEMENT_METAS: ElementMeta[] = [
  { key: Element.WOOD, name: '木', char: '木', activeColor: 'text-emerald-800', activeBg: 'bg-emerald-100/80', activeBorder: 'border-emerald-400' },
  { key: Element.FIRE, name: '火', char: '火', activeColor: 'text-red-800', activeBg: 'bg-red-100/80', activeBorder: 'border-red-400' },
  { key: Element.EARTH, name: '土', char: '土', activeColor: 'text-amber-900', activeBg: 'bg-amber-100/80', activeBorder: 'border-amber-400' },
  { key: Element.METAL, name: '金', char: '金', activeColor: 'text-yellow-900', activeBg: 'bg-yellow-100/80', activeBorder: 'border-yellow-400' },
  { key: Element.WATER, name: '水', char: '水', activeColor: 'text-sky-900', activeBg: 'bg-sky-100/80', activeBorder: 'border-sky-400' },
];

export function SpecializationCompass() {
  const elemMultipliers = useGameStore((s) => s.elemMultipliers);
  const triadCounts = useGameStore((s) => s.triadCounts);
  const grandCycles = useGameStore((s) => s.grandCycles);

  return (
    <div className="flex items-center justify-between gap-1 rounded-lg border border-wood-light/60 bg-[#faf6ee] px-2.5 py-0.5 shadow-2xs">
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[11px] font-bold font-serif text-ink flex items-center gap-1">
          <span className="text-amber-700">☯</span>
          <span>五行道基</span>
        </span>
        {grandCycles > 0 && (
          <span className="text-[9px] font-bold font-serif text-gold bg-gold/15 px-1 py-0.2 rounded border border-gold/40">
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
              className={`flex items-center gap-0.5 px-1.5 py-0.2 rounded border text-[10px] font-serif transition-all ${
                isBoosted
                  ? `${meta.activeBg} ${meta.activeBorder} font-bold ${meta.activeColor} shadow-2xs`
                  : 'bg-white/40 border-wood-light/40 text-wood-mid/70'
              }`}
              title={`${meta.name}行专精: Lv.${count} (炼化/释灵 ×${mult.toFixed(2)})`}
            >
              <span className="font-bold">{meta.char}</span>
              <span className="tabular-nums font-mono text-[9px] leading-none">
                {isBoosted ? `+${pct}%` : '1.0x'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
