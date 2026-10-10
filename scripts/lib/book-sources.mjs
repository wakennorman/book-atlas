/**
 * 「哪本书对应哪份原著 txt」的**唯一**定义（v0.179）。
 *
 * ## 为什么要抽出来
 *
 * 起因是 `audit-relation-actors.mjs` 里那张硬编码的 `SOURCES` 表：
 *
 *     'three-kingdoms':                 '…/opencode/ba-books/三国演义.txt'
 *     'one-hundred-years-of-solitude':  '…/opencode/epub.txt'          ← ⚠
 *     'crime-and-punishment':           '…/opencode/ba-books/罪与罚.txt'
 *
 * 三个问题叠在一起：
 *
 * ① **《百年孤独》指到了另一个文件**。`%TEMP%\opencode\epub.txt`（696,795 字节）
 *    与 `%TEMP%\opencode\ba-books\百年孤独.txt`（698,738 字节）是**同一译本的两份不同抽取**：
 *    前者清洗过（带版权页/CIP 页），后者是原始 epub→txt 转储（带 `==== [001] titlepage.xhtml ====`
 *    分片标记）。其余脚本一律用 `ba-books/` 那一份 ⇒ 同一个"原著"有两份来源，
 *    而且其中一份**不在 ba-books 目录里**。
 *
 * ② **它是一张写死绝对路径的表**，而别的脚本用的是 `os.tmpdir()`。
 *    用户名/临时目录一变，这张表就悄悄指向不存在的位置。
 *
 * ③ **缺原文时静默降级**。`audit-relation-actors.mjs` 的 C 级判据是
 *    `if (verbatim && src && pos < 0)` —— `src` 为 `null` 时**整条 C 级不判**，
 *    报告上只多一行小字。也就是说：**把原著文件删掉，审计会"更干净"**。
 *    这是最坏的一种失败方式（失败得像个成功），所以本模块把"缺"显式返回出来，
 *    让调用方必须表态（打印「B/C 未判」而不是「没有」）。
 *
 * ## 这已经是"同一个定义抄多份"的又一例
 *
 * `scripts/lib/data-files.mjs` 的注释里列过三例，这是第四例：
 * 「原著文件名」原先散在 `audit-relation-actors.mjs`（硬编码表）、
 * `audit-first-ch.mjs`（`BOOKS` 里的 `txt` 字段）、以及一堆一次性 `fix-*.mjs` 里。
 * ⇒ 只收拢**在用**的两处（两个审计脚本）；一次性补丁脚本已执行完、只留档，不去动它们。
 *
 * ⚠ 原著 txt **不在版本库里**，CI 上没有 ⇒ 依赖它的判据在 CI 上跑不了，
 *   那是**手工步骤**，不是门禁（见 `check-first-ch-ledger.mjs` 的 L10 同款处理）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 原著 txt 所在目录（本机才有；`%TEMP%\opencode\ba-books\`）。 */
export const SOURCE_DIR = path.join(os.tmpdir(), 'opencode', 'ba-books');

/**
 * slug → 原著文件名。
 * ⚠ **加一本书必须来这一处**（否则新书在审计里永远是"缺原文 ⇒ B/C 未判"）。
 */
export const BOOK_TXT = {
  'three-kingdoms': '三国演义.txt',
  'crime-and-punishment': '罪与罚.txt',
  'one-hundred-years-of-solitude': '百年孤独.txt',
};

/**
 * 比对前先把空白与间隔号去掉 —— EPUB→txt 会往中文里插大量空格，
 * 逐字比对必须在这个"紧凑"形态上做（v0.144 的索引错位就是没做这一步）。
 */
export const flatSource = (s) => String(s || '').replace(/[\s·・･　]/g, '');

/** 这本书的原著文件该在哪（没登记过这本书就返回 null）。 */
export function bookSourcePath(slug, dir = SOURCE_DIR) {
  const f = BOOK_TXT[slug];
  return f ? path.join(dir, f) : null;
}

/**
 * 读一本书的原著。
 * @returns {{slug:string, path:string|null, text:string|null}}
 *   `path === null` ⇒ 这本书**没有登记**原著文件；
 *   `text === null` ⇒ 登记了但**文件不存在**。
 *   两种都要当成"没判"，不要当成"没问题"。
 */
export function loadBookSource(slug, dir = SOURCE_DIR) {
  const p = bookSourcePath(slug, dir);
  if (!p || !fs.existsSync(p)) return { slug, path: p, text: null };
  return { slug, path: p, text: flatSource(fs.readFileSync(p, 'utf8')) };
}

/** 缺原文时给调用方用的一句话（两种缺法要分开说）。 */
export function missingSourceNote(info) {
  if (info.text) return '';
  return info.path
    ? `⚠ 找不到原著文本：${info.path} ⇒ 依赖原文的判据**未判**`
    : `⚠ 这本书没有登记原著文件（见 scripts/lib/book-sources.mjs 的 BOOK_TXT）⇒ 依赖原文的判据**未判**`;
}
