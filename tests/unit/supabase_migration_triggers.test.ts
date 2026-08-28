import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Supabase 迁移与触发器契约测试', () => {
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
