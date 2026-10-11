#!/usr/bin/env node
/**
 * 【长期】发布门禁每轮都跑　（v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定）
 * 台账 `why` 栏里「逐字引文」的**逐字性**检查 —— v0.182 新增。
 *
 * ## 为什么需要它
 *
 * v0.102 真的放过一条**伪造引文**（把转述装成「」）。`scripts/fix-fabricated-quote.mjs`
 * 是那次的补丁，`scripts/verify-quotes.mjs` + `audit-relation-actors.mjs` 的 C 级守着
 * **关系引文** —— 但**台账 `why` 栏里的引文此前没有任何一处检查**。
 * 而台账恰恰是「人回原著读过」的结论所在，它要是引错了字，读它的人就没法复核。
 *
 * ## ⚠ 判据为什么不是「所有「」都必须逐字」
 *
 * 实测：对四份台账的**全部 99 条**「」做检查 ⇒ **29 条查不到**，其中绝大多数
 * **根本不是引文** —— 「」在台账里被**两种用途**共用：
 *
 *   ① 逐字引文 ：「越骑校尉王颀皆死于国难」  ← 必须在原文里查得到
 *   ② 给说法命名：「钟邓结怨」「声明覆盖范围」「这个地主」  ← 本来就不是引文
 *
 * 直接全查 ⇒ 29 条红 ⇒ **纯噪声的门禁会被忽略，比没有更坏**（MEMORY 反复记的同一族）。
 *
 * ## 本检查的判据：**引文点名了本条台账的主语 ⇒ 它就是在给这个主语作证 ⇒ 必须是印刷版逐字**
 *
 * 这不是启发式，是**职责**：给一个说法起名字，不需要它出现在原著里；
 * 而拿一句话**给某个人作证**，那句话就必须真的是原文。
 * 实测这条过滤把 29 条噪声压到 **3 条，而这 3 条全是真缺陷**（见下）—— 零假阳性。
 *
 * 「主语」按台账而不同，全部**从数据里查回来**，不写死：
 *
 * | 台账 | 主语 |
 * |---|---|
 * | `dup-names-ok.json` | `members` 里每个人的主名（去括号） |
 * | `first-ch-ok.json` | `name` |
 * | `relation-actors-ok.json` | `from` / `to` 的主名 |
 * | `cross-chapter-ok.json` | ⚠ 主语是**事件 id**，不是人 ⇒ **本判据不适用**，打印说明后跳过 |
 *
 * ## 「印刷版逐字」的口径：**只去空白，保留间隔号**
 *
 * ⚠ `loadBookSource()` 返回的是 `flatSource()` 过的正文，它连 `·・･` 一起删了。
 * 用它去查 ⇒「何塞·阿尔卡蒂奥」写成「何塞阿尔卡蒂奥」**照样"查得到"**，
 * 而那不是印刷版。⇒ 本检查**直接读 txt**，只 `replace(/[\s　]/g,'')`。
 *
 * 但「引文里有没有点名主语」这一步**要**把间隔号归一（否则 `何塞·阿尔卡蒂奥`
 * 与 `何塞阿尔卡蒂奥` 会被当成两个人，主语就匹配不上）⇒ **两种口径，各司其职**。
 *
 * ## 判据
 *
 * | # | 判据 |
 * |---|---|
 * | Q1 | 引文点名了本条台账的主语 ⇒ 必须在该书原著里**印刷版逐字**存在 |
 * | Q2 | 引文里含省略号（`…`/`⋯`）⇒ 跳过并**计数**：它是**节引**，不可能逐字 |
 * | Q3 | 台账的主语在本机原著里查不到书名 ⇒ **跳过并打印**（不静默） |
 * | Q4 | 不适用的台账（主语不是人）⇒ **打印理由**后跳过，不假装查过了 |
 *
 * ## ⚠ 已知限制（必须打印，不能假装它是硬门禁）
 *
 * **Q1–Q4 全部需要原著 txt**，而原著不进版本库 ⇒ **CI 上恒跳过**，本机才有。
 * 跳过时**必须打印**（v0.173 的教训：门禁不打印"跳过了什么"，绿就等于装饰品）。
 * 另：Q2 只放过「`…`节引」这一种；**改写过的转述若不含 `…`，仍会被报红** ——
 * 这是**故意的**（宁可多报），因为转述装成引文正是 v0.102 的病根。
 *
 * 用法：`node scripts/check-ledger-quotes.mjs`
 *
 * ⚠ 支持 `BOOKATLAS_ROOT`（只给测试用，与其余台账门禁同一写法）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOURCE_DIR, BOOK_TXT } from './lib/book-sources.mjs';

export const DEFAULT_ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 本检查覆盖的台账 → 主语怎么取。`kind:'person'` 的按人名判，`kind:'event'` 的不适用。 */
export const LEDGERS = [
  { rel: 'data/dup-names-ok.json', kind: 'person', source: 'members' },
  { rel: 'data/first-ch-ok.json', kind: 'person', source: 'name' },
  { rel: 'data/relation-actors-ok.json', kind: 'person', source: 'from/to' },
  { rel: 'data/cross-chapter-ok.json', kind: 'event', source: 'event' },
];

/** 匹配用：连间隔号一起去掉。**只用于「引文有没有点名主语」这一步。 */
const matchable = (s) => String(s || '').replace(/[·・･\s　]/g, '');

/** 印刷版逐字用的归一：**只去空白，保留间隔号**。 */
const printed = (s) => String(s || '').replace(/[\s　]/g, '');

/** 取主名（去掉「（…）」补充）—— 与 `lib/dup-names.mjs` 的 baseName 同义，此处不 import 它：
 *  本检查与 ④ 台账门禁**判的不是一件事**，不必共用同一个模块（避免互相牵动）。 */
const mainName = (s) => String(s || '').replace(/[（(].*$/, '').trim();

/** 「节引」：含省略号的引文不可能逐字（Q2）。 */
const isElided = (s) => /[…⋯]/.test(s);

/**
 * 这段引文**点名了主语**吗？
 *
 * ## ⚠ 三版都踩过同一个坑，这里记下取舍
 *
 * v0.182 实测：「」在台账里被**两种用途**共用 —— 逐字引文、以及**给一个说法命名**
 * （「钟邓结怨」「声明覆盖范围」）。不加过滤 ⇒ 全查 99 条里 **29 条红**，纯噪声。
 *
 * 试过的三种判据，前两种都不成立：
 *   ① `q.includes(sub)` —— 「甲一甲二」（成对命名）会被当成点名了「甲一」。
 *   ② 「主语两侧不能是汉字」—— 「甲一在此」右侧是动词「在」，也是汉字 ⇒ **真引文被漏掉**。
 *      而且 ④ 台账里所有成员**共享同一个 base**（`王颀（长安）`/`王颀（天水）` 去括号后都是「王颀」，
 *      按构造就是），所以"两个主语连写"这件事**根本无法从字符边界分辨**。
 *
 * ⇒ 最终只用第③种：**引文里出现了本条台账的主语**（间隔号归一后子串匹配）就算点名。
 *   剩下的歧义——"点名"到底是在引用还是在命名——**交给书写约定**：
 *   **引号 = 声明这是原文**。要写一个原书里没有的说法，就别给它加引号
 *   （本轮改 `first-ch-ok.json` 的「江夏[202]张虎」时正是这么处理的）。
 *
 * @param {string} quote
 * @param {string[]} subjects 本条台账的主语（可多个）
 */
export function namesSubject(quote, subjects) {
  const subs = (Array.isArray(subjects) ? subjects : [subjects]).map(matchable).filter(Boolean);
  const q = matchable(quote);
  if (!q || !subs.length) return false;
  return subs.some((s) => s && q.includes(s));
}

export function checkLedgerQuotes(root = DEFAULT_ROOT, opts = {}) {
  const dir = opts.sourceDir || SOURCE_DIR;
  const problems = [];
  const notes = [];
  const stats = { ledgers: 0, quotes: 0, checked: 0, elided: 0, notApplicable: [] };

  /* 原著缓存：只去空白，保留间隔号 */
  const rawCache = new Map();
  const rawOf = (slug) => {
    if (rawCache.has(slug)) return rawCache.get(slug);
    const f = BOOK_TXT[slug];
    let t = null;
    if (f) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) t = fs.readFileSync(p, 'utf8').replace(/[\s　]/g, '');
    }
    rawCache.set(slug, t);
    return t;
  };

  /* 人物 id → 主名（每本书缓存一次） */
  const bookCache = new Map();
  const bookOf = (slug) => {
    if (bookCache.has(slug)) return bookCache.get(slug);
    const p = path.join(root, 'data', `${slug}.json`);
    let v = null;
    if (fs.existsSync(p)) {
      try { v = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { v = null; }
    }
    bookCache.set(slug, v);
    return v;
  };
  const nameOfId = (slug, id) => {
    const b = bookOf(slug);
    if (!b) return '';
    const c = (b.characters || []).find((x) => x.id === id);
    return c ? mainName(c.name) : '';
  };

  for (const spec of LEDGERS) {
    const lf = path.join(root, spec.rel);
    if (!fs.existsSync(lf)) continue;
    stats.ledgers++;

    let doc;
    try { doc = JSON.parse(fs.readFileSync(lf, 'utf8')); }
    catch (e) { problems.push(`${spec.rel}：JSON 解析失败 —— ${e.message}`); continue; }
    const list = Array.isArray(doc) ? doc : (Array.isArray(doc.明细) ? doc.明细 : null);
    if (!list) { problems.push(`${spec.rel}：既不是数组、也没有 \`明细\` 数组`); continue; }

    /* Q4：主语不是人的台账，本判据用不上 ⇒ 打印理由，不假装查过 */
    if (spec.kind !== 'person') {
      stats.notApplicable.push(spec.rel);
      notes.push(`⚠ ${spec.rel}：主语是**${spec.source}（事件 id）**，不是人名`
        + ` ⇒ 「引文点名主语」这条判据用不上，**本轮未判**（不是"没有问题"）。`);
      continue;
    }

    list.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object') return;
      const slug = entry.book || 'three-kingdoms';
      const raw = rawOf(slug);
      if (raw === null) {
        notes.push(`⚠ ${spec.rel}[${i}]（${slug}）：本机没有原著 txt ⇒ 该条**未判**`
          + `（CI 上恒如此，原著不进版本库）。`);
        return;
      }

      /* 主语清单：全部从数据查回来，不写死名字 */
      let subs = [];
      if (Array.isArray(entry.members)) subs = entry.members.map((id) => nameOfId(slug, id));
      else if (entry.name) subs = [entry.name];
      else if (entry.from || entry.to) subs = [entry.from, entry.to].map((id) => nameOfId(slug, id));
      subs = subs.filter(Boolean).map(mainName);
      if (!subs.length) {
        notes.push(`⚠ ${spec.rel}[${i}]（${slug}）：算不出主语 ⇒ 本条**未判**（不是"没有问题"）。`);
        return;
      }

      for (const q of [...String(entry.why || '').matchAll(/「([^」]+)」/g)].map((m) => m[1])) {
        stats.quotes++;
        if (isElided(q)) { stats.elided++; continue; }              /* Q2 */
        if (!namesSubject(q, subs)) continue;                          /* 不是在给主语作证 */
        stats.checked++;
        if (raw.includes(printed(q))) continue;                      /* Q1 过 */

        /* 报红：附上原文最接近的一段，让人一眼看出差在哪 */
        const core = [...q.matchAll(/[^，、。；：？！]{6,}/g)].map((m) => m[0])
          .sort((a, b) => b.length - a.length)[0] || q;
        const k = raw.indexOf(matchable(core));
        const near = k >= 0
          ? `\n      原文最近：「…${raw.slice(Math.max(0, k - 12), k + printed(core).length + 12)}…」`
          : '';
        problems.push(
          `Q1 ${spec.rel}[${i}]（${slug}）：引文点名了「${subs.join('、')}」，`
          + `但**不是印刷版逐字** —— 台账是「人回原著读过」的结论，引错字就没法复核。\n`
          + `      台账：「${q}」${near}`,
        );
      }
    });
  }

  notes.push(`台账 ${stats.ledgers} 份 · 「」共 ${stats.quotes} 条 · `
    + `点名主语须逐字 ${stats.checked} 条 · 节引（Q2 放过）${stats.elided} 条`);
  return { problems, notes, stats };
}

/* 入口判断用 pathToFileURL 规范化再比（与其余门禁同一写法）。
 * ⚠ 不得写成 `endsWith(process.argv[1])` —— 本仓库目录名带空格，空格是 %20 编码，
 *   两边永远不相等 ⇒ 主流程一次都不跑而退出码还是 0（「检查通过」其实是「检查没执行」）。 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { problems, notes, stats } = checkLedgerQuotes();
  for (const n of notes) console.log(`  ${n}`);
  if (!stats.checked && !stats.notApplicable.length) {
    console.log('\n⚠ 一条引文都没判 —— 原著不在本机。**这不是"没有问题"，是"没判"。**');
    console.log(`  ⇒ 需要 %TEMP%\\opencode\\ba-books\\ 下的三本 txt；CI 上恒如此。`);
  }
  if (problems.length) {
    console.error(`\n✗ 台账引文：${problems.length} 条不是印刷版逐字`);
    for (const p of problems) console.error(`   ${p}`);
    process.exit(1);
  }
  console.log('\n✓ 台账引文：点名主语的那些都是印刷版逐字');
}