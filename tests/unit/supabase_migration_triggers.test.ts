import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Supabase 迁移与触发器契约测试 - 20260827100000', () => {
  const migrationPath = path.resolve(__dirname, '../../supabase/migrations/20260827100000_sync_game_sessions_to_cultivation_ledger.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('迁移文件存在且包含必要的触发器与函数定义', () => {
    expect(sql).toContain('create or replace function public.sync_game_session_to_cultivation_ledger()');
    expect(sql).toContain('create trigger trg_sync_game_session_to_cultivation_ledger');
    expect(sql).toContain('create or replace function private.upsert_game_session_impl');
  });

  it('upsert_game_session_impl 正确匹配数据库主键与客户端ID，防止主键冲突', () => {
    expect(sql).toMatch(/where\s+player_id\s*=\s*p_player_id\s+and\s+\(\s*\(\s*p_session_id\s+is\s+not\s+null\s+and\s+id\s*=\s*p_session_id\s*\)\s+or\s+\(\s*p_client_session_id\s+is\s+not\s+null\s+and\s+client_session_id\s*=\s*p_client_session_id\s*\)\s*\)/i);
  });

  it('触发器涵盖 completed 与 abandoned 状态，并在 conflict 时幂等更新', () => {
    expect(sql).toContain("if new.status in ('completed', 'abandoned') then");
    expect(sql).toContain('insert into public.cultivation_ledger_entries');
    expect(sql).toContain("when new.status = 'completed' then greatest(0, round(new.final_score::numeric, 1))");
    expect(sql).toContain('else null');
  });

  it('触发器包含 pg_catalog, public, private 完整 search_path 保证安全', () => {
    expect(sql).toContain('set search_path = pg_catalog, public, private');
    expect(sql).toContain('security definer');
  });
});

describe('Supabase 迁移与触发器契约测试 - 20260828100000 (corrupted_recovery, session_revision & concurrency check)', () => {
  const migrationPath = path.resolve(__dirname, '../../supabase/migrations/20260828100000_support_corrupted_recovery_status.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('表约束允许 corrupted_recovery 与 failed 状态，且包含 session_revision 列与原子递增触发器', () => {
    expect(sql).toMatch(/check\s*\(\s*status\s+in\s*\([^)]*'corrupted_recovery'[^)]*\)\s*\)/i);
    expect(sql).toContain('alter table public.game_sessions add column if not exists session_revision integer not null default 0;');
    expect(sql).toContain('create or replace function public.sync_game_event_session_revision()');
    expect(sql).toContain('create trigger trg_game_events_increment_session_revision');
  });

  it('显式 DROP 所有历史 RPC 重载，杜绝旧签名绕过并发校验', () => {
    expect(sql).toContain('drop function if exists public.upsert_game_session(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, timestamptz);');
    expect(sql).toContain('drop function if exists private.upsert_game_session_impl(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, boolean, timestamptz, bigint, jsonb);');
  });

  it('通用 private.upsert_game_session_impl 彻底剔除 corrupted_recovery，且 abandoned 终态强制要求 expected_session_revision', () => {
    expect(sql).toContain("if p_status not in ('started', 'running', 'completed', 'abandoned', 'failed') then");
    expect(sql).toContain("if p_status = 'abandoned' and p_expected_session_revision is null then");
    expect(sql).toContain("raise exception 'expected_session_revision is required for abandoned status'");
    // 确保通用 private 实现中没有允许 corrupted_recovery 篡改 abandoned
    expect(sql).not.toContain("and p_status <> 'corrupted_recovery'");
  });

  it('公共 upsert_game_session 严格拒绝 corrupted_recovery，只保留唯一的 canonical 签名', () => {
    expect(sql).toContain("if p_status not in ('started', 'running', 'completed', 'abandoned', 'failed') then");
    expect(sql).toContain("invalid session status for public upsert: %");
    expect(sql).toContain("p_expected_session_revision => p_expected_session_revision");
  });

  it('私有 finalize_corrupted_recovery 仅限 service_role，严禁已终结会话（abandoned/failed/completed）并校验 session_revision', () => {
    expect(sql).toContain('create or replace function private.finalize_corrupted_recovery');
    expect(sql).toContain("if v_session.status not in ('started', 'running') then");
    expect(sql).toContain("raise exception 'session_already_finalized: current status is %'");
    expect(sql).toContain('if v_session.session_revision > p_expected_session_revision then');
    expect(sql).toContain("raise exception 'conflict: newer session revision exists (expected %, actual %)'");
    expect(sql).toContain('grant execute on function private.finalize_corrupted_recovery(uuid, uuid, integer) to service_role;');
  });

  it('触发器在 corrupted_recovery 状态下清理对应的账本记录', () => {
    expect(sql).toContain("elsif new.status = 'corrupted_recovery' then");
    expect(sql).toContain("delete from public.cultivation_ledger_entries");
    expect(sql).toContain("where player_id = new.player_id");
    expect(sql).toContain("and (game_session_id = new.id or local_game_id = new.id::text)");
  });

  it('显式收紧 routine privileges：private 函数仅限 service_role，public upsert 仅限 authenticated 与 service_role', () => {
    expect(sql).toContain('revoke all on function private.finalize_corrupted_recovery(uuid, uuid, integer) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function private.finalize_corrupted_recovery(uuid, uuid, integer) to service_role;');
    expect(sql).toContain('revoke all on function private.upsert_game_session_impl(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, boolean, timestamptz, bigint, jsonb, integer) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function private.upsert_game_session_impl(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, boolean, timestamptz, bigint, jsonb, integer) to service_role;');
    expect(sql).toContain('revoke all on function public.upsert_game_session(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, timestamptz, integer) from public, anon;');
    expect(sql).toContain('grant execute on function public.upsert_game_session(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, timestamptz, integer) to authenticated, service_role;');
  });

  it('受控 append_game_events RPC：追加只写并在冲突时 DO NOTHING，返回服务端最新 session_revision', () => {
    expect(sql).toContain('create or replace function public.append_game_events(');
    expect(sql).toContain('on conflict (player_id, client_event_id) do nothing');
    expect(sql).toContain('revoke all on function public.append_game_events(uuid, jsonb) from public, anon;');
    expect(sql).toContain('grant execute on function public.append_game_events(uuid, jsonb) to authenticated, service_role;');
  });

  it('append_game_events RPC 严格校验 session_id 归属当前玩家，杜绝跨会话越权写入', () => {
    expect(sql).toContain("raise exception 'session does not belong to current player'");
    expect(sql).toContain("join public.game_sessions s on s.id = r.session_id and s.player_id = r.player_id");
  });
});
