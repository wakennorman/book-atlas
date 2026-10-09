/**
 * 单测：scripts/check-missing-ok.mjs（「噪声忽略名单」的一致性检查）。
 *
 * ## 为什么值得单独测一条「检查脚本」
 *
 * 这条检查本身就是为了防"名单悄悄失效" —— 而**如果它自己永远 exit 0**
 * （入口判断写成 `import.meta.url.endsWith(process.argv[1])` 就够了：
 *   本仓库目录名带空格，路径里的空格是 %20 编码，两边永远不相等 ⇒ 主流程一次都不跑、
 *   退出码还是 0 —— "检查通过"其实是"检查没执行"），
 * 那它就是又一个「看着在守、其实没守」的假门禁（v0.145 / v0.146 / v0.154 / v0.156 / v0.160~162 同一族）。
 * ⇒ 必须有一条测试**证明它真的会报红**。
 *
 * ## 怎么测：造一个**临时目录**，把 ROOT 指过去
 *
 * 脚本支持 `BOOKATLAS_ROOT` 环境变量（只给测试用），所以这里在 tmp 里写一份最小
 * `data/demo.json`（一本 demo 书）+ `data/demo.missing-ok.json`，逐场景跑、断言退出码。
 * **全程不碰真实仓库**。
 *
 * ⚠ 主力判据是 M6：忽略条目**恰好等于**数据里某个真名 ⇒ 报红
 *   （名单自称"不是人名"，可数据里就有这个人）。
 *   但**子串**不算（名单口径 ③ 明确允许"属于已有人物的别名或全名片段"）——
 *   这里也钉一条：`甲`（是「甲人」的子串）**不该**报红。
 *
 * 用法：node test/missing-ok-guard.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-missing-ok.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-mok-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA);
const BOOK = path.join(DATA, 'demo.json');
const MF = path.join(DATA, 'demo.missing-ok.json');

fs.writeFileSync(BOOK, JSON.stringify({
  meta: { slug: 'demo' },
  characters: [
    { id: 'a', name: '甲人', aliases: ['甲别名'], altNames: ['甲译'] },
    { id: 'b', name: '乙人', aliases: [] },
  ],
  places: [{ id: 'p', name: '甲城', aliases: ['甲地'] }],
  relations: [],
}, null, 2) + '\n', 'utf8');

const GOOD = ['_说明', '_这一本是演示用的。', '文分解', { name: '不是人', why: '演示理由' }];
const writeMf = (o) => fs.writeFileSync(MF, JSON.stringify(o, null, 2) + '\n', 'utf8');
const rmMf = () => { try { fs.unlinkSync(MF); } catch { /* 忽略 */ } };
const run = () => spawnSync(process.execPath, [SCRIPT], {
  encoding: 'utf8', env: { ...process.env, BOOKATLAS_ROOT: tmp },
}).status;

console.log('══ scripts/check-missing-ok.mjs 的守卫 ══\n');

writeMf(GOOD);
ok(run() === 0, '正常态（说明行 + 字符串 + {name,why}）⇒ exit 0');

rmMf();
ok(run() === 0, '没有任何 missing-ok 文件 ⇒ exit 0');

const RED = [
  ['M1 顶层不是数组', { 说明: 'x' }],
  ['M2 条目是数字（消费方会静默忽略）', ['_说明', 42]],
  ['M2 条目是数组', ['_说明', ['文分解']]],
  ['M3 名字为空字符串', ['_说明', '  ']],
  ['M3 对象条目的 name 以 `_` 开头（会被当说明吞掉）', ['_说明', { name: '_文分解', why: '演示理由' }]],
  ['M4 名字重复', ['_说明', '文分解', '文分解']],
  ['M5 `{name,why}` 缺 why', ['_说明', { name: '不是人' }]],
  ['M5 `{name,why}` 的 why 是空白', ['_说明', { name: '不是人', why: '   ' }]],
  ['M6 忽略条目恰好是**人物主名**（甲人）', ['_说明', '甲人']],
  ['M6 忽略条目恰好是**人物别名**（甲别名）', ['_说明', '甲别名']],
  ['M6 忽略条目恰好是**人物译名**（甲译）', ['_说明', '甲译']],
  ['M6 忽略条目恰好是**地点名**（甲城）', ['_说明', '甲城']],
  /* M8（v0.164 新增）：这份名单自己就犯过 —— 两本书的 `_说明` 第二行漏了 `_` 前缀，
     整句 46~54 字被当成「已判过的噪声」。M3 抓不到（它只问会不会被吞）。 */
  ['M8 条目是一整句说明（含「：」和 `**`）', ['_说明', '这是 audit-against-text.mjs 的**噪声忽略名单**：只收「实测确认不是人名」的候选。']],
  ['M8 条目是整句说明但没标点（超 12 字）', ['_说明', '这是一条很长的忽略条目名称']],
];
const RED_COUNT = RED.length;
for (const [label, obj] of RED) { writeMf(obj); ok(run() === 1, `${label} ⇒ exit 1`); }

/* 正向：真实条目最长 5 字（实测三本书），长于此但仍合法的写法不该被误伤 */
writeMf(['_说明', '这不是人名']);   // 5 字
ok(run() === 0, 'M8 反向：5 字的正常条目 ⇒ 不报红（阈值不误伤合法条目）');

/* 子串**不该**报红（口径 ③ 允许"已有人物的别名或全名片段"） */
writeMf(['_说明', '甲']);
ok(run() === 0, 'M6 反向：名字是真人名的**子串**（甲 ⊂ 甲人）⇒ exit 0（口径 ③ 允许片段）');

/* JSON 语法坏 */
fs.writeFileSync(MF, '{ 这不是 JSON', 'utf8');
ok(run() === 1, 'M1 JSON 解析失败 ⇒ exit 1');

/* 孤儿名单：有 missing-ok、没有对应的书 */
rmMf();
fs.writeFileSync(path.join(DATA, 'ghost.missing-ok.json'), JSON.stringify(['_说明', 'x'], null, 2) + '\n', 'utf8');
ok(run() === 1, 'M7 孤儿名单（有 .missing-ok 没有 .json）⇒ exit 1');
fs.unlinkSync(path.join(DATA, 'ghost.missing-ok.json'));

writeMf(GOOD);
ok(run() === 0, '还原后 ⇒ exit 0');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过（含 ${RED_COUNT} 条「期望报红」场景）`}`);
process.exit(fail ? 1 : 0);
