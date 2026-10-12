#!/usr/bin/env node
/**
 * 【长期】工具：把三国「姓氏+1~2字」的碎片候选**机械分层**，并复核 v0.185 的结论。
 * 用法：node scripts/audit-3k-fragments.mjs [--min 2] [--show 40]
 *
 * ## 为什么要有这个
 *
 * `audit-against-text.mjs` 对三国报 **2580 条待判**（`--min 2`）。这个数大到没人会逐条读，
 * 而 v0.185 当时的结论是「真实缺口只有 `姜子牙`/`张子房` 两个，其余 2919 条是碎片」。
 *
 * ⚠ 那个结论**没人能复核**：「碎片」是**总体印象**，不是判据 ——
 *   下一个人只能重新读一遍 2580 条，或者干脆信它。
 * 本脚本把那个印象变成**可重跑的机械分层**，于是「碎片」有了口径。
 *
 * ## 判据（三条，各自独立，全部**可机械核验**）
 *
 * ① **地名** —— 候选**整体**落在 `places[].name` 里（`荆州`/`祁山`/`樊城`…）。
 *    ⚠ 注意是**整体相等**，不是子串：`荆州` 在 places 里，但 `荆州之`/`荆州之兵` 不是。
 *
 * ② **已知人物的碎片** —— 两种方向：
 *    a. 候选去掉**尾字**后落在已知名字池（`孔明大`→`孔明`、`孔明曰`→`孔明`、`孔明之`→`孔明`）
 *    b. 候选是某个已知名字的**前截**（`吴主孙` ← `吴主孙权`；`魏主曹` ← `魏主曹丕/曹叡`）
 *    ⇒ 这是「孔明+动词」「主+姓」这类切歪的指纹。
 *    ⚠ 与 `lib/against-text.mjs` 已有的「候选是已知名字的**子串** ⇒ 碎片」方向相反，
 *      两者都要查：那是查"被包含"，这里是查"被截断/被加尾"。
 *
 * ③ **虚词结尾** —— 候选以 `之乎者也矣哉曰云不又来去上下中前后里外大小多少` 收尾。
 *    人名几乎不会以这些字结尾；而「姓氏+1~2字」这个规则最爱切出
 *    `荆州之`/`江东之`/`于地`/`从之` 这类。
 *
 * ## ⚠ 本脚本**不下结论说剩下的是不是人**
 *
 * 它只做**减法**（把可机械判掉的剥掉），把「需要人读」的量**明确印出来**。
 * 为什么不继续自动判：「在场 vs 提及」「是不是人名」这两类问题，
 * v0.201–v0.203 已三次证明**没有可靠机械判据**（详见 CHANGELOG v0.203）。
 * ⇒ 这个工具的价值是**把 2580 变成一个可信的小数字**，不是替人做判断。
 *
 * ## ⭐ v0.205 裁定：③ 桶（待人读）**不再人判，也不是待办**
 *
 * 用户拍板、理由充分：这 4477 条是 `[百家姓][\u4e00-\u9fa5]{1,2}` 这个提取正则的
 * **必然产物**（`后人有` 153× / `于地` 48× / `从其言` 42×… 全是常用词被切开），
 * 不是数据缺陷 —— 判它们等于审一个正则的切法。依据见
 * `docs/待判候选-原著到手-2026-10-12.md` §五。
 * ⇒ 脚本尾部按此改写：③ 只是一个**如实印出来的数**，不再挂着"需要人读"三个字。
 *
 * ## 有效性自测（守卫必须能红）
 *
 * `--selftest` 用**造出来的**坏样本跑同一份判据：真名形态、地名形态、
 * 碎片形态各一，期望分类正确。判据写错时它会红。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURNAMES } from './lib/against-text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const MIN = Number(argv.find((a) => /^--min=/.test(a))?.slice(6) || 2);
const SHOW = Number(argv.find((a) => /^--show=/.test(a))?.slice(7) || 30);

/** 高频虚词/语气词 —— 人名几乎不会以这些字收尾 */
export const TAIL_JUNK = /[之乎者也矣哉曰云不又来去上下中前后里外大多少]/;

/** 分类器（导出以便自测复用同一份判据） */
export function classify(name, ctx, known, placeSet) {
  if (placeSet.has(name)) return { kind: '地名', why: `places[] 里就有「${name}」` };
  if (name.length === 3 && known.has(name.slice(0, 2))) {
    return { kind: '碎片', why: `去掉尾字「${name[2]}」就是已知人物「${name.slice(0, 2)}」` };
  }
  for (const k of known) {
    if (k.length > name.length && k.startsWith(name)) {
      return { kind: '碎片', why: `是已知名字「${k}」的前 ${name.length} 字` };
    }
  }
  if (TAIL_JUNK.test(name[name.length - 1])) {
    return { kind: '碎片', why: `以虚词「${name[name.length - 1]}」收尾` };
  }
  return { kind: '待判', why: ctx ? `…${ctx}…` : '' };
}

/* ───────────────────────── 有效性自测 ───────────────────────── */
if (argv.includes('--selftest')) {
  const known = new Set(['孔明', '吴主孙权', '魏主曹丕']);
  const places = new Set(['荆州']);
  const cases = [
    // 判据②a「去尾字」：尾字**不在**虚词表里也必须抓到
    //（`孔明笑`/`孔明令`/`孔明自` 的尾字是 笑/令/自，虚词表抓不到，只有这条能抓）
    ['孔明笑', '碎片', '已知人物 + 动词（尾字「笑」不在虚词表 ⇒ 只有判据②a 能抓）'],
    ['孔明令', '碎片', '已知人物 + 令（尾字「令」不在虚词表）'],
    ['孔明自', '碎片', '已知人物 + 自（尾字「自」不在虚词表）'],
    ['孔明曰', '碎片', '已知人物 + 曰（虚词表也能抓，但②a 应更早命中）'],
    // 判据②b「前截」
    ['吴主孙', '碎片', '已知名字「吴主孙权」的前 3 字'],
    ['魏主曹', '碎片', '已知名字「魏主曹丕」的前 3 字'],
    // 判据①
    ['荆州', '地名', '整体等于 places 里的一项'],
    // 判据③
    ['荆州之', '碎片', '地名 + 虚词尾'],
    ['江东之', '碎片', '地名 + 虚词尾'],
    // 反向：真名形态绝不能被误判掉
    ['姜维', '待判', '真名形态'],
    ['张嶷', '待判', '真名形态（尾字「嶷」不在虚词表）'],
    ['马超', '待判', '真名形态'],
  ];
  let bad = 0;
  for (const [n, want, why] of cases) {
    const got = classify(n, '', known, places).kind;
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${n} → ${got}（期望 ${want}｜${why}）`);
  }
  console.log(bad ? `\n✗ ${bad} 条不符` : `\n✓ 全部 ${cases.length} 条符合`);
  process.exit(bad ? 1 : 0);
}

/* ───────────────────────── 实跑 ───────────────────────── */
const txtPath = process.argv.find((a) => !a.startsWith('--') && a.endsWith('.txt'))
  || 'C:/Users/chw/AppData/Local/Temp/opencode/ba-books/sanguo.txt';
if (!fs.existsSync(txtPath)) {
  console.error(`✗ 找不到原著：${txtPath}`);
  console.error('  用法：node scripts/audit-3k-fragments.mjs <三国原文.txt>');
  process.exit(1);
}
const txt = fs.readFileSync(txtPath, 'utf8');
const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/three-kingdoms.json'), 'utf8'));
const okList = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/three-kingdoms.missing-ok.json'), 'utf8'));

const known = new Set();
for (const c of book.characters) {
  for (const f of [c.name, ...(c.aliases || []), ...(c.altNames || [])]) if (f && f.length >= 2) known.add(f);
}
const placeSet = new Set((book.places || []).map((p) => p.name));
const okSet = new Set(okList.map((x) => (typeof x === 'string' ? x : x.name)));

const re = new RegExp(`[${SURNAMES}][\\u4e00-\\u9fa5]{1,2}`, 'g');
const counts = new Map(), ctxOf = new Map();
let m;
while ((m = re.exec(txt)) !== null) {
  const s = m[0];
  counts.set(s, (counts.get(s) || 0) + 1);
  if (!ctxOf.has(s)) ctxOf.set(s, txt.slice(Math.max(0, m.index - 20), m.index + s.length + 14).replace(/\s+/g, ' '));
}

const cands = [...counts.entries()].filter(([n, c]) => c >= MIN && !known.has(n) && !okSet.has(n));
const buckets = { 地名: [], 碎片: [], 待判: [] };
for (const [n, c] of cands) {
  const r = classify(n, ctxOf.get(n), known, placeSet);
  buckets[r.kind].push({ n, c, ...r });
}

console.log(`三国 · 姓氏候选机械分层（--min ${MIN}）`);
console.log(`原著 ${txtPath}\n`);
console.log(`候选（≥${MIN} 次、既不在人物池也不在台账）：${cands.length}`);
console.log(`  ① 地名（整体等于 places 里一项）      ${String(buckets.地名.length).padStart(5)}`);
console.log(`  ② 碎片（已知人/地名 + 尾字/前截）    ${String(buckets.碎片.length).padStart(5)}`);
console.log(`  ③ 待人读（v0.205 起不再人判）        ${String(buckets.待判.length).padStart(5)}`);
console.log(`\n⇒ 可机械判掉 ${buckets.地名.length + buckets.碎片.length} 条；`
  + `③ 剩 ${buckets.待判.length} 条 —— v0.185 的「2580 条全是碎片」就落在这个缺口上。`);

buckets.待判.sort((a, b) => b.c - a.c);
console.log(`\n--- 待判前 ${SHOW} 条（按出现次数）---`);
for (const r of buckets.待判.slice(0, SHOW)) {
  console.log(`  ${String(r.c).padStart(3)}× ${r.n.padEnd(5)} ${r.why}`);
}
console.log(`\n⚠ v0.205 裁定：③ 这 ${buckets.待判.length} 条**不再逐条人读，也不是待办**。`);
console.log(`  它们是「姓氏+1~2字」这个提取正则的必然产物（后人有 153× / 于地 48× / 从其言 42×…），`);
console.log(`  不是数据缺陷 —— 判它们等于审一个正则的切法，不是审这本书的数据。`);
console.log(`  本脚本的价值停在"机械分层"：可指认的剥掉，剩下的如实印出来。`);
console.log(`  依据：docs/待判候选-原著到手-2026-10-12.md §五。`);