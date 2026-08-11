/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase 项目 URL（必填才能启用遥测；缺失时游戏以遥测关闭状态运行） */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase 发布密钥（anon/publishable key；绝不在此放入 service_role/secret） */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
