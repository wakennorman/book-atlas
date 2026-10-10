#!/usr/bin/env node
/**
 * `transition: all` 展开检查：同一 transition 声明里不得混用两种缓动 / 时长。
 *
 * ## 为什么需要它
 * v0.171 把全站 15 处 `transition: all var(--duration-x) var(--ease-Y)` 展开成显式属性列表
 * （规则来源：vercel `web-design-guidelines` 的「Never `transition: all`」）。
 * 展开时**擅自给不同属性分配了不同缓动**：
 *   · `.seg` 的 color / border-color / box-shadow —— spring 改成了 standard
 *   · `shared .chip` 的 transform —— standard 改成了 spring
 * 语义上"只是把属性列出来"，**视觉上却改了手感** ——
 * 用户当场反馈：「鼠标悬停到按钮上的动效变了」。
 *
 * 原来每处都是 `all` + **一个**缓动、**一个**时长 ⇒ 展开后也必须所有属性同一套。
 * 本脚本守这条约定。
 *
 * ## 判据
 * 扫 `css/style.css` 与 `shared/design-system.css` 里每个 `transition:` 声明块：
 * 其中出现 **≥2 种 `var(--ease-*)`** 或 **≥2 种 `var(--duration-*)`** ⇒ exit 1。
 *
 * ## 豁免
 * 确有理由要混用的（例如 hover 用 spring、focus 用 standard），在该声明**上方 3 行内**写：
 *   ease-mixed-ok: <至少 8 字理由>
 * 与项目其它豁免一致 —— **没理由的豁免等于没豁免**。
 *
 * ## 刻意不做
 * **不检查**「transition 列表漏了状态规则里变化的属性」。v0.171 实际漏过两处
 * （`.primary:active` 的 `filter`、`.btn-ghost:hover` 的 `color`），但项目里历史 hover
 * 规则大量改属性，一刀切会天天误报 —— 而门禁里一条会误报的检查终会被吞掉。
 * 那类漏属性靠**人工核对**：改 transition 时，把该元素所有 `:hover/:focus/:active`
 * 规则里出现的属性逐个列进去。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['css/style.css', 'shared/design-system.css'];

const problems = [];

for (const rel of FILES) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) continue;
  const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (!/transition\s*:/.test(lines[i])) continue;
    // 收集整条声明（可能跨行，直到 `;`）
    let decl = lines[i].replace(/^.*?transition\s*:/, '');
    for (let j = i; !decl.includes(';') && j + 1 < lines.length; j++) {
      decl += ' ' + lines[j + 1].trim();
    }
    decl = decl.split(';')[0];
    if (/\bnone\b/.test(decl)) continue;                       // transition: none —— 无缓动可混

    const uniq = (re) => [...new Set([...decl.matchAll(re)].map((m) => m[0]))];
    const eases = uniq(/var\(--ease-[a-z-]+\)/g);
    const durs = uniq(/var\(--duration-[a-z-]+\)/g);
    if (eases.length < 2 && durs.length < 2) continue;

    // 豁免：声明上方 3 行内
    const ctx = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (/ease-mixed-ok:\s*\S{8,}/.test(ctx)) continue;

    const mixed = [];
    if (eases.length > 1) mixed.push('缓动 ' + eases.join(' / '));
    if (durs.length > 1) mixed.push('时长 ' + durs.join(' / '));
    problems.push(`${rel}:${i + 1} 混用 ${mixed.join('；')}`);
  }
}

if (problems.length) {
  console.error('✗ transition 展开后混用了缓动 / 时长：');
  for (const p of problems) console.error('    ' + p);
  console.error('');
  console.error('  原来都是 `transition: all` + 单一缓动/时长 ⇒ 展开必须保持单一，');
  console.error('  否则"只是列了属性"却**改了手感**（v0.171 就是这么让用户察觉到的）。');
  console.error('  修：把该声明里所有属性统一成同一个 var(--ease-*) / var(--duration-*)；');
  console.error('  确有理由混用 ⇒ 在声明上方 3 行内写 `ease-mixed-ok: <至少 8 字理由>`。');
  process.exit(1);
}

console.log('✓ transition 缓动/时长一致（每个声明块只用一种 var(--ease-*) 与 var(--duration-*)）');
