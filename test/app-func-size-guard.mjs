#!/usr/bin/env node
/**
 * 守卫：`js/app.js` 里不许有**超长函数**（v0.197 · 债一 B2）
 *
 * ## 为什么要有这条
 *
 * app.js 是**单文件**（纯静态、零构建，见 `docs/工程债立项-2026-10-12.md`），
 * 文件总行数守不住"函数别太长"这件事 —— 一个文件可以整齐地由十个 500 行函数组成。
 *
 * 实测本轮之前最长的几个：
 *
 * | 函数 | 行数 |
 * |---|---|
 * | `bindUI()` | **515** |
 * | `buildOption()` | 350 |
 * | `applyEdgeFilter()` | 306 |
 * | `epubPage()` | 219 |
 *
 * 痛点不是"行数多"，而是**改任何一处都要在几百行里定位**，且没有边界。
 *
 * ## 为什么阈值是 400
 *
 * · 上界要**真的拦得住现在的问题**：`bindUI` 515 行必须红。
 * · 下界要**留得住正常函数**：`buildOption` 350 行是 ECharts option 装配，
 *   它天生就长（一堆 series/option 字面量），拆开反而更碎。
 *   ⇒ 400 正好卡在「明显失控」与「本来就长」之间。
 * · ⚠ 阈值是**约定**，不是真理。哪天发现某个 390 行的函数确实该拆，
 *   就调这个数，并在 `CHANGELOG` 里写明为什么 —— 别偷偷放宽。
 *
 * ## ⚠ 这条守卫的判据必须**抗得住误报**
 *
 * 第一版用「从函数声明行数到下一个顶层符号」算长度，结果把**文件末尾的最后一个函数**
 * 算成了「一直到文件尾」，于是所有在最后定义的函数都被虚报成长函数。
 * ⇒ 改成**花括号配平**（跳过字符串 / 模板串 / 两种注释）。
 * ⚠ 配平必须**逐字符**走且换行不重置状态 —— 第一版的粗略版在跨行模板串上就错了。
 *
 * 用法：node test/app-func-size-guard.mjs
 */
import fs from 'node:fs';
import { APP_PATH } from '../scripts/add-app-partitions.mjs';

/** 超过这个行数就报。理由见文件头。 */
const MAX_LINES = 400;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

console.log('══ js/app.js 函数长度守卫 ══\n');
console.log(`  阈值：${MAX_LINES} 行\n`);

const src = fs.readFileSync(APP_PATH, 'utf8');
const lines = src.split('\n');

/** 顶层函数/常量声明：返回 {name, line, arrow}。 */
function topLevelFns(text) {
  const out = [];
  text.split('\n').forEach((l, i) => {
    const m = /^ {2}(?:async )?function (\w+)|^ {2}const (\w+) = /.exec(l);
    if (!m) return;
    /* ⚠ 判断「是不是箭头函数」要看**原文里有没有 `=>`**，
     *   不能看捕获组 —— 第一版用 `m[3] ? 'const' : 'function'`，
     *   而 `const x = (…) => …` 匹配的是第二个分支（`m[3]` 恒为 undefined）
     *   ⇒ `edgeKey` / `esc` 这些**单行箭头函数**全被当成普通函数去配平，
     *   于是各背了 260 / 259 行的冤枉长度。 */
    const name = m[1] || m[2];
    const arrow = !m[1] && /=>/.test(l);
    out.push({ name, line: i + 1, arrow });
  });
  return out;
}

/**
 * 从 `from`（0-based 行号，该行含声明）起做花括号配平，返回结束行（0-based）。
 * 逐字符走，跳过字符串 / 模板串 / 行注释 / 块注释。
 */
function matchBrace(textLines, from) {
  let depth = 0;
  let inStr = '';        // '"' 或 "'"
  let tplDepth = 0;      // 模板串可嵌套 ${}
  let inLine = false;
  let inBlock = false;
  for (let i = from; i < textLines.length; i++) {
    const line = textLines[i];
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      const n = line[k + 1];
      if (inLine) { if (c === '\n') inLine = false; continue; }   // 行注释到行尾（单行处理）
      if (inBlock) { if (c === '*' && n === '/') { inBlock = false; k++; } continue; }
      if (inStr) {
        if (c === '\\') { k++; continue; }
        if (c === inStr) inStr = '';
        continue;
      }
      if (tplDepth > 0) {
        if (c === '\\') { k++; continue; }
        if (c === '`') tplDepth--;
        continue;
      }
      if (c === '/' && n === '/') { inLine = true; break; }
      if (c === '/' && n === '*') { inBlock = true; k++; continue; }
      if (c === '"' || c === "'") { inStr = c; continue; }
      if (c === '`') { tplDepth = 1; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth--; if (depth === 0) return i; }
    }
    /* 行注释状态在换行后清掉（上面 break 出来时已在同一行内，这里统一收尾）。 */
    inLine = false;
  }
  return -1;
}

const fns = topLevelFns(src);

/* ── 判据 1：配平必须成功（否则长度算不出来，等于没测） ── */
const measured = [];
const unclosed = [];
for (const f of fns) {
  const startLine = lines[f.line - 1];
  /* ⚠ **箭头函数没有大括号**：`const edgeKey = (a, b) => …;` 是一整行。
   *   第一版照样去配平，于是从下一个 `{` 开始扫，把后面 260 行全算成它的长度
   *   （实测 `edgeKey` 被算成 260 行、`esc` 259 行，而它们真实长度都是 1）。
   *
   *   ⚠⚠ 判据**不能**用「声明行里有没有 `{`」—— 第二版就是这么写的，
   *     而 `edgeKey` 那行含**模板串** `` `${a}|${b}` `` ⇒ 里面有 `{` ⇒ 照样误判。
   *   ⇒ 改用可靠信号：**箭头函数体在这一行内结束**（行尾是 `;` 或 `,`）。
   *     跨行的箭头函数体（如 `const foo = () => {`）行尾是 `{`，走配平。 */
  if (f.arrow) {
    const t = startLine.trimEnd();
    const isInlineArrow = t.endsWith(';') || t.endsWith(',');
    if (isInlineArrow) {
      measured.push({ ...f, end: f.line, len: 1 });
      continue;
    }
  }
  const end = matchBrace(lines, f.line - 1);
  if (end < 0) { unclosed.push(f); continue; }
  measured.push({ ...f, end: end + 1, len: end + 1 - (f.line - 1) });
}
ok(unclosed.length === 0,
  `每个顶层函数的括号都配平${unclosed.length ? `（配平失败：${unclosed.map((f) => f.name).join('、')}）` : ''}`);

/* ── 判据 2：没有超过阈值的 ── */
const over = measured.filter((f) => f.len > MAX_LINES).sort((a, b) => b.len - a.len);
ok(over.length === 0,
  `没有超过 ${MAX_LINES} 行的函数${over.length ? `（${over.length} 个超了）` : ''}`);
for (const f of over) console.error(`      · ${f.name}() ${f.len} 行（L${f.line}–L${f.end}）`);

/* ── 判据 3：最长的那几个（当记录，不当判据） ── */
const top5 = [...measured].sort((a, b) => b.len - a.len).slice(0, 5);
console.log('\n  最长的 5 个函数（记录）：');
for (const f of top5) {
  const flag = f.len > MAX_LINES ? ' ← 超阈值' : '';
  console.log(`    ${String(f.len).padStart(4)} 行  ${f.name}()  (L${f.line})${flag}`);
}

console.log(`\n${'─'.repeat(56)}`);
console.log(`通过 ${pass}　失败 ${fail}`);
if (fail) { console.error(`\n✗ 有函数失控了。修法见 docs/债一B2-bindUI拆分方案.md`); process.exit(1); }
console.log('✓ 没有超长函数');
