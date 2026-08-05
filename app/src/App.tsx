import { useEffect, useRef, useState } from 'react';
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
import { HelpModal } from './components/HelpCenter';
import { StartScreen } from './components/StartScreen';
import { GameOverModal } from './components/GameOverModal';
import { LeaderboardModal } from './components/LeaderboardModal';

export default function App() {
  const gameState = useGameStore((s) => s.gameState);
  const turnManager = useGameStore((s) => s.turnManager);
  const tick = useGameStore((s) => s.tick);
  const initialize = useGameStore((s) => s.initialize);
  const startGame = useGameStore((s) => s.startGame);
  const loadGameFromSave = useGameStore((s) => s.loadGameFromSave);
  const openLeaderboard = useGameStore((s) => s.openLeaderboard);
  const closeLeaderboard = useGameStore((s) => s.closeLeaderboard);
  const showToast = useGameStore((s) => s.showToast);
  const hasSave = useGameStore((s) => s.hasSave);
  const leaderboardOpen = useGameStore((s) => s.leaderboardOpen);
  const [helpOpen, setHelpOpen] = useState(false);

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

  const isLoading = gameState === 'init' || !turnManager;

  return (
    <div className="flex items-center justify-center w-full h-full bg-stone-800">
      <div
        data-game-shell
        className="relative w-full h-full max-w-[428px] bg-parchment overflow-y-auto overflow-x-hidden flex flex-col font-sans shadow-2xl md:rounded-2xl md:my-6 md:h-[calc(100%-3rem)] md:max-h-[920px] max-md:pb-[88px]"
      >
        {isLoading ? (
          <StartScreen
            turnManager={turnManager}
            hasSave={hasSave}
            onStart={() => {
              startGame();
              showToast('游戏开始');
            }}
            onContinue={() => {
              loadGameFromSave();
              showToast('继续游戏');
            }}
            onLeaderboard={openLeaderboard}
          />
        ) : (
          <>
            {/* 游戏 UI */}
            <TopPanel />
            <QiBar />
            <PublicCards onHelp={() => setHelpOpen(true)} />

            {/* 分割线 */}
            <div className="mx-4 border-t-2 border-dashed border-wood-light" />

            <HandCards />

            {/* 弹性占位：内容不满屏时把操作栏推到底部；内容超出时收缩为 0（配合滚动） */}
            <div className="flex-1 min-h-0" />

            <ActionBar />
            <SettlementPreviewModal />
            <SeasonTransition />
            <MarginCallOverlay />
            <Toast />

            {gameState === 'game_over' && <GameOverModal />}
          </>
        )}
        <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
        {leaderboardOpen && <LeaderboardModal />}
      </div>
    </div>
  );
}