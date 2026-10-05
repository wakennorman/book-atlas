#!/usr/bin/env node
/**
 * 亲属称谓对质（发布门禁的一步）：拿族谱算出的称谓，去对质数据里**手写的** type。
 *
 * 起因（v0.98，用户抓出来的）：
 *   《百年孤独》有一条「奥雷里亚诺·布恩迪亚上校 —叔侄（伯父与侄）— 奥雷里亚诺第二」。
 *   上校是第二代、奥雷里亚诺第二是第四代，**差两代**，"叔侄"在中文里严格只指差一代
 *   ⇒ 应该是「叔祖父与侄孙」。同类错误一共 3 条，全都差一代，而且 events 为 0（无原文依据）。
 *
 * 为什么这类错误能长期存活：
 *   ① 称谓是**手打的字符串**，不是算出来的，所以不可能自洽；
 *   ② derive-kin.mjs 开头有一条「已有直接关系的两个人不再推导」⇒
 *      **手打的错标签把推导系统挡住了**：错的不但没被改对，还顺带让正确的推导边也不生成。
 *
 * 所以本检查做两件事：
 *   1. 对质：手写的亲属称谓与族谱算出来的不一致 ⇒ **报错**（除非在豁免清单里并写明理由）
 *   2. 统计遮挡：有多少"族谱能算、但因为已有一条手写关系而不会被推导"的人对
 *
 * ⚠ 只对**族谱能算**的关系对质。族谱覆盖不足时（很多书 parents 只填了几个）
 *   算不出就跳过 —— 不能因为缺族谱就报一片红，那是噪声不是缺陷。
 *
 * 用法：
 *   node scripts/check-kin-terms.mjs --all      # 所有书
 *   node scripts/check-kin-terms.mjs data/xx.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTree, computeKin } from './kin-terms.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── 主词归族 ────────────────────────────────────────────
 * ⚠ 不能直接拿 type 跟算法输出比字符串 —— 现实里同一个意思有很多种写法：
 *     「姑侄／情人」「母子（相认）」「同母异父的兄弟（也是堂兄弟）」「叔侄（伯父与侄）」
 * 里面有修饰、事件、补充说明，只有**主词**和**代差**是可比的两件事。
 *   第一版直接比字符串，同一本书报了 16 处"不一致"，其中 13 处纯属写法不同，
 *   真正的错只有 3 处 —— 误报会让人忽略真错，必须先把噪声去掉。
 * 族内差别（伯/叔、堂/表、侄/甥）由算法按性别和父系算出，不靠文字比。
 */
const HEAD_FAMILY = [
  [/兄弟|姐妹|兄妹|姐弟|孪生/, 'sibling'],
  [/叔|姑|舅|姨|侄|甥/, 'collateral'],
  [/父|母|子|女|祖|孙/, 'direct'],
];

/** 只留主词：去掉「／情人」事件后缀、「（伯父与侄）」说明、以及「养」前缀。 */
function headOf(type) {
  const s = String(type || '').split('／')[0].split('→')[0].split(/[（(]/)[0];
  return s.replace(/^养/, '').trim();
}

function familyOf(head) {
  for (const [re, fam] of HEAD_FAMILY) if (re.test(head)) return fam;
  return '?';
}

/**
 * 读 type **声称**的代差：同胞 0、亲子 1、祖孙 2、曾祖孙 3、高祖 4。
 *
 * ⚠ 必须看**整条**文字，不能只看主词。
 *   代差常写在括号里：「叔侄（叔祖父与侄孙）」的主词「叔侄」本身只说 1 代，
 *   真正的 2 代在括号中。只看主词会把刚改对的关系又报成不一致 —— 那样这道门禁
 *   反而逼人别去修数据。
 *
 * ⚠ 同胞必须用主词判，且优先：「同母异父的兄弟」整句含「母」，
 *   按整句会掉进"亲子 1 代"，而它其实是 0 代。
 *
 * ⚠ 外祖／外孙本身就是差 2 代。第一版漏了它，把「外祖母」当成"读不出 ⇒ 默认 1 代"，
 *   于是一条完全正确的关系（费尔南达＝奥雷里亚诺·巴比伦的外祖母）被误报。
 */
function claimedGap(head, full) {
  if (familyOf(head) === 'sibling') return 0;
  const t = String(full || head);
  if (/高祖|天祖|玄孙|来孙/.test(t)) return 4;
  if (/曾祖孙|曾孙|高祖孙|曾叔祖父|曾姑祖母|曾舅外祖父|曾姨外祖母/.test(t)) return 3;
  if (/祖孙|侄孙|甥孙|孙女|甥孙女|叔祖父|姑祖母|舅外祖父|姨外祖母|外祖|外孙/.test(t)) return 2;
  return 1;
}

/** 算法算的 term 与数据里的 type 说的是不是同一件事。 */
function sameLabel(computed, actual, computedGap) {
  const hc = headOf(computed), ha = headOf(actual);
  if (familyOf(hc) !== familyOf(ha)) return false;
  return computedGap === claimedGap(ha, actual);
}

/* 豁免清单：手写的 type 与族谱不一致，但**是有意**的。
 * 每条必须写明理由（≥8 字），否则不许加进来 —— "先关掉再说"是最坏的做法。
 * 格式：`{ "book": "书名", "from": "id", "to": "id", "reason": "…" }`
 * 理由的正当来源只有三类：
 *   · 原文明确用了另一个词（并注明章节）
 *   · 这本书族谱本身不完整，算不出（说明缺哪一段）
 *   · 关系里含收养／姻亲成分，纯血缘算不出来
 */
const EXEMPT_FILE = path.join(ROOT, 'data', 'kin-terms-exempt.json');
const loadExempt = () => {
  if (!fs.existsSync(EXEMPT_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(EXEMPT_FILE, 'utf8')); } catch { return []; }
};

/* data/ 下还有图包（*.graph.json）、豁免清单（*.missing-ok.json）、索引（books.json）
 * —— 它们不是书，装载结构也不同（books.json 的 characters 是对象不是数组）。
 * 全量扫会直接崩在 `book.characters.map`。 */
const SIDECAR = /\.(graph|text|missing-ok|relayout|altnames-sources|name-form-ok)\.json$|^books\.json$/;
/** 族谱覆盖率低于这个比例就整体跳过（数据本来就没录全，不是缺陷）。 */
const COVERAGE_MIN = 0.15;

/** 只对"声称是血缘亲属"的关系对质（情人／挚友／师徒之类不在范围内）。 */
const KIN_RE = /父|母|子|女|叔|姑|舅|姨|侄|甥|祖|孙|兄弟|姐妹|堂|表/;

const argv = process.argv.slice(2);
const files = argv.includes('--all')
  ? fs.readdirSync(path.join(ROOT, 'data'))
    .filter((f) => f.endsWith('.json') && !SIDECAR.test(f))
    .map((f) => path.join('data', f))
  : argv.filter((a) => !a.startsWith('--'));

if (!files.length) {
  console.error('用法：node scripts/check-kin-terms.mjs data/xx.json | --all');
  process.exit(1);
}

const exempt = loadExempt();
const isExempt = (bookId, from, to) => exempt.some((e) =>
  e.book === bookId && e.from === from && e.to === to
  && typeof e.reason === 'string' && e.reason.trim().length >= 8);

let errorCount = 0, checkedTotal = 0, mismTotal = 0, shadowedTotal = 0, skipped = 0;
console.log(`亲属称谓对质：豁免清单 ${exempt.length} 条\n`);

for (const rel of files) {
  const file = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (!fs.existsSync(file)) { console.log(`  (跳过) 找不到 ${rel}`); continue; }
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bookId = path.basename(file, '.json');
  const byId = new Map((book.characters || []).map((c) => [c.id, c]));
  const nm = (id) => byId.get(id)?.name ?? id;
  const tree = buildTree(book.relations || [], book.characters || []);

  const coverage = tree.parents.size / Math.max(1, (book.characters || []).length);
  if (coverage < COVERAGE_MIN) {
    skipped++;
    console.log(`  · ${bookId}：族谱只覆盖 ${tree.parents.size} 人（${(coverage * 100).toFixed(0)}%），跳过对质`);
    continue;
  }

  let checked = 0;
  const mism = [];
  for (const r of book.relations || []) {
    if (r.derived) continue;                                  // 推导出来的本来就是脚本写的
    if (!KIN_RE.test(String(r.type || ''))) continue;
    const k = computeKin(tree, r.from, r.to);
    if (!k.term || k.kind === 'unrelated') continue;         // 族谱算不出，不报
    checked++;
    if (k.term === r.type) continue;
    if (isExempt(bookId, r.from, r.to)) continue;
    if (sameLabel(k.term, r.type, k.gap)) continue;
    mism.push({ r, k });
  }

  // 遮挡规模：族谱能算、但数据里**没有任何关系**的人对 —— 本该由 derive-kin 补上，
  // 却因为已有一条手写关系（多半是错的那条）被跳过。
  const have = new Set((book.relations || []).map((r) => (r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`)));
  const ids = (book.characters || []).map((c) => c.id);
  let shadowed = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      if (have.has(`${a}|${b}`)) continue;
      const k = computeKin(tree, a, b);
      if (k.kind === 'unrelated' || k.kind === 'self') continue;
      shadowed++;
    }
  }

  checkedTotal += checked; mismTotal += mism.length; shadowedTotal += shadowed;
  if (!mism.length) {
    console.log(`  ✓ ${bookId}：对质 ${checked} 条全部一致`
      + (shadowed ? `（另有 ${shadowed} 对族谱能算但没有关系，可考虑补边）` : ''));
    continue;
  }
  console.log(`  ✗ ${bookId}：对质 ${checked} 条，不一致 ${mism.length} 条`
    + (shadowed ? `；另有 ${shadowed} 对族谱能算但数据里没有关系` : ''));
  for (const { r, k } of mism) {
    const ev = (r.events || []).length;
    console.log(`      ${nm(r.from)} — ${r.type} — ${nm(r.to)}`);
    console.log(`        族谱算出：${k.term}（差 ${k.gap} 代）　原文事件 ${ev} 条${ev === 0 ? ' ★零依据' : ''}`);
    errorCount++;
  }
}

console.log(`\n${'='.repeat(56)}`);
console.log(`对质 ${checkedTotal} 条，不一致 ${mismTotal} 条，被遮挡的人对 ${shadowedTotal} 对，跳过 ${skipped} 本书`);
if (errorCount) {
  console.log(`\n✗ ${errorCount} 处不一致。修法二选一：`);
  console.log('  · 改数据里的 type（推荐：让称谓与族谱一致）');
  console.log('  · 确认原文确实另有说法 ⇒ 加进 data/kin-terms-exempt.json 并写明理由（≥8 字）');
  process.exit(1);
}
console.log('✓ 没有不一致');
