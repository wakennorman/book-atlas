/**
 * 「噪声忽略名单」（`data/<slug>.missing-ok.json`）的**读取** —— v0.183 新建。
 *
 * ## 为什么抽出来（而不是让守卫去跑 `audit-search.mjs`）
 *
 * `audit-search.mjs` 是**顶层就干活**的脚本，`import` 它会把主流程也跑一遍
 * （v0.181 记的同一个坑：`check-dup-names-ledger.mjs` 不能反过来 import 审计脚本）。
 * ⇒ 读取逻辑放这里，两边都从它取。
 *
 * ## 名单的语义（决定它能不能跨语料用）
 *
 * 三份 `_说明` 都写明收录口径是「**这个字符串不是人名**」：
 *   ① 常用词被「姓氏+1~2字」规则误捞   ⇒ 与语料无关
 *   ② 不是人名的专名/地名/物件         ⇒ 与语料无关
 *   ③ 属于**已有人物**的别名或全名片段 ⇒ 关于**人物**的事实，与语料无关
 * ⇒ 所以"在《三国演义》正文上判过'这不是人名'"，**可以**用来过滤
 *   `audit-search.mjs` ③（在**我们自己写的文案**上）产出的同名候选。
 *
 * ## ⚠ 但它**只能**过滤"已判过的"，**不能**让 ③ 变得有用
 *
 * 实测（v0.183）：③ 报的三国 406 条里只有 5 条是原著检测器也报的，
 * 其余 401 条全是**跨词边界的叙述碎片**（`黄巾起`/`平要术`/`诸侯讨`/`伏兵杀`/`关迎敌`）。
 * 读台账只挡掉 91/656（14%）。
 * ⇒ 真正的病灶是 ③ 在**中文叙述文本**上没有判别力
 * （`[百家姓][\u4e00-\u9fa5]{1,2}` 必然切出碎片；而 `audit-against-text.mjs`
 *  靠的"出现在已知人物 ±90 字内"那条精度信号，在我们的文案上**实测一条都砍不掉**
 *  —— 0/565，因为我们的文案通篇都在写已知人物）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 名单里以 `_` 开头的行是说明，不是条目（口径与 `check-missing-ok.mjs` 一致）。 */
const isNote = (x) => typeof x === 'string' && x.startsWith('_');

/**
 * 读一本书的噪声忽略名单。
 *
 * @param {string} dataDir `data/` 目录
 * @param {string} slug     书 slug（不带 `.json`）
 * @returns {{names:Set<string>, entries:number, missing:boolean, error?:string}}
 *   `missing` ⇒ 没有这个名单文件（**不是**"名单为空"，消费方要能区分）
 *   `error`   ⇒ JSON 坏了 —— **绝不能**静默当空名单，否则判过的噪声会全部复活
 *               （这正是 v0.160 记的「静默降级」那一族：删掉原著/弄坏名单 ⇒ 检查看起来更干净）
 */
export function loadMissingOk(dataDir, slug) {
  const file = path.join(dataDir, `${slug}.missing-ok.json`);
  if (!fs.existsSync(file)) return { names: new Set(), entries: 0, missing: true };

  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    return { names: new Set(), entries: 0, missing: false, error: `${slug}.missing-ok.json 不是合法 JSON：${e.message}` };
  }
  /* 形状两种都收：纯数组，或 `{_说明…, 明细}`（与其余台账同一口径）。 */
  const list = Array.isArray(doc) ? doc : (Array.isArray(doc.明细) ? doc.明细 : null);
  if (!list) {
    return { names: new Set(), entries: 0, missing: false, error: `${slug}.missing-ok.json 既不是数组、也没有 \`明细\` 数组` };
  }

  const names = new Set();
  let entries = 0;
  for (const e of list) {
    if (isNote(e)) continue;
    if (typeof e === 'string') { names.add(e); entries++; continue; }
    if (e && typeof e === 'object' && typeof e.name === 'string') { names.add(e.name); entries++; }
  }
  return { names, entries, missing: false };
}

/**
 * 从候选里去掉**已判过**的那些。
 *
 * @param {Array<[string, number]>} cand `[名字, 次数]` 列表
 * @param {Set<string>} ok
 * @returns {{kept:Array<[string,number]>, dropped:Array<[string,number]>}}
 *   `dropped` 必须被**打印**（v0.173 教训：门禁/审计不打印"挡掉了什么"，绿就等于装饰品）。
 */
export function dropAdjudicated(cand, ok) {
  if (!ok || !ok.size) return { kept: cand, dropped: [] };
  const kept = []; const dropped = [];
  for (const c of cand) (ok.has(c[0]) ? dropped : kept).push(c);
  return { kept, dropped };
}