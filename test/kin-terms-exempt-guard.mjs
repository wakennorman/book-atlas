/**
 * 单测：scripts/check-kin-terms-exempt.mjs（「称谓对质豁免清单」的引用完整性检查）。
 *
 * ## 为什么值得单独测一条「检查脚本」
 *
 * 这条检查是为了一份**只有 2 条、而且两条的豁免对象族谱都算不出来**的清单 ——
 * 也就是说：它坏掉（JSON 坏 / 理由太短 / 指错人）时，`check-kin-terms.mjs` 跑出来
 * **和一切正常一模一样**（那两条本来就被 `if (!k.term || k.kind === 'unrelated') continue;` 跳过）。
 * ⇒ 检查本身如果因为一个入口判断就永远空转（`import.meta.url.endsWith(process.argv[1])`：
 *   本仓库目录名带空格，路径里的空格是 %20 编码，两边永远不相等 ⇒ 主流程一次都不跑、
 *   退出码还是 0 —— "检查通过"其实是"检查没执行"），那就又是一个假门禁
 *   （v0.145 / v0.146 / v0.154 / v0.156 / v0.160 / v0.161 同一族）。
 * ⇒ 必须有一条测试**证明它真的会报红**。
 *
 * ## 怎么测：造一个**临时目录**，把 ROOT 指过去
 *
 * 脚本支持 `BOOKATLAS_ROOT` 环境变量（只给测试用），而且它 import 的
 * `lib/data-files.mjs` 也认这个变量（v0.162 起）⇒ `listBookSlugs()` 会读 tmp 里的书。
 * 这里在 tmp 里写一份最小 `data/demo.json`（一本 demo 书）+ `data/kin-terms-exempt.json`，
 * 逐场景跑、断言退出码。**全程不碰真实仓库**。
 *
 * 用法：node test/kin-terms-exempt-guard.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-kin-terms-exempt.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-kte-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA);
const BOOK = path.join(DATA, 'demo.json');
const EXEMPT = path.join(DATA, 'kin-terms-exempt.json');

fs.writeFileSync(BOOK, JSON.stringify({
  meta: { slug: 'demo' },
  characters: [
    { id: 'a', name: '甲', aliases: [] },
    { id: 'b', name: '乙', aliases: [] },
  ],
  relations: [],
}, null, 2) + '\n', 'utf8');

const GOOD = [{ book: 'demo', from: 'a', to: 'b', reason: '演示理由，够八个字了吧' }];
const writeExempt = (o) => fs.writeFileSync(EXEMPT, JSON.stringify(o, null, 2) + '\n', 'utf8');
const rmExempt = () => { try { fs.unlinkSync(EXEMPT); } catch { /* 忽略 */ } };
const run = () => spawnSync(process.execPath, [SCRIPT], {
  encoding: 'utf8', env: { ...process.env, BOOKATLAS_ROOT: tmp },
}).status;

console.log('══ scripts/check-kin-terms-exempt.mjs 的守卫 ══\n');

writeExempt(GOOD);
ok(run() === 0, '正常态（一条合法豁免）⇒ exit 0');

rmExempt();
ok(run() === 0, '清单不存在（可选文件）⇒ exit 0');

const RED = [
  ['K1 顶层不是数组', { book: 'demo' }],
  ['K2 缺 `to` 字段', [{ book: 'demo', from: 'a', reason: '演示理由，够八个字了吧' }]],
  ['K2 `reason` 为空', [{ book: 'demo', from: 'a', to: 'b', reason: '   ' }]],
  ['K3 `reason` 短于 8 字（消费方会静默不生效）', [{ book: 'demo', from: 'a', to: 'b', reason: '太短' }]],
  ['K4 `book` 不是 data/ 下的书', [{ book: 'ghost', from: 'a', to: 'b', reason: '演示理由，够八个字了吧' }]],
  ['K5 `from` 不是真实 id', [{ book: 'demo', from: 'x', to: 'b', reason: '演示理由，够八个字了吧' }]],
  ['K5 `to` 不是真实 id', [{ book: 'demo', from: 'a', to: 'y', reason: '演示理由，够八个字了吧' }]],
  ['K5 用 name 而不是 id', [{ book: 'demo', from: '甲', to: '乙', reason: '演示理由，够八个字了吧' }]],
  ['K6 重复（同一 book+from+to）', [GOOD[0], { ...GOOD[0] }]],
  ['K7 `from` 与 `to` 相同', [{ book: 'demo', from: 'a', to: 'a', reason: '演示理由，够八个字了吧' }]],
];
for (const [label, obj] of RED) { writeExempt(obj); ok(run() === 1, `${label} ⇒ exit 1`); }

/* JSON 语法坏 —— 这是最阴的一种：消费方 loadExempt 会静默 return [] */
fs.writeFileSync(EXEMPT, '{ 这不是 JSON', 'utf8');
ok(run() === 1, 'K0 JSON 解析失败（消费方会静默当成空名单）⇒ exit 1');

writeExempt(GOOD);
ok(run() === 0, '还原后 ⇒ exit 0');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过（含 11 条「期望报红」场景）`}`);
process.exit(fail ? 1 : 0);
