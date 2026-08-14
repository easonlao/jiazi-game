import { useEffect } from 'react';
import { useGameStore } from '../store';

export function Toast() {
  const toast = useGameStore((s) => s.toast);
  const clearToast = useGameStore((s) => s.clearToast);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(clearToast, 2000);
      return () => clearTimeout(timer);
    }
  }, [toast, clearToast]);

  if (!toast) return null;

  return (
    <div className="toast-in absolute left-1/2 top-1/2 z-[90] -translate-x-1/2 -translate-y-1/2 px-4 py-2 rounded-full bg-ink/90 text-parchment text-sm font-medium shadow-lg">
      {toast}
    </div>
  );
}
