import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SupabaseAnalyticsBackend } from '../../app/src/lib/analyticsBackend';
import { TelemetryController } from '../../app/src/lib/telemetryController';
import { calculatePerseveranceSummary } from '../../app/src/lib/cultivationProfile';
import { CURRENT_RULES_VERSION, CURRENT_REPLAY_RULES, cloneReplayRulesSnapshot } from '../../src/core';
import { TurnManager } from '../../src/core/TurnManager';
import { SeededRandomSource } from '../../src/core/RandomSource';
import { useGameStore, setTelemetryControllerForTesting } from '../../app/src/store';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
  clear(): void { this.data.clear(); }
  get length(): number { return this.data.size; }
  key(index: number): string | null { return Array.from(this.data.keys())[index] ?? null; }
}

/**
 * 模拟完整的真实 Supabase 数据库引擎（含 game_sessions 表、game_events 表、
 * cultivation_ledger_entries 表，以及 upsert_game_session_impl 存储过程和
 * trg_sync_game_session_to_cultivation_ledger 触发器行为）。
 */
class SimulatedSupabaseDatabase {
  gameSessions: Map<string, any> = new Map();
  gameEvents: any[] = [];
  cultivationLedger: Map<string, any> = new Map(); // key: ${player_id}:
  playerLinks: Map<string, string> = new Map(); // auth_user_id -> player_id

  constructor(public authUserId: string, public playerId: string) {
    this.playerLinks.set(authUserId, playerId);
  }

  // 模拟 private.upsert_game_session_impl
  rpcUpsertGameSession(args: {
    p_player_id: string;
    p_session_id: string;
    p_client_session_id: string;
    p_started_at: string;
    p_status: 'started' | 'running' | 'completed' | 'abandoned';
    p_rounds_completed: number;
    p_final_score: number;
    p_rules_version: string;
    p_game_mode: string;
    p_app_version: string;
    p_consent_version: string;
    p_ended_at?: string | null;
  }) {
    // RLS check
    if (this.playerLinks.get(this.authUserId) !== args.p_player_id) {
      throw new Error('session player does not belong to current user');
    }

    // 查找既有会话：按 id 或 client_session_id 匹配
    let existing: any = null;
    for (const sess of this.gameSessions.values()) {
      if (sess.player_id === args.p_player_id && (sess.id === args.p_session_id || sess.client_session_id === args.p_client_session_id)) {
        existing = sess;
        break;
      }
    }

    if (existing) {
      if (['completed', 'failed', 'corrupted_recovery'].includes(existing.status)) {
        return existing;
      }
      if (existing.status === 'abandoned' && args.p_status !== 'corrupted_recovery') {
        return existing;
      }
      if (['started', 'running'].includes(args.p_status)) {
        return existing;
      }

      existing.status = args.p_status;
      existing.rounds_completed = args.p_rounds_completed;
      existing.final_score = args.p_final_score;
      existing.ended_at = args.p_ended_at ?? new Date().toISOString();
      this.fireTrigger(existing);
      return existing;
    }

    // 若新开局，先将既有 started/running 会话标记为 abandoned
    if (['started', 'running'].includes(args.p_status)) {
      for (const sess of this.gameSessions.values()) {
        if (sess.player_id === args.p_player_id && ['started', 'running'].includes(sess.status)) {
          sess.status = 'abandoned';
          sess.ended_at = new Date().toISOString();
          this.fireTrigger(sess);
        }
      }
    }

    const newSession = {
      id: args.p_session_id || 'uuid-' + Math.random(),
      player_id: args.p_player_id,
      client_session_id: args.p_client_session_id,
      rules_version: args.p_rules_version,
      game_mode: args.p_game_mode,
      app_version: args.p_app_version,
      consent_version: args.p_consent_version,
      status: args.p_status,
      started_at: args.p_started_at || new Date().toISOString(),
      ended_at: args.p_ended_at ?? null,
      rounds_completed: args.p_rounds_completed,
      final_score: args.p_final_score,
      replay_seed: 12345,
      rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
    };
    this.gameSessions.set(newSession.id, newSession);
    this.fireTrigger(newSession);
    return newSession;
  }

  // 模拟触发器 trg_sync_game_session_to_cultivation_ledger
  private fireTrigger(sess: any) {
    if (['completed', 'abandoned'].includes(sess.status)) {
      const key = `${sess.player_id}:${sess.id}`;
      const entry = {
        player_id: sess.player_id,
        local_game_id: sess.id,
        game_session_id: sess.id,
        rules_version: Number(sess.rules_version) || 1,
        started_at: sess.started_at,
        ended_at: sess.ended_at || new Date().toISOString(),
        outcome: sess.status,
        final_score: sess.status === 'completed' ? Math.max(0, Math.round(Number(sess.final_score) * 10) / 10) : null,
        record_source: 'verified_session',
        created_at: sess.started_at,
        updated_at: new Date().toISOString(),
      };
      this.cultivationLedger.set(key, entry);
    }
  }

  createMockSupabaseClient() {
    const db = this;
    return {
      from: (table: string) => {
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockImplementation((rows: any[]) => {
            if (table === 'game_events') {
              for (const row of rows) {
                // RLS: check player identity
                if (row.player_id !== db.playerId) {
                  return Promise.reject(new Error('RLS violation: invalid player_id'));
                }
                db.gameEvents.push(row);
              }
            }
            return Promise.resolve({ data: rows, error: null });
          }),
          upsert: vi.fn().mockImplementation((rows: any[]) => {
            if (table === 'game_events') {
              for (const row of rows) {
                // RLS: check player identity
                if (row.player_id !== db.playerId) {
                  return Promise.reject(new Error('RLS violation: invalid player_id'));
                }
                db.gameEvents.push(row);
              }
            }
            return Promise.resolve({ data: rows, error: null });
          }),
          eq: vi.fn().mockImplementation((col: string, val: any) => {
            return {
              in: vi.fn().mockImplementation((col2: string, vals: any[]) => {
                return {
                  order: vi.fn().mockReturnThis(),
                  limit: vi.fn().mockReturnThis(),
                  maybeSingle: vi.fn().mockImplementation(() => {
                    if (table === 'game_sessions') {
                      for (const sess of Array.from(db.gameSessions.values()).reverse()) {
                        if (sess.player_id === val && vals.includes(sess.status)) {
                          return Promise.resolve({ data: sess, error: null });
                        }
                      }
                      return Promise.resolve({ data: null, error: null });
                    }
                    return Promise.resolve({ data: null, error: null });
                  }),
                };
              }),
              eq: vi.fn().mockImplementation((col2: string, val2: any) => {
                const queryObj: any = {
                  order: vi.fn().mockImplementation(() => queryObj),
                  then: (resolve: any) => {
                    if (table === 'game_events') {
                      const matched = db.gameEvents.filter(
                        (e) => e.player_id === val && e.session_id === val2
                      );
                      return resolve({ data: matched, error: null });
                    }
                    return resolve({ data: [], error: null });
                  },
                };
                return queryObj;
              }),
              order: vi.fn().mockImplementation(() => {
                if (table === 'cultivation_ledger_entries') {
                  const records = Array.from(db.cultivationLedger.values()).filter(
                    (e) => e.player_id === val
                  );
                  return Promise.resolve({ data: records, error: null });
                }
                return Promise.resolve({ data: [], error: null });
              }),
            };
          }),
        };
      },
      rpc: vi.fn().mockImplementation((fn: string, args: any) => {
        if (fn === 'upsert_game_session') {
          try {
            const res = db.rpcUpsertGameSession(args);
            return Promise.resolve({ data: res, error: null });
          } catch (e: any) {
            return Promise.resolve({ data: null, error: e });
          }
        }
        if (fn === 'append_game_events') {
          const events = args.p_events || [];
          for (const ev of events) {
            db.gameEvents.push({
              player_id: args.p_player_id,
              ...ev,
            });
          }
          return Promise.resolve({
            data: [{
              session_id: events[0]?.session_id,
              session_revision: db.gameEvents.length,
              inserted_count: events.length,
            }],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: db.authUserId } } }, error: null }),
        signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: db.authUserId } }, error: null }),
      },
      functions: {
        invoke: vi.fn().mockImplementation((name: string, { body }: any) => {
          if (name === 'start-verified-session') {
            const sessionId = 'uuid-sess-' + Date.now();
            const started = db.rpcUpsertGameSession({
              p_player_id: db.playerId,
              p_session_id: sessionId,
              p_client_session_id: body.client_session_id,
              p_started_at: new Date().toISOString(),
              p_status: 'started',
              p_rounds_completed: 0,
              p_final_score: 0,
              p_rules_version: String(CURRENT_RULES_VERSION),
              p_game_mode: 'volatility_trade',
              p_app_version: '1.0.0',
              p_consent_version: '1',
            });
            return Promise.resolve({
              data: {
                session_id: started.id,
                started_at: started.started_at,
                seed: started.replay_seed,
                rules_snapshot: started.rules_snapshot,
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      },
    };
  }
}

describe('Supabase 真实数据库迁移、RLS、触发器与续局全链路模拟集成测试', () => {
  let db: SimulatedSupabaseDatabase;
  let backend: SupabaseAnalyticsBackend;
  let controller: TelemetryController;
  let storage: MemoryStorage;

  beforeEach(async () => {
    db = new SimulatedSupabaseDatabase('auth-u-100', 'player-p-100');
    backend = new SupabaseAnalyticsBackend(db.createMockSupabaseClient() as any);
    storage = new MemoryStorage();
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-28T00:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-p-100',
      public_player_id: 'pub-100',
      public_code: 'CODE100',
      display_name: '道号真修士',
      leaderboard_eligible: true,
    }));

    controller = new TelemetryController({ storage, backend });
    setTelemetryControllerForTesting(controller);
    await controller.init();
  });

  it('全链路生命周期：开局 -> 动作记录 -> 主动终止 -> 触发器写账本 -> 跨设备拉取与坚持度计算', async () => {
    // 1. 开第 1 局对局并上报事件
    const meta = { rules_version: String(CURRENT_RULES_VERSION), game_mode: 'volatility_trade', volatility_enabled: true };
    const prepared1 = await controller.prepareVerifiedSession(meta);
    expect(prepared1).not.toBeNull();
    const started1 = controller.startSession(meta, prepared1);
    expect(started1).toBe(true);

    const sessId1 = controller.getActiveSessionId()!;
    expect(sessId1).toBe(prepared1!.session_id);

    // 记录若干动作事件
    controller.recordReplayAction({ type: 'buy', cardIndex: 0, leverage: false });
    controller.recordReplayAction({ type: 'wait' });
    await controller.track('action_buy', { session_id: sessId1, round: 1, action: 'buy' });
    await controller.track('action_wait', { session_id: sessId1, round: 2, action: 'wait' });

    // 2. 主动终止对局 -> 验证数据库 status 更新为 abandoned，触发器写入账本
    controller.abandonSession('voluntary_exit');
    await controller.flush();
    await controller.syncPendingTerminations();

    expect(db.gameSessions.get(sessId1)?.status).toBe('abandoned');
    const ledgerKey1 = `player-p-100:${sessId1}`;
    expect(db.cultivationLedger.has(ledgerKey1)).toBe(true);
    expect(db.cultivationLedger.get(ledgerKey1)).toMatchObject({
      outcome: 'abandoned',
      final_score: null,
      game_session_id: sessId1,
    });

    // 3. 在设备 2 上初始化并查询活跃局与账本
    const storage2 = new MemoryStorage();
    storage2.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-28T00:00:00.000Z' }));
    storage2.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-p-100',
      public_player_id: 'pub-100',
      public_code: 'CODE100',
      display_name: '道号真修士',
      leaderboard_eligible: true,
    }));

    const controller2 = new TelemetryController({ storage: storage2, backend });
    await controller2.init();

    // 因为第 1 局已终止，此时活跃局为 null
    expect(controller2.getState().activeCloudSession).toBeNull();
    // 但云端账本成功拉取到了该放弃记录
    const ledgerRecords = controller2.getState().cultivationLedger?.records ?? [];
    expect(ledgerRecords).toHaveLength(1);
    expect(ledgerRecords[0]?.outcome).toBe('abandoned');

    // 4. 开第 2 局并在中途保持 active -> 设备 2 成功拉取并接续
    const prepared2 = await controller.prepareVerifiedSession(meta);
    expect(prepared2).not.toBeNull();
    controller.startSession(meta, prepared2);
    await controller.flush();
    const sessId2 = controller.getActiveSessionId()!;

    const baseActionPayload = {
      session_id: sessId2,
      round: 1,
      season: 'spring',
      qi_before: 100,
      qi_after: 80,
      score_before: 0,
      score_after: 10,
      leverage_multiplier: 1.5,
      public_context: [{ id: 1, name: '甲子', score: 10 }],
      hand_context: [{ id: 2, name: '乙丑', score: 10, use_leverage: true }],
      card_index: 1,
      use_leverage: true,
      card_id: 1,
      card_name: '甲子',
      card_main_element: 'wood',
      card_yin_yang: 'yang',
      card_score: 10,
      base_score: 10,
      volatility_delta: 0,
      buy_cost: 20,
      replay_action: { type: 'buy', cardIndex: 1, leverage: true },
    };
    controller.recordReplayAction({ type: 'buy', cardIndex: 1, leverage: true });
    controller.track('action_buy', baseActionPayload);
    await controller.flush();

    // 设备 2 刷新 -> 成功获取 activeCloudSession 及精确动作序列
    await controller2.refreshActiveSession();
    const activeOnDev2 = controller2.getState().activeCloudSession;
    expect(activeOnDev2).not.toBeNull();
    expect(activeOnDev2?.session_id).toBe(sessId2);
    expect(activeOnDev2?.actions).toEqual([
      { type: 'buy', cardIndex: 1, leverage: true },
    ]);

    // 5. 设备 2 接续此会话并完成结算
    const bound = controller2.resumeVerifiedSession(
      meta,
      {
        session_id: activeOnDev2!.session_id,
        started_at: activeOnDev2!.started_at,
        seed: activeOnDev2!.seed,
        rules_snapshot: activeOnDev2!.rules_snapshot,
      },
      activeOnDev2!.actions,
      { rounds: 1, final_score: 10, margin_call_count: 0 }
    );
    expect(bound).toBe(true);

    // 完成终局
    await backend.upsertSession('player-p-100', {
      session_id: sessId2,
      started_at: activeOnDev2!.started_at,
      status: 'completed',
      rounds_completed: 60,
      final_score: 188.5,
      rules_version: String(CURRENT_RULES_VERSION),
      game_mode: 'volatility_trade',
      app_version: '1.0.0',
      consent_version: '1',
      ended_at: new Date().toISOString(),
    });

    // 验证触发器将第 2 局记为 completed 且带有效分数
    const ledgerKey2 = `player-p-100:${sessId2}`;
    expect(db.cultivationLedger.get(ledgerKey2)).toMatchObject({
      outcome: 'completed',
      final_score: 188.5,
      game_session_id: sessId2,
    });

    // 6. 验证最终坚持度计算口径
    const allLedger = Array.from(db.cultivationLedger.values());
    expect(allLedger).toHaveLength(2); // 1 abandoned, 1 completed
    const perseverance = calculatePerseveranceSummary(allLedger.map((r) => ({
      id: r.local_game_id,
      rulesVersion: r.rules_version,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      outcome: r.outcome,
      finalScore: r.final_score,
      source: 'verified_session',
      sourceLabel: '云端校验',
    })));

    expect(perseverance.evalStatus).toBe('accumulating'); // < 3 局完整评估
    expect(perseverance.perseveranceRate).toBeNull();
    expect(perseverance.currentStreak).toBe(1);
    expect(perseverance.bestStreak).toBe(1);
  });
});
