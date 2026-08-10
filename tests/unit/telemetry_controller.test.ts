import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryController } from '../../app/src/lib/telemetryController';
import type { AnalyticsBackend } from '../../app/src/lib/analyticsBackend';
import type { StorageProvider } from '../../app/src/core/StorageProvider';

class MemoryStorage implements StorageProvider {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function createBackend() {
  return {
    ensureSession: vi.fn(async () => true),
    provision: vi.fn(),
    recoverIdentity: vi.fn(),
    updateDisplayName: vi.fn(async () => undefined),
    uploadEvents: vi.fn(async () => undefined),
    upsertSession: vi.fn(async () => undefined),
    submitLeaderboard: vi.fn(async () => undefined),
    fetchLeaderboard: vi.fn(async () => []),
  } satisfies AnalyticsBackend;
}

function seedIdentity(storage: MemoryStorage, eligible: boolean): void {
  storage.setItem(
    'jiazi_consent',
    JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-10T00:00:00.000Z' }),
  );
  storage.setItem(
    'jiazi_player_identity',
    JSON.stringify({
      player_id: 'player-1',
      public_player_id: 'public-1',
      public_code: 'PUBLIC001',
      display_name: eligible ? '测试玩家' : '玩家',
      leaderboard_eligible: eligible,
    }),
  );
}

function seedLegacyIdentity(storage: MemoryStorage): void {
  storage.setItem(
    'jiazi_consent',
    JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-10T00:00:00.000Z' }),
  );
  storage.setItem(
    'jiazi_player_identity',
    JSON.stringify({
      player_id: 'player-legacy',
      public_player_id: 'public-legacy',
      display_name: '旧玩家',
    }),
  );
}

const meta = {
  rules_version: '3',
  game_mode: 'standard',
  volatility_enabled: true,
};

describe('TelemetryController leaderboard eligibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('未设置用户名时只保留本地结果，不提交云端排行榜', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, false);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    expect(controller.startSession(meta)).toBe(true);
    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 1200, margin_call_count: 0 });

    await Promise.resolve();
    await Promise.resolve();
    expect(backend.submitLeaderboard).not.toHaveBeenCalled();
  });

  it('设置用户名后提交用户名对应的公开编码和分数', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    expect(controller.startSession(meta)).toBe(true);
    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 1200.4, margin_call_count: 0 });

    await vi.waitFor(() => expect(backend.submitLeaderboard).toHaveBeenCalledTimes(1));
    expect(backend.submitLeaderboard).toHaveBeenCalledWith(
      'player-1',
      expect.objectContaining({
        public_player_id: 'public-1',
        score: 1200.4,
        rules_version: '3',
      }),
    );
  });

  it('兼容旧本地身份：历史自定义名称仍可提交，缺失字段按规则回填', async () => {
    const storage = new MemoryStorage();
    seedLegacyIdentity(storage);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    expect(controller.startSession(meta)).toBe(true);
    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 900, margin_call_count: 0 });

    await vi.waitFor(() => expect(backend.submitLeaderboard).toHaveBeenCalledTimes(1));
    expect(backend.submitLeaderboard).toHaveBeenCalledWith(
      'player-legacy',
      expect.objectContaining({
        public_player_id: 'public-legacy',
        rules_version: '3',
      }),
    );
  });
});
