import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Standards & Migration: player_experiment_assignments RLS and Ledger Backfill', () => {
  const migrationPath = resolve(__dirname, '../../supabase/migrations/20260831000000_add_balance_profile_to_leaderboard.sql');
  const migrationSql = readFileSync(migrationPath, 'utf-8');

  it('enables row level security on player_experiment_assignments table', () => {
    expect(migrationSql).toMatch(/alter\s+table\s+public\.player_experiment_assignments\s+enable\s+row\s+level\s+security;/i);
  });

  it('revokes anon and authenticated role permissions from player_experiment_assignments', () => {
    expect(migrationSql).toMatch(/revoke\s+all\s+on\s+table\s+public\.player_experiment_assignments\s+from\s+anon,\s*authenticated;/i);
  });

  it('adds balance_profile_id to leaderboard_entries and cultivation_ledger_entries with backfill', () => {
    expect(migrationSql).toContain('alter table public.leaderboard_entries');
    expect(migrationSql).toContain('add column if not exists balance_profile_id text;');
    expect(migrationSql).toContain('alter table public.cultivation_ledger_entries');
    expect(migrationSql).toContain('add column if not exists balance_profile_id text;');

    // 检查历史回填逻辑
    expect(migrationSql).toContain("when rules_version::text = '9' then 'v9_standard'");
    expect(migrationSql).toContain("when rules_version::text = '8' then 'v8_standard'");
    expect(migrationSql).toContain("where balance_profile_id is null;");
  });
});
