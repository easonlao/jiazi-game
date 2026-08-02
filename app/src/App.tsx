import { useEffect, useRef } from 'react';
import { useGameStore } from './store';
import { TopPanel } from './components/TopPanel';
import { QiBar } from './components/QiBar';
import { PublicCards } from './components/PublicCards';
import { HandCards } from './components/HandCards';
import { ActionBar } from './components/ActionBar';
import { SettlementPreviewModal } from './components/SettlementPreviewModal';
import { SeasonTransition } from './components/SeasonTransition';
import { MarginCallOverlay } from './components/MarginCallOverlay';
import { Toast } from './components/Toast';

export default function App() {
  const gameState = useGameStore((s) => s.gameState);
  const turnManager = useGameStore((s) => s.turnManager);
  const tick = useGameStore((s) => s.tick);
  const initialize = useGameStore((s) => s.initialize);
  const startGame = useGameStore((s) => s.startGame);
  const showToast = useGameStore((s) => s.showToast);
  const marginCallEvent = useGameStore((s) => s.marginCallEvent);

  const gameRef = useRef<HTMLDivElement>(null);
  const lastMcId = useRef(0);

  // 初始化引擎
  useEffect(() => {
    if (!turnManager) {
      initialize();
    }
  }, [turnManager, initialize]);

  // TurnManager 回调只 +tick，这里监听到 tick 变动后再统一 sync
  // 确保读到的是 TurnManager 所有内部状态都落定后的最终值
  useEffect(() => {
    if (turnManager && tick > 0) {
      useGameStore.getState()._sync();
    }
  }, [turnManager, tick]);

  // 爆仓瞬间：整个游戏画面震动（重触发：先移除类→强制 reflow→再添加）
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
  }, [marginCallEvent]);

  const isLoading = gameState === 'init' || !turnManager;

  return (
    <div className="flex items-center justify-center w-full h-full bg-stone-800">
      <div
        ref={gameRef}
        className="relative w-full h-full max-w-[428px] bg-parchment overflow-y-auto overflow-x-hidden flex flex-col font-sans shadow-2xl md:rounded-2xl md:my-6 md:h-[calc(100%-3rem)] md:max-h-[920px]"
      >
        {/* 加载中 / 开始 */}
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 p-6 overflow-y-auto">
            <div className="text-center shrink-0">
              <h1 className="text-3xl font-bold font-serif text-ink mb-1">甲子纪</h1>
              <p className="text-xs text-ink-light">Jiazi Chronicle · 六十甲子策略卡牌</p>
            </div>

            {/* 玩法说明 */}
            <div className="w-full max-w-xs text-xs text-ink-light space-y-2 bg-[#faf6ee] border border-wood-light rounded-lg p-3">
              <h3 className="font-bold font-serif text-ink text-sm">玩法</h3>
              <ul className="space-y-1.5">
                <li>· 单局 <b className="text-ink">60 回合</b>，分 春夏秋冬 四季交替推进</li>
                <li>· 每回合从公共牌池选牌 <b className="text-ink">买入</b>持仓，每回合结算收益</li>
                <li>· 牌在对应季节评分更高：<b className="text-emerald-700">春木</b> <b className="text-red-600">夏火</b> <b className="text-slate-600">秋金</b> <b className="text-sky-600">冬水</b>；土牌四季稳定</li>
                <li>· <b className="text-ink">卖出</b>结算差价收益；买入会暂时占用一部分气，卖出时先释放占用气，再扣退出费；<b className="text-ink">等待</b>放弃本轮但下回合多回气</li>
              <li>· 勾选 <b className="text-qi-critical">杠杆</b> 建立杠杆仓位；倍率按季内档位随回合变化，换季重置为 1.0x，同时放大收益与持仓气耗</li>
              </ul>
              <p className="text-[10px] text-ink-light/70 mt-2">目标：60 回合结束时 <b className="text-gold">总分尽可能高</b>。无固定胜负线。</p>
            </div>

            {turnManager ? (
              <button
                onClick={() => {
                  startGame();
                  showToast('游戏开始');
                }}
                className="px-8 py-3 rounded-xl bg-ink text-parchment text-lg font-bold font-serif hover:bg-wood-dark transition-colors active:scale-95 shrink-0"
              >
                开始游戏
              </button>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-wood-mid border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-ink-light">加载牌库中...</p>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* 游戏 UI */}
            <TopPanel />
            <QiBar />
            <PublicCards />

            {/* 分割线 */}
            <div className="mx-4 border-t-2 border-dashed border-wood-light" />

            <HandCards />

            {/* 弹性占位，把操作栏推到底部 */}
            <div className="flex-1" />

            <ActionBar />
            <SettlementPreviewModal />
            <SeasonTransition />
            <MarginCallOverlay />
            <Toast />

            {/* 游戏结束 */}
            {gameState === 'game_over' && (
              <div className="modal-backdrop absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <div className="mx-4 w-full max-w-xs bg-parchment rounded-xl shadow-2xl p-6 text-center">
                  <h2 className="text-xl font-bold font-serif text-ink mb-4">游戏结束</h2>
                  <p className="text-3xl font-bold text-gold mb-6">
                    {useGameStore.getState().score.toFixed(1)} 分
                  </p>
                  <button
                    onClick={() => {
                      const tm = useGameStore.getState().turnManager;
                      if (tm) {
                        tm.reset();
                        useGameStore.getState()._sync();
                      }
                    }}
                    className="w-full py-3 rounded-xl bg-ink text-parchment text-base font-bold font-serif hover:bg-wood-dark transition-colors"
                  >
                    重新开始
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
