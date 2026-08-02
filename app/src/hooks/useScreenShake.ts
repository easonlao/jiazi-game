import { useEffect, useRef } from 'react';
import type { FxMarginCallEvent } from '../store';

/**
 * 爆仓瞬间整个游戏画面震动。
 * 通过监听 marginCallEvent.id 变化触发（重触发：先移除类→强制 reflow→再添加）。
 */
export function useScreenShake(
  gameRef: React.RefObject<HTMLDivElement | null>,
  marginCallEvent: FxMarginCallEvent | null,
) {
  const lastMcId = useRef(0);

  useEffect(() => {
    if (!marginCallEvent || marginCallEvent.id === lastMcId.current) return;
    lastMcId.current = marginCallEvent.id;
    const el = gameRef.current;
    if (!el) return;
    el.classList.remove('screen-shake');
    void el.offsetWidth;
    el.classList.add('screen-shake');
    const t = setTimeout(() => el.classList.remove('screen-shake'), 750);
    return () => clearTimeout(t);
  }, [marginCallEvent, gameRef]);
}
