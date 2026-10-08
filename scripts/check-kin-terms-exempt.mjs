/* 「称谓对质豁免清单」的**引用完整性**检查 —— v0.162 新增。
 *
 * ## 清单是什么
 *
 * `data/kin-terms-exempt.json` 记「手写的亲属称谓与族谱算出来的不一致、但**是有意**的」那些关系对。
 * 每条：`{book, from, to, reason}`（`from`/`to` 是**人物 id**）。
 * 消费方只有一个：`scripts/check-kin-terms.mjs` 的 `isExempt(bookId, from, to)`。
 *
 * ## 为什么它需要一个门禁
 *
 * 消费方 `loadExempt()` 有两处**静默**：
 *
 *   ① **JSON 解析失败 ⇒ `catch { return [] }`** —— 整份清单**悄悄变成空名单**。
 *      这时本该被豁免的关系会重新变成"不一致"。但**不一定会被发现**：
 *      这两条豁免的对象（孙权—孙桓）族谱本来就**算不出来**（孙河无父母记录）⇒
 *      对质循环里 `if (!k.term || k.kind === 'unrelated') continue;` 直接跳过它们
 *      ⇒ **解析失败和一切正常，跑出来一模一样**。
 *
 *   ② **`reason` 短于 8 字 ⇒ `isExempt` 返回 false** —— 这条豁免**不生效**。
 *      而它看起来还好好地待在文件里（与 v0.160 台账"键写成别名 ⇒ 申报不生效"同一族）。
 *
 * 加上它按 **id** 记账，而 id 会变（改名 / 删人 / 合并都动它）——
 * 于是"清单指向一个不存在的人"也没有任何一处会响。
 *
 * ## 判据（**不需要原著文本**，所以能进 CI）
 *
 *   K1  顶层是数组、每条是 `{book,from,to,reason}` 对象
 *   K2  `book` / `from` / `to` / `reason` 都是非空字符串
 *   K3  `reason.trim().length >= 8`（**与消费方 `isExempt` 的门槛逐字一致** —— 短了这条豁免静默失效）
 *   K4  `book` 是 `data/` 下真实存在的书（走 `lib/data-files.mjs` 的 `listBookSlugs()`）
 *   K5  `from` / `to` 是该书里真实存在的人物 **id**
 *   K6  `(book, from, to)` 不重复
 *   K7  `from !== to`（一个人不是自己的亲属）
 *
 * ⚠ **两条刻意不做的判据**（记下来别再写）：
 *
 *   ① **不检查"这条关系是否存在于数据里"。** 清单**允许**"关系已不存在、只为留依据防改错"
 *      的条目 —— `sun-quan→sun-huan` 那条的理由里明写「本条实际不再被对质覆盖，
 *      列在这里是为了留下依据、防止以后有人『按族谱修正』把它改错」。
 *      ⇒ 若照搬 v0.160/v0.161 的"引用完整性"（要求被引用对象真实存在），会**误报**。
 *      能安全检查的是"**人**在不在"（K5），不是"**关系**在不在"。
 *
 *   ② **不检查 reason 里是否注明了来源类型**（原文 / 族谱缺失 / 收养姻亲）——
 *      消费方 `isExempt` 只看长度，不看内容；把"必须注明章节"变成门禁会挡住合法条目。
 *      那属于**人工评审**，不是机器判据。
 *
 * 用法：node scripts/check-kin-terms-exempt.mjs
 *
 * ⚠ 支持 `BOOKATLAS_ROOT` 环境变量（**只给测试用**，与 check-name-form-ledger.mjs 同一写法）：
 *   test/kin-terms-exempt-guard.mjs 在 tmp 里造一份最小 data/，把 ROOT 指过去逐场景断言退出码。
 *   （它 import 的 `lib/data-files.mjs` 也认这个变量 —— 见那个文件 v0.162 的说明。）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listBookSlugs } from './lib/data-files.mjs';

const ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const FILE = path.join(DATA, 'kin-terms-exempt.json');

export function checkKinTermsExempt() {
  const problems = [];
  if (!fs.existsSync(FILE)) return problems;   // 可选文件：没有就等于没有豁免

  let list;
  try { list = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) {
    problems.push(`kin-terms-exempt.json：JSON 解析失败 —— ${e.message}`
      + `\n     ⇒ 消费方 loadExempt() 会**静默 return []**，整份清单变成空名单（所有豁免失效）。`);
    return problems;
  }
  if (!Array.isArray(list)) {
    problems.push('kin-terms-exempt.json：顶层必须是数组（消费方 `exempt.some(...)` 直接依赖它）');
    return problems;
  }

  const books = new Set(listBookSlugs());
  const idCache = new Map();
  const idsOf = (slug) => {
    if (idCache.has(slug)) return idCache.get(slug);
    let set = null;
    try {
      const b = JSON.parse(fs.readFileSync(path.join(DATA, `${slug}.json`), 'utf8'));
      set = new Set((b.characters || []).map((c) => c.id));
    } catch { set = new Set(); }
    idCache.set(slug, set);
    return set;
  };

  const seen = new Map();
  for (const [i, e] of list.entries()) {
    const at = `第 ${i + 1} 条`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) { problems.push(`${at}：不是 \`{book,from,to,reason}\` 对象`); continue; }

    for (const k of ['book', 'from', 'to', 'reason']) {
      if (typeof e[k] !== 'string' || !e[k].trim()) problems.push(`${at}：\`${k}\` 缺失或为空`);
    }

    if (typeof e.book === 'string' && e.book.trim() && !books.has(e.book)) {
      problems.push(`${at}：\`book\` 写「${e.book}」，不是 data/ 下的书（${[...books].join(' / ') || '（一本书都没有）'}）`
        + `\n     ⇒ 消费方按 bookId 匹配，写错书名这条豁免**永不生效**。`);
    }

    if (typeof e.reason === 'string' && e.reason.trim().length < 8) {
      problems.push(`${at}：\`reason\` 只有 ${e.reason.trim().length} 字（<8）`
        + `\n     ⇒ 消费方 isExempt() 要求 reason ≥8 字，**短了这条豁免静默失效**（文件里看着还在，实际不生效）。`);
    }

    if (books.has(e.book)) {
      const ids = idsOf(e.book);
      for (const k of ['from', 'to']) {
        if (typeof e[k] === 'string' && e[k].trim() && !ids.has(e[k])) {
          problems.push(`${at}：\`${k}\` = 「${e[k]}」不是 ${e.book} 里的人物 **id**`
            + `\n     ⇒ 豁免指向**不存在的人**（改名 / 删人 / 合并后没同步？）。`
            + `\n     ⚠ 注意这里是 id 不是 name；要的是 \`characters[].id\`。`);
        }
      }
    }

    if (typeof e.from === 'string' && e.from === e.to) {
      problems.push(`${at}：\`from\` 与 \`to\` 相同（${e.from}）—— 一个人不是自己的亲属`);
    }

    const key = `${e.book}|${e.from}|${e.to}`;
    if (seen.has(key)) problems.push(`${at}：与第 ${seen.get(key)} 条重复（同一 book+from+to）`);
    else seen.set(key, i + 1);
  }

  return problems;
}

/* 入口判断用 pathToFileURL 规范化再比（别写 endsWith(process.argv[1])：
 * 本仓库目录名带空格，路径里的空格是 %20 编码，两边永远不相等 ⇒ 主流程一次都不跑、退出码还是 0）。 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ps = checkKinTermsExempt();
  if (!ps.length) {
    console.log('✓ 称谓对质豁免清单：每条都指着真实的人，书名 / 理由长度 / 唯一性都对得上');
    process.exit(0);
  }
  console.error(`✗ 称谓对质豁免清单有 ${ps.length} 处问题：\n`);
  for (const p of ps) console.error('  ✗ ' + p);
  process.exit(1);
}
