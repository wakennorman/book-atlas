/**
 * 单测：scripts/check-surname-coverage.mjs（「提取器盲区台账」的一致性检查）。
 *
 * ## 为什么值得单独测一条「检查脚本」
 *
 * 这条检查守的是「**工具看不见的人**」：缺口检测靠 `audit-against-text.mjs` 的
 * `/[百家姓][\u4e00-\u9fa5]{1,2}/` 产候选，产不出来的人真漏了也不会进缺口清单。
 * 实测：百年孤独 **60 个主名一个都产不出来**、罪与罚 5/38、三国 792/882。
 * 而这条检查**自己解析工具源码**来保持同源 —— 解析不到就报红（C0），
 * 那样它才有资格说「盲区已被显式化」。它若永远 exit 0，就是又一个假门禁
 * （v0.145 / v0.146 / v0.154 / v0.156 / v0.160~163 同一族）。
 *
 * ## 怎么测：造一个**临时目录**，把 ROOT 指过去
 *
 * 脚本支持 `BOOKATLAS_ROOT`（只给测试用）。tmp 里写：最小 `data/`（books.json + demo.json
 * + 台账）+ **一份 tools/audit-against-text.mjs 副本**（检查要解析它）。
 * 逐场景跑、断言退出码，**全程不碰真实仓库**。
 *
 * ## demo 书的四个人是刻意挑的
 *
 *   张飞     张在百家姓表内、2 字 ⇒ **产得出来**（不该出现在台账里）
 *   丽贝卡   首字「丽」不在表内 ⇒ 盲区（成因①）
 *   吴太夫人 吴在表内但 4 字 ⇒ 盲区（成因②：只取 2~3 字）
 *   张飞→子义 简称别名，产不出来但**按设计不申报**（缺口检测按主名找人）
 *
 * 用法：node test/surname-coverage-guard.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-surname-coverage.mjs');
const TOOL = path.join(ROOT, 'scripts', 'audit-against-text.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-scv-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA);
fs.mkdirSync(path.join(tmp, 'scripts'));
/* 检查要解析工具源码来保持同源 ⇒ tmp 里必须有一份副本（两条「同源」场景还要改它） */
fs.copyFileSync(TOOL, path.join(tmp, 'scripts', 'audit-against-text.mjs'));

const BOOK = path.join(DATA, 'demo.json');
const LF = path.join(DATA, 'demo.surname-blind-ok.json');
const toolText = fs.readFileSync(TOOL, 'utf8');

fs.writeFileSync(path.join(DATA, 'books.json'), JSON.stringify({ books: [{ slug: 'demo' }] }, null, 2) + '\n', 'utf8');
fs.writeFileSync(BOOK, JSON.stringify({
  meta: { slug: 'demo' },
  characters: [
    { id: 'a', name: '张飞', aliases: ['子义'], altNames: [] },
    { id: 'b', name: '丽贝卡', aliases: [], altNames: [] },
    { id: 'c', name: '吴太夫人', aliases: [], altNames: [] },
  ],
  places: [],
  relations: [],
}, null, 2) + '\n', 'utf8');

const GOOD = [
  '_说明：demo 台账',
  { name: '丽贝卡', why: '首字「丽」不在工具那张单字百家姓表里 ⇒ 产不出来' },
  { name: '吴太夫人', why: '提取器只取「姓氏字＋1~2 字」，本名 4 字 ⇒ 整名产不出来' },
];
const writeLf = (o) => fs.writeFileSync(LF, JSON.stringify(o, null, 2) + '\n', 'utf8');
const rmLf = () => { try { fs.unlinkSync(LF); } catch { /* 忽略 */ } };
const writeTool = (s) => fs.writeFileSync(path.join(tmp, 'scripts', 'audit-against-text.mjs'), s, 'utf8');
const run = () => spawnSync(process.execPath, [SCRIPT], {
  encoding: 'utf8', env: { ...process.env, BOOKATLAS_ROOT: tmp },
}).status;

console.log('══ scripts/check-surname-coverage.mjs 的守卫 ══\n');

rmLf();
fs.writeFileSync(BOOK, JSON.stringify({
  meta: { slug: 'demo' },
  characters: [{ id: 'a', name: '张飞', aliases: [], altNames: [] }],
  places: [], relations: [],
}, null, 2) + '\n', 'utf8');
ok(run() === 0, '正常态（主名全部产得出来、没有台账）⇒ exit 0');

fs.writeFileSync(BOOK, JSON.stringify({
  meta: { slug: 'demo' },
  characters: [
    { id: 'a', name: '张飞', aliases: ['子义'], altNames: [] },
    { id: 'b', name: '丽贝卡', aliases: [], altNames: [] },
    { id: 'c', name: '吴太夫人', aliases: [], altNames: [] },
  ],
  places: [], relations: [],
}, null, 2) + '\n', 'utf8');

rmLf();
ok(run() === 1, 'C8 有盲区主名却**没有台账** ⇒ exit 1（盲区是隐形的）');

writeLf(GOOD);
ok(run() === 0, '正常态（两个盲区主名都申报了理由）⇒ exit 0');

const RED = [
  ['C8 台账漏报一个盲区主名', ['_说明', { name: '丽贝卡', why: '演示' }]],
  ['C2 `why` 为空', ['_说明', { name: '丽贝卡' }, { name: '吴太夫人', why: '演示' }]],
  ['C2 `why` 是空白', ['_说明', { name: '丽贝卡', why: '  ' }, { name: '吴太夫人', why: '演示' }]],
  ['C2 条目是字符串（不是 {name,why}）', ['_说明', '丽贝卡', { name: '吴太夫人', why: '演示' }]],
  ['C3 同一个盲区名重复申报', ['_说明',
    { name: '丽贝卡', why: '演示' }, { name: '丽贝卡', why: '演示' },
    { name: '吴太夫人', why: '演示' }]],
  ['C4 申报的是**别名**（子义）而不是主名', ['_说明',
    { name: '子义', why: '演示' },
    { name: '丽贝卡', why: '演示' }, { name: '吴太夫人', why: '演示' }]],
  ['C4 申报了一个**查无此人**的名字', ['_说明',
    { name: '查无此人', why: '演示' },
    { name: '丽贝卡', why: '演示' }, { name: '吴太夫人', why: '演示' }]],
  ['C5 豁免了一个**产得出来**的名字（张飞）', ['_说明',
    { name: '张飞', why: '演示' },
    { name: '丽贝卡', why: '演示' }, { name: '吴太夫人', why: '演示' }]],
  ['C1 既不是数组也没有 `明细`', { 说明: 'x' }],
  ['C6 `申报条数` 与明细条数不符', { 申报条数: 5, 明细: GOOD.slice(1) }],
];
for (const [label, obj] of RED) { writeLf(obj); ok(run() === 1, `${label} ⇒ exit 1`); }

/* 反向：别名产不出来**不该**要求申报（上一步 GOOD 里没有「子义」，已隐含验证） */
writeLf(GOOD);
ok(run() === 0, '反向：简称别名（子义）产不出来但未申报 ⇒ 不报红（缺口检测按主名找人）');

/* JSON 语法坏 */
fs.writeFileSync(LF, '{ 这不是 JSON', 'utf8');
ok(run() === 1, 'C1 台账 JSON 解析失败 ⇒ exit 1');

/* 孤儿台账 */
rmLf();
fs.writeFileSync(path.join(DATA, 'ghost.surname-blind-ok.json'), JSON.stringify(['_说明'], null, 2) + '\n', 'utf8');
ok(run() === 1, 'C7 孤儿台账（有台账没有 .json）⇒ exit 1');
fs.unlinkSync(path.join(DATA, 'ghost.surname-blind-ok.json'));

/* C0：工具源码解析不出来 ⇒ 必须报红（拒绝猜默认值），而不是当通过 */
writeLf(GOOD);
writeTool(toolText.replace("const SURNAMES = '", 'const SURNAMES_FOR_COMPILER = '));
ok(run() === 1, 'C0 工具里解析不到 SURNAMES ⇒ exit 1（宁可报红，不猜默认值跑假绿）');
writeTool(toolText.replace(/const\s+norm\s*=/, 'const normRenamed ='));
ok(run() === 1, 'C0 工具里解析不到 norm ⇒ exit 1');
writeTool(toolText.replace(/\[\$\{SURNAMES\}\]\[\S*?\]\{(\d+),(\d+)\}/, '[${SURNAMES}][\\u4e00-\\u9fa5]{1,2}X'));
ok(run() === 1, 'C0 工具里解析不到 surnameRe 的长度区间 ⇒ exit 1');

/* 台账自失效：提取器一放宽（姓氏表里加了「丽」），那条豁免立刻变过期 */
writeTool(toolText.replace("const SURNAMES = '赵", "const SURNAMES = '丽赵"));
ok(run() === 1, '提取器放宽后（丽 进姓氏表）「丽贝卡」豁免过期 ⇒ exit 1（台账会自失效）');
writeTool(toolText);

writeLf(GOOD);
ok(run() === 0, '全部还原后 ⇒ exit 0');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过（含 C0 同源三档 + 自失效场景）`}`);
process.exit(fail ? 1 : 0);
