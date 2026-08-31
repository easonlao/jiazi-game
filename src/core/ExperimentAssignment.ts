import {
  type BalanceProfile,
  getBalanceProfileById,
  getDefaultBalanceProfileForRules,
  EA_DEFAULT_BALANCE_PROFILE,
} from './BalanceProfile.ts';

export interface ExperimentVariant {
  variantId: string;
  balanceProfileId: string;
  weight: number;
}

export interface ExperimentConfig {
  id: string;
  name: string;
  enabled: boolean;
  rulesVersion: number;
  variants: ExperimentVariant[];
  salt?: string;
}

export interface ExperimentAssignmentResult {
  profile: BalanceProfile;
  experimentId: string | null;
  variantId: string | null;
}

export interface ExperimentValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 校验试验配置合法性：
 * - 试验变体不能为空
 * - 每个变体必须指向真实已注册的 BalanceProfile
 * - 变体档案的 rulesVersion 必须与试验的 rulesVersion 严格一致
 */
export function validateExperimentConfig(config: ExperimentConfig | null | undefined): ExperimentValidationResult {
  if (!config) {
    return { valid: false, errors: ['Experiment configuration is missing'] };
  }
  const errors: string[] = [];
  if (!config.id || typeof config.id !== 'string') {
    errors.push('Experiment ID is required and must be a string');
  }
  if (typeof config.rulesVersion !== 'number') {
    errors.push('Experiment rulesVersion is required');
  }
  if (!config.variants || !Array.isArray(config.variants) || config.variants.length === 0) {
    errors.push(`Experiment ${config.id ?? 'unknown'} variants must not be empty`);
  } else {
    for (const variant of config.variants) {
      if (!variant.variantId || typeof variant.variantId !== 'string') {
        errors.push(`Variant in experiment ${config.id} is missing a valid variantId`);
      }
      const profile = getBalanceProfileById(variant.balanceProfileId);
      if (!profile) {
        errors.push(
          `Variant '${variant.variantId}' references non-existent balance profile '${variant.balanceProfileId}' in experiment ${config.id}`,
        );
      } else if (profile.rulesVersion !== config.rulesVersion) {
        errors.push(
          `Variant '${variant.variantId}' profile '${variant.balanceProfileId}' has rulesVersion ${profile.rulesVersion}, but experiment is configured for rulesVersion ${config.rulesVersion}`,
        );
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 确定性 32-bit FNV-1a 哈希，将输入字符串映射到 [0, 1) 区间。
 * 保证相同 playerId 在同一 experimentId 下在所有端、所有时间得到完全相同的哈希结果。
 */
export function hashStringToUnitInterval(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // 转换为无符号 32 位整数并归一化到 [0, 1)
  const unsigned = hash >>> 0;
  return unsigned / 0x100000000;
}

/**
 * 将玩家确定性分配到试验分组。
 * - 试验未启用、配置为空时，确定性回退到默认平衡档案。
 * - 校验试验配置：若配置非法（如引用不存在档案或跨规则混配），拒绝伪装成试验分流，安全回退到全服默认且 experimentId 为 null。
 */
export function assignPlayerToExperiment(
  playerId: string | null | undefined,
  experiment: ExperimentConfig | null | undefined,
  defaultProfile?: BalanceProfile,
): ExperimentAssignmentResult {
  const fallback: BalanceProfile = defaultProfile ?? (
    experiment ? (getDefaultBalanceProfileForRules(experiment.rulesVersion) ?? EA_DEFAULT_BALANCE_PROFILE) : EA_DEFAULT_BALANCE_PROFILE
  );

  if (!playerId || !experiment || !experiment.enabled) {
    return {
      profile: fallback,
      experimentId: null,
      variantId: null,
    };
  }

  // 严格校验试验配置合法性（杜绝引用失效或跨规则混配）
  const validation = validateExperimentConfig(experiment);
  if (!validation.valid) {
    console.error(`[ExperimentAssignment] Invalid experiment config for '${experiment.id}':`, validation.errors);
    return {
      profile: fallback,
      experimentId: null,
      variantId: null,
    };
  }

  const totalWeight = experiment.variants.reduce((sum, v) => sum + Math.max(0, v.weight), 0);
  if (totalWeight <= 0) {
    return {
      profile: fallback,
      experimentId: null,
      variantId: null,
    };
  }

  const hashKey = `${playerId}:${experiment.id}:${experiment.salt ?? 'ea_salt'}`;
  const unitValue = hashStringToUnitInterval(hashKey);
  const targetThreshold = unitValue * totalWeight;

  let cumulative = 0;
  let selectedVariant: ExperimentVariant = experiment.variants[0];

  for (const variant of experiment.variants) {
    cumulative += Math.max(0, variant.weight);
    if (targetThreshold < cumulative) {
      selectedVariant = variant;
      break;
    }
  }

  const profile = getBalanceProfileById(selectedVariant.balanceProfileId);
  if (!profile || profile.rulesVersion !== experiment.rulesVersion) {
    // 理论上已被 validateExperimentConfig 拦截，防御性双重保障
    return {
      profile: fallback,
      experimentId: null,
      variantId: null,
    };
  }

  return {
    profile,
    experimentId: experiment.id,
    variantId: selectedVariant.variantId,
  };
}

/** 当前系统配置的 EA 试验（全局或按规则版本索引） */
export const REGISTERED_EXPERIMENTS: Record<string, ExperimentConfig> = {
  // 示例试验槽位（默认关闭，启用后自动按权重稳定分流）：
  'ea_v9_balance_test': {
    id: 'ea_v9_balance_test',
    name: 'V9 平衡微调试验',
    enabled: false,
    rulesVersion: 9,
    variants: [
      { variantId: 'control', balanceProfileId: 'v9_standard', weight: 50 },
      { variantId: 'treatment_tuned', balanceProfileId: 'v9_ea_tuned', weight: 50 },
    ],
  },
};

export function getActiveExperimentForRules(
  rulesVersion: number,
  registered: Record<string, ExperimentConfig> = REGISTERED_EXPERIMENTS,
): ExperimentConfig | null {
  for (const exp of Object.values(registered)) {
    if (exp.enabled && exp.rulesVersion === rulesVersion) {
      return exp;
    }
  }
  return null;
}
