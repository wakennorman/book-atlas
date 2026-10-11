/**
 * 单测：`scripts/README.md`（`scripts/` 的索引）**与仓库现状是否一致**。
 *
 * ## 为什么值得单独测（v0.189）
 *
 * 索引是**生成物**（`scripts/make-scripts-index.mjs`）。生成物的老规矩是
 * "生成 + `--check` 对拍"，`check.yml` 里也有 `--check` 那一步。
 * 但本机 `npm run gate` **一步都跑不了**（node 起不了子进程，见 §本机约束），
 * 所以真正的本地防线是**这条守卫**：它直接 import 生成器的纯函数、
 * 当场把渲染结果和磁盘上的文件对拍。
 *
 * 三类断言，各有各的用：
 *
 * ① **逐字节相等** —— 加了脚本 / 改了文件头一句话却忘了重新生成 ⇒ 立刻红。
 * ② **收录完整性** —— 索引必须列出 `scripts/` 与 `scripts/lib/` 下**每一个** `.mjs`。
 *    防的是"生成器自己漏了一整类文件"（那种漂法不会让 ① 红）。
 * ③ **分类判据与门禁一致** —— 索引里的「门禁」必须**恰好**是
 *    `check.yml` 里 `run: node scripts/<名字>` 那一批，不多不少。
 *    防的是"门禁加了脚本、索引还按老判据分类"。
 *
 * ## ⚠ 这条守卫**刻意不起子进程**
 *
 * 本机 node 起不了**任何**子进程（`spawnSync` 一律 EBUSY，v0.180 实测）。
 * 代价：`--check` 那个 CLI 分支不在覆盖内 ⇒ 靠手工跑一次
 * （v0.189 已跑：故意改一行 README，`--check` 报出"第一处不同在第 N 行"并 exit 1）。
 *
 * 用法：node test/scripts-index-guard.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIndex, firstLineOf, collectUsage, ROOT } from '../scripts/make-scripts-index.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (HERE !== ROOT) console.error(`  （ROOT 与预期不同：${ROOT}）`);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

console.log('══ scripts/README.md（scripts/ 索引）的守卫 ══\n');

const README = path.join(ROOT, 'scripts', 'README.md');
const want = renderIndex(ROOT);

/* ── 1. ⚠ 核心：磁盘上的索引必须与"现在渲染出来"的逐字节相同 ── */
{
  ok(fs.existsSync(README), 'scripts/README.md 存在（不存在就等于没有索引）');
  const have = fs.existsSync(README) ? fs.readFileSync(README, 'utf8') : '';
  if (have !== want) {
    const a = have.split('\n'), b = want.split('\n');
    let at = -1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { at = i; break; }
    console.error(`      第一处不同在第 ${at + 1} 行：`);
    console.error(`        文件里： ${a[at] === undefined ? '(没有这一行)' : a[at]}`);
    console.error(`        应该是： ${b[at] === undefined ? '(不该有这一行)' : b[at]}`);
  }
  ok(have === want,
    'README 与当前 scripts/ 现状**逐字节一致**（加了脚本/改了文件头却忘了重新生成 ⇒ 这里红）');
}

/* ── 2. 收录完整性：一个文件都不许漏 ── */
{
  const top = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs'));
  const lib = fs.readdirSync(path.join(ROOT, 'scripts', 'lib')).filter((f) => f.endsWith('.mjs'));
  const missing = [...top, ...lib].filter((n) => !want.includes(`\`${n}\``));
  ok(missing.length === 0,
    `scripts/ 与 scripts/lib/ 下 ${top.length + lib.length} 个 .mjs 全在索引里`
    + (missing.length ? ` —— 漏了：${missing.join('、')}` : ''));
  /* ⚠ 反向：索引里不该出现**不存在**的脚本（生成器的 readdir 决定了不可能，
   *   但这一条守的是"以后有人改成硬编码清单"那种改法）。 */
  const listed = [...new Set([...want.matchAll(/^\| `([A-Za-z0-9_-]+\.mjs)`/gm)].map((m) => m[1]))];
  const ghost = listed.filter((n) => !top.includes(n) && !lib.includes(n));
  ok(ghost.length === 0, `索引里没有不存在的脚本${ghost.length ? ` —— 幽灵条目：${ghost.join('、')}` : ''}`);
}

/* ── 3. 分类判据必须与 check.yml 一致 ── */
{
  const { ci } = collectUsage(ROOT);
  const 门禁段 = want.split('## 门禁（')[1] || '';
  const 门禁表 = 门禁段.split('## ')[0];
  const inIndex = new Set([...门禁表.matchAll(/^\| `([A-Za-z0-9_-]+\.mjs)`/gm)].map((m) => m[1]));
  const notIndexed = [...ci.keys()].filter((n) => !inIndex.has(n));
  const extra = [...inIndex].filter((n) => !ci.has(n));
  ok(notIndexed.length === 0,
    `check.yml 里 \`run: node scripts/*\` 的 ${ci.size} 个脚本**都在**「门禁」一节`
    + (notIndexed.length ? ` —— 漏了：${notIndexed.join('、')}` : ''));
  ok(extra.length === 0,
    `「门禁」一节里没有"其实没在 CI 跑"的脚本${extra.length ? ` —— 多了：${extra.join('、')}` : ''}`);
  ok(ci.size >= 20, `门禁数量合理（${ci.size} 个 ≥ 20）—— 数字突然变小说明解析器坏了`);

  /* 每个 check-*.mjs 都必须被识别成门禁（与 guard-hygiene 的 H7 同源，这里从索引角度再守一次） */
  const checks = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => /^check-.*\.mjs$/.test(f));
  const checkNotGate = checks.filter((n) => !ci.has(n));
  ok(checkNotGate.length === 0,
    `${checks.length} 个 check-*.mjs 全是门禁`
    + (checkNotGate.length ? ` —— 没进 CI：${checkNotGate.join('、')}` : ''));
}

/* ── 4. 索引必须把"一次性补丁不删"说清楚（这是本轮的任务本身）── */
{
  ok(/不要删|不删/.test(want), '索引里明说了**不删**（否则下一个人照样会把补丁当死代码清掉）');
  ok(/证据链/.test(want), '说明了补丁是"证据链"的一部分 —— 给出**为什么**不删，而不只是"别删"');
  ok(/## 一次性补丁（\d+ 个）/.test(want), '有独立的一节列一次性补丁');
  ok(/没进 CI、没被 import、文档里也没提的/.test(want),
    '有"没人引用"的一节（防"看着像在用"）');
  const m = /## 一次性补丁（(\d+) 个）/.exec(want);
  ok(m && Number(m[1]) > 20, `一次性补丁有 ${m ? m[1] : '?'} 个（> 20）—— 这一节不是空的`);
  /* ⚠ 这一节的口径必须是**严格**的：`check.yml` 里被提到过**不算**"在用" ——
   *   那个名单里混着 `node --check` 的文件列表和注释。第一版把"提及"也算成引用，
   *   于是 46 个无人引用的脚本只报出 1 个（**把问题掩盖掉了**）。 */
  const seg = want.split('## ⚠ 没进 CI、没被 import、文档里也没提的')[1] || '';
  const total = Number((/共 \*\*(\d+)\*\* 个/.exec(seg) || [])[1] || 0);
  ok(total > 10, `严格口径下"没人引用"的脚本报出 ${total} 个（> 10）—— 松口径会把这一节缩成 1 条`);
  ok(/（补丁命名的那些（?:展开）|补丁命名的那些/.test(seg) || /<details>/.test(seg),
    '补丁命名的那些折叠起来（否则这一节就是"一次性补丁"那一节的重复）');
}

/* ── 5. `firstLineOf`：抽取规则本身 ── */
{
  ok(firstLineOf('/** 甲甲乙乙丙丙丁丁。 */') === '甲甲乙乙丙丙丁丁。', '剥掉 /** 与 */');
  ok(firstLineOf('/* 甲乙丙丁戊己。 */') === '甲乙丙丁戊己。', '剥掉单行块注释的 /* 与 */');
  ok(firstLineOf('// 甲乙丙丁戊己。\nconst a = 1;') === '甲乙丙丁戊己。', '剥掉 //');
  ok(firstLineOf('#!/usr/bin/env node\n * 甲乙丙丁戊己。') === '甲乙丙丁戊己。', '跳过 shebang');
  ok(firstLineOf('import fs from "node:fs";') === '', '没有汉字注释 ⇒ 返回空串（不硬编）');
  ok(firstLineOf(' * 甲乙丙\n * 丁戊己') === '', '每行都不到 4 个汉字 ⇒ 返回空串（不把半句话当描述）');
  const longOne = firstLineOf(`/** ${'甲乙丙丁戊己庚辛'.repeat(15)} */`);
  ok(longOne.length <= 89 && longOne.endsWith('…'),
    `长描述被截断到 ${longOne.length} 字并以 … 收尾（不会把整段塞进表格）`);
  ok(firstLineOf('/** 甲乙丙丁 | 戊己庚辛 */').includes('\\|'),
    '表格分隔符被转义成 `\\|`（否则整张表会错列）');
}

/* ── 6. `collectUsage`：四类证据都要能收上来 ── */
{
  const u = collectUsage(ROOT);
  ok(u.ci.has('validate.mjs'), 'CI 里 `run: node scripts/validate.mjs --all` 收上来了');
  ok(/--all/.test(u.ci.get('validate.mjs') || ''), '**参数一起收**（丢了参数就是另一个命令）');
  ok(u.importedBy.has('dup-names.mjs'), 'import 关系收上来了（lib/dup-names.mjs 被 check-dup-names-ledger 用）');
  ok(u.docs.has('validate.mjs'), '文档引用收上来了');
}

/* ── 7. 入口卫生 ── */
{
  /* ⚠ 检查的是**生成器**，不是本守卫；且 guard-hygiene 的 H1 会剥注释后扫守卫，
   *   所以关键词拆开构造，别在源码里留下完整单词。 */
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'make-scripts-index.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const banned = ['child_' + 'process', 'spawn' + 'Sync', 'exec' + 'Sync'];
  ok(!banned.some((k) => src.includes(k)), '生成器里没有子进程（守卫才能直接 import 它）');
  ok(/^export function renderIndex/m.test(src), '导出 renderIndex');
  ok(/^export function firstLineOf/m.test(src), '导出 firstLineOf');
  ok(/^export function collectUsage/m.test(src), '导出 collectUsage');
  ok(/import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/.test(src),
    '主流程有入口判断（否则守卫 import 它会把索引重写一遍）');
  /* ⚠ 这一条是实测出来的：`pathToFileURL(undefined)` **会抛**，
   *   而它出现在模块顶层 ⇒ 任何 `argv[1]` 为空的宿主（`node --input-type=module -e` 等）
   *   **import 这一下就崩**，报错却像"路径写错了"。 */
  ok(/process\.argv\[1\]\s*&&\s*import\.meta\.url ===/.test(src),
    '入口判断先查 `process.argv[1]` 存不存在（否则 argv[1] 为空时 import 直接抛）');
  ok(/process\.exit\(1\)/.test(src), '`--check` 不一致时 `process.exit(1)`（只打印不报红 = 假门禁）');
}

console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过`}`);
process.exit(fail ? 1 : 0);
