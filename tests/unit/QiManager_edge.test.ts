import { describe, it, expect } from 'vitest';
import { QiManager } from '../../src/core/QiManager';

describe('QiManager - 气耗管理边界测试', () => {
  it('应该处理低气开局（10气）', () => {
    const qiManager = new QiManager(10); // 初始10气
    
    // 自然回复10气
    qiManager.recover(10);
    expect(qiManager.getQi()).toBe(20);
  });

  it('应该处理高气开局（80气）', () => {
    const qiManager = new QiManager(80); // 初始80气
    
    // 自然回复10气，但不能超过上限
    qiManager.recover(10);
    expect(qiManager.getQi()).toBe(80); // 不能超过上限
  });

  it('应该正确计算买入消耗', () => {
    const qiManager = new QiManager(50);
    
    // 买入消耗 = Math.ceil(11 * (1 + 0.005 * 评分))（评分×10整数化，系数÷10）
    // 评分40（×10后4.0）时：Math.ceil(11 * (1 + 0.005 * 40)) = Math.ceil(13.2) = 14
    const cost = qiManager.calculateBuyCost(40);
    expect(cost).toBe(14);
  });

  it('应该正确计算等待额外回复', () => {
    const qiManager = new QiManager(50);
    
    // 等待额外回复10气
    qiManager.recover(10);
    expect(qiManager.getQi()).toBe(60);
  });

  it('应该处理气耗后气为负数的情况', () => {
    const qiManager = new QiManager(5);
    
    // 气耗后气为负数，应该触发爆仓检查
    qiManager.deductQi(10);
    expect(qiManager.getQi()).toBeLessThanOrEqual(0);
    expect(qiManager.isMarginCall()).toBe(true);
  });

  it('验证 spend 与 deductQi 的差别以及强制扣气', () => {
    const qiManager = new QiManager(50);
    // spend 不允许扣为负数，且返回 false
    const spendResult = qiManager.spend(60);
    expect(spendResult).toBe(false);
    expect(qiManager.getQi()).toBe(50);

    // deductQi 允许扣为负数
    qiManager.deductQi(60);
    expect(qiManager.getQi()).toBe(-10);
    expect(qiManager.isMarginCall()).toBe(true);
  });

  it('应该正确获取基础回复量', () => {
    const qiManager = new QiManager(50);
    expect(qiManager.getBaseRecovery()).toBe(10);
    expect(qiManager.getWaitBonus()).toBe(10);
  });
});
