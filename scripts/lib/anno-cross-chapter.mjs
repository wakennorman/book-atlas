/* 「事件章号」与「跨章声明（A3）」的**唯一定义** —— v0.177 新增。
 *
 * ## 为什么要抽出来
 *
 * 这套判据原先只在 `scripts/audit-annotations.mjs` 里有一份。v0.177 给
 * `data/cross-chapter-ok.json` 加了门禁 `scripts/check-cross-chapter-ledger.mjs`，
 * 而它的主力判据（**台账 ⇄ 数据双向一致**）必须重算一遍 A3 ——
 * 那就是「同一个定义抄两份」，而本仓库已经栽过三次
 * （见 `data-files.mjs` 头部：亲子边定义 / PARENT_CHILD / sidecar 名单）。
 * ⇒ 抽到这里，两处共用。
 *
 * ## 定义
 *
 * **事件章号** = `events[].chapter` 里的数字，取不到就退到 `events[].ch`。
 *   （三本书的 events 都只写 `ch`；`chapter` 是关系事件那边的另一种写法，这里兼容。
 *    ⚠ 取不到数字时返回 `null` —— 表示"章号不可知"，**不算跨章**。）
 *
 * **跨章声明（A3）** = 条目 `items[].events[]` 里，章号 ≠ 本条 `ch` 的事件。
 *   ⚠ 判据是**声明**（`events[]`），不是正文引用 —— 正文引用那条走 A1。
 *
 * 用法：
 *   import { crossChapterDeclarations, eventChapter } from './lib/anno-cross-chapter.mjs';
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA = path.join(ROOT, 'data');

/** 事件章号；`chapter` 优先、退 `ch`；取不到数字 → null（= 章号不可知，不算跨章）。 */
export function eventChapter(evById, id) {
  const e = evById.get(id);
  if (!e) return null;
  const m = String(e.chapter ?? '').match(/\d+/) ?? String(e.ch ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** 一本书的全部跨章声明。`A` = annotations JSON，`B` = 书 JSON。 */
export function crossChapterDeclarations(book, A, B) {
  const evById = new Map((B.events || []).map((e) => [e.id, e]));
  const out = [];
  for (const it of A.items || []) {
    for (const id of it.events || []) {
      if (!evById.has(id)) continue;                 // 事件不存在由 A1 那条判据报
      const ec = eventChapter(evById, id);
      if (ec !== null && ec !== it.ch) out.push({ book, ch: it.ch, event: id, eventCh: ec, itemTitle: it.title });
    }
  }
  return out;
}

/** 读一本书的 annotations + 书 JSON；缺任一个就返回 null。 */
export function loadBookPair(book, root = ROOT) {
  const af = path.join(root, 'data', 'annotations', `${book}.json`);
  const bf = path.join(root, 'data', `${book}.json`);
  if (!fs.existsSync(af) || !fs.existsSync(bf)) return null;
  return { A: JSON.parse(fs.readFileSync(af, 'utf8')), B: JSON.parse(fs.readFileSync(bf, 'utf8')) };
}
