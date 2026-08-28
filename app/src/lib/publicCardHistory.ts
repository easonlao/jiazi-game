import type { JiaziCard, TurnManager } from '@core/index';
import type { RoundLogEntry } from '@core/index';
import { cardTrace } from './cardSummary';

export interface PublicCardHistoryPoint {
  round: number;
  score: number;
  season: string | null;
}

export interface PublicCardHistorySeasonBand {
  season: string;
  startRound: number;
  endRound: number;
  startIndex: number;
  endIndex: number;
}

export interface PublicCardHistoryTransaction {
  round: number;
  actionRound: number;
  season: string;
  kind: 'buy' | 'sell' | 'settle';
  value: number;
  qiCost: number;
  buyScore: number | null;
  earnings: number;
}

export interface PublicCardHistoryVoidEvent {
  round: number;
  count: number;
  totalK: number;
  maxK: number;
  swallowed: number;
}

export interface PublicCardHistoryViewModel {
  cardName: string;
  points: PublicCardHistoryPoint[];
  seasonBands: PublicCardHistorySeasonBand[];
  transactions: PublicCardHistoryTransaction[];
  voidEvents: PublicCardHistoryVoidEvent[];
  currentScore: number;
  currentRound: number;
  earlyHistoryUnavailable: boolean;
  hasUnknownSeasons: boolean;
}

export function computeSeasonBands(points: readonly PublicCardHistoryPoint[]): PublicCardHistorySeasonBand[] {
  const bands: PublicCardHistorySeasonBand[] = [];
  let currentBand: PublicCardHistorySeasonBand | null = null;

  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!point || !point.season) {
      currentBand = null;
      continue;
    }

    if (currentBand && currentBand.season === point.season && currentBand.endIndex === index - 1) {
      currentBand.endRound = point.round;
      currentBand.endIndex = index;
    } else {
      currentBand = {
        season: point.season,
        startRound: point.round,
        endRound: point.round,
        startIndex: index,
        endIndex: index,
      };
      bands.push(currentBand);
    }
  }

  return bands;
}

export function buildPublicCardHistoryView(
  card: JiaziCard,
  turnManager: TurnManager,
  roundLog: readonly RoundLogEntry[],
): PublicCardHistoryViewModel {
  const confirmedSeasons = new Map<number, string>();
  for (const entry of roundLog) {
    if (!entry.compatReconstructed && entry.season) {
      confirmedSeasons.set(entry.round, entry.season);
    }
  }
  const currentRound = turnManager.getCurrentRound();
  const currentSeason = turnManager.getCurrentSeason();
  if (!confirmedSeasons.has(currentRound) && currentSeason) {
    confirmedSeasons.set(currentRound, currentSeason);
  }

  const rawPoints = turnManager.getPublicCardHistoryForCard(card.id);
  const points: PublicCardHistoryPoint[] = rawPoints.map((point) => ({
    round: point.round,
    score: point.score,
    season: confirmedSeasons.get(point.round) ?? null,
  }));

  const seasonBands = computeSeasonBands(points);
  const hasUnknownSeasons = points.some((p) => p.season === null);

  const trace = cardTrace([...roundLog], card.name);
  const transactions = trace
    .flatMap((item): PublicCardHistoryTransaction[] => {
      if (item.compatReconstructed || (item.kind !== 'buy' && item.kind !== 'sell' && item.kind !== 'settle')) return [];
      const actionRound = item.actionRound ?? item.round;
      const derivedSeason = confirmedSeasons.get(actionRound) ?? item.season;
      return [{
        round: item.round,
        actionRound,
        season: derivedSeason,
        kind: item.kind,
        value: item.value,
        qiCost: item.qiCost,
        buyScore: item.buyScore,
        earnings: item.earnings,
      }];
    })
    .sort((a, b) => a.actionRound - b.actionRound || a.round - b.round || a.kind.localeCompare(b.kind));

  const voidEvents: PublicCardHistoryVoidEvent[] = [];
  for (const entry of roundLog) {
    if (!entry.compatReconstructed && entry.voidSwallow && entry.voidSwallow.totalK > 0) {
      voidEvents.push({
        round: entry.round,
        count: entry.voidSwallow.count,
        totalK: entry.voidSwallow.totalK,
        maxK: entry.voidSwallow.maxK,
        swallowed: entry.voidSwallow.swallowed ?? 0,
      });
    }
  }
  voidEvents.sort((a, b) => a.round - b.round);

  const currentPoint = points[points.length - 1] ?? {
    round: currentRound,
    score: turnManager.getCardScore(card, currentSeason),
    season: currentSeason,
  };

  return {
    cardName: card.name,
    points,
    seasonBands,
    transactions,
    voidEvents,
    currentScore: currentPoint.score,
    currentRound: currentPoint.round,
    earlyHistoryUnavailable: points.length > 0 ? points[0]!.round > 1 : true,
    hasUnknownSeasons,
  };
}
