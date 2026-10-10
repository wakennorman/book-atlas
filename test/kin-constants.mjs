/**
 * KIN / KIN_HINT / BLOOD_TERM 跨端一致性对拍（v0.149 新增；v0.152 补 BLOOD_TERM）
 *
 * ## 为什么要有它
 *
 * 「亲属类型」的标签（blood→血缘、inlaw→姻亲…）在项目里有 **5 处副本**：
 *   · scripts/kin.mjs                     —— 权威（被 validate.mjs / annotate-kin.mjs / wholebook.mjs import）
 *   · js/app.js            KIN_LABEL      —— 网页端
 *   · js/editor.js         KIN_LABEL      —— 编辑器端
 *   · miniprogram/utils/graph.js          —— 小程序（KIN + KIN_HINT）
 *   · miniprogram/pages/index/index.js    —— 小程序（KIN_LABEL）
 *
 * 之所以是副本而不是单一来源：浏览器 / 小程序模块 import 不了 `scripts/`（会要求把 scripts/ 也塞进
 * SW 预缓存 / 小程序包），项目对同类问题的既定策略是「手抄 + 对拍」（见 v0.146 的 guessKin、v0.147）。
 *
 * 目前 5 处一致，但**没有任何测试守着** —— 某端单独改一个标签（如把「姻亲」写成「亲家」），
 * 就会出现「同一个 kin 在网页显示 A、在小程序显示 B」这种**用户可见**的不一致，而门禁全绿。
 *
 * ## 做法
 *
 * 读各文件源码 → 正则抽出常量对象字面量 → 逐键比对（连「漏抄一个键」也能抓到）。
 * 不用 `new Function` / `eval`：对象值全是单引号字符串，正则足够，也免得踩 eslint 的 no-new-func。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIN, guessKin } from '../scripts/kin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 从源码里抽 `[export] const NAME = { ... };`，解析成对象（值按单引号字符串取）。 */
function pick(file, name) {
  const m = read(file).match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;`));
  if (!m) throw new Error(`在 ${file} 里找不到 const ${name} = {...}`);
  const obj = {};
  for (const km of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*'([^']*)'/g)) obj[km[1]] = km[2];
  if (Object.keys(obj).length === 0) throw new Error(`${file} 的 ${name} 没解析出任何键（写法变了吗？）`);
  return obj;
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.error(`  ✗ ${msg}`); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n▶ KIN 标签（与权威 scripts/kin.mjs 的 KIN 逐字比对）');
const LABEL_SITES = [
  ['js/app.js', 'KIN_LABEL'],
  ['js/editor.js', 'KIN_LABEL'],
  ['miniprogram/utils/graph.js', 'KIN'],
  ['miniprogram/pages/index/index.js', 'KIN_LABEL'],
];
for (const [f, name] of LABEL_SITES) {
  let v;
  try { v = pick(f, name); } catch (e) { ok(false, `${f}: ${e.message}`); continue; }
  ok(same(v, KIN), `${f} 的 ${name} 与权威一致（${Object.keys(v).length} 键）`);
}

console.log('\n▶ KIN_HINT（两处互比）');
const HINT_SITES = ['js/app.js', 'miniprogram/utils/graph.js'];
const hints = [];
for (const f of HINT_SITES) {
  try { hints.push([f, pick(f, 'KIN_HINT')]); } catch (e) { ok(false, `${f}: ${e.message}`); }
}
if (hints.length === 2) {
  ok(same(hints[0][1], hints[1][1]), `KIN_HINT 两处一致（${hints[0][0]} ⇄ ${hints[1][0]}）`);
  ok(same(Object.keys(hints[0][1]).sort(), Object.keys(KIN).sort()), 'KIN_HINT 的键集合与 KIN 相同');
}

console.log('\n▶ 权威键集合（金标：钉「正确」而非「现状」）');
const EXPECTED = ['adoptive', 'blood', 'foster', 'inlaw', 'marriage', 'step', 'sworn'];
ok(same(Object.keys(KIN).sort(), EXPECTED), `KIN 恰有这 7 个键：${EXPECTED.join(' / ')}`);

console.log('\n▶ BLOOD_TERM（纯血缘称谓表：两处逐字对拍 + 金标）');
/* 「纯血缘称谓」表（父子/母子/兄弟/舅甥…）在项目里有 **2 处副本**：
 *   · scripts/kin.mjs  —— 权威（checkKin 靠它判「标了非 blood，type 却是血缘称谓」）
 *   · js/editor.js     —— 编辑器（kinIssues 用同一张表，「校验」与「数据体检」共用）
 * 这张表**已经漂过**：编辑器那份少了 8 个词（姨甥 / 表兄弟 / 表兄妹 / 堂兄弟 / 堂兄妹 /
 * 孪生兄弟 / 孪生姐妹 / 父子关系），于是「堂兄弟 + kin=收养」在 scripts 侧报错、
 * 编辑器侧不报 —— 而当时**没有任何测试守着**（浏览器里那份 kinIssues 的对拍是 v0.152 才补的）。
 * ⚠ 只对拍抓不到「两边一起错」：一起删掉「堂兄弟」两边照样一致。
 *   所以下面还有一张**金标**表钉"正确"，而不只是钉"两边一样"。 */
function pickRe(file, name) {
  const m = read(file).match(new RegExp('(?:export\\s+)?const\\s+' + name + '\\s*=\\s*/([^/]*)/'));
  if (!m) throw new Error(`在 ${file} 里找不到 const ${name} = /.../`);
  return m[1];
}
const TERM_SITES = ['scripts/kin.mjs', 'js/editor.js'];
const terms = [];
for (const f of TERM_SITES) {
  try { terms.push([f, pickRe(f, 'BLOOD_TERM')]); } catch (e) { ok(false, `${f}: ${e.message}`); }
}
if (terms.length === 2) {
  ok(terms[0][1] === terms[1][1], `BLOOD_TERM 两处逐字一致（${terms[0][0]} ⇄ ${terms[1][0]}）`);
}

const EXPECTED_TERMS = [
  '父子', '父女', '母子', '母女', '兄弟', '姐妹', '兄妹', '姐弟', '祖孙', '曾祖孙', '叔侄',
  '舅甥', '姨甥', '姑侄', '表兄弟', '表兄妹', '堂兄弟', '堂兄妹', '孪生兄弟', '孪生姐妹', '父子关系',
];
try {
  const body = pickRe('scripts/kin.mjs', 'BLOOD_TERM');
  /* `^` 是**载荷**，不是装饰：少了它，type「养父子」会命中里面的「父子」
   * ⇒ 一条「kin=收养 + 养父子」的合法关系被判成「血缘称谓配了收养」。 */
  ok(/^\^\(/.test(body) && /\)$/.test(body),
    '权威 BLOOD_TERM 写成 `^(…)`（锚定在开头 + 整条一个分组）—— 少了 `^`，「养父子」会被误判成血缘称谓');
  const authTerms = body.replace(/^\^/, '').replace(/^\(/, '').replace(/\)$/, '').split('|');
  const missing = EXPECTED_TERMS.filter((w) => !authTerms.includes(w));
  const extra = authTerms.filter((w) => !EXPECTED_TERMS.includes(w));
  ok(same(authTerms, EXPECTED_TERMS),
    `权威 BLOOD_TERM 恰有这 ${EXPECTED_TERMS.length} 个称谓、顺序一致`
    + `${missing.length ? `（缺 ${missing.join(' / ')}）` : ''}${extra.length ? `（多 ${extra.join(' / ')}）` : ''}`);
} catch (e) { ok(false, e.message); }

console.log('\n▶ guessKin 跨端对拍（9 条正则 + 分支顺序 + STEP 金标）');
/* `guessKin` 在项目里有 **2 份实现**：
 *   · scripts/kin.mjs   —— 权威（正则抽成具名常量：SWORN / ADOPTIVE / STEP / …）
 *   · js/editor.js      —— 编辑器手抄的第二份（正则**内联**在函数体里）
 * 编辑器那份的注释自己写着「必须与 scripts/kin.mjs 的 guessKin 逐字对应」，
 * 但**此前没有任何测试守着**它 —— 而它已经漂过（v0.145：少 `晚爹`、NOT_KIN 少 12 词、BLOOD 少 9 词）。
 *
 * 起因（v0.179）：`STEP` 只枚举了 `继[父母子女儿]`，不认「继兄弟 / 继姐妹 / 继兄妹 / 继姐弟」，
 *   于是这些词落到 BLOOD（里面恰好有 兄|弟|姐|妹）⇒ `继姐妹` 被判成血缘。
 *   罪与罚 3 条**正确**的数据因此被 validate 报「看着像 血缘，但标的是 继亲」。
 *   ⇒ 补上字，并在这里加判据：**正则集合 + 分支顺序**两处一致，外加一张钉"正确"的金标表。
 *   ⚠ 只对拍抓不到「两边一起错」（一起删掉「继兄」两边照样一致）⇒ 金标表不能省。
 */
function guessKinSpec(file) {
  const src = read(file);
  const named = {};
  for (const m of src.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z_]*)\s*=\s*\/([^/\n]+)\/;/g)) named[m[1]] = m[2];
  const fn = src.match(/function guessKin\(type\)\s*\{[\s\S]*?\n[ \t]*\}/);
  if (!fn) throw new Error(`在 ${file} 里找不到 function guessKin(type) {…}`);
  /* 去掉注释再扫 —— 注释里在**讲**这些正则，会提到旧写法与「父/母/兄/弟」这类斜杠。 */
  const body = fn[0].replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const res = new Set();
  for (const m of body.matchAll(/\/([^/\n]+)\/\.test\(t\)/g)) res.add(m[1]);
  for (const m of body.matchAll(/([A-Z][A-Z_]*)\.test\(t\)/g)) {
    if (!named[m[1]]) throw new Error(`${file}：${m[1]} 在 guessKin 里用了，但找不到 const 定义`);
    res.add(named[m[1]]);
  }
  /* 分支顺序也要对：把「恋爱类」挪到 blood 之前会改变判定结果，而正则集合看不出来。 */
  const rets = [...body.matchAll(/return\s+'([a-z]*)';/g)].map((m) => m[1]);
  return { res: [...res].sort(), rets };
}
try {
  const a = guessKinSpec('scripts/kin.mjs');
  const b = guessKinSpec('js/editor.js');
  ok(a.res.length >= 9, `从权威里抽到 ${a.res.length} 条正则（应 ≥9）`);
  ok(same(a.res, b.res), `两份 guessKin 的正则集合一致（各 ${a.res.length} 条）`
    + `${same(a.res, b.res) ? '' : `\n      权威独有：${a.res.filter((x) => !b.res.includes(x)).join(' / ')}`
      + `\n      编辑器独有：${b.res.filter((x) => !a.res.includes(x)).join(' / ')}`}`);
  ok(same(a.rets, b.rets), `两份 guessKin 的分支顺序一致（return 序列 ${a.rets.map((r) => r || '空').join(' → ')}）`);
} catch (e) { ok(false, e.message); }

/* 金标：钉「正确」而不是钉「现状」。左边 = type，右边 = guessKin 该给的答案。 */
const GK_CASES = [
  // 继亲本人 / 继亲子 —— 本来就认得
  ['继父', 'step'], ['继母', 'step'], ['继子', 'step'], ['继女', 'step'],
  ['继父子', 'step'], ['继母女', 'step'], ['继母继子', 'step'], ['继母（继亲）', 'step'],
  // ★ v0.179 补上的继亲**兄弟姐妹**（原先一条都不认，全落进 blood）
  ['继兄弟', 'step'], ['继姐妹', 'step'], ['继兄妹', 'step'], ['继姐弟', 'step'],
  ['继兄', 'step'], ['继姐', 'step'], ['继弟', 'step'], ['继妹', 'step'],
  // 口语的继亲词
  ['后妈', 'step'], ['后爹', 'step'], ['晚娘', 'step'], ['晚爹', 'step'], ['填房', 'step'],
  // ★ 反例：新加的「兄姐弟妹」四个字**不能**误伤这些非继亲的词
  ['继任', ''], ['受遗命继事', ''], ['继任次序', ''], ['继任（主祭神甫）', ''],
  // 反例：真血缘 / 收养不能被抢走
  ['兄弟', 'blood'], ['姐妹', 'blood'], ['兄妹', 'blood'], ['父子', 'blood'],
  ['养父子', 'adoptive'], ['收养', 'adoptive'],
];
for (const [type, want] of GK_CASES) {
  const got = guessKin(type);
  ok(got === want, `guessKin(${JSON.stringify(type)}) = ${JSON.stringify(got)}`
    + `${got === want ? '' : `（应为 ${JSON.stringify(want)}）`}`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} KIN 跨端一致性　通过：${pass}  失败：${fail}`);
process.exit(fail === 0 ? 0 : 1);
