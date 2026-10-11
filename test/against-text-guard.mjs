/**
 * 单测：`scripts/lib/against-text.mjs`（对着原著正文找漏人的判据）＋
 * **它在 `audit-against-text.mjs` 里确实被接上了**。
 *
 * ## 为什么值得单独测（v0.189）
 *
 * 起因是一个**报的数不是它算的数**的缺陷：老实现把 `slice(0, topN)` 之后的
 * 窗口条数当成"扫出 N 个疑似漏人"印出来 ——
 * 《百年孤独》真实待判 280 条却印「5 个」，《罪与罚》708 条印「16 个」。
 * 而且 `topN` 卡在"词的一部分"粗筛**之前** ⇒ 它既不是"前 N 条"，
 * 也不是"前 N 条像人名的"，是个两头不靠的截断。
 *
 * ## ⚠ 这条守卫的核心是"红绿证据"，不是"跑得通"
 *
 * 第 1 组用例**刻意让"坏"候选（紧跟在「的」后面，粗筛该丢）的排名高于"好"候选**，
 * 再把显示窗口设成 1：
 *
 *   · 正确顺序（先粗筛、后截断）⇒ 显示那 1 条好候选；
 *   · 旧顺序（先截断、后粗筛）⇒ 窗口里全是坏候选，粗筛后**一条都不剩**。
 *
 * 所以断言 `shown === 1 && rows[0].name === 好候选` 是**能红**的 ——
 * 把 lib 里那两行调回去，这条用例立刻变红。（已实测：调换后 3 条红。）
 *
 * ## ⚠ 这条守卫**刻意不起子进程**
 *
 * 本机 node 起不了**任何**子进程（`spawnSync` 一律 EBUSY，v0.180 实测），
 * 而原著 txt **不在版本库里**（`extract-epub.mjs` 注明了）⇒ 这条链**没法**做成
 * 跑 CLI 的门禁。这里直接 import 判据，用**合成文本**构造边界。
 * 代价：入口判断不在覆盖内 ⇒ 靠手工跑一次（v0.189 已跑：
 * `node scripts/audit-against-text.mjs data/crime-and-punishment.json .text/crime-and-punishment.txt`
 * 正常输出）。
 *
 * 用法：node test/against-text-guard.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGapReport, renderGapReport, norm, plain, NEAR, MIN, TOP_N }
  from '../scripts/lib/against-text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

console.log('══ scripts/lib/against-text.mjs 的守卫 ══\n');

/* ── 合成语料 ──
 * 「坏」候选紧跟在「的」后面（粗筛该丢），出现 5 次；
 * 「好」候选前面是句号（粗筛该留），出现 2 次。
 * ⇒ 排序按"近旁次数"降序 ⇒ **坏候选排在前**，这正是旧顺序会翻车的形状。
 */
const KNOWN = ['李四'];
const BAD = ['张甲乙', '王丙丁', '赵戊己', '钱庚辛', '孙壬癸'];
const GOOD = ['周子丑', '吴寅卯', '郑辰巳'];
let RAW = '';
for (let k = 0; k < 5; k++) for (const b of BAD) RAW += `李四的${b}。`;
for (let k = 0; k < 2; k++) RAW += `李四。${GOOD.join('。')}。`;

const ALL = BAD.length + GOOD.length;      // 8
const PLAUSIBLE = GOOD.length;             // 3

/* ── 1. ⚠ 核心：粗筛必须在截断**之前**（否则好候选一条都看不见）── */
{
  const r = buildGapReport({ raw: RAW, names: KNOWN, topN: 1 });
  ok(r.rawCount === ALL, `扫出 ${ALL} 个候选（实测 ${r.rawCount}）`);
  ok(r.total === ALL, `待判 ${ALL} 条（实测 ${r.total}）—— **不是窗口条数**`);
  ok(r.plausible === PLAUSIBLE, `粗筛后 ${PLAUSIBLE} 条（实测 ${r.plausible}）—— 5 个坏候选被丢掉`);
  ok(r.shown === 1 && r.rows[0] && r.rows[0].name === GOOD[0],
    `窗口=1 时显示的是**好候选**（实测 ${r.shown} 条：${r.rows.map((x) => x.name).join('、') || '空'}）`
    + ' —— 若 lib 里把 slice 挪回粗筛之前，这里会变成 0 条');
  ok(r.truncated === true, `粗筛后 ${PLAUSIBLE} 条 > 窗口 1 ⇒ 报截断`);
}

/* ── 2. 报告里的"待判总数"必须是真的（这就是 v0.189 修的那个假数）── */
{
  const r = buildGapReport({ raw: RAW, names: KNOWN, topN: 1 });
  const text = renderGapReport(r, { slug: 'demo', min: MIN, near: NEAR, topN: 1 }).join('\n');
  ok(new RegExp(`待判 ${ALL} 条`).test(text), `报告里印的是**待判 ${ALL} 条**，不是"本页 1 条"`);
  ok(/本页显示 1 条/.test(text) && /还有 2 条\*\*没有显示\*\*/.test(text),
    '报告里说清了本页显示几条、还差几条没显示');
  ok(/译本/.test(text) && /判别力很低/.test(text),
    '常驻提示：这条规则在译本上判别力很低（漏了就等于让人把 280 条候选当成 280 个漏掉的人）');
}

/* ── 3. 截断要**显式**说出来 ── */
{
  const r = buildGapReport({ raw: RAW, names: KNOWN, topN: 3 });
  ok(r.total === ALL && r.plausible === PLAUSIBLE && r.shown === 3 && r.truncated === false,
    '窗口 3 = 粗筛后 3 ⇒ 不算截断（不能把"够放"报成"截断了"）');
  const big = buildGapReport({ raw: RAW, names: KNOWN, topN: 99 });
  ok(big.shown === PLAUSIBLE, `窗口 99 ⇒ 粗筛后的 ${PLAUSIBLE} 条全在（实测 ${big.shown}）`);
}

/* ── 4. `--top 0`（≤0）必须**全列**，不是"一条都不显示" ── */
{
  const r = buildGapReport({ raw: RAW, names: KNOWN, topN: 0 });
  ok(r.shown === PLAUSIBLE, `topN=0 ⇒ 全列 ${PLAUSIBLE} 条（实测 ${r.shown}）—— 老写法 slice(0,0) 会一条都不显示`);
  ok(r.truncated === false, 'topN=0 时永远不算截断');
  const neg = buildGapReport({ raw: RAW, names: KNOWN, topN: -3 });
  ok(neg.shown === PLAUSIBLE, 'topN 为负数同样全列（不崩、不静默清空）');
}

/* ── 5. 台账扣除：**只认精确相等**（与 check-missing-ok 的 M6 同一口径）── */
{
  const r = buildGapReport({ raw: RAW, names: KNOWN, okSet: new Set(['张甲乙']), topN: 0 });
  ok(r.judgedDropped === 1, `命中台账 1 条（实测 ${r.judgedDropped}）`);
  ok(r.rawCount === ALL && r.total === ALL - 1, `扣掉前 ${ALL} 条、待判 ${ALL - 1} 条，两个数都报出来`);
  ok(!r.rows.some((x) => x.name === '张甲乙'), '判过的那条不再出现在清单里');

  const sub = buildGapReport({ raw: RAW, names: KNOWN, okSet: new Set(['张甲']), topN: 0 });
  ok(sub.judgedDropped === 0, '子串**不算**判过（「张甲」不该把「张甲乙」扣掉）');
}

/* ── 6. 已知名字要能挡住（否则"已知的人"会被报成"漏人"）── */
{
  const r = buildGapReport({ raw: '李四张三丰。李四张三丰。', names: ['李四', '张三丰'], topN: 0 });
  ok(r.rawCount === 0, `已知名字（含别名）不会进候选（实测 ${r.rawCount} 条）`);
  const r2 = buildGapReport({ raw: '李四张甲乙。李四张甲乙。', names: ['李四'], topN: 0 });
  ok(r2.rawCount === 1, '同一个名字出现 2 次 ⇒ 过门槛');
  const r3 = buildGapReport({ raw: '李四张甲乙。', names: ['李四'], topN: 0 });
  ok(r3.rawCount === 0, '只出现 1 次 ⇒ 不过默认门槛（min=2）');
}

/* ── 7. `norm` / `plain` 两个小工具（其余判据都建在它们上面）── */
{
  ok(norm('何塞·阿尔卡蒂奥') === '何塞阿尔卡蒂奥', 'norm 去掉间隔号（两本书的已知名都带 ·）');
  ok(norm('  A b，C ') === 'abc', 'norm 去空白/标点并小写');
  ok(plain('<p>甲&amp;乙</p>') === '甲&乙', 'plain 剥标签与实体');
  ok(plain('甲&#65;乙') === '甲乙', 'plain 剥数字实体（**只剥不解码** —— 原文本就是剥过的）');
}

/* ── 8. ⚠ 结构性：lib 里 slice 必须排在粗筛之后（静态兜一层）── */
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'against-text.mjs'), 'utf8');
  const iFilter = src.indexOf('const plausibleRows = ranked.filter(looksLikeName);');
  const iSlice = src.indexOf('plausibleRows.slice(0, topN)');
  ok(iFilter >= 0, 'lib 里有"粗筛"这一步（`ranked.filter(looksLikeName)`）');
  ok(iSlice >= 0, 'lib 里有"按 topN 截断"这一步（`plausibleRows.slice(0, topN)`）');
  ok(iFilter >= 0 && iSlice >= 0 && iFilter < iSlice,
    '**粗筛排在截断之前** —— 调回去就是 v0.189 修掉的那个"报的数不是算的数"');
}

/* ── 9. ⚠ lib 必须真的被接上（防「库写了、忘了接」）── */
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-against-text.mjs'), 'utf8');
  ok(/from\s+'\.\/lib\/against-text\.mjs'/.test(src),
    'audit-against-text.mjs 真的 import 了 lib/against-text.mjs（否则这个库就是死的）');
  ok(/buildGapReport\s*\(/.test(src) && /renderGapReport\s*\(/.test(src),
    '两个导出都被调用了（只 import 不用 = 另一种死法）');
  ok(/for \(const line of renderGapReport\(/.test(src),
    '报告的每一行都**打印**出来了（不打印就等于装饰品）');
  ok(!/\.slice\(0,\s*topN\)/.test(src),
    '脚本自己不再做 `slice(0, topN)` 截断（截断只许在 lib 里、且必须在粗筛之后）');
}

/* ── 10. ⚠ 百家姓表**只有一份**（v0.189）——`audit-search.mjs` 不再内联副本 ──
 *
 * 背景：`audit-search.mjs` 原先内联着一份 377 字的百家姓，与 lib 里那份**逐字相同**。
 * "逐字相同"本身没有门禁守得住 ⇒ 下次只补几个生僻姓到一边，同一本书两次扫描
 * （③ 与我们自己的文案 / 原著正文）候选就对不上，而两边都绿。
 * 这里静态钉住"那边真的改成 import 了、且没再自己声明一份"。
 */
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-search.mjs'), 'utf8');
  ok(/import\s*\{\s*SURNAMES\s*\}\s*from\s*'\.\/lib\/against-text\.mjs'/.test(src),
    'audit-search.mjs 从 lib/against-text.mjs import 了 SURNAMES（唯一来源）');
  ok(!/const\s+SURNAMES\s*=/.test(src),
    '**没有**再自己声明一份 `const SURNAMES =`（声明了就说明副本又回来了）');
  /* 只 import 不用 = 另一种死法：还得确认那个名字真被拼进扫描正则。 */
  ok(/new RegExp\(`\[\$\{SURNAMES\}\]/.test(src),
    'import 进来的 SURNAMES 真的拼进了扫描正则（不是死变量）');
}

/* ── 11. 入口卫生 ── */
{
  /* ⚠ 这里检查的是 **lib**，不是本守卫自己 —— 而本守卫的文件头正写着 spawnSync。
   *   且 `test/guard-hygiene.mjs`（H1）会**剥注释后**扫所有守卫，
   *   本文件里若出现 `child_process` 字面量会被它误判 ⇒ 关键词拆开构造。 */
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'against-text.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const banned = ['child_' + 'process', 'spawn' + 'Sync', 'exec' + 'Sync', 'require(' + "'fs'"];
  ok(!banned.some((k) => src.includes(k)), 'lib 里没有子进程、没有 fs（纯函数，守卫才能直接调）');
  ok(/^export function buildGapReport/m.test(src), '导出 buildGapReport');
  ok(/^export function renderGapReport/m.test(src), '导出 renderGapReport');
  ok(/^export function plain/m.test(src), '导出 plain');
  ok(/^export const NEAR/m.test(src) && /^export const MIN/m.test(src) && /^export const TOP_N/m.test(src),
    '导出 NEAR / MIN / TOP_N（阈值只有一处定义，消费方 import 而不是抄第二份）');
  ok(MIN === 2 && TOP_N === 60 && NEAR === 90, `默认阈值没被悄悄改（min=${MIN} top=${TOP_N} near=${NEAR}）`);
}

console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过`}`);
process.exit(fail ? 1 : 0);
