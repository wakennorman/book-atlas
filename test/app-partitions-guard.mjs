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
 * ## 四条判据
 *
 * | # | 判据 | 防的是什么 |
 * |---|---|---|
 * | P1 | 表里的每个 `起始符号` 在 app.js 里**都存在** | 函数改名/删除 ⇒ 表失效 |
 * | P2 | 表里的**分区数** == 文件里的**分区标记数** == `PARTS` 长度 | 手工删标记、或生成器与文件脱节 |
 * | P3 | 每个分区标记后面**紧跟**（隔 0~1 个空行）的是表里对应的那个符号 | 标记插错位置，符号名对不上 |
 * | P4 | **表里不出现行号** | 行号会因插入标记而整体后移 ⇒ 必然变成假坐标（第一版就栽在这） |
 *
 * ⚠ 判据复用 `scripts/add-app-partitions.mjs` 的 `PARTS`，不另抄一份 ——
 *   抄一份的话，改了那边忘了这边，守卫会拿旧表去对新文件，报出一堆假红。
 *
 * 用法：node test/app-partitions-guard.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partitionTable, APP_PATH } from '../scripts/add-app-partitions.mjs';

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
}

console.log(`\n${'─'.repeat(56)}`);
console.log(`通过 ${pass}　失败 ${fail}`);
if (fail) { console.error('✗ 分区目录有问题'); process.exit(1); }
console.log('✓ 分区目录与文件一致');
