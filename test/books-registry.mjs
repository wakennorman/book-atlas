/**
 * 「data/ 里哪些是书」只有一个定义 —— 注册表与实际内容必须一致（v0.155 新增）
 *
 * ## 为什么要有它
 *
 * 项目里「哪些是书」有**两份定义**，而且互不知情：
 *
 *   · `data/books.json` 的 `books[]` —— 前端（`app.js` / `editor.js`）与约 10 个脚本读它
 *     （check-annotations / check-event-chars / check-graph-fields / check-packs-sync /
 *      check-sw-precache / audit-search / audit-against-text / annotate-kin …）
 *   · `scripts/lib/data-files.mjs` 的 `listBooks()` —— readdir 过滤 sidecar，
 *     被 validate / derive-kin / check-kin-terms / audit-relation-actors 用
 *
 * **没有任何脚本交叉校验这两者。** 而"加一本书"是**手动**步骤
 * （`books.json` 的 `noteAddBook` 明说：① 在 books 数组里加一条 …）—— 手动 = 会忘。
 *
 * ## 忘了登记的后果：**门禁假绿**
 *
 * 在 `data/` 放一本新书、却忘了登记进 `books.json`：
 *   · `listBooks()` 系（validate / derive-kin / 称谓对质）**会**处理它 ⇒ 看起来"检查过了"
 *   · `books.json` 系（check-annotations / check-event-chars / check-graph-fields /
 *     check-packs-sync / check-sw-precache / 前端）**全部静默跳过它**
 * ⇒ 新书**半上线**：门禁全绿，但大部分步骤根本没看它一眼。
 *
 * 反过来，登记了 `data/` 里不存在的书 ⇒ 前端 `fetch` 404。
 *
 * 这是本项目「同一个定义抄多份」的又一例（`lib/data-files.mjs` 注释里已列 ①②③）。
 * 与 v0.152 / v0.153 的处理一致：**不合并两套（各有用途），而是加判据守一致。**
 *
 * ## 判据（双向）
 * ① `books.json` 里每条 `file` / `graphFile` / `textFile` 都必须真实存在
 * ② `data/` 里每本书（`listBooks()`）都必须在 `books.json` 里登记
 * ③ `file` 必须等于 `data/<slug>.json`（slug 与文件名不许各写各的）
 *
 * 用法：node test/books-registry.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listBooks, isUnsupportedBookType } from '../scripts/lib/data-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const reg = JSON.parse(fs.readFileSync(path.join(DATA, 'books.json'), 'utf8'));
const books = Array.isArray(reg.books) ? reg.books : [];
ok(books.length > 0, `books.json 里有 ${books.length} 本书`);

/* ① 登记的路径都存在（file / graphFile / textFile） */
for (const b of books) {
  for (const k of ['file', 'graphFile', 'textFile']) {
    const p = b[k];
    ok(typeof p === 'string' && fs.existsSync(path.join(ROOT, p)),
      `books.json「${b.slug}」的 ${k} 存在（${p}）`);
  }
}

/* ③ slug 与 file 不许各写各的 */
for (const b of books) {
  ok(b.file === `data/${b.slug}.json`, `books.json「${b.slug}」的 file 与 slug 一致`);
}

/* ④ v0.215：注册进来的书必须是**已支持**的书型（`meta.type` ∈ SUPPORTED_TYPES）。
 *    为什么：诗歌 / 散文 / 工具书这类书给不出"关系 + 定义关系的事件"，
 *    前端对它们走的是一页"为什么不做"的说明（app.js 的 renderUnsupportedBook）。
 *    那道出口是**兜底**；真正的闸在这里 —— 谁把这类书注册进 books.json，
 *    全网用户就会看到一个"点开只有一句话"的条目，而那看起来像网站坏了。
 *    ⚠ 判据读 `data/<slug>.json` 里的 meta.type（不是 books.json —— 那边没这个字段）。 */
for (const b of books) {
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(path.join(ROOT, b.file), 'utf8')).meta || null; } catch { /* ① 已报 */ }
  if (!meta) continue;
  ok(!isUnsupportedBookType({ meta }),
    `books.json「${b.slug}」的书型「${meta.type || '(缺 meta.type)'}」是已支持的`
    + `${isUnsupportedBookType({ meta }) ? ' —— 诗歌/散文/工具书请改成「作品集」并**不要**注册进 books.json（前端只给它一页"不做"的说明）' : ''}`);
}

/* ② 双向：listBooks() 的 slug 集合必须与 books.json 的 slug 集合相等 */
const regSlugs = new Set(books.map((b) => b.slug));
const actualSlugs = new Set(listBooks().map((f) => f.replace(/\.json$/, '')));
const unregistered = [...actualSlugs].filter((s) => !regSlugs.has(s));   // data/ 有、books.json 没有
const ghost = [...regSlugs].filter((s) => !actualSlugs.has(s));          // books.json 有、data/ 没有
ok(unregistered.length === 0,
  `data/ 里的每本书都登记进了 books.json${unregistered.length ? `（**漏登记**：${unregistered.join('、')} ⇒ 这些书被大多数门禁步骤静默跳过）` : ''}`);
ok(ghost.length === 0,
  `books.json 里每本书都在 data/ 里存在${ghost.length ? `（**幽灵条目**：${ghost.join('、')} ⇒ 前端会 fetch 404）` : ''}`);

console.log(fail ? `\n✗ ${fail} 处不一致` : `\n✓ 书目注册表与 data/ 实际内容一致（${pass} 条）`);
process.exit(fail ? 1 : 0);
