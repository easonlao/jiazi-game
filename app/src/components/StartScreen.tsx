import { useGameStore } from '../store';

interface StartScreenProps {
  turnManager: ReturnType<typeof useGameStore.getState>['turnManager'];
  hasSave: boolean;
  onStart: () => void;
  onContinue: () => void;
  onLeaderboard: () => void;
}

/**
 * 启动加载/开始页：标题、玩法简介、开始按钮或加载中状态。
 * 检测到存档时显示"继续游戏"，否则显示"开始游戏"。
 */
export function StartScreen({ turnManager, hasSave, onStart, onContinue, onLeaderboard }: StartScreenProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
      <div className="text-center shrink-0">
        <h1 className="text-3xl font-bold font-serif text-ink mb-1">甲子纪</h1>
        <p className="text-xs text-ink-light">Jiazi Chronicle · 六十甲子策略卡牌</p>
      </div>

      <div className="w-full max-w-xs rounded-lg border border-wood-light bg-[#faf6ee] px-3 py-2.5 text-xs leading-relaxed text-ink-light">
        <h3 className="mb-1 font-serif text-sm font-bold text-ink">玩法</h3>
        <p>60 回合，春夏秋冬随机换季；每回合可买入、卖出或等待。</p>
        <p>持仓每回合结算收益和气耗，评分越高收益越高，气耗也越高。</p>
        <p>杠杆会放大收益和气耗，换季重置；气不足时可能爆仓。</p>
      </div>

      {turnManager ? (
        <div className="flex flex-col gap-2 w-full max-w-xs">
          {hasSave ? (
            <>
              <button
                onClick={onContinue}
                className="w-full py-3 rounded-xl bg-ink text-parchment text-lg font-bold font-serif hover:bg-wood-dark transition-colors active:scale-95"
              >
                继续游戏
              </button>
              <button
                onClick={onStart}
                className="w-full py-3 rounded-xl border-2 border-wood-mid text-ink text-base font-bold font-serif hover:bg-wood-light transition-colors active:scale-95"
              >
                新游戏
              </button>
            </>
          ) : (
            <button
              onClick={onStart}
              className="w-full py-3 rounded-xl bg-ink text-parchment text-lg font-bold font-serif hover:bg-wood-dark transition-colors active:scale-95"
            >
              开始游戏
            </button>
          )}
          <button
            onClick={onLeaderboard}
            className="w-full py-2.5 rounded-xl border border-wood-light text-ink-light text-sm font-serif hover:bg-wood-light transition-colors active:scale-95"
          >
            排行榜
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-wood-mid border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-ink-light">加载牌库中...</p>
        </div>
      )}
    </div>
  );
}