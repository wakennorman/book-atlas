/**
 * data/ 目录里"哪些文件是书、哪些是附属文件"的**唯一**定义。
 *
 * ## 为什么要抽出来（v0.114）
 *
 * 同一份 sidecar 名单此前在**三个地方各抄了一遍**：
 *     scripts/check-kin-terms.mjs
 *     scripts/derive-kin.mjs
 *     scripts/audit-relation-actors.mjs
 *
 * 加上 `data/kin-terms-exempt.json`（v0.113 新建）时忘了同步，
 * 结果对质脚本开始把这个 JSON **当成一本书**去扫：
 *     「· kin-terms-exempt：族谱只覆盖 0 人（0%），跳过对质」
 *
 * ## 这已经是"同一个定义抄多份"的第三例
 *
 *   ① 亲子边的定义：kin-terms.mjs 的 PARENT_CHILD 含「养」，
 *      而三个审计脚本自己写的正则不含 ⇒ 养亲边对审计完全不可见（v0.110）
 *   ② PARENT_CHILD 与 isParentChild 的关系（已合并为单一来源）
 *   ③ sidecar 名单（就是本文件）
 *
 * 共同点：**定义抄多份，然后各改各的，漂移了就静默出错**。
 * 凡是需要"多处保持一致"的定义，就该有一个 module。
 *
 * ## v0.162：ROOT 支持 `BOOKATLAS_ROOT` 环境变量（只给测试用）
 *
 * 加了 `scripts/check-kin-terms-exempt.mjs` 之后，它的守卫测试需要在 tmp 里造一份
 * 最小 `data/`（一本 demo 书 + 一份豁免清单），用环境变量把根目录指过去 —— 而
 * `listBooks()` 原先写死 `ROOT`，不认这个变量 ⇒ 守卫测试**测不了"书不存在"这类判据**
 * （tmp 里造的书，listBooks 看不见）。
 * ⇒ 与 check-version-bump / check-name-form-ledger / check-altnames-ledger 同一写法：
 *   **环境变量优先，没设就用真实路径**（不设时行为与以前**逐字相同**，因此对现有四个
 *   使用者零影响 —— 它们都不设这个变量）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA = path.join(ROOT, 'data');

/**
 * 附属文件（不是书）：
 *   .graph.json / .text.json      打包产物
 *   .missing-ok.json              漏人豁免
 *   .relayout.json                布局缓存
 *   .altnames-sources.json        别名出处
 *   .name-form-ok.json            译名异体
 *   .surname-blind-ok.json        提取器盲区豁免（v0.164 新增：产不出来的主名要申报理由）
 *   books.json                    三本书的清单
 *   kin-terms-exempt.json         称谓对质豁免清单（v0.113 新建，最容易漏）
 *   cross-chapter-ok.json         A3 跨章声明台账（v0.177 新增：按 book+章号+事件id 记账）
 *
 * ⚠ **加 sidecar 必须来这一处**（v0.164 实测又踩了一次：新增
 *   `data/<slug>.surname-blind-ok.json` 后忘了加进下面的正则，
 *   `test/books-registry.mjs` 立刻把它当成「没登记进 books.json 的书」报红）。
 */
export const SIDECAR = /\.(graph|text|missing-ok|relayout|altnames-sources|name-form-ok|surname-blind-ok)\.json$|^books\.json$|^kin-terms-exempt\.json$|^cross-chapter-ok\.json$/;

/**
 * data/ 下的书文件名（**只有文件名，不带 `data/` 前缀**），已按字典序排好。
 *
 * ⚠ 为什么不直接返回 'data/xxx.json'：
 *   audit-relation-actors.mjs 自己会 `path.join(ROOT, 'data', f)`，
 *   返回带前缀就成了 `data/data/xxx.json`。
 *   前缀由调用方按各自需要拼，模块只负责"哪些是书"这一件事。
 */
export function listBooks() {
  if (!fs.existsSync(DATA)) return [];
  return fs.readdirSync(DATA)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.') && !SIDECAR.test(f))
    .sort();
}

/** 同上，但直接给 slug（不含扩展名）。 */
export function listBookSlugs() {
  return listBooks().map((f) => f.replace(/\.json$/, ''));
}

/** 书的完整路径。 */
export function bookPath(file) {
  return path.join(DATA, file);
}
