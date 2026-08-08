/**
 * 最优参数簇正式基准（由临时扫描脚本 _param_final.test.ts 转正，2026-08-08）。
 * 背景：三轮参数扫描（14→8→8 组）后收敛到最优簇，本脚本用于大样本精跑给出稳定分布。
 * 20000 局结论：≥6055.6(玩家) 概率 0.055%~0.070%；MAX≈6577~6666；best 局为零爆仓+杠杆全持有。
 * 运行：node node_modules/vitest/vitest.mjs run tests/unit/optimal_param_bench.test.ts
 */
import { describe, it } from 'vitest';
import { TurnManager, SeededRandomSource, Element } from '../../src/core/index';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import * as fs from 'node:fs';
import * as path from 'node:path';

const _log = console.log;
const OUT = path.join(__dirname, 'optimal_param_bench_results.txt');

interface Params {
  name: string;
  levThreshold: number;
  secondLevMinQi: number;
  maxLevSlots: number;
  clearRound: number | null;
  lockFuturePeak: number;
  buyMinCur: number;
  sellPullback: number;
  leverageTiming: 'any' | 'late';
  qiBuffer: number;
}

const VARIANTS: Params[] = [
  { name: 'J2_阈值15+锁30+buf3', levThreshold: 15, secondLevMinQi: 30, maxLevSlots: 2, clearRound: 5, lockFuturePeak: 30, buyMinCur: 13, sellPullback: 18, leverageTiming: 'any', qiBuffer: 3 },
  { name: 'J4_阈值15+锁32', levThreshold: 15, secondLevMinQi: 30, maxLevSlots: 2, clearRound: 5, lockFuturePeak: 32, buyMinCur: 13, sellPullback: 18, leverageTiming: 'any', qiBuffer: 5 },
];

function play(tm: TurnManager, p: Params) {
  let buy = 0, sell = 0, wait = 0, lev = 0, lock = 0, lockedBuy = 0;
  const peak = new Map<number, number>();
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
    for (const { s, i } of slots) {
      const cur = s.card.getSeasonScore(season);
      peak.set(i, Math.max(peak.get(i) ?? cur, cur));
    }
    const levCount = slots.filter(({ s }) => s!.useLeverage).length;

    if (slots.length > 0) {
      const ev = slots.map(({ s, i }) => {
        const cur = s!.card.getSeasonScore(season);
        const next = s!.card.getSeasonScore(nextSeason);
        return { i, s: s!, cur, next, gain: cur - s!.buyScore, drop: next - cur, pullback: (peak.get(i) ?? cur) - cur };
      });
      if (qi < 12 && slots.length > 0) {
        const w = [...ev].sort((a, b) => a.cur - b.cur)[0];
        if (tm.executeSell(w.i)) { acted = true; sell++; continue; }
      }
      const neg = ev.find((c) => c.cur < 0 && c.next < 0);
      if (neg && tm.executeSell(neg.i)) { acted = true; sell++; continue; }
      const pb = ev.find((c) => c.pullback >= p.sellPullback && c.cur > 10 && (c.s.useLeverage ? c.drop < 0 : true));
      if (pb && tm.executeSell(pb.i)) { acted = true; sell++; continue; }
      if (p.clearRound !== null && tm.getCurrentRound() === p.clearRound) {
        const all = [...ev].sort((a, b) => a.cur - b.cur);
        if (all[0] && tm.executeSell(all[0].i)) { acted = true; sell++; continue; }
      }
      if (isSeasonEnd) {
        const crash = [...ev].sort((a, b) => (a.s.useLeverage === b.s.useLeverage ? 0 : a.s.useLeverage ? -1 : 1))
          .find((c) => (c.s.useLeverage ? c.drop < -20 : c.drop < -12));
        if (crash && tm.executeSell(crash.i)) { acted = true; sell++; continue; }
      }
    }

    if (tm.getLockedCardIds().length < 2 && qi > 30 && cards.length > 0) {
      const afterIdx = (['spring', 'summer', 'autumn', 'winter'].indexOf(nextSeason) + 1) % 4;
      const afterNext = ['spring', 'summer', 'autumn', 'winter'][afterIdx];
      const cand = cards.map((c, idx) => {
        const cur = c.getSeasonScore(season);
        const next = c.getSeasonScore(nextSeason);
        const fp = Math.max(next, c.getSeasonScore(afterNext));
        return { idx, c, cur, fp, isEarth: c.mainElement === Element.EARTH };
      }).filter((x) => !tm.isCardLocked(x.c.id) && !x.isEarth && x.fp >= p.lockFuturePeak && x.cur <= 12)
        .sort((a, b) => b.fp - a.fp);
      const t = cand[0];
      if (t) { const r = tm.executeLockCard(t.idx); if (r.ok) { acted = true; lock++; continue; } }
    }

    if (canBuy && qi > 18) {
      const scored = cards.map((c, idx) => {
        const cur = c.getSeasonScore(season);
        const next = c.getSeasonScore(nextSeason);
        return { idx, c, cur, next, drop: next - cur, isEarth: c.mainElement === Element.EARTH };
      });
      if (isSeasonEnd) {
        const ambush = scored.filter((c) => c.drop >= 18 && c.cur <= 12).sort((a, b) => b.drop - a.drop)[0];
        if (ambush && qi > 25) {
          const cost = (tm as any).qiManager.calculateBuyCost(ambush.cur, false);
          if (qi > cost + 5 && tm.executeBuy(ambush.idx, false)) { buy++; acted = true; continue; }
        }
      }
      const hot = scored.filter((c) => tm.isCardLocked(c.c.id) && c.cur >= 15).sort((a, b) => b.cur - a.cur)[0];
      if (hot && qi > 22) {
        const cost = (tm as any).qiManager.calculateBuyCost(hot.cur, false);
        if (qi > cost + 8 && tm.executeBuy(hot.idx, false)) { buy++; lockedBuy++; acted = true; continue; }
      }
      if (levCount < p.maxLevSlots) {
        const wantLev = scored
          .filter((c) => c.cur >= p.levThreshold)
          .filter((c) => p.leverageTiming !== 'late' || roundInSeason >= 8)
          .sort((a, b) => b.cur - a.cur)[0];
        if (wantLev) {
          const second = levCount >= 1 && qi < p.secondLevMinQi;
          if (!second) {
            const cost = (tm as any).qiManager.calculateBuyCost(wantLev.cur, true);
            if (qi > cost + p.qiBuffer && tm.executeBuy(wantLev.idx, true)) { buy++; lev++; acted = true; continue; }
          }
        }
      }
      const byCur = [...scored].sort((a, b) => b.cur - a.cur)[0];
      if (byCur && byCur.cur >= p.buyMinCur && byCur.drop >= -10 && qi > 22) {
        const cost = (tm as any).qiManager.calculateBuyCost(byCur.cur, false);
        if (qi > cost + 5 && tm.executeBuy(byCur.idx, false)) { buy++; acted = true; continue; }
      }
    }

    if (!acted) { try { tm.executeWait(); wait++; } catch { break; } }
  }
  return {
    score: tm.getScore(), hold: tm.getTotalHoldEarnings(), sellE: tm.getTotalSellEarnings(),
    mc: tm.getMarginCallCount(), buy, sell, wait, lev, lock, lockedBuy,
  };
}

describe('optimal-param-bench', () => {
  it('J2/J4 20000 each', async () => {
    const GAMES = 20000;
    for (const p of VARIANTS) {
      const res: ReturnType<typeof play>[] = [];
      for (let g = 0; g < GAMES; g++) {
        const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(700000 + g * 13));
        await tm.initialize();
        tm.startGame();
        res.push(play(tm, p));
      }
      const scores = res.map((r) => r.score).sort((a, b) => a - b);
      const q = (x: number) => scores[Math.floor((scores.length - 1) * x)];
      const over = (v: number) => res.filter((r) => r.score >= v).length;
      const best = res.reduce((a, b) => (a.score > b.score ? a : b));
      const lines = [
        `=== ${p.name} (${GAMES} games) ===`,
        `P50=${q(0.5).toFixed(0)} P90=${q(0.9).toFixed(0)} P95=${q(0.95).toFixed(0)} P99=${q(0.99).toFixed(0)} MAX=${scores[scores.length - 1].toFixed(0)} mean=${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(0)}`,
        `≥5900: ${over(5900)}局(${(over(5900) / GAMES * 100).toFixed(3)}%)  ≥6000: ${over(6000)}局(${(over(6000) / GAMES * 100).toFixed(3)}%)  ≥6055.6: ${over(6055.6)}局(${(over(6055.6) / GAMES * 100).toFixed(3)}%)`,
        `mc%=${(res.filter((r) => r.mc > 0).length / res.length * 100).toFixed(1)}`,
        `BEST score=${best.score.toFixed(1)} hold=${best.hold.toFixed(1)} sell=${best.sellE.toFixed(1)} mc=${best.mc} lev=${best.lev} lock=${best.lock} lockedBuy=${best.lockedBuy} buy=${best.buy} sellN=${best.sell}`,
        '',
      ];
      fs.appendFileSync(OUT, lines.join('\n'));
      _log(lines.join('\n'));
    }
    _log('=== FINAL DONE ===');
  }, 900000);
});
