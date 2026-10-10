#!/usr/bin/env node
/**
 * `data/first-ch-ok.json`（**firstCh 已核台账**）的门禁。
 *
 * ## 这份台账是什么
 *
 * `audit-first-ch.mjs` 把 `characters[].firstCh` 与原著首现对拍，报出一份「待核清单」。
 * 里面「★其余」那一桶是"名字首现得比 firstCh 早很多、又不是名单/注释"的条目。
 * **人回原著逐条读完**之后，有的确实是错（用 `scripts/fix-first-ch.mjs` 改数据），
 * 有的**本来就对**（第 85 回的王双只是被点名、第 78 回的司马师在后人诗里、
 * 第 7 回的张虎是另一个人…）⇒ 后者记进这份台账，审计读到就不再报。
 *
 * ## 为什么必须守
 *
 * 台账按 **`(book, name)`** 记账，而 `name`、`firstCh` 都会变（改名/合并/再修数据都动它）。
 * 消费方 `audit-first-ch.mjs` 又是**按主名 + 当前 firstCh** 去匹配的
 * ⇒ 台账条目一旦与数据脱节，它要么**静默失效**（该报的不报了），要么
 * **指向一个不存在的人**（看起来还好好待着）。这与 `name-form-ok` /
 * `altnames-sources` / `kin-terms-exempt` / `missing-ok` / `cross-chapter-ok`
 * 是同一族问题（v0.160–v0.163、v0.177 共抓到 7 处存量漂移）。
 *
 * ## 判据
 *
 * | # | 判据 |
 * |---|---|
 * | L1 | 台账不存在 ⇒ 0 处问题（可选文件）。存在则顶层必须是**数组** |
 * | L2 | 条目必须是对象，且 `book`/`name` 非空字符串、`firstCh`/`textFirst` 为正整数、`why` 为字符串 |
 * | L3 | `why` 去掉空白后 **≥ 8 字** |
 * | L4 | `kind` 必须在**闭集**里（闭集从 `audit-first-ch.mjs` 导入，不抄第二遍） |
 * | L5 | `book` 必须存在（`data/<book>.json` 可读） |
 * | L6 | 该 book 的数据里必须有 `name` 这个人（`characters[].name` **精确**匹配） |
 * | L7 | 台账 `firstCh` 必须**等于**数据里的 `firstCh`（数据改了台账没改 ⇒ 报红） |
 * | L8 | `firstCh − textFirst` 必须 **> 阈值**（否则它已经不是"记晚了"，不该待在台账里） |
 * | L9 | 同一 `book\|name` 不许重复 |
 * | L10 | **双向**：数据里现在还有没有"未核"的「其余」条目 —— 有就报红。⚠ **需要原著** |
 *
 * ## ⚠ L10 的已知限制（必须打印，不能假装它是硬门禁）
 *
 * L1–L9 只读 `data/`，CI 上能跑。**L10 要读原著**（`%TEMP%\opencode\ba-books\三国演义.txt`），
 * 而原著不进版本库 ⇒ **CI 上 L10 恒跳过**，本机才有。跳过时**必须打印出来**
 * （v0.173 的教训：门禁不打印"跳过了什么"，绿就等于装饰品）。
 *
 * 用法：`node scripts/check-first-ch-ledger.mjs`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditFirstCh, KINDS, LEDGER_REL, DEFAULT_THRESHOLD, DEFAULT_TXT } from './audit-first-ch.mjs';

export const DEFAULT_ROOT = process.env.BOOKATLAS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isPosInt = (x) => Number.isInteger(x) && x > 0;
const nospace = (s) => String(s ?? '').replace(/\s/g, '');

export function checkFirstChLedger(root = DEFAULT_ROOT, opts = {}) {
  const ps = [];
  const lf = path.join(root, LEDGER_REL);
  const notes = [];
  if (!fs.existsSync(lf)) return { problems: ps, notes: [`(跳过) 没有 ${LEDGER_REL} —— 可选文件，0 处问题`] };

  let arr;
  try { arr = JSON.parse(fs.readFileSync(lf, 'utf8')); }
  catch (err) { return { problems: [`L1 ${LEDGER_REL} 不是合法 JSON：${err.message}`], notes }; }
  if (!Array.isArray(arr)) return { problems: [`L1 ${LEDGER_REL} 顶层必须是数组（现在是 ${typeof arr}）`], notes };

  /* 数据缓存 */
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
  arr.forEach((e, i) => {
    const at = `${LEDGER_REL}[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) { ps.push(`L2 ${at} 不是对象`); return; }
    const { book, name, firstCh, textFirst, kind, why } = e;
    if (typeof book !== 'string' || !book.trim()) ps.push(`L2 ${at} book 必须是非空字符串`);
    if (typeof name !== 'string' || !name.trim()) ps.push(`L2 ${at} name 必须是非空字符串`);
    if (!isPosInt(firstCh)) ps.push(`L2 ${at} firstCh 必须是正整数（现在是 ${JSON.stringify(firstCh)}）`);
    if (!isPosInt(textFirst)) ps.push(`L2 ${at} textFirst 必须是正整数（现在是 ${JSON.stringify(textFirst)}）`);
    if (typeof why !== 'string') ps.push(`L2 ${at} why 必须是字符串`);
    if (typeof why === 'string' && nospace(why).length < 8) {
      ps.push(`L3 ${at} why 去掉空白后只有 ${nospace(why).length} 字（要求 ≥8）—— 理由太短等于没写`);
    }
    if (typeof kind !== 'string' || !KINDS.includes(kind)) {
      ps.push(`L4 ${at} kind 必须是闭集之一 ${JSON.stringify(KINDS)}（现在是 ${JSON.stringify(kind)}）`);
    }
    if (typeof book !== 'string' || typeof name !== 'string') return;

    const key = `${book}|${name}`;
    if (seen.has(key)) ps.push(`L9 ${at} 重复条目 ${key}`);
    seen.add(key);

    const b = loadBook(book);
    if (!b) { ps.push(`L5 ${at} 找不到书 data/${book}.json（book 写错？）`); return; }
    const c = (b.characters || []).find((x) => x.name === name);
    if (!c) {
      ps.push(`L6 ${at} ${book} 里没有叫「${name}」的人 —— 台账指向一个不存在的人（改过名/删过人？）`);
      return;
    }
    if (isPosInt(firstCh) && Number(c.firstCh) !== Number(firstCh)) {
      ps.push(`L7 ${at} ${name}：台账 firstCh=${firstCh}，数据 firstCh=${c.firstCh} —— 数据改过而台账没跟上`);
    }
    if (isPosInt(firstCh) && isPosInt(textFirst) && firstCh - textFirst <= DEFAULT_THRESHOLD) {
      ps.push(`L8 ${at} ${name}：firstCh(${firstCh}) − 原文首现(${textFirst}) = ${firstCh - textFirst} ≤ 阈值 ${DEFAULT_THRESHOLD}`
        + ` —— 它已经不再是「记晚了」，不该留在台账里（删掉它，或把 firstCh 改回去）`);
    }
  });

  /* ── L10 双向（需要原著） ── */
  const txtPath = opts.txtPath || DEFAULT_TXT;
  if (!fs.existsSync(txtPath)) {
    notes.push(`⚠ L10（双向）**跳过**：原著不在本机（${txtPath}）`);
    notes.push('   ⇒ CI 上恒跳过（原著不进版本库）。本机要跑完整判据，需有那份 txt。');
    notes.push('   ⇒ 所以「数据里有没有**新冒出来**的未核条目」这条**在 CI 上没人守** —— 本机跑 audit-first-ch.mjs 看「未核」是否为 0。');
  } else {
    const r = auditFirstCh({ root, txtPath });
    if (r.error) notes.push(`⚠ L10 跳过：${r.error}`);
    else if (r.unReviewed.length) {
      for (const x of r.unReviewed) {
        ps.push(`L10 ${r.slug}「${x.name}」firstCh=${x.fc}、原文首现=${x.first}（差 ${x.d}）—— 既没修数据、也没进台账`);
      }
    } else {
      notes.push(`L10 ✓ 双向：${r.slug} 的「其余」桶里已核 ${r.reviewedCount} 条、未核 0 条`);
    }
  }
  return { problems: ps, notes };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { problems, notes } = checkFirstChLedger();
  for (const n of notes) console.log(`  ${n}`);
  if (problems.length) {
    console.error(`\n✗ firstCh 台账：${problems.length} 处问题`);
    for (const p of problems) console.error(`   ${p}`);
    console.error('\n   ⇒ 台账按 (book, name) 记账，而 name/firstCh 都会变 ⇒ 必须与数据同步。');
    process.exit(1);
  }
  console.log(`\n✓ firstCh 台账：形状 / 理由栏 / 引用完整性都对得上，且与数据一致（L1–L9 全过）`);
}
