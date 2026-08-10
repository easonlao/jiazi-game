import { useState } from 'react';
import { useGameStore } from '../store';

/**
 * 匿名身份与数据同意面板（开始页）。
 * 仅消费 store 的 telemetryState 与遥测 actions，不引入 Supabase SDK。
 *
 * 安全约束：
 * - 不渲染内部 player_id / token，公开 ID 只展示 public_player_id 前 8 位；
 * - 恢复码只从当前 session 的 store 状态读取并复制到剪贴板，
 *   绝不写入组件外的新 localStorage。
 */
export function PlayerIdentityPanel() {
  const telemetryState = useGameStore((s) => s.telemetryState);
  const grantTelemetryConsent = useGameStore((s) => s.grantTelemetryConsent);
  const declineTelemetryConsent = useGameStore((s) => s.declineTelemetryConsent);
  const provisionPlayer = useGameStore((s) => s.provisionPlayer);
  const recoverPlayer = useGameStore((s) => s.recoverPlayer);
  const updatePlayerDisplayName = useGameStore((s) => s.updatePlayerDisplayName);

  const [nameDraft, setNameDraft] = useState('');
  const [recoverDraft, setRecoverDraft] = useState('');
  const [copied, setCopied] = useState(false);

  const consent = telemetryState?.consent ?? null;
  const identity = telemetryState?.identity ?? null;
  const recoveryCode = telemetryState?.recovery_code ?? null;
  const error = telemetryState?.error ?? null;
  const busy = telemetryState?.busy ?? false;

  const handleCopy = async () => {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默忽略
    }
  };

  const handleRecover = async () => {
    const code = recoverDraft.trim();
    if (!code) return;
    if (await recoverPlayer(code)) setRecoverDraft('');
  };

  // consent 未决定：说明 + 同意 / 暂不记录
  if (!consent) {
    return (
      <div className="w-full max-w-xs rounded-lg border border-wood-light bg-[#faf6ee] px-3 py-2.5 text-xs leading-relaxed text-ink-light">
        <h3 className="mb-1 font-serif text-sm font-bold text-ink">匿名数据记录（可选）</h3>
        <p>仅记录对局动作与回合结算，用于平衡分析；不记录真实姓名，无需登录。</p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => void grantTelemetryConsent()}
            aria-label="同意并生成玩家 ID"
            disabled={busy}
            className="flex-1 py-1.5 rounded-lg bg-ink text-parchment text-xs font-bold font-serif hover:bg-wood-dark transition-colors active:scale-95 disabled:opacity-50"
          >
            同意并生成玩家 ID
          </button>
          <button
            onClick={declineTelemetryConsent}
            aria-label="暂不记录数据"
            className="flex-1 py-1.5 rounded-lg border border-wood-light text-ink-light text-xs font-serif hover:bg-wood-light transition-colors active:scale-95"
          >
            暂不记录
          </button>
        </div>
        <div className="mt-2 border-t border-wood-light pt-2">
          <p className="mb-1">已有恢复码？同意后找回原来的玩家 ID。</p>
          <div className="flex gap-1.5">
            <input
              value={recoverDraft}
              onChange={(e) => setRecoverDraft(e.target.value)}
              placeholder="输入恢复码"
              aria-label="输入恢复码并同意数据记录"
              className="min-w-0 flex-1 rounded-lg border border-wood-light bg-parchment px-2 py-1 text-xs text-ink outline-none focus:border-wood-mid"
            />
            <button
              onClick={() => void grantTelemetryConsent(recoverDraft.trim())}
              aria-label="同意数据记录并恢复身份"
              disabled={busy || !recoverDraft.trim()}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-wood-mid text-parchment text-xs font-serif hover:bg-wood-dark transition-colors active:scale-95 disabled:opacity-50"
            >
              同意并恢复
            </button>
          </div>
        </div>
      </div>
    );
  }

  // consent 已拒绝：仅提示未记录云端数据
  if (consent.granted === false) {
    return (
      <div className="w-full max-w-xs rounded-lg border border-wood-light bg-[#faf6ee] px-3 py-2 text-xs leading-relaxed text-ink-light">
        <h3 className="mb-0.5 font-serif text-sm font-bold text-ink">匿名数据记录（可选）</h3>
        <p>未记录云端数据</p>
      </div>
    );
  }

  // consent 已同意但尚无身份：展示生成中/失败，可重试，不阻塞开始游戏
  if (!identity) {
    return (
      <div className="w-full max-w-xs rounded-lg border border-wood-light bg-[#faf6ee] px-3 py-2.5 text-xs leading-relaxed text-ink-light">
        <h3 className="mb-1 font-serif text-sm font-bold text-ink">匿名数据记录（可选）</h3>
        {busy ? <p>正在生成玩家 ID…</p> : <p>已同意记录，但云端身份尚未就绪。</p>}
        {error && <p className="mt-1 text-qi-critical">{error}</p>}
        <button
          onClick={() => void provisionPlayer()}
          aria-label="重试生成玩家 ID"
          disabled={busy}
          className="mt-2 w-full py-1.5 rounded-lg border border-wood-mid text-ink text-xs font-bold font-serif hover:bg-wood-light transition-colors active:scale-95 disabled:opacity-50"
        >
          {busy ? '生成中…' : '重试生成玩家 ID'}
        </button>
        <div className="mt-2 border-t border-wood-light pt-2">
          <p className="mb-1">已有恢复码？用它找回原来的玩家 ID。</p>
          <div className="flex gap-1.5">
            <input
              value={recoverDraft}
              onChange={(e) => setRecoverDraft(e.target.value)}
              placeholder="输入恢复码"
              aria-label="输入恢复码以恢复玩家身份"
              className="min-w-0 flex-1 rounded-lg border border-wood-light bg-parchment px-2 py-1 text-xs text-ink outline-none focus:border-wood-mid"
            />
            <button
              onClick={() => void handleRecover()}
              aria-label="恢复玩家身份"
              disabled={busy || !recoverDraft.trim()}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-wood-mid text-parchment text-xs font-serif hover:bg-wood-dark transition-colors active:scale-95 disabled:opacity-50"
            >
              恢复
            </button>
          </div>
        </div>
      </div>
    );
  }

  // consent 已同意且有身份
  const jiaziId = identity.public_player_id.slice(0, 8);

  const handleUpdateName = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    await updatePlayerDisplayName(name);
    setNameDraft('');
  };

  return (
    <div className="w-full max-w-xs rounded-lg border border-wood-light bg-[#faf6ee] px-3 py-2.5 text-xs leading-relaxed text-ink-light">
      <h3 className="mb-1 font-serif text-sm font-bold text-ink">匿名数据记录（可选）</h3>

      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-bold text-ink">{identity.display_name || '未命名玩家'}</span>
        <span className="shrink-0 rounded bg-wood-light/40 px-1.5 py-0.5 font-mono tracking-wider text-ink">
          {jiaziId}
        </span>
      </div>

      {error && <p className="mt-1 text-qi-critical">{error}</p>}

      <div className="mt-1.5 flex gap-1.5">
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          placeholder="修改名称（1-12 字）"
          aria-label="修改玩家名称"
          className="min-w-0 flex-1 rounded-lg border border-wood-light bg-parchment px-2 py-1 text-xs text-ink outline-none focus:border-wood-mid"
        />
        <button
          onClick={() => void handleUpdateName()}
          aria-label="保存玩家名称"
          className="shrink-0 px-2.5 py-1 rounded-lg bg-wood-mid text-parchment text-xs font-serif hover:bg-wood-dark transition-colors active:scale-95"
        >
          保存
        </button>
      </div>

      {recoveryCode && (
        <div className="mt-1.5 rounded-lg border border-gold/50 bg-gold/10 px-2 py-1.5">
          <p className="font-bold text-ink">恢复码，请妥善保存</p>
          <div className="mt-1 flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-ink">{recoveryCode}</code>
            <button
              onClick={() => void handleCopy()}
              aria-label="复制恢复码"
              className="shrink-0 px-2 py-0.5 rounded border border-wood-mid text-ink text-xs font-serif hover:bg-wood-light transition-colors"
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-1.5 flex gap-1.5">
        <input
          value={recoverDraft}
          onChange={(e) => setRecoverDraft(e.target.value)}
          placeholder="输入恢复码找回身份"
          aria-label="输入恢复码以在另一台设备恢复"
          className="min-w-0 flex-1 rounded-lg border border-wood-light bg-parchment px-2 py-1 text-xs text-ink outline-none focus:border-wood-mid"
        />
        <button
          onClick={() => void handleRecover()}
          aria-label="用恢复码恢复身份"
          className="shrink-0 px-2.5 py-1 rounded-lg bg-wood-mid text-parchment text-xs font-serif hover:bg-wood-dark transition-colors active:scale-95"
        >
          恢复
        </button>
      </div>
    </div>
  );
}
