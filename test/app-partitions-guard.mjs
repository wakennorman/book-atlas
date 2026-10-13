#!/usr/bin/env node
/**
 * 守卫：`js/app.js` 的分区目录**没有过期**（v0.196 · 债一 B1 的配套）
 *
 * ## 为什么要有这条
 *
 * 目录的价值全在"它还对不对"。而目录天生会过期：
 * 加一个函数、改一个名字、挪一段代码 —— 表格不动，它就开始骗人。
 * **一个骗人的目录比没有目录更糟**：没有目录的人会 grep，一个骗人的目录让人信它。
 *
 * 这条守卫让目录**要么是对的，要么是红的**，没有第三种状态。
 *
 * ## 判据
 *
 * | # | 判据 | 防的是什么 |
 * |---|---|---|
 * | P1 | 表里的每个 `起始符号` 在 app.js 里**都存在** | 函数改名/删除 ⇒ 表失效 |
 * | P2 | 表里的**分区数** == 文件里的**分区标记数** == `PARTS` 长度 | 手工删标记、或生成器与文件脱节 |
 * | P3 | 每个分区标记后面**紧跟**（隔 0~1 个空行）的是表里对应的那个符号 | 标记插错位置，符号名对不上 |
 * | P4 | **表里不出现行号** | 行号会因插入标记而整体后移 ⇒ 必然变成假坐标（第一版就栽在这） |
 * | P4b/P4c | 目录里自称的「文件共 N 行、M 个顶层符号，K 个分区」**三个数都对**（v0.209 补） | P4b 原来只查"那句话在不在" ⇒ 实测目录自称 6255 行、文件已 6640 行，**照样绿** |
 * | P5 | 把生成器当纯函数重跑一次，结果**逐字等于当前文件**（v0.209 补） | `--force --write` **并不幂等**（每跑一次多一个空行），而 P4c 永远绿 ⇒ 生成器自己会漂，没人看得见 |
 *
 * ⚠ 判据复用 `scripts/add-app-partitions.mjs` 的 `PARTS` / `topLevelSymbols` / `partitionedSource`，
 *   不另抄一份 —— 抄一份的话，改了那边忘了这边，守卫会拿旧表去对新文件，报出一堆假红。
 *
 * 用法：node test/app-partitions-guard.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partitionTable, APP_PATH, topLevelSymbols, partitionedSource } from '../scripts/add-app-partitions.mjs';

/* 复用生成器的表（经它导出的函数取，符合 guard-hygiene 的「必须导出函数」要求）。 */
const PARTS = partitionTable();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (HERE !== ROOT) console.error(`  （ROOT 与预期不同：${ROOT}）`);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

console.log('══ js/app.js 分区目录的守卫 ══\n');

const src = fs.readFileSync(APP_PATH, 'utf8');
const lines = src.split('\n');

/* 顶部目录 = 文件开头那个块注释。 */
const headEnd = src.indexOf('*/');
const head = src.slice(0, headEnd);

/* 表里解析出来的行：`| N. 标题 | \`符号\` | 数字 |` */
/* ⚠ 行首是 ` * | N. …`（块注释里的表格）⇒ `^\s*` 匹配不了那个 `*`，
 *   第一版写成 `^\s*\|` 于是 60 行表**一行都没解析出来**，P1/P2 全绿但其实是空跑。
 *   ⇒ 必须写成 `^\s*\*?\s*\|`（`*` 可选）。 */
const rows = [...head.matchAll(/^\s*\*?\s*\|\s*(\d+)\.\s*(.+?)\s*\|\s*`(\w+)`\s*\|\s*(\d+)\s*\|/gm)]
  .map((m) => ({ idx: Number(m[1]), title: m[2], anchor: m[3], count: Number(m[4]) }));

/* ── P1 表里每个起始符号都存在 ── */
{
  const missing = rows.filter((r) => !new RegExp(`^  (?:async )?function ${r.anchor}\\b|^  const ${r.anchor} =`, 'm').test(src));
  ok(missing.length === 0,
    `P1 表里 ${rows.length} 个起始符号在 app.js 里都存在${missing.length ? `（缺 ${missing.map((m) => m.anchor).join('、')}）` : ''}`);
}

/* ── P2 三个数字必须一致：表 / 文件里的标记 / PARTS ── */
{
  const marks = lines.filter((l) => /══ 区域 \d+\/\d+：/.test(l));
  const m = /区域 (\d+)\/(\d+)：/.exec(marks[0] || '');
  const declared = m ? Number(m[2]) : -1;
  ok(rows.length === PARTS.length && marks.length === PARTS.length && declared === PARTS.length,
    `P2 分区数一致（表 ${rows.length} · 标记 ${marks.length} · 标记自称 ${declared} · PARTS ${PARTS.length}）`);
}

/* ── P3 每个标记后面紧跟的是表里对应的符号 ── */
{
  const bad = [];
  lines.forEach((l, i) => {
    const m = /^ {2}\/\* ══ 区域 (\d+)\/\d+：.+ ══ \*\/$/.exec(l);
    if (!m) return;
    const want = PARTS[Number(m[1]) - 1];
    if (!want) { bad.push(`区域 ${m[1]}：PARTS 里没有对应项`); return; }
    /* 往后找第一个顶层符号（隔 0~1 个空行）。 */
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const sym = /^ {2}(?:async )?function (\w+)|^ {2}const (\w+) =/.exec(lines[j] || '');
    const got = sym ? (sym[1] || sym[2]) : '(没有符号)';
    if (got !== want.anchor) bad.push(`区域 ${m[1]}：标记后是 ${got}，但 PARTS 说应是 ${want.anchor}`);
  });
  ok(bad.length === 0, `P3 每个分区标记后面就是它该有的符号${bad.length ? `（${bad.length} 处不符）` : ''}`);
  for (const b of bad) console.error(`      · ${b}`);
}

/* ── P4 表里不许出现行号 ── */
{
  const hasLineNo = /^\s*\*?\s*\|\s*\d+\s*–\s*\d+\s*\|/m.test(head);
  ok(!hasLineNo,
    'P4 表里没有行号（行号会因插入标记而整体后移 ⇒ 必然变成假坐标）');
  const declaredLines = /\d+\s*行、\d+\s*个顶层符号/.test(head);
  ok(declaredLines, 'P4b 目录里写明了当前行数与符号数（那两行是对着文件现算的）');
  /* ── P4c 那两个数字**真的对**（v0.209 补）──
   * ⚠ 为什么补：P4b 只查"那句话在不在"。实测目录里写着「文件共 6255 行、265 个顶层符号」，
   *   而文件已经 6640 行（`split('\n')` 口径）—— **差了 385 行，P4b 照样绿**，因为正则只看形状。
   *   这正是本仓最恨的那类假绿：门禁守了形状、没守内容 ⇒ 一个骗人的目录（本文件开头
   *   自己写着"一个骗人的目录比没有目录更糟"）。
   * 口径**从生成器 import**（`topLevelSymbols`），不在这里重写一份。 */
  const decl = /文件共 (\d+) 行、(\d+) 个顶层符号，(\d+) 个分区/.exec(head);
  if (!decl) {
    ok(false, 'P4c 目录里那行不是「文件共 N 行、M 个顶层符号，K 个分区」的形状 ⇒ 没法核数');
  } else {
    const symN = topLevelSymbols(lines).length;
    ok(Number(decl[1]) === lines.length,
      `P4c 目录自称的行数是对的（自称 ${decl[1]} / 实际 ${lines.length}）`);
    ok(Number(decl[2]) === symN,
      `P4c 目录自称的顶层符号数是对的（自称 ${decl[2]} / 实际 ${symN}）`);
    ok(Number(decl[3]) === rows.length,
      `P4c 目录自称的分区数是对的（自称 ${decl[3]} / 表 ${rows.length}）`);
  }

  /* ── P5 生成器是幂等的（v0.209 补）──
   * ⚠ 为什么必须补：脚本自己的注释写着「落盘（幂等）」，而实测 `--force --write`
   *   每跑一次就往目录后面多塞一个空行（6655 → 6656 → 6657），**没有任何门禁会红** ——
   *   P4c 只核目录里那个数对不对，而那个数每次都会被重算 ⇒ 永远是对的。
   *   这一类"生成器自己会漂"的病，只有把生成器当**纯函数**跑一遍才看得见；
   *   本机起不了子进程（`spawnSync` → EBUSY），所以判据必须在**进程内** import 它。
   * ⚠ 比较前把行尾归一（`\r\n` → `\n`）：本机 `core.autocrlf=true`，工作区是 CRLF，
   *   而生成出来的目录行是 LF ⇒ 不归一会看到"每一行都不同"这种**纯属行尾**的假差异。 */
  {
    const { out, problems } = partitionedSource(src, { force: true });
    ok(problems.length === 0,
      `P5 生成器自检通过${problems.length ? `（${problems.length} 条，首条：${problems[0].slice(0, 70)}）` : ''}`);
    const norm = (s) => s.replace(/\r\n/g, '\n');
    const a = norm(src).split('\n');
    const b = norm(out).split('\n');
    const same = norm(src) === norm(out);
    ok(same, 'P5b 重跑一次 --force --write 不会改动任何一行（生成器幂等）');
    if (!same) {
      let at = -1;
      for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { at = i; break; }
      console.error(`      · 第一处不同在第 ${at + 1} 行：`
        + `现在 ${JSON.stringify((a[at] || '').slice(0, 50))} / 生成 ${JSON.stringify((b[at] || '').slice(0, 50))}`);
      console.error(`      · 行数：现在 ${a.length} / 生成 ${b.length}`);
    }
  }
}

console.log(`\n${'─'.repeat(56)}`);
console.log(`通过 ${pass}　失败 ${fail}`);
if (fail) { console.error('✗ 分区目录有问题'); process.exit(1); }
console.log('✓ 分区目录与文件一致');
