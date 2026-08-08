/**
 * 上限对齐评价验证（2026-08-08）。
 *
 * 目标：证明新评价（evaluateCeiling 六维）与最终分数强相关，旧评价
 * （decisionQualityScore 情境做对率）与分数脱钩。
 *
 * 方法：四策略 × 同 seed（牌运一致，纯策略差异）：
 *   OPT      调参最优簇（levThreshold=15/lockFuturePeak=30/buyMinCur=13/any 时机）→ 高分组
 *   LATE     会玩但杠杆只在季内后半程 → 中高分组（验证 timing 维度区分"杠杆时机"而非仅"有无杠杆"）
 *   CONS     保守但会玩（完全不杠杆 + 买 cur≥15 + 锁高峰 30 + 回撤 15 卖）→ 中分组
 *   PASSIVE  摆烂（几乎只调息，极少买入）→ 低分组
 * 每局收集分数 + 行为统计 + decisionLog → 算新旧评价分 → Spearman 相关。
 *
 * 判据：新评价分 vs 分数 ρ ≥ 0.7（强相关）；旧评价分 vs 分数应显著更低（展示脱钩）。
 * 运行：node node_modules/vitest/vitest.mjs run tests/unit/ceiling_validation.test.ts
 */
import { describe, it } from 'vitest';
import { TurnManager, SeededRandomSource, Element } from '../../src/core/index';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { evaluateCeiling, decisionQualityScore, evaluateDecisions, type BehaviorInput } from '../../app/src/lib/gameReview';
import * as fs from 'node:fs';
import * as path from 'node:path';

const _log = console.log;
const OUT = path.join(__dirname, 'ceiling_validation_results.txt');

type Mode = 'OPT' | 'LATE' | 'CONS' | 'PASSIVE';

function play(tm: TurnManager, mode: Mode) {
  for (let i = 0; i < 200; i++) {
    if (tm.getState() !== 'player_action') break;
    const qi = tm.getQi();
    const hand = tm.getHand();
    const cards = tm.getPublicCards();
    const handCount = hand.filter((s) => s !== null).length;
    const canBuy = handCount < 3 && cards.length > 0;
    const season = tm.getCurrentSeason();
    const nextSeason = tm.getFollowingSeason();
    const roundInSeason = tm.getCurrentRoundInSeason();
    const seasonLen = tm.getCurrentSeasonLength();
    const isSeasonEnd = roundInSeason >= seasonLen - 1;
    let acted = false;

    const slots = hand.map((s, i) => ({ s, i })).filter((x) => x.s !== null);
    const levCount = slots.filter(({ s }) => s!.useLeverage).length;

    // ── PASSIVE：几乎不做事 ──
    if (mode === 'PASSIVE') {
      // 只在神识极充裕且手牌空时买一张高分牌，其余全部调息
      const canBuyNow = canBuy && qi > 60 && handCount === 0;
      if (canBuyNow) {
        const top = cards
          .map((c, idx) => ({ idx, cur: c.getSeasonScore(season) }))
          .sort((a, b) => b.cur - a.cur)[0];
        if (top && top.cur >= 25) { tm.executeBuy(top.idx, false); acted = true; }
      }
      if (!acted) { try { tm.executeWait(); } catch { break; } }
      continue;
    }

    // ── 卖出逻辑（OPT/CONS 共用骨架，参数不同）──
    const peak = new Map<number, number>();
    for (const { s, i } of slots) {
      const cur = s!.card.getSeasonScore(season);
      peak.set(i, Math.max(peak.get(i) ?? cur, cur));
    }
    const ev = slots.map(({ s, i }) => {
      const cur = s!.card.getSeasonScore(season);
      const next = s!.card.getSeasonScore(nextSeason);
      return { i, s: s!, cur, next, gain: cur - s!.buyScore, drop: next - cur, pullback: (peak.get(i) ?? cur) - cur };
    });
    if (mode === 'CONS' || mode === 'LATE') {
      // 保守但会玩：不杠杆，持有为主（回撤 15 才卖，比 OPT 的 18 早），正常止损与应急
      if (qi < 12 && slots.length > 0) {
        const w = [...ev].sort((a, b) => a.cur - b.cur)[0];
        if (tm.executeSell(w.i)) { acted = true; }
      }
      if (!acted) {
        const neg = ev.find((c) => c.cur < 0 && c.next < 0);
        if (neg && tm.executeSell(neg.i)) { acted = true; }
      }
      if (!acted) {
        const pb = ev.find((c) => c.pullback >= 15 && c.cur > 12);
        if (pb && tm.executeSell(pb.i)) { acted = true; }
      }
      if (!acted && isSeasonEnd) {
        const crash = ev.find((c) => c.drop < -12);
        if (crash && tm.executeSell(crash.i)) { acted = true; }
      }
    } else {
      // OPT：清仓日 + 回撤 18 卖（调参最优簇行为）
      if (qi < 12 && slots.length > 0) {
        const w = [...ev].sort((a, b) => a.cur - b.cur)[0];
        if (tm.executeSell(w.i)) { acted = true; }
      }
      if (!acted) {
        const neg = ev.find((c) => c.cur < 0 && c.next < 0);
        if (neg && tm.executeSell(neg.i)) { acted = true; }
      }
      if (!acted) {
        const pb = ev.find((c) => c.pullback >= 18 && c.cur > 10 && (c.s.useLeverage ? c.drop < 0 : true));
        if (pb && tm.executeSell(pb.i)) { acted = true; }
      }
      if (!acted && tm.getCurrentRound() === 5) {
        const all = [...ev].sort((a, b) => a.cur - b.cur);
        if (all[0] && tm.executeSell(all[0].i)) { acted = true; }
      }
      if (!acted && isSeasonEnd) {
        const crash = [...ev].sort((a, b) => (a.s.useLeverage === b.s.useLeverage ? 0 : a.s.useLeverage ? -1 : 1))
          .find((c) => (c.s.useLeverage ? c.drop < -20 : c.drop < -12));
        if (crash && tm.executeSell(crash.i)) { acted = true; }
      }
    }

    // ── 锁定（OPT/LATE/CONS 都锁高峰 30；PASSIVE 不锁）──
    // PASSIVE 分支已提前 continue，此处 mode 恒非 PASSIVE（TS 收窄），比较冗余
    if (tm.getLockedCardIds().length < 2 && qi > 30 && cards.length > 0 && !acted) {
      const afterIdx = (['spring', 'summer', 'autumn', 'winter'].indexOf(nextSeason) + 1) % 4;
      const afterNext = ['spring', 'summer', 'autumn', 'winter'][afterIdx];
      const cand = cards.map((c, idx) => {
        const cur = c.getSeasonScore(season);
        const next = c.getSeasonScore(nextSeason);
        const fp = Math.max(next, c.getSeasonScore(afterNext));
        return { idx, c, cur, fp, isEarth: c.mainElement === Element.EARTH };
      }).filter((x) => !tm.isCardLocked(x.c.id) && !x.isEarth && x.fp >= 30 && x.cur <= 12)
        .sort((a, b) => b.fp - a.fp);
      const t = cand[0];
      if (t) { const r = tm.executeLockCard(t.idx); if (r.ok) acted = true; }
    }

    // ── 买入 ──
    if (canBuy && qi > 18 && !acted) {
      const scored = cards.map((c, idx) => {
        const cur = c.getSeasonScore(season);
        const next = c.getSeasonScore(nextSeason);
        return { idx, c, cur, next, drop: next - cur, isEarth: c.mainElement === Element.EARTH };
      });
      const hot = scored.filter((c) => tm.isCardLocked(c.c.id) && c.cur >= 15).sort((a, b) => b.cur - a.cur)[0];
      if (mode === 'OPT' && hot && qi > 22) {
        const cost = (tm as any).qiManager.calculateBuyCost(hot.cur, false);
        if (qi > cost + 8 && tm.executeBuy(hot.idx, false)) { acted = true; }
      }
      if (!acted && (mode === 'OPT' || mode === 'LATE') && levCount < 2) {
        const wantLev = scored.filter((c) => c.cur >= 15).sort((a, b) => b.cur - a.cur)[0];
        if (wantLev) {
          // LATE 只在季内后半程 + 神识充足时才杠杆，其余与 CONS 相同（隔离"杠杆时机"单一变量）
          const lateOk = mode === 'LATE' ? roundInSeason >= seasonLen * 0.5 && qi >= 35 : true;
          if (lateOk) {
            const second = levCount >= 1 && qi < 30;
            if (!second) {
              const cost = (tm as any).qiManager.calculateBuyCost(wantLev.cur, true);
              if (qi > cost + 3 && tm.executeBuy(wantLev.idx, true)) { acted = true; }
            }
          }
        }
      }
      if (!acted) {
        // OPT 买 cur≥13 潜力牌；CONS 买 cur≥15 但不杠杆（保守）
        const floor = mode === 'OPT' ? 13 : 15;
        const byCur = [...scored].sort((a, b) => b.cur - a.cur)[0];
        if (byCur && byCur.cur >= floor && byCur.drop >= -10 && qi > 22) {
          const cost = (tm as any).qiManager.calculateBuyCost(byCur.cur, false);
          if (qi > cost + 5 && tm.executeBuy(byCur.idx, false)) { acted = true; }
        }
      }
    }

    if (!acted) { try { tm.executeWait(); } catch { break; } }
  }
  return tm;
}

/** Spearman 秩相关 */
function spearman(xs: number[], ys: number[]): number {
  const rank = (arr: number[]) => {
    const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const r = new Array(arr.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k].i] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

describe('ceiling-validation', () => {
  it('新评价 vs 分数强相关，旧评价脱钩', async () => {
    const GAMES = 1500;
    const byMode: Record<Mode, { score: number; newQ: number; oldQ: number; dims: Record<string, number>; hold: number; sell: number; badCardHits: number; badCardTotal: number }[]> = {
      OPT: [], LATE: [], CONS: [], PASSIVE: [],
    };
    for (const mode of ['OPT', 'LATE', 'CONS', 'PASSIVE'] as Mode[]) {
      for (let g = 0; g < GAMES; g++) {
        const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(900000 + g * 13));
        await tm.initialize();
        tm.startGame();
        play(tm, mode);
        const log = tm.getDecisionLog();
        const badCardHits = log.some((d) => d.scenario === 'bad_card_holding') ? 1 : 0;
        const badCardTotal = log.filter((d) => d.scenario === 'bad_card_holding').length;
        const b: BehaviorInput = {
          totalBuys: tm.getTotalBuys(), totalSells: tm.getTotalSells(), totalWaits: tm.getTotalWaits(),
          totalLeverageBuys: tm.getTotalLeverageBuys(), totalLocks: tm.getTotalLocks(),
          marginCallCount: tm.getMarginCallCount(), score: tm.getScore(),
          totalHoldEarnings: tm.getTotalHoldEarnings(), totalSellEarnings: tm.getTotalSellEarnings(),
          totalSettleEarnings: tm.getTotalSettleEarnings(), totalMarginCallPenalty: tm.getTotalMarginCallPenalty(),
        };
        const ceiling = evaluateCeiling(b, log);
        const oldQ = decisionQualityScore(evaluateDecisions(log));
        const dims: Record<string, number> = {};
        for (const d of ceiling.dims) dims[d.key] = d.score;
        byMode[mode].push({ score: b.score, newQ: ceiling.total, oldQ, dims, hold: b.totalHoldEarnings ?? 0, sell: b.totalSellEarnings ?? 0, badCardHits, badCardTotal });
      }
    }
    const all = [...byMode.OPT, ...byMode.LATE, ...byMode.CONS, ...byMode.PASSIVE];
    const scores = all.map((r) => r.score);
    const newQ = all.map((r) => r.newQ);
    const oldQ = all.map((r) => r.oldQ);
    const rhoNew = spearman(scores, newQ);
    const rhoOld = spearman(scores, oldQ);
    const dimRho: [string, number][] = (['hold', 'leverage', 'timing', 'mc', 'stop', 'lock'] as const).map((k) => [k, spearman(scores, all.map((r) => r.dims[k]))]);

    // ── 权重敏感性：候选组合的综合 ρ（复用 all 的 dims，不重跑游戏）──
    const combos: [string, Record<string, number>][] = [
      ['current', { hold: 0.30, leverage: 0.20, timing: 0.15, mc: 0.15, stop: 0.10, lock: 0.10 }],
      ['weak-down', { hold: 0.36, leverage: 0.24, timing: 0.08, mc: 0.08, stop: 0.12, lock: 0.12 }],
      ['aggressive', { hold: 0.40, leverage: 0.25, timing: 0.05, mc: 0.05, stop: 0.13, lock: 0.12 }],
      ['mild', { hold: 0.32, leverage: 0.22, timing: 0.10, mc: 0.10, stop: 0.13, lock: 0.13 }],
    ];
    const comboLines = combos.map(([name, w]) => {
      const q = all.map((r) => {
        let t = 0;
        for (const [k, v] of Object.entries(w)) t += r.dims[k] * v;
        return t * 100;
      });
      return `  ${name}: rho=${spearman(scores, q).toFixed(3)} | ${Object.entries(w).map(([k, v]) => `${k}=${v}`).join(' ')}`;
    });

    const stat = (mode: Mode) => {
      const rs = byMode[mode];
      const ss = rs.map((r) => r.score).sort((a, b) => a - b);
      const q = (x: number) => ss[Math.floor((ss.length - 1) * x)];
      const nq = rs.map((r) => r.newQ).sort((a, b) => a - b);
      const nq50 = nq[Math.floor((nq.length - 1) * 0.5)];
      const nq90 = nq[Math.floor((nq.length - 1) * 0.9)];
      const best = rs.reduce((a, b) => (a.score > b.score ? a : b));
      return `score P50=${q(0.5).toFixed(0)} P90=${q(0.9).toFixed(0)} MAX=${q(1).toFixed(0)} | newQ P50=${nq50.toFixed(0)} P90=${nq90.toFixed(0)} | best(score=${best.score.toFixed(0)} newQ=${best.newQ})`;
    };

    const hitStat = (mode: Mode) => {
      const rs = byMode[mode];
      const hits = rs.filter((r) => r.badCardHits === 1).length;
      const avgEntries = rs.reduce((s, r) => s + r.badCardTotal, 0) / rs.length;
      const stop50 = rs.map((r) => r.dims.stop).sort((a, b) => a - b)[Math.floor(rs.length * 0.5)];
      const stopMean = rs.reduce((s, r) => s + r.dims.stop, 0) / rs.length;
      return `badCard局=${hits}/${rs.length}(${(hits / rs.length * 100).toFixed(0)}%) avg条目=${avgEntries.toFixed(2)} stopP50=${stop50.toFixed(2)} stop均值=${stopMean.toFixed(2)}`;
    };

    const lines = [
      '=== ceiling_validation (4 modes × 1500 games, same seeds) ===',
      `mode\tscoreP50\tscoreP90\tscoreMAX\tnewQ_P50\tnewQ_P90`,
      `OPT\t${stat('OPT')}`,
      `LATE\t${stat('LATE')}`,
      `CONS\t${stat('CONS')}`,
      `PASSIVE\t${stat('PASSIVE')}`,
      ``,
      `badCard 命中:`,
      `  OPT\t${hitStat('OPT')}`,
      `  LATE\t${hitStat('LATE')}`,
      `  CONS\t${hitStat('CONS')}`,
      `  PASSIVE\t${hitStat('PASSIVE')}`,
      '',
      `Spearman(score, NEW ceiling) = ${rhoNew.toFixed(3)}`,
      `Spearman(score, OLD decisionQuality) = ${rhoOld.toFixed(3)}`,
      `dim rho: ${dimRho.map(([k, v]) => `${k}=${v.toFixed(3)}`).join('  ')}`,
      '',
      `weight combos:`,
      ...comboLines,
      '',
    ];
    fs.writeFileSync(OUT, lines.join('\n'));
    _log(lines.join('\n'));
    _log('=== DONE ===');
  }, 600000);
});
