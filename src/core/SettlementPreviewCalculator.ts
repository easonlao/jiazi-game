/**
 * 行动前/实际结算共用的持仓纯计算边界。
 *
 * 这里只接收可序列化的持仓快照和计算器函数，不读取或修改 TurnManager
 * 状态，因此预览与实际结算可以共享同一组逐项收益/气耗计算。
 */
export interface HoldingCalculationInput {
  cardName: string;
  cardScore: number;
  useLeverage: boolean;
  /** 土牌使用专属杠杆气耗系数，需要标记元素类型 */
  isEarth?: boolean;
}

export interface HoldingCalculationItem {
  cardName: string;
  earning: number;
  qiCost: number;
  leverage: number;
}

export interface HoldingCalculationResult {
  items: HoldingCalculationItem[];
  holdEarnings: number;
  holdQiCost: number;
}

export interface HoldingCalculationFunctions {
  calculateHoldEarnings: (cardScore: number, leverage: number) => number;
  calculateHoldQiCost: (cardScore: number, leverage: number, isEarth?: boolean) => number;
}

/**
 * 按指定结算倍率计算一组持仓的逐项结果和合计。
 * 未启用杠杆的持仓始终使用 1 倍；输入顺序会原样保留，便于映射回手牌。
 */
export function calculateHoldingSettlement(
  holdings: readonly HoldingCalculationInput[],
  settlementLeverage: number,
  calculators: HoldingCalculationFunctions,
): HoldingCalculationResult {
  const items = holdings.map((holding) => {
    const leverage = holding.useLeverage ? settlementLeverage : 1;
    return {
      cardName: holding.cardName,
      earning: calculators.calculateHoldEarnings(holding.cardScore, leverage),
      qiCost: calculators.calculateHoldQiCost(holding.cardScore, leverage, holding.isEarth),
      leverage,
    };
  });

  return {
    items,
    holdEarnings: items.reduce((total, item) => total + item.earning, 0),
    holdQiCost: items.reduce((total, item) => total + item.qiCost, 0),
  };
}
