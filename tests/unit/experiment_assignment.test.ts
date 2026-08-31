import { describe, it, expect } from 'vitest';
import {
  assignPlayerToExperiment,
  hashStringToUnitInterval,
  getActiveExperimentForRules,
  validateExperimentConfig,
  type ExperimentConfig,
} from '../../src/core/ExperimentAssignment';
import {
  V9_STANDARD_PROFILE,
  getBalanceProfileById,
  getDefaultBalanceProfileForRules,
} from '../../src/core/BalanceProfile';

describe('Issue 06: 稳定的 EA 试验分组与确定性分流', () => {
  const sampleExperiment: ExperimentConfig = {
    id: 'exp_v9_balance_q3',
    name: 'V9 平衡调优 AB 测试',
    enabled: true,
    rulesVersion: 9,
    variants: [
      { variantId: 'control', balanceProfileId: 'v9_standard', weight: 50 },
      { variantId: 'treatment_tuned', balanceProfileId: 'v9_ea_tuned', weight: 50 },
    ],
    salt: 'test_salt_123',
  };

  it('同一玩家在同一试验中跨设备、跨对局保持 100% 确定且同一的分组', () => {
    const playerA = 'player-uuid-aaa-111';
    const playerB = 'player-uuid-bbb-222';

    const resultA1 = assignPlayerToExperiment(playerA, sampleExperiment);
    const resultA2 = assignPlayerToExperiment(playerA, sampleExperiment);
    const resultA3 = assignPlayerToExperiment(playerA, sampleExperiment);

    expect(resultA1.variantId).toBe(resultA2.variantId);
    expect(resultA1.variantId).toBe(resultA3.variantId);
    expect(resultA1.profile.profileId).toBe(resultA2.profile.profileId);
    expect(resultA1.experimentId).toBe('exp_v9_balance_q3');

    const resultB1 = assignPlayerToExperiment(playerB, sampleExperiment);
    const resultB2 = assignPlayerToExperiment(playerB, sampleExperiment);
    expect(resultB1.variantId).toBe(resultB2.variantId);
  });

  it('hashStringToUnitInterval 具备均匀分布且输出稳定在 [0, 1) 区间', () => {
    const values: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const val = hashStringToUnitInterval(`player_${i}:test_exp:salt`);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
      values.push(val);
    }
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    // 均值应接近 0.5 (容差 0.05)
    expect(avg).toBeGreaterThan(0.45);
    expect(avg).toBeLessThan(0.55);
  });

  it('试验未启用、关闭或不存在时，确定性回退到当前规则默认档案', () => {
    const disabledExperiment: ExperimentConfig = {
      ...sampleExperiment,
      enabled: false,
    };

    const result = assignPlayerToExperiment('player-uuid-123', disabledExperiment);
    expect(result.experimentId).toBeNull();
    expect(result.variantId).toBeNull();
    expect(result.profile.profileId).toBe('v9_standard');

    const nullResult = assignPlayerToExperiment('player-uuid-123', null);
    expect(nullResult.experimentId).toBeNull();
    expect(nullResult.variantId).toBeNull();
    expect(nullResult.profile.profileId).toBe('v9_standard');
  });

  it('多分组权重按比例分配', () => {
    const weightedExp: ExperimentConfig = {
      id: 'weighted_exp',
      name: '三组试验',
      enabled: true,
      rulesVersion: 9,
      variants: [
        { variantId: 'v_small', balanceProfileId: 'v9_standard', weight: 10 },
        { variantId: 'v_medium', balanceProfileId: 'v9_standard', weight: 30 },
        { variantId: 'v_large', balanceProfileId: 'v9_ea_tuned', weight: 60 },
      ],
    };

    const counts: Record<string, number> = { v_small: 0, v_medium: 0, v_large: 0 };
    const sampleSize = 1000;
    for (let i = 0; i < sampleSize; i++) {
      const res = assignPlayerToExperiment(`p_${i}`, weightedExp);
      if (res.variantId) {
        counts[res.variantId] = (counts[res.variantId] ?? 0) + 1;
      }
    }

    // 10% / 30% / 60% 分布检验
    expect(counts.v_small).toBeGreaterThan(50);
    expect(counts.v_small).toBeLessThan(160);
    expect(counts.v_medium).toBeGreaterThan(230);
    expect(counts.v_medium).toBeLessThan(370);
    expect(counts.v_large).toBeGreaterThan(500);
    expect(counts.v_large).toBeLessThan(700);
  });

  it('validateExperimentConfig 严格校验档案存在性与 rulesVersion 匹配', () => {
    // 合法配置
    const validRes = validateExperimentConfig(sampleExperiment);
    expect(validRes.valid).toBe(true);
    expect(validRes.errors.length).toBe(0);

    // 引用不存在的档案 ID
    const invalidProfileExp: ExperimentConfig = {
      ...sampleExperiment,
      variants: [
        { variantId: 'bad_var', balanceProfileId: 'non_existent_profile_xyz', weight: 100 },
      ],
    };
    const invalidProfileRes = validateExperimentConfig(invalidProfileExp);
    expect(invalidProfileRes.valid).toBe(false);
    expect(invalidProfileRes.errors[0]).toContain('non-existent balance profile');

    // 跨规则版本混配（V9 试验引用了 V4 档案）
    const mismatchedRulesExp: ExperimentConfig = {
      ...sampleExperiment,
      variants: [
        { variantId: 'v4_var', balanceProfileId: 'v4_standard', weight: 100 },
      ],
    };
    const mismatchedRes = validateExperimentConfig(mismatchedRulesExp);
    expect(mismatchedRes.valid).toBe(false);
    expect(mismatchedRes.errors[0]).toContain('rulesVersion 4, but experiment is configured for rulesVersion 9');
  });

  it('试验配置非法时拒绝伪装分流，安全回退到全服默认且不携带 experimentId', () => {
    const badExperiment: ExperimentConfig = {
      id: 'bad_exp',
      name: '非法试验',
      enabled: true,
      rulesVersion: 9,
      variants: [
        { variantId: 'bad_var', balanceProfileId: 'v4_standard', weight: 100 },
      ],
    };

    const res = assignPlayerToExperiment('player_123', badExperiment);
    expect(res.experimentId).toBeNull();
    expect(res.variantId).toBeNull();
    expect(res.profile.profileId).toBe('v9_standard');
  });
});
