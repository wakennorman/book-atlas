#!/usr/bin/env node
/**
 * firstCh 审计：把 `characters[].firstCh`（首次出场章）与**原著首现章**对拍。
 *
 * ## 为什么需要它
 * `firstCh` 决定两件事：① 剧透保护什么时候解锁这个人；② 章节面板「本章谁初次登场」。
 * 填晚了 ⇒ 人物在该出场的时候被锁住、章节面板漏报。
 *
 * v0.144 手工核出 4 个（王朗 56→15、马良 63→52、李恢 91→60、邓芝 91→85），
 * 但那是**一次性探针**。这个脚本把它固化成可复现的清单。
 *
 * ## 判据（重要：这输出的是「待核清单」，不是「错误清单」）
 * `firstCh` 的口径 = **首次实打实出场**（名单/被提及不算）。
 * 但"名字在原文里首次出现"会被三类东西污染，所以必须**人工核 referent**：
 *
 * | 假阳性 | 例 | 形态 |
 * |---|---|---|
 * | **子串碰撞** | 「留平」被匹配到「陈**留平**丘人」 | 名字夹在别的词里 |
 * | **评点/注释** | 「黄皓」被匹配到毛宗岗评点「刘禅不用黄皓」 | 出现在 `〚NNN〛` 注释段或回前总评 |
 * | **同名不同人** | 「王颀」匹配到第9回的李傕之乱王颀，但数据里那条是天水王颀 | 去括号后重名 |
 * | **名单/被提及** | 邓芝在第65回投降名单里，实际出场在第85回 | 名单枚举 |
 *
 * ⇒ 脚本**自动排掉"去括号后同名"**的人物（那类必然假阳性），其余逐条打印
 *   首现处的**上下文片段**，供人工判读。**它不改任何数据。**
 *
 * ## 用法
 * ```bash
 * node scripts/audit-first-ch.mjs                    # 三国，阈值 5
 * node scripts/audit-first-ch.mjs --threshold 10     # 只看差 10 回以上的
 * node scripts/audit-first-ch.mjs --top 20           # 只打印前 20 条
 * ```
 * ⚠ **目前只支持三国**（另两本的原著正文没有可用分章标记，见 `BOOKS` 里的说明）。
 * 原著 txt 不在版本库里（CI 跑不了），需本机 `%TEMP%\opencode\ba-books\` 下有一份。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const THRESHOLD = Number(arg('--threshold', 5));
const TOP = Number(arg('--top', 0)) || Infinity;
const SLUG = arg('--book', 'three-kingdoms');

const TMP = path.join(os.tmpdir(), 'opencode', 'ba-books');

/* 各书的分章方式。
 * ⚠ 只有三国的原著正文带分章标记（「第N回」）；另两本的 txt 分了章但正文没有标记：
 *   百年孤独 —— 「第N章」只出现在目录里，正文段落之间无标记；
 *   罪与罚   —— 按「部」重编号（第一部第一~七章、第二部第一~七章…），与数据的顺序章号 1..41 不对应。
 *   两本都只有 60/38 人，手工核更快。 */
const BOOKS = {
  'three-kingdoms': { txt: '三国演义.txt', split: /^第([一二三四五六七八九十百零]+)回/gm, cn: true },
  'one-hundred-years-of-solitude': { txt: '百年孤独.txt', unsupported: '原著正文里没有章节标记（「第N章」只出现在目录），无法机械分章' },
  'crime-and-punishment': { txt: '罪与罚.txt', unsupported: '原著按「部」重编号（每部都从第一章起），与数据的顺序章号 1..41 不对应' },
};
const cfg = BOOKS[SLUG];
if (!cfg) { console.error(`✗ 未知书目：${SLUG}（可选：${Object.keys(BOOKS).join(' / ')}）`); process.exit(1); }
if (cfg.unsupported) {
  console.error(`✗ ${SLUG} 暂不支持：${cfg.unsupported}`);
  console.error('  （要把「部内章号」映射到「顺序章号」，得先知道每部的章数——需要单独一轮）');
  process.exit(1);
}

const srcPath = path.join(TMP, cfg.txt);
if (!fs.existsSync(srcPath)) {
  console.error(`✗ 找不到原著：${srcPath}`);
  console.error('  （原著不进版本库；CI 里跑不了这个脚本，属于手工步骤）');
  process.exit(1);
}

const CN = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cn2n(s) {
  if (s === '零') return 0;
  let t = 0, tmp = 0;
  for (const ch of s) {
    if (ch === '百') { tmp = (tmp || 1) * 100; t += tmp; tmp = 0; }
    else if (ch === '十') { tmp = (tmp || 1) * 10; t += tmp; tmp = 0; }
    else tmp = CN[ch] || 0;
  }
  return t + tmp;
}

/* ── 切章 ──
 * ⚠ 关键：**索引必须与匹配用的文本同源**。第一版在"原始文本"上算分章位置，
 *   却拿去切"去空格后的文本" ⇒ 索引错位、结论全错（实测把第93回报成第6回）。
 *   现在统一在 `flat` 上分章、在 `flat` 上匹配。
 */
const raw = fs.readFileSync(srcPath, 'utf8');
const flat = raw.replace(/[ \t　]/g, '');
const heads = [];
{ const re = cfg.split; let m; while ((m = re.exec(flat))) heads.push({ idx: m.index, n: cfg.cn ? cn2n(m[1]) : Number(m[1]) }); }
if (heads.length < 2) { console.error(`✗ 分章正则没匹配到内容（${SLUG}）—— 原著格式可能变了`); process.exit(1); }

const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${SLUG}.json`), 'utf8'));
const totalCh = book.meta?.chapters || 0;

/** 目录 + 正文各一份时取后一半；编号连续 1..N 的那段才是正文 */
function pickBody(list, total) {
  if (list.length === total && list.every((x, i) => x.n === i + 1)) return list;
  const tail = list.slice(list.length - total);
  if (tail.every((x, i) => x.n === i + 1)) return tail;
  const half = list.slice(Math.floor(list.length / 2));
  return half;
}
const body = pickBody(heads, totalCh);
if (!body.every((x, i) => x.n === i + 1)) {
  console.warn(`⚠ 正文切分可能不准（首=${body[0]?.n} 尾=${body[body.length - 1]?.n}，期望 1..${totalCh}）—— 结论仅作参考`);
}
const segs = body.map((h, i) => ({ ch: i + 1, start: h.idx, end: i + 1 < body.length ? body[i + 1].idx : flat.length }));
const segText = segs.map((s) => flat.slice(s.start, s.end));

/* ── 排掉「去括号后同名」（必然假阳性） ── */
const base = (n) => String(n || '').replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
const nameCount = new Map();
for (const c of book.characters) nameCount.set(base(c.name), (nameCount.get(base(c.name)) || 0) + 1);

/* ── 对拍 ── */
const cand = [];
let skippedDup = 0, skippedShort = 0, skippedNoFc = 0, notFound = 0;
for (const c of book.characters) {
  const b = base(c.name);
  if (b.length < 2) { skippedShort++; continue; }
  if ((nameCount.get(b) || 0) > 1) { skippedDup++; continue; }
  const fc = Number(c.firstCh);
  if (!Number.isFinite(fc)) { skippedNoFc++; continue; }
  let first = null, at = -1;
  for (let i = 0; i < segText.length; i++) { const p = segText[i].indexOf(b); if (p >= 0) { first = i + 1; at = p; break; } }
  if (first === null) { notFound++; continue; }
  const d = fc - first;
  if (d > THRESHOLD) {
    const seg = segText[first - 1];
    const ctx = seg.slice(Math.max(0, at - 45), at + b.length + 45);
    const around = seg.slice(Math.max(0, at - 40), at + b.length + 40);
    const dun = (around.match(/、/g) || []).length;                 // 顿号密集 ⇒ 名单枚举
    const annot = around.includes('〚') || seg.slice(Math.max(0, at - 30), at).includes('〚');
    const kind = annot ? '注释' : (dun >= 3 ? '名单' : '其余');
    cand.push({ name: c.name, id: c.id, fc, first, d, ctx, kind });
  }
}
cand.sort((a, b) => b.d - a.d);

/* ── 报告 ── */
const by = (k) => cand.filter((x) => x.kind === k);
console.log(`\n▶ ${SLUG}（${book.characters.length} 人 / ${totalCh} 章）`);
console.log(`  阈值：firstCh 比原文首现晚 > ${THRESHOLD} 章`);
console.log(`  已排除：去括号后同名 ${skippedDup} 人（必然假阳性）· 名字<2字 ${skippedShort} 人 · 无 firstCh ${skippedNoFc} 人`);
console.log(`  原文里找不到名字：${notFound} 人（多为字号/别称，或数据里的写法与原著不同）`);
console.log(`\n  ⚠ 以下 ${cand.length} 条是**待核清单**，不是错误清单 —— 必须看上下文核 referent。`);
console.log('    已按首现形态分三组，「其余」才是真正值得核的。');

const GROUPS = [
  ['其余', '★ 最值得核：既不在名单里、也不在注释里'],
  ['名单', '顿号密集 ⇒ 多半是「投降/封赏名单」枚举；firstCh 口径**不含名单** ⇒ 多为假阳性'],
  ['注释', '出现在毛宗岗评点/校记（`〚NNN〛`）里 ⇒ 假阳性'],
];
for (const [label, note] of GROUPS) {
  const arr = by(label);
  if (!arr.length) continue;
  console.log(`\n### ${label}（${arr.length} 条）—— ${note}\n`);
  console.log('  | 人物 | firstCh | 原文首现 | 差 | 首现处上下文 |');
  console.log('  |---|---|---|---|---|');
  const show = label === '其余' ? arr.slice(0, TOP) : arr.slice(0, Math.min(TOP, 6));
  for (const x of show) {
    console.log(`  | ${x.name} | ${x.fc} | ${x.first} | ${x.d} | …${x.ctx.replace(/\|/g, '\\|')}… |`);
  }
  if (arr.length > show.length) console.log(`  | … | | | | 还有 ${arr.length - show.length} 条（用 --top 调整） |`);
}
console.log('\n  ⇒ 确认是错的，用 `scripts/fix-*.mjs` 那套（带原著 locate 短语）去改；');
console.log('    本脚本**不改任何数据**。\n');
