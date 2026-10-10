#!/usr/bin/env node
/**
 * `data/relation-actors-ok.json`（**行为人审计已核台账**）的门禁。
 *
 * ## 这份台账是什么
 *
 * `audit-relation-actors.mjs` 按风险分级挑出"引文存在、但引文可能不支持这条关系"的边：
 *   A 代词无主（引文里连一个当事人名字都没有）｜B 第三方在场（引文里有另一个家人）
 *   ｜C 查无此文（事件文字在原书里搜不到）
 * **人回原著逐条读完**之后，绝大多数是误报（家族边的事件里必然提到家人、
 * 中文本来就靠代词承接），少数是真错（v0.179 的玛尔美拉朵夫：被当成生父，实为继父）。
 * 读完判为误报的记进这份台账，门禁读到就不再报 —— 于是**新冒出来的 A/B/C 必须重新读过**。
 *
 * ## 为什么必须守
 *
 * 台账按 **`(book, from, to)`** 记账，而 id、关系本身都会变
 * （改名 / 合并 / 删边都动它）。台账条目一旦与数据脱节，它要么**静默失效**
 * （该报的不报了），要么**指向一条不存在的关系**（看起来还好好待着）。
 * 这与 `name-form-ok` / `altnames-sources` / `kin-terms-exempt` / `missing-ok` /
 * `cross-chapter-ok` / `first-ch-ok` 是同一族问题（v0.160–v0.163、v0.177、v0.178
 * 共抓到 10 处存量漂移）。
 *
 * ## 判据
 *
 * | # | 判据 |
 * |---|---|
 * | L1 | 台账不存在 ⇒ 0 处问题（可选文件）。存在则顶层必须是**数组**，且 JSON 必须能解析 |
 * | L2 | 条目必须是对象，且 `book`/`from`/`to` 为非空字符串、`why` 为字符串 |
 * | L3 | `why` 去掉空白后 **≥ 8 字** |
 * | L4 | `flags` 必须是**非空数组**，取值落在闭集 `A/B/C` 内且不重复 |
 * | L5 | `book` 必须是已知书（`data/<book>.json` 可读） |
 * | L6 | 该书里必须有 `from` 与 `to` 这两个人物 id |
 * | L7 | 该书里必须**存在** `from → to` 这条关系 |
 * | L8 | 同一 `book\|from\|to` 不许重复 |
 * | L9 | 台账记的 `flags` 必须与审计**现在**报的 flags 一致（多记 = 漂移） |
 * | L10 | **双向**：审计现在报出的每一条边都必须在台账里 —— 否则说明冒出了**没读过**的条目 |
 *
 * ## ⚠ L9 / L10 的已知限制（必须打印，不能假装它是硬门禁）
 *
 * L1–L8 只读 `data/`，CI 上能跑。**L9 与 L10 需要原著**：B 级（第三方在场）与
 * C 级（查无此文）的判据都依赖原著文本（`%TEMP%\opencode\ba-books\`），
 * 而原著不进版本库 ⇒ **CI 上只能核 A 级**，B/C 那部分跳过。
 * 跳过时**必须打印出来**（v0.173 的教训：门禁不打印"跳过了什么"，绿就等于装饰品）。
 *
 * 用法：`node scripts/check-relation-actors-ledger.mjs`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditRelationActors } from './audit-relation-actors.mjs';

export const DEFAULT_ROOT = process.env.BOOKATLAS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LEDGER_REL = 'data/relation-actors-ok.json';
/** 闭集。加一级（比如把没实现的 D 级做出来）必须同时改这里与审计脚本。 */
export const FLAGS = ['A', 'B', 'C'];

const nospace = (s) => String(s ?? '').replace(/\s/g, '');
const keyOf = (book, from, to) => `${book}|${from}|${to}`;

/**
 * @param {string} root 仓库根（或 tmp 里造的假根）
 * @param {{dir?:string}} [opts] `dir` = 原著 txt 所在目录（守卫测试指到 tmp）
 * @returns {{problems:string[], notes:string[], checked:number, unchecked:number}}
 */
export function checkRelationActorsLedger(root = DEFAULT_ROOT, opts = {}) {
  const ps = [];
  const notes = [];
  const lf = path.join(root, LEDGER_REL);
  if (!fs.existsSync(lf)) return { problems: ps, notes: [`(跳过) 没有 ${LEDGER_REL} —— 可选文件，0 处问题`], checked: 0, unchecked: 0 };

  let arr;
  try { arr = JSON.parse(fs.readFileSync(lf, 'utf8')); }
  catch (err) { return { problems: [`L1 ${LEDGER_REL} 不是合法 JSON：${err.message}`], notes, checked: 0, unchecked: 0 }; }
  if (!Array.isArray(arr)) return { problems: [`L1 ${LEDGER_REL} 顶层必须是数组（现在是 ${typeof arr}）`], notes, checked: 0, unchecked: 0 };

  const books = new Map();
  const loadBook = (slug) => {
    if (books.has(slug)) return books.get(slug);
    const p = path.join(root, 'data', `${slug}.json`);
    let v = null;
    if (fs.existsSync(p)) { try { v = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { v = null; } }
    books.set(slug, v);
    return v;
  };

  const seen = new Set();
  const ledgerKeys = new Map();          // key → Set(flags)
  arr.forEach((e, i) => {
    const at = `${LEDGER_REL}[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) { ps.push(`L2 ${at} 不是对象`); return; }
    for (const f of ['book', 'from', 'to']) {
      if (typeof e[f] !== 'string' || !e[f].trim()) ps.push(`L2 ${at} 的 ${f} 必须是非空字符串`);
    }
    if (typeof e.why !== 'string') ps.push(`L2 ${at} 的 why 必须是字符串`);
    else if (nospace(e.why).length < 8) ps.push(`L3 ${at} 的 why 去掉空白只有 ${nospace(e.why).length} 字（要 ≥8 字）—— 「先关掉再说」是最坏的做法`);

    /* L4 */
    if (!Array.isArray(e.flags) || !e.flags.length) {
      ps.push(`L4 ${at} 的 flags 必须是非空数组`);
    } else {
      const bad = e.flags.filter((f) => !FLAGS.includes(f));
      if (bad.length) ps.push(`L4 ${at} 的 flags 含非法值 ${JSON.stringify(bad)}（只能是 ${FLAGS.join('/')}）`);
      if (new Set(e.flags).size !== e.flags.length) ps.push(`L4 ${at} 的 flags 有重复`);
    }
    if (typeof e.book !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string') return;

    /* L5 */
    const book = loadBook(e.book);
    if (!book) { ps.push(`L5 ${at} 的 book「${e.book}」不存在（data/${e.book}.json 读不到）`); return; }
    const ids = new Set((book.characters || []).map((c) => c.id));
    /* L6 */
    for (const f of ['from', 'to']) {
      if (!ids.has(e[f])) ps.push(`L6 ${at} 的 ${f}「${e[f]}」不是 ${e.book} 里的人物 id`);
    }
    /* L7 */
    const rel = (book.relations || []).find((r) => r.from === e.from && r.to === e.to);
    if (!rel) ps.push(`L7 ${at} 在 ${e.book} 里找不到关系 ${e.from} → ${e.to}（台账指着一条不存在的边）`);
    /* L8 */
    const k = keyOf(e.book, e.from, e.to);
    if (seen.has(k)) ps.push(`L8 ${at} 与前面的条目重复：${k}`);
    seen.add(k);
    ledgerKeys.set(k, new Set(Array.isArray(e.flags) ? e.flags : []));
  });

  /* ── L9 / L10：拿审计**现在**的结果对拍 ─────────────────────────────
   * ⚠ B/C 级要读原著。原著不在版本库里 ⇒ 缺原文时这两级**不可判**，
   *   只能把比对范围收窄到 A 级，并把"收窄了"打印出来。 */
  let checked = 0;
  let unchecked = 0;
  const res = auditRelationActors({ root, dir: opts.dir });
  const canCheckBC = res.missingSrc.length === 0;
  if (!canCheckBC) {
    notes.push(`(限制) ${res.missingSrc.length} 本书缺原著文本 ⇒ L9/L10 只核 **A 级**；B/C 级${res.missingSrc.map((m) => m.slug).join('、')} 未核`);
  }
  const actual = new Map();
  for (const r of res.rows) {
    const k = keyOf(r.book, r.rel.from, r.rel.to);
    if (!actual.has(k)) actual.set(k, new Set());
    for (const f of r.flags) {
      if (!canCheckBC && f !== 'A') continue;
      actual.get(k).add(f);
    }
  }

  /* L9：台账记的 flags ⊆/⊇ 审计现在报的 flags（限定在可核范围内比） */
  for (const [k, rec] of ledgerKeys) {
    const eff = new Set([...rec].filter((f) => canCheckBC || f === 'A'));
    if (!eff.size) { unchecked++; continue; }                 // 全是 B/C 且缺原文 ⇒ 未核
    checked++;
    const act = actual.get(k) ?? new Set();
    const miss = [...eff].filter((f) => !act.has(f));
    if (miss.length) {
      ps.push(`L9 台账漂移：${k} 记了 ${miss.join('/')} 级，但审计现在**不报**这几级`
        + '（数据或审计判据变了 ⇒ 这条已经不该待在台账里，删掉它或重新回原著读）');
    }
  }
  /* L10：双向的另一半 —— 审计报出来的每一条都必须在台账里 */
  for (const [k, fs] of actual) {
    if (!fs.size) continue;
    if (!ledgerKeys.has(k)) {
      ps.push(`L10 未登记：${k} 被审计报出 ${[...fs].join('/')} 级，却不在 ${LEDGER_REL} 里`
        + '（新冒出来的必须回原著读过并登记）');
    }
  }

  return { problems: ps, notes, checked, unchecked };
}

/* ── CLI ──
 * ⚠ 本仓库路径里带空格，必须用 `pathToFileURL` 比 href（`endsWith` 会永远为假、静默不跑）。 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { problems, notes, checked, unchecked } = checkRelationActorsLedger();
  for (const n of notes) console.log(`  ${n}`);
  console.log(`\n行为人审计台账：核了 ${checked} 条${unchecked ? `，另有 ${unchecked} 条因缺原著未核` : ''}`);
  if (problems.length) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error(`\n✗ ${problems.length} 处问题`);
    process.exit(1);
  }
  console.log('✓ 台账与审计一致');
}
