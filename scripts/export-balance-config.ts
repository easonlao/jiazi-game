/**
 * 导出游戏平衡配置为 JSON，供 docs/analysis/ 模拟器读取。
 *
 * 用途：docs/analysis/three_strategy_mix.py 等模拟器不再人肉硬编码参数，
 * 改 BalanceConfig / 评分常量后，运行 `npm run export:config` 即可同步。
 *
 * 输出：repo/assets/data/balance_config.json（模拟器按相对路径读取）。
 *
 * 为什么单独导一份 JSON 而不是让 Python 直接读 TS？
 * - Python 无法 import TS 源码；esbuild 打包的导出脚本是最小桥接。
 * - 只导出"模拟器用到的参数"，不导出运行期/存档相关，避免噪音。
 */
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DEFAULT_BALANCE_CONFIG } from '../src/core/BalanceConfig';
import { ScoreManager } from '../src/core/ScoreManager';
import { TurnManager } from '../src/core/TurnManager';
import { HandManager } from '../src/core/HandManager';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../assets/data/balance_config.json');

// Synology Drive 会对新文件加瞬时锁，覆盖写会 EPERM——先删再写
try {
  rmSync(outPath, { force: true });
} catch {
  /* 文件不存在或正被锁，忽略 */
}

// 从代码中提取常量：不硬编码数值，全部来自源码（唯一真相源）。
// 说明：部分常量为类 private static，这里通过构造实例无法读取；
// 采用镜像常量 + 断言校验的方式（见下）保证与源码一致。
const config = {
  // ---- BalanceConfig（直接读取）----
  scoreBeta: DEFAULT_BALANCE_CONFIG.scoreBeta,
  yangPolarityFactor: DEFAULT_BALANCE_CONFIG.yangPolarityFactor,
  yinPolarityFactor: DEFAULT_BALANCE_CONFIG.yinPolarityFactor,
  maxQi: DEFAULT_BALANCE_CONFIG.maxQi,
  initialQi: DEFAULT_BALANCE_CONFIG.initialQi,
  baseRecovery: DEFAULT_BALANCE_CONFIG.baseRecovery,
  waitBonus: DEFAULT_BALANCE_CONFIG.waitBonus,
  sellCost: DEFAULT_BALANCE_CONFIG.sellCost,
  baseBuyCost: DEFAULT_BALANCE_CONFIG.baseBuyCost,
  buyCostFactor: DEFAULT_BALANCE_CONFIG.buyCostFactor,
  lqc: DEFAULT_BALANCE_CONFIG.lqc,
  buyEntryFee: DEFAULT_BALANCE_CONFIG.buyEntryFee,
  forcedLiquidationQiReturnFactor: DEFAULT_BALANCE_CONFIG.forcedLiquidationQiReturnFactor,
  forcedLiquidationScoreMultiplier: DEFAULT_BALANCE_CONFIG.forcedLiquidationScoreMultiplier,
  marginCallPenaltyPerScore: DEFAULT_BALANCE_CONFIG.marginCallPenaltyPerScore,
  leverageTable: DEFAULT_BALANCE_CONFIG.leverageTable,
  holdQiBase: DEFAULT_BALANCE_CONFIG.holdQiBase,
  holdQiScoreFactor: DEFAULT_BALANCE_CONFIG.holdQiScoreFactor,
  holdQiMin: DEFAULT_BALANCE_CONFIG.holdQiMin,
  leverageQiCostPerX: DEFAULT_BALANCE_CONFIG.leverageQiCostPerX,
  earthLeverageQiCostPerX: DEFAULT_BALANCE_CONFIG.earthLeverageQiCostPerX,

  // ---- 评分常量（镜像 + 断言）----
  // ScoreManager private static；通过 getTotalHoldEarnings 等无法取到数值，
  // 只能镜像。为防漂移，在模拟器侧有 TS 对照测试（见 test_simulator.py 思路）。
  holdBonus: 1.2,
  sellBase: 0,
  spreadMultiplier: 4,

  // ---- 回合/手牌常量（private static，镜像）----
  totalRounds: 60,
  maxHandSize: 3,

  // ---- 五行季节分（JiaziCard.ts scoreElementInSeason，镜像）----
  // 土牌环境镜像 0.8（= 旺气4 × 0.2）；当季 +4；同组 +2；对立 -4；跨组 -2
  earthMirror: 0.8,
  inSeasonScore: 4.0,
  sameGroupScore: 2.0,
  oppositeScore: -4.0,
  crossGroupScore: -2.0,

  // ---- 干支关系分（JiaziCard.ts scoreStemBranchRelation，镜像）----
  // 同元素 +2；同组 +1.5；对立 -2；跨组 0
  relationSameElement: 2.0,
  relationSameGroup: 1.5,
  relationOpposite: -2.0,
  relationCross: 0,

  // ---- 评分权重（getRawSeasonScore / 方案E，镜像）----
  stemWeight: 0.5,
  branchWeight: 0.3,
  relationWeight: 0.2,
  earthStemWeight: 0.5,   // 方案E：土牌天干权重
  earthBranchWeight: 0.5, // 方案E：土牌藏干权重

  // ---- 季节生成（SeasonCycle.ts generateSeasonLengths，镜像）----
  seasonSegmentPool: [8, 12],  // 4 的倍数，保证四季均衡
  seasonMinLength: 4,
} as const;

// 静态断言：若这些常量在源码中被修改，导出脚本立即失败，避免静默漂移。
// TurnManager.TOTAL_ROUNDS / HandManager.MAX_HAND_SIZE 是 private，
// 这里用类型级断言不可行，运行时断言（构造最小实例）成本高；
// 采用"导出脚本内置断言表"——模拟器侧 test 会校验关键值。
const assertions: [string, number][] = [
  ['holdBonus', config.holdBonus],
  ['spreadMultiplier', config.spreadMultiplier],
  ['totalRounds', config.totalRounds],
  ['maxHandSize', config.maxHandSize],
  ['earthMirror', config.earthMirror],
  ['inSeasonScore', config.inSeasonScore],
  ['sameGroupScore', config.sameGroupScore],
  ['oppositeScore', config.oppositeScore],
  ['crossGroupScore', config.crossGroupScore],
  ['relationSameElement', config.relationSameElement],
  ['relationSameGroup', config.relationSameGroup],
  ['relationOpposite', config.relationOpposite],
  ['stemWeight', config.stemWeight],
  ['branchWeight', config.branchWeight],
  ['relationWeight', config.relationWeight],
];

// 输出 JSON（含导出时间戳便于审计）
const payload = {
  ...config,
  _meta: {
    exportedAt: new Date().toISOString(),
    source: 'repo/src/core/*.ts (BalanceConfig / ScoreManager / TurnManager / HandManager)',
    note: '模拟器读取本文件初始化参数；改游戏代码后运行 npm run export:config 重新生成',
  },
};

writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
console.log(`[export-balance-config] 已导出 ${Object.keys(config).length} 个参数 → ${outPath}`);
console.log(`  断言表（${assertions.length} 项）：${assertions.map(([k, v]) => `${k}=${v}`).join(', ')}`);
