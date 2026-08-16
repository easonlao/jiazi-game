import { SeededRandomSource } from './RandomSource.ts';
import {
  isSupportedRulesVersion,
  type SupportedRulesVersion,
} from './GameSaveService.ts';
import type { ScoreRules } from './ScoreManager.ts';
import type { ScoreVolatilityConfig } from './ScoreVolatility.ts';
import { TurnManager, type GameState } from './TurnManager.ts';

/** 玩家在一局游戏中提交给服务端的最小动作集合。 */
export type ReplayAction =
  | { type: 'buy'; cardIndex: number; leverage: boolean }
  | { type: 'sell'; slotIndex: number }
  | { type: 'wait' }
  | { type: 'lock'; cardIndex: number }
  | { type: 'unlock'; cardIndex: number };

/** 服务端会话创建时冻结的规则输入。客户端不得用最终分数替代这些字段。 */
export interface ReplayRequest {
  seed: number;
  actions: readonly ReplayAction[];
  rulesVersion: SupportedRulesVersion;
  volatility?: Partial<ScoreVolatilityConfig>;
  scoreRules?: Partial<ScoreRules>;
}

export interface ReplayResult {
  score: number;
  state: GameState;
  completed: true;
  rounds: number;
  rulesVersion: SupportedRulesVersion;
}

/** 防止恶意请求用超长动作序列消耗服务端重放资源；服务端还应限制请求体大小。 */
export const MAX_REPLAY_ACTIONS = 1000;

export class ReplayValidationError extends Error {
  constructor(
    message: string,
    readonly actionIndex: number | null = null,
  ) {
    super(message);
    this.name = 'ReplayValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertNonNegativeInteger(value: unknown, field: string, actionIndex: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ReplayValidationError(`${field} 必须是非负整数`, actionIndex);
  }
}

function applyAction(turnManager: TurnManager, action: ReplayAction, actionIndex: number): void {
  if (!isRecord(action) || typeof action.type !== 'string') {
    throw new ReplayValidationError('行动格式无效', actionIndex);
  }

  let accepted = false;
  switch (action.type) {
    case 'buy':
      assertNonNegativeInteger(action.cardIndex, 'cardIndex', actionIndex);
      if (typeof action.leverage !== 'boolean') {
        throw new ReplayValidationError('leverage 必须是布尔值', actionIndex);
      }
      accepted = turnManager.executeBuy(action.cardIndex, action.leverage);
      break;
    case 'sell':
      assertNonNegativeInteger(action.slotIndex, 'slotIndex', actionIndex);
      accepted = turnManager.executeSell(action.slotIndex);
      break;
    case 'wait':
      accepted = turnManager.executeWait();
      break;
    case 'lock': {
      assertNonNegativeInteger(action.cardIndex, 'cardIndex', actionIndex);
      accepted = turnManager.executeLockCard(action.cardIndex).ok;
      break;
    }
    case 'unlock':
      assertNonNegativeInteger(action.cardIndex, 'cardIndex', actionIndex);
      accepted = turnManager.executeUnlockCard(action.cardIndex);
      break;
    default:
      throw new ReplayValidationError('不支持的行动类型', actionIndex);
  }

  if (!accepted) {
    throw new ReplayValidationError(`行动未被游戏引擎接受: ${action.type}`, actionIndex);
  }
}

/**
 * 使用服务端冻结的 seed 与规则重放完整对局。
 *
 * 该适配器只调用 TurnManager，不复制任何评分或持仓公式；最终分数只能来自引擎。
 * 规则版本是必填项，便于后续 Edge Function 将会话快照作为唯一可信规则来源。
 */
export async function replayGame(request: ReplayRequest): Promise<ReplayResult> {
  if (!isRecord(request) || !Number.isSafeInteger(request.seed)) {
    throw new ReplayValidationError('seed 必须是安全整数');
  }
  if (!Array.isArray(request.actions)) {
    throw new ReplayValidationError('actions 必须是数组');
  }
  if (request.actions.length > MAX_REPLAY_ACTIONS) {
    throw new ReplayValidationError(`actions 超过上限 ${MAX_REPLAY_ACTIONS}`);
  }
  if (!isSupportedRulesVersion(request.rulesVersion)) {
    throw new ReplayValidationError('rulesVersion 不受支持');
  }

  const random = new SeededRandomSource(request.seed);
  const turnManager = new TurnManager(undefined, random, {
    rulesVersion: request.rulesVersion,
    volatility: request.volatility,
    scoreRules: request.scoreRules,
    volatilityRandom: random,
    // V6 地支波动：与服务端重放透传同一 seeded 源（客户端局 = 服务端重放同 roll）。
    branchRollRandom: random,
  });

  try {
    await turnManager.initialize();
    turnManager.startGame();
  } catch (error) {
    throw new ReplayValidationError(`重放初始化失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (let index = 0; index < request.actions.length; index += 1) {
    applyAction(turnManager, request.actions[index], index);
  }

  if (turnManager.getState() !== 'game_over') {
    throw new ReplayValidationError('对局未完成 60 回合', null);
  }

  return {
    score: turnManager.getScore(),
    state: turnManager.getState(),
    completed: true,
    rounds: turnManager.getTotalRounds(),
    rulesVersion: turnManager.getRulesVersion(),
  };
}
