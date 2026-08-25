import type { JiaziCard, TurnManager } from '@core/index';
import type { RoundLogEntry } from '@core/index';
import { cardTrace } from './cardSummary';

export interface PublicCardHistoryPoint {
  round: number;
  score: number;
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

export interface PublicCardHistoryViewModel {
  cardName: string;
  points: PublicCardHistoryPoint[];
  transactions: PublicCardHistoryTransaction[];
  currentScore: number;
  currentRound: number;
  earlyHistoryUnavailable: boolean;
}

export function buildPublicCardHistoryView(
  card: JiaziCard,
  turnManager: TurnManager,
  roundLog: readonly RoundLogEntry[],
): PublicCardHistoryViewModel {
  const points = turnManager
    .getPublicCardHistoryForCard(card.id)
    .map((point) => ({ round: point.round, score: point.score }));
  const trace = cardTrace([...roundLog], card.name);
  const transactions = trace
    .flatMap((item): PublicCardHistoryTransaction[] => {
      if (item.compatReconstructed || (item.kind !== 'buy' && item.kind !== 'sell' && item.kind !== 'settle')) return [];
      return [{
        round: item.round,
        actionRound: item.actionRound ?? item.round,
        season: item.season,
        kind: item.kind,
        value: item.value,
        qiCost: item.qiCost,
        buyScore: item.buyScore,
        earnings: item.earnings,
      }];
    })
    .sort((a, b) => a.actionRound - b.actionRound || a.round - b.round || a.kind.localeCompare(b.kind));

  const currentPoint = points[points.length - 1] ?? { round: turnManager.getCurrentRound(), score: turnManager.getCardScore(card, turnManager.getCurrentSeason()) };
  return {
    cardName: card.name,
    points,
    transactions,
    currentScore: currentPoint.score,
    currentRound: currentPoint.round,
    earlyHistoryUnavailable: points.length > 0 ? points[0]!.round > 1 : true,
  };
}
