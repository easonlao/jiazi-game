import type { StorageProvider } from '@core/index';

export const PENDING_TERMINATIONS_STORAGE_KEY = 'jiazi_pending_terminations';

export type TerminationReason = 'voluntary_termination' | 'new_game_override' | 'reset' | 'pagehide';

export interface PendingTerminationRecord {
  sessionId: string;
  playerId: string;
  clientSessionId?: string;
  reason: TerminationReason;
  roundsCompleted: number;
  finalScore: number;
  occurredAt: string;
  status: 'pending' | 'syncing';
  lastAttemptAt?: string;
  retryCount?: number;
  clientActionCount?: number;
  kind?: 'voluntary_termination' | 'corrupted_recovery';
  expectedSessionRevision?: number;
  expectedLastEventSequence?: number;
  localEventsUploaded?: number;
}

export function readAllPendingTerminations(
  storage: StorageProvider,
): Record<string, PendingTerminationRecord[]> {
  const raw = storage.getItem(PENDING_TERMINATIONS_STORAGE_KEY);
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return {};
    const result: Record<string, PendingTerminationRecord[]> = {};
    for (const [key, items] of Object.entries(data)) {
      if (Array.isArray(items)) {
        result[key] = items.filter(
          (item): item is PendingTerminationRecord =>
            Boolean(item) &&
            typeof item.sessionId === 'string' &&
            typeof item.playerId === 'string' &&
            typeof item.occurredAt === 'string',
        );
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function readPendingTerminations(
  storage: StorageProvider,
  playerId?: string | null,
): PendingTerminationRecord[] {
  if (!playerId) return [];
  const all = readAllPendingTerminations(storage);
  return all[playerId] ?? [];
}

export function writePendingTermination(
  storage: StorageProvider,
  record: PendingTerminationRecord,
): void {
  if (!record.playerId || !record.sessionId) return;
  const all = readAllPendingTerminations(storage);
  const list = all[record.playerId] ?? [];
  const existingIdx = list.findIndex((item) => item.sessionId === record.sessionId);
  if (existingIdx >= 0) {
    list[existingIdx] = { ...list[existingIdx], ...record };
  } else {
    list.push(record);
  }
  all[record.playerId] = list;
  storage.setItem(PENDING_TERMINATIONS_STORAGE_KEY, JSON.stringify(all));
}

export function removePendingTermination(
  storage: StorageProvider,
  playerId: string,
  sessionId: string,
): void {
  if (!playerId || !sessionId) return;
  const all = readAllPendingTerminations(storage);
  const list = all[playerId];
  if (!list) return;
  const filtered = list.filter((item) => item.sessionId !== sessionId);
  if (filtered.length === 0) {
    delete all[playerId];
  } else {
    all[playerId] = filtered;
  }
  if (Object.keys(all).length === 0) {
    storage.removeItem(PENDING_TERMINATIONS_STORAGE_KEY);
  } else {
    storage.setItem(PENDING_TERMINATIONS_STORAGE_KEY, JSON.stringify(all));
  }
}

export function clearPendingTerminations(
  storage: StorageProvider,
  playerId?: string | null,
): void {
  if (!playerId) {
    storage.removeItem(PENDING_TERMINATIONS_STORAGE_KEY);
    return;
  }
  const all = readAllPendingTerminations(storage);
  delete all[playerId];
  if (Object.keys(all).length === 0) {
    storage.removeItem(PENDING_TERMINATIONS_STORAGE_KEY);
  } else {
    storage.setItem(PENDING_TERMINATIONS_STORAGE_KEY, JSON.stringify(all));
  }
}
