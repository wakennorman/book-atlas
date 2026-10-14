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
 *   first-ch-ok.json              firstCh 已核台账（v0.178 新增：按 book+主名 记账）
 *   relation-actors-ok.json       行为人审计已核台账（v0.179 新增：按 book+from+to 记账）
 *   dup-names-ok.json             ④「去括号后同名」已核台账（v0.181 新增：按 book+去括号后的主名 记账）
 *   perf-baseline.json            首屏性能基线台账（v0.198 由 perf-budget --bless 写；
 *                                  v0.205.1 补：它不是书，但忘了进正则 ⇒ books-registry
 *                                  从 v0.198 起一直红，又被同轮的 CI startup_failure 掩盖）
 *   s2t.json                      简→繁转换表（v0.219：繁体版不是翻译，是查表转换；
 *                                  提交的人工资产，由 scripts/make-s2t-dict.mjs 产出）
 *
 * ⚠ **加 sidecar 必须来这一处**（v0.164 实测又踩了一次：新增
 *   `data/<slug>.surname-blind-ok.json` 后忘了加进下面的正则，
 *   `test/books-registry.mjs` 立刻把它当成「没登记进 books.json 的书」报红）。
 *   v0.179 又踩了一次：新建 `data/relation-actors-ok.json` 时漏了这一处，
 *   于是 `audit-relation-actors.mjs` 把它当成第 4 本书去扫，
 *   报告里多出一行「relation-actors-ok 缺原著」——**看起来像真的**，很容易放过去。
 *   ⚠ v0.181 加 `dup-names-ok.json` 时，**这一条注释本身就是现成的证据**：
 *   它已经列在上面的清单里了却还没进正则 —— 所以下面那行也补上了。
 *   ⚠ v0.205.1 第五次：`perf-baseline.json` 是**性能基线**（`--bless` 产物，
 *   不是书），漏在这里 ⇒ 同上。
 *   ⚠ v0.219 第六次：`data/s2t.json`（简→繁转换表）同样不是书，漏在这里 ⇒
 *   `test/books-registry.mjs` 报「漏登：s2t」，而且**大多数按书扫的门禁都会把它跳过**
 *   ——也就是它让一整类检查静默少扫一个文件，正是这份注释一直在拦的那件事。
 */
export const SIDECAR = /\.(graph|text|missing-ok|relayout|altnames-sources|name-form-ok|surname-blind-ok)\.json$|^books\.json$|^kin-terms-exempt\.json$|^cross-chapter-ok\.json$|^first-ch-ok\.json$|^relation-actors-ok\.json$|^dup-names-ok\.json$|^perf-baseline\.json$|^s2t\.json$/;

/**
 * data/ 下的书文件名（**只有文件名，不带 `data/` 前缀**），已按字典序排好。
 *
 * ⚠ 为什么不直接返回 'data/xxx.json'：
 *   audit-relation-actors.mjs 自己会 `path.join(ROOT, 'data', f)`，
 *   返回带前缀就成了 `data/data/xxx.json`。
 *   前缀由调用方按各自需要拼，模块只负责"哪些是书"这一件事。
 */
export function listBooks() {
  return listBooksIn(DATA);
}

/**
 * 同上，但可以指定别的 data 目录（v0.179 新增，**只给守卫测试用**）。
 *
 * `test/relation-actors-ledger-guard.mjs` 要在 tmp 里造一份最小 `data/`
 * （一本 demo 书 + 一份台账），再拿真实判据去跑 —— 而 `listBooks()` 写死 `DATA`。
 * 守卫若走 `BOOKATLAS_ROOT` 环境变量，就必须在 `import` 之前设好；
 * 显式传目录更直白，也和 `auditFirstCh({ root })` 的写法一致。
 * ⚠ `listBooks()` 的行为**逐字未变**（它只是转调本函数）。
 */
export function listBooksIn(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir)
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

/**
 * 书型（v0.206 新增）。`meta.type` 这个字段**早就存在** —— 现有三本都写着「叙事类」，
 * 而全仓只有一处读过它（`js/app.js` 的拆书素材：非叙事类不发请求）。
 *
 * 理论类书籍的节点是**概念/术语**（《刻意练习》里的「心理表征」「甜蜜点」），不是人物
 * ⇒ 一切「按人名做的判据」对它**结构性不成立**：
 *   · 姓氏提取器盲区（`check-surname-coverage`）—— 概念名的首字不是姓；
 *   · 关系引文·行为人审计（`audit-relation-actors`）—— 概念之间没有"行为人"；
 *   · 漏人检测 / 译名台账 / 重名台账 —— 没有"人"可漏、可译、可重名。
 *
 * ⇒ 判据集中在这一处，各处 import。**别把 `=== '理论类'` 抄到每个门禁里**
 *   （铁律 7：同一个定义抄多份，然后各改各的，漂移了就静默出错）。
 *
 * ⚠ 分流的判据必须是**显式声明**（`meta.type`），不是"猜这本书像不像理论书"——
 *   猜出来的类型会在某本书上悄悄判错，而报告看起来完全正常。
 * ⚠ 各门禁跳过的分支**必须打印**：静默少一本书会被读成「这本书 0 处问题」，那是假绿。
 */
export const THEORY_TYPE = '理论类';
export function isTheoryBook(book) {
  return !!book && !!book.meta && book.meta.type === THEORY_TYPE;
}

/**
 * v0.215：**已支持**的书型白名单（前端会真的给它画图谱）。
 *
 * 为什么要有这份表：本书库的形态是"节点 + 有依据事件的关系 + 阶段 + 事件"
 * （`scripts/validate.mjs` 的 error 级要求 relations / events 非空）。
 * 诗歌、散文、工具书、设定集这类**给不出这个东西** —— 硬灌数据只会得到一张空图谱 +
 * 满屏使用说明，那正是本项目最恨的"骗人的目录"同族病（没有目录的人会 grep，
 * 一个骗人的目录让人信它）。
 *
 * ⇒ 这类书不是"做坏了"，是**明确不支持**：`meta.type` 声明成一个白名单外的值
 *   （建议 `作品集`），前端就走出口页说清"为什么不做、什么书适合"，
 *   而 `test/books-registry.mjs` 拦住"把它注册进 books.json"这条路。
 *
 * ⚠ 加一种书型 = 加一行白名单 **+** 前端真的能画（`js/app.js` 的术语表与视图都要认它）。
 *   只改白名单不改前端，得到的是一张用错词的表 —— 比空图谱更难发现。
 */
export const SUPPORTED_TYPES = ['叙事类', '理论类'];
/** 诗歌 / 散文 / 工具书这类"没有可供图谱化的关系"的书，用这个值显式声明不支持。 */
export const WORK_COLLECTION_TYPE = '作品集';

/**
 * 这本书是不是**声明了**一个还不支持的书型？
 *
 * ⚠ 只看**显式声明**：`meta.type` 缺失/为空时不算（那是老数据，按叙事类走，
 *   由 validate 提示补声明）—— 猜出来的类型会在某本书上悄悄判错（同 `isTheoryBook` 的教训）。
 */
export function isUnsupportedBookType(book) {
  const t = book && book.meta && book.meta.type;
  return typeof t === 'string' && t !== '' && !SUPPORTED_TYPES.includes(t);
}
