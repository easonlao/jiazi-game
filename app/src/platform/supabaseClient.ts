/**
 * 浏览器 Supabase 客户端（web 平台）。
 *
 * 仅读取 VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY（anon key）。
 * 任一缺失时返回 null，游戏以遥测关闭状态运行（本地游玩不受影响）。
 * 严禁在此或任何客户端文件中使用 service_role / secret key。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseConfig(): { url: string; key: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

let cached: SupabaseClient | null | undefined;

/** 惰性创建单例；env 缺失返回 null。 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const config = getSupabaseConfig();
  if (!config) {
    cached = null;
    return null;
  }
  cached = createClient(config.url, config.key, {
    auth: {
      // 匿名会话仅用于身份/遥测，走 localStorage 持久化以便刷新后恢复
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return cached;
}
