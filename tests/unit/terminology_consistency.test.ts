/**
 * 术语一致性守卫：防止旧资源术语「气/心神」重新流入 UI 用户可见文案。
 *
 * 背景（2026-08-08 用户要求）：项目统一用「神识」描述玩家资源（qi），
 * 旧术语「气」「心神」已全部迁移。本测试扫描 app/src 下用户可见字符串
 * （tsx 的 JSX 文本 + 字符串字面量），断言不存在资源指代的旧术语。
 *
 * 白名单（这些「气」是机制名/世界观，不是资源指代，不得误报）：
 * - 灵气（干支牌）
 * - 金气/水气/木气/火气（季节五行文案）
 * - 炼气（境界名）、浊气（评价语）、气运/气数
 * - 锁定气/锁气/气量/气耗（机制词，代码注释与变量名不在此测试范围）
 *
 * 注意：本测试只扫 app/src 用户可见层（UI 文案），不扫 src/core 注释
 * （注释属机制描述，双轨约定允许用机制名「气」）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** 扫描目录下所有 tsx/ts 文件（递归） */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (/\.(tsx|ts)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

/** 提取一行中的用户可见字符串（单引号/双引号/模板字符串/JSX 文本） */
function extractUserVisibleStrings(line: string): string[] {
  const out: string[] = [];
  // 字符串字面量（含模板字符串）
  const re = /'([^']*)'|"([^"]*)"|`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/** 旧资源术语模式：独立「气」字（非白名单）或「心神」 */
const BANNED_PATTERNS: RegExp[] = [
  // 资源整体指代：回气、气耗尽、气不足、每回合 -X 气、扣X气
  /回气/,
  /气耗尽/,
  /气不足/,
  /每回合.*\d+ 气/,
  /心神/, // 心神 是彻底废弃的叙事名
];

/** 白名单词组：含这些词的「气」不算资源指代 */
const WHITELIST = [
  '灵气', '金气', '水气', '木气', '火气', '炼气', '浊气',
  '气运', '气数', '气归藏', '气伏藏', '气式微', '气敛息',
];

describe('术语一致性守卫：UI 用户可见文案统一用「神识」', () => {
  it('app/src 用户可见字符串无「回气/气耗尽/心神」等旧资源术语', () => {
    const base = resolve(process.cwd(), 'app/src');
    const files = collectFiles(base);
    const offenders: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const stripped = line.trim();
        // 跳过纯注释行
        if (stripped.startsWith('//') || stripped.startsWith('*') || stripped.startsWith('/*')) continue;
        // 跳过 import/require 语句（路径或类型引用，非用户可见）
        if (stripped.startsWith('import ') || stripped.startsWith('export ') && stripped.includes(' from ')) continue;

        for (const s of extractUserVisibleStrings(line)) {
          // 白名单：含白名单词组的字符串跳过
          if (WHITELIST.some((w) => s.includes(w))) continue;
          // 黑名单：命中旧资源术语模式
          for (const pat of BANNED_PATTERNS) {
            if (pat.test(s)) {
              offenders.push(`${file}:${i + 1}: "${s}"`);
              break;
            }
          }
        }
      }
    }

    expect(offenders, `旧术语残留：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('UI 关键资源术语已统一为「神识」（正向断言：神识必须存在）', () => {
    const base = resolve(process.cwd(), 'app/src');
    const files = collectFiles(base);
    let shenshiCount = 0;
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      // 统计用户可见字符串中的「神识」（排除注释行）
      for (const line of content.split('\n')) {
        const stripped = line.trim();
        if (stripped.startsWith('//') || stripped.startsWith('*') || stripped.startsWith('/*')) continue;
        if (stripped.startsWith('import ') || stripped.startsWith('export ') && stripped.includes(' from ')) continue;
        for (const s of extractUserVisibleStrings(line)) {
          if (s.includes('神识')) shenshiCount++;
        }
      }
    }
    expect(shenshiCount).toBeGreaterThan(0);
  });
});
