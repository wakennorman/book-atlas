/**
 * 单测：scripts/check-first-ch-ledger.mjs（firstCh 已核台账的一致性检查）
 *      ＋ scripts/audit-first-ch.mjs 的**子串碰撞**判据（v0.178 新增）。
 *
 * ## 为什么值得单独测
 *
 * 这条检查本身就是为了防"台账悄悄失效" —— 而**如果它自己永远 exit 0**，
 * 那它就是又一个「看着在守、其实没守」的假门禁（v0.145 / v0.146 / v0.154 /
 * v0.156 / v0.160~163 / v0.177 同一族）。⇒ 必须有一条测试**证明它真的会报红**。
 *
 * ## ⚠ 这条守卫**刻意不起子进程**
 *
 * 本机 node 起不了**任何**子进程（`spawnSync` 一律 EBUSY），所以
 * `test/*-guard.mjs` 里那套 `spawnSync(process.execPath, [SCRIPT])` 在本机
 * **每条用例都红**、等于没测。这里改用**导出的函数**：
 *
 *     checkFirstChLedger(root, { txtPath })   ← 显式传 root 与假原著路径
 *     auditFirstCh({ root, txtPath })          ← 子串碰撞判据
 *
 * ⚠ 代价：**入口判断**（`import.meta.url === pathToFileURL(process.argv[1])`，
 * 本仓库目录名带空格，写错就"主流程一次都不跑、退出码还是 0"）不在这条守卫的覆盖内
 * —— 靠手工跑一次 `node scripts/check-first-ch-ledger.mjs` 与
 * `node scripts/audit-first-ch.mjs` 确认（v0.178 已跑：两者 exit 0）。
 *
 * ## 假语料
 *
 * 在临时目录里造一份**只有 8 回**的三国 txt（`meta.chapters = 8`），
 * 人物都只出现一两次，这样每条判据都能被单独触发：
 *
 * | 人物 | firstCh | 原文首现 | 差 | 用途 |
 * |---|---|---|---|---|
 * | 甲甲 | 8 | 回1 | 7 | 未核的「其余」 |
 * | 乙乙 | 8 | 回1 | 7 | 已核的「其余」 |
 * | 戊戊 | 7 | 回1 | 6 | 已核（刚好在阈值之上） |
 * | 丁丁 | 6 | 回1 | 5 | **阈值之下 ⇒ 审计看不见**（用来测 L8 与阈值） |
 * | 丙丙 | 3 | 回3 | 0 | 回1 那次是子串碰撞（被地名「大丙」吞掉）⇒ 用来测碰撞判据 |
 *
 * 用法：node test/first-ch-ledger-guard.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkFirstChLedger } from '../scripts/check-first-ch-ledger.mjs';
import { auditFirstCh } from '../scripts/audit-first-ch.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-firstch-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA, { recursive: true });
const LEDGER = path.join(DATA, 'first-ch-ok.json');
const TXT = path.join(tmp, 'fake-3k.txt');

/* ── 假原著：8 回，回标记必须在行首（审计用的是 /^第…回/gm） ── */
const LINES = [
  '第一回起',
  '甲甲在此。大丙丙在此。乙乙在此。戊戊在此。丁丁在此。',
  '第二回二',
  '无事。',
  '第三回三',
  '丙丙在此。',
  '第四回四', '无事。',
  '第五回五', '无事。',
  '第六回六', '无事。',
  '第七回七', '无事。',
  '第八回八', '无事。',
];
fs.writeFileSync(TXT, LINES.join('\n'), 'utf8');

fs.writeFileSync(path.join(DATA, 'three-kingdoms.json'), JSON.stringify({
  meta: { slug: 'three-kingdoms', chapters: 8 },
  places: [{ name: '大丙' }],
  characters: [
    { id: 'jia', name: '甲甲', firstCh: 8 },
    { id: 'yi', name: '乙乙', firstCh: 8 },
    { id: 'wu', name: '戊戊', firstCh: 7 },
    { id: 'ding', name: '丁丁', firstCh: 6 },
    { id: 'bing', name: '丙丙', firstCh: 3 },
  ],
  relations: [],
  events: [],
}, null, 2) + '\n', 'utf8');

const mk = (name, firstCh, textFirst, extra = {}) => ({
  book: 'three-kingdoms', name, firstCh, textFirst, kind: '被提及',
  why: `${name} 的那次出现是"被提及"，不是出场，所以 firstCh 本来就对`,
  ...extra,
});
const GOOD = [mk('甲甲', 8, 1), mk('乙乙', 8, 1), mk('戊戊', 7, 1)];
const writeL = (o) => fs.writeFileSync(LEDGER, JSON.stringify(o, null, 2) + '\n', 'utf8');
const rmL = () => { try { fs.unlinkSync(LEDGER); } catch { /* 忽略 */ } };
const run = () => checkFirstChLedger(tmp, { txtPath: TXT });
const audit = () => auditFirstCh({ root: tmp, txtPath: TXT });

console.log('══ scripts/check-first-ch-ledger.mjs ＋ audit-first-ch 子串碰撞 的守卫 ══\n');

/* ── 0. 先验假语料本身 ── */
{
  const r = audit();
  ok(!r.error, '假语料能跑起来（分章 / 数据 / 台账都读到了）');
  ok(r.cand.length === 3, `待核清单 3 条（甲甲/乙乙/戊戊，差 7/7/6）—— 实测 ${r.cand.length} 条`);
  ok(!r.cand.some((x) => x.name === '丁丁'), '丁丁（差 5）**不在**清单里 ⇒ 阈值 > 5 生效');
  ok(r.unReviewed.length === 3, '未核 3 条（台账还没写）');
  const col = r.collisions.filter((x) => x.name === '丙丙');
  ok(col.length === 1 && col[0].ent === '大丙',
    `子串碰撞：丙丙（回1）⊂「大丙」被跳过 ⇒ 首现顺延到回3（差 0）${col.length === 1 ? '' : ' —— ⚠ 没跳过！'}`);
  const bing = r.cand.find((x) => x.name === '丙丙');
  ok(!bing, '丙丙不在清单里（首现已顺延到回3、与 firstCh 相同）');
}

/* ── 1. 正常态 ── */
writeL(GOOD);
ok(run().problems.length === 0, '正常态（3 条已核、数据一致）⇒ 0 处问题');
ok(audit().unReviewed.length === 0, '正常态：审计的「未核」= 0');
{
  const { notes } = run();
  ok(notes.some((n) => /L10 ✓ 双向/.test(n)), 'L10 双向跑通了（原著在 ⇒ 真的比对了）');
}

rmL();
ok(run().problems.length === 0, '没有台账文件 ⇒ 0 处问题（可选文件）');

/* ── 2. 每条判据各造一个反例 ── */
const RED = [
  ['L1 顶层不是数组', { 说明: 'x' }],
  ['L2 条目不是对象', ['x']],
  ['L2 book 为空', [mk('甲甲', 8, 1, { book: '  ' })]],
  ['L2 name 为空', [mk('甲甲', 8, 1, { name: '' })]],
  ['L2 firstCh 不是正整数', [mk('甲甲', '8', 1)]],
  ['L2 textFirst 不是正整数', [mk('甲甲', 8, '1')]],
  ['L2 why 不是字符串', [mk('甲甲', 8, 1, { why: 42 })]],
  ['L3 why 为空', [mk('甲甲', 8, 1, { why: '   ' })]],
  ['L3 why 不足 8 字', [mk('甲甲', 8, 1, { why: '太短' })]],
  ['L3 why 里用空白凑长度（去空白后仍不足 8 字）', [mk('甲甲', 8, 1, { why: 'a b c d' })]],
  ['L4 kind 不在闭集里', [mk('甲甲', 8, 1, { kind: '随便写的' })]],
  ['L5 书不存在', [mk('甲甲', 8, 1, { book: 'ghost' })]],
  ['L6 数据里没有这个人', [mk('张三', 8, 1)]],
  ['L7 台账 firstCh 与数据不一致', [mk('甲甲', 7, 1)]],
  ['L8 firstCh − 原文首现 ≤ 阈值（丁丁：6−1=5）', [mk('丁丁', 6, 1)]],
  ['L9 同一 book|name 重复', [GOOD[0], mk('甲甲', 8, 1, { why: '另一条理由，也够八个字' })]],
  ['L10 数据里有未核的「其余」条目（台账只覆盖一半）', [GOOD[0]]],
];
const RED_COUNT = RED.length;
for (const [label, obj] of RED) {
  writeL(obj);
  const ps = run().problems;
  ok(ps.length > 0, `${label} ⇒ 报红（${ps.length} 处）${ps.length ? '' : ' —— ⚠ 没报红！'}`);
}

/* JSON 语法坏 */
fs.writeFileSync(LEDGER, '{ 这不是 JSON', 'utf8');
ok(run().problems.length > 0, 'L1 JSON 解析失败 ⇒ 报红');

/* ── 3. 反向：别误伤 ── */
writeL([...GOOD, mk('丁丁', 6, 1)]);
{
  const ps = run().problems;
  ok(ps.length === 1 && /L8/.test(ps.join('')),
    'L8 反向：只有"差 5（不该在台账里）"的丁丁被报，合法的三条不误伤');
}

/* 原著不在 ⇒ L10 只打印跳过、不报红（CI 上的真实情形） */
writeL(GOOD);
{
  const r = checkFirstChLedger(tmp, { txtPath: path.join(tmp, '不存在.txt') });
  ok(r.problems.length === 0 && r.notes.some((n) => /L10（双向）\*\*跳过\*\*/.test(n)),
    '原著不在本机 ⇒ L10 只打印「跳过」、不报红（且**必须打印**，不能静默）');
}

writeL(GOOD);
ok(run().problems.length === 0, '还原后 ⇒ 0 处问题');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过（含 ${RED_COUNT} 条「期望报红」场景 + 1 条 JSON 坏 + 3 条反向/跳过）`}`);
process.exit(fail ? 1 : 0);
