-- 20260831000000_add_balance_profile_to_leaderboard.sql
-- 为 leaderboard_entries 与 cultivation_ledger_entries 添加 balance_profile_id 字段，支持按平衡档案隔离排行榜与独立修行口径
-- 回填历史既有记录，防止按档案过滤后历史记录静默消失
-- 建立 player_experiment_assignments 持久化表，锁定玩家试验分组并启用严格 RLS 封锁匿名端

alter table public.leaderboard_entries
  add column if not exists balance_profile_id text;

-- 1. 回填历史排行榜记录
update public.leaderboard_entries
set balance_profile_id = case
  when rules_version::text = '9' then 'v9_standard'
  when rules_version::text = '8' then 'v8_standard'
  when rules_version::text = '7' then 'v7_standard'
  when rules_version::text = '6' then 'v6_standard'
  when rules_version::text = '5' then 'v5_standard'
  when rules_version::text = '4' then 'v4_standard'
  else 'v4_standard'
end
where balance_profile_id is null;

create index if not exists leaderboard_entries_profile_rank_idx
  on public.leaderboard_entries (balance_profile_id, score desc);

create index if not exists leaderboard_entries_rules_profile_rank_idx
  on public.leaderboard_entries (rules_version, balance_profile_id, score desc);

alter table public.cultivation_ledger_entries
  add column if not exists balance_profile_id text;

-- 2. 回填历史修行账本记录
update public.cultivation_ledger_entries
set balance_profile_id = case
  when rules_version::text = '9' then 'v9_standard'
  when rules_version::text = '8' then 'v8_standard'
  when rules_version::text = '7' then 'v7_standard'
  when rules_version::text = '6' then 'v6_standard'
  when rules_version::text = '5' then 'v5_standard'
  when rules_version::text = '4' then 'v4_standard'
  else 'v4_standard'
end
where balance_profile_id is null;

create index if not exists cultivation_ledger_entries_player_profile_idx
  on public.cultivation_ledger_entries (player_id, balance_profile_id, outcome);

-- 3. 玩家试验分组持久化表
create table if not exists public.player_experiment_assignments (
  player_id text not null,
  experiment_id text not null,
  variant_id text not null,
  balance_profile_id text not null,
  assigned_at timestamptz not null default now(),
  primary key (player_id, experiment_id)
);

create index if not exists player_experiment_assignments_exp_idx
  on public.player_experiment_assignments (experiment_id, variant_id);

-- 4. 启用 RLS 并封锁匿名/浏览器端读写（仅 Edge Function service_role 可访问）
alter table public.player_experiment_assignments enable row level security;
revoke all on table public.player_experiment_assignments from anon, authenticated;
