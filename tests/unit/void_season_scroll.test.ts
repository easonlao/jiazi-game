/**
 * 空亡倒数序列生成（buildVoidCountdown）单元测试。
 *
 * 2026-08-14 重构：引擎（TurnManager.processVoidRound）已给出 K 步推进的完整轨迹 path
 * （每步 { season, roundInSeason }，长度 = k），本模块据此生成动画倒数序列：
 * 每步「剩余 K 数（从 k 倒数）+ 当前位置（季节名 + 季内回合数）」。
 * 旧 buildVoidJourney（季节轮播段序列）已删除——引擎给 path 后无需再推导跳转段。
 */
import { describe, it, expect } from 'vitest';
import { buildVoidCountdown } from '../../app/src/lib/voidSeasonScroll';

describe('buildVoidCountdown（空亡倒数序列，从引擎 path 生成）', () => {
  it('从 path 生成倒数序列：每步 { season, roundInSeason, remaining }，长度 = path.length = k', () => {
    const path = [
      { season: 'summer', roundInSeason: 4 },
      { season: 'summer', roundInSeason: 5 },
      { season: 'summer', roundInSeason: 6 },
      { season: 'autumn', roundInSeason: 1 },
      { season: 'autumn', roundInSeason: 2 },
    ];
    const seq = buildVoidCountdown(path, 5);
    expect(seq).toEqual([
      { season: 'summer', roundInSeason: 4, remaining: 5 },
      { season: 'summer', roundInSeason: 5, remaining: 4 },
      { season: 'summer', roundInSeason: 6, remaining: 3 },
      { season: 'autumn', roundInSeason: 1, remaining: 2 },
      { season: 'autumn', roundInSeason: 2, remaining: 1 },
    ]);
  });

  it('跨季切换季节名：season 字段随 path 每步变化（动画「当前位置」据此换季）', () => {
    const seq = buildVoidCountdown([
      { season: 'autumn', roundInSeason: 12 },
      { season: 'winter', roundInSeason: 1 },
      { season: 'winter', roundInSeason: 2 },
    ], 3);
    expect(seq.map((s) => s.season)).toEqual(['autumn', 'winter', 'winter']);
    expect(seq[1]).toEqual({ season: 'winter', roundInSeason: 1, remaining: 2 });
  });

  it('remaining 从 k 递减到 1（K 归 0 停留步由组件以剩余 0 显示最终位置）', () => {
    const seq = buildVoidCountdown([
      { season: 'spring', roundInSeason: 1 },
      { season: 'spring', roundInSeason: 2 },
      { season: 'spring', roundInSeason: 3 },
    ], 3);
    expect(seq.map((s) => s.remaining)).toEqual([3, 2, 1]);
  });

  it('k 为 NaN/±Infinity：remaining 回退 1，不抛错（P2-3 防御保留）', () => {
    const path = [{ season: 'spring', roundInSeason: 2 }];
    expect(buildVoidCountdown(path, Number.NaN)).toEqual([{ season: 'spring', roundInSeason: 2, remaining: 1 }]);
    expect(buildVoidCountdown(path, Number.POSITIVE_INFINITY)[0]!.remaining).toBe(1);
    expect(buildVoidCountdown(path, Number.NEGATIVE_INFINITY)[0]!.remaining).toBe(1);
  });

  it('空 path：返回空序列（引擎保证 path 长度 = k；防御不抛错）', () => {
    expect(buildVoidCountdown([], 3)).toEqual([]);
  });

  it('票 01：插入起点帧（剩余 K + 触发前位置），随后每步递增、剩余递减到 0', () => {
    const path = [
      { season: 'summer', roundInSeason: 4 },
      { season: 'summer', roundInSeason: 5 },
    ];
    const seq = buildVoidCountdown(path, 2, 'summer', 3);
    expect(seq).toEqual([
      { season: 'summer', roundInSeason: 3, remaining: 2 }, // 起点帧：触发前位置（当前回合）
      { season: 'summer', roundInSeason: 4, remaining: 1 },
      { season: 'summer', roundInSeason: 5, remaining: 0 },
    ]);
    // 长度 = k + 1（起点帧 + path 的 k 步）
    expect(seq).toHaveLength(path.length + 1);
  });

  it('票 01：跨季起点帧 + 剩余递减到 0（位置从当前回合开始，逐步跨季切换季节名）', () => {
    const path = [
      { season: 'summer', roundInSeason: 7 },
      { season: 'autumn', roundInSeason: 1 },
    ];
    const seq = buildVoidCountdown(path, 2, 'summer', 6);
    expect(seq.map((s) => s.remaining)).toEqual([2, 1, 0]);
    expect(seq[0]).toEqual({ season: 'summer', roundInSeason: 6, remaining: 2 });
    expect(seq[1]).toEqual({ season: 'summer', roundInSeason: 7, remaining: 1 });
    expect(seq[2]).toEqual({ season: 'autumn', roundInSeason: 1, remaining: 0 });
  });

  it('票 01：无 prevSeason/prevRoundInSeason 时省略起点帧（防御路径，保持旧语义递减到 1）', () => {
    const seq = buildVoidCountdown([
      { season: 'spring', roundInSeason: 1 },
      { season: 'spring', roundInSeason: 2 },
    ], 2);
    expect(seq).toEqual([
      { season: 'spring', roundInSeason: 1, remaining: 2 },
      { season: 'spring', roundInSeason: 2, remaining: 1 },
    ]);
  });
});
