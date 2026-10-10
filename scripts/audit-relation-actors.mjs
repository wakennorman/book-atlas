#!/usr/bin/env node
/**
 * 关系引文的「行为人审计」—— 找出**引文存在、但引文不支持这条关系**的那些边。
 *
 * 起因（v0.101，用户抓出）：
 *   「奥雷里亚诺·布恩迪亚上校 —师徒（唱歌）— 好汉弗朗西斯科」
 *   事件引文是真实的原文（「哼着好汉弗朗西斯科的老歌把家中…贴满了一比索的纸币」），
 *   但那句里的「他」指的是**奥雷里亚诺第二**，不是上校。
 *   ⇒ 引文对得上 ≠ 行为人对得上。我上一轮只做了"引文配对"，就当成了核实通过。
 *
 * 这道审计按**风险**分级，只把可疑的那些挑出来，而不是把两千多条全打印一遍：
 *
 *   A 级 · 代词无主    引文里有「他/她/其/此人」等代词，而引文里**没有**关系双方的名字
 *                      ⇒ 无法判断行为人是谁。**本次的错就在这一类**。
 *   B 级 · 第三方在场 引文里出现了数据中**另一个人物**的名字，且此人与一方有亲属关系
 *                      ⇒ 可能是把邻居的互动挂到了某人头上。
 *   C 级 · 引文查无此文 事件文字在原书里搜不到（含转述、改写、拼接）
 *                      ⇒ 证据等级存疑，需要人工看是不是把转述当引文。
 *   D 级 · 章号不符    事件标了章节，但引文实际出现在另一章（**尚未实现**，见文末「已知限制」）
 *
 * ⚠ 这是**审计**，不是断言器：A/B/C/D 都可能是误报（比如引文本来就用简称、
 *   代词指的是不在数据里的人、章号是章节序号而非原书章节）。
 *   所以默认**只出报告、退出码 0**；`--strict` 才让 A 级变成失败。
 *
 * 用法：
 *   node scripts/audit-relation-actors.mjs            # 出报告，退出 0
 *   node scripts/audit-relation-actors.mjs --strict   # A 级即失败
 *   node scripts/audit-relation-actors.mjs --context 200   # 上下文窗口字数
 *   node scripts/audit-relation-actors.mjs --strict-sources # 缺原著即失败（本机专属，CI 上不用）
 *
 * ## v0.179 的两处修正
 *
 * ① `looksVerbatim` 收紧成「引文 ≥2 字」。原先只要有「」就算逐字引文，于是
 *    「…替自己「挡」下这场乱伦」这种**单字强调**被当成引文，整句转述搜不到 ⇒ 假 C 级。
 *    全库实测只有 1 条是这种写法。
 * ② 原著路径收进 `scripts/lib/book-sources.mjs`（单一来源）。原先那张硬编码表把
 *    《百年孤独》指到了 `%TEMP%\opencode\epub.txt`，与其余脚本用的
 *    `ba-books\百年孤独.txt` **不是同一个文件**；而且缺原文时 C 级会**静默变成 0**。
 *    现在缺原文会在报告里单列一节写「B/C 未判」，不再伪装成"没问题"。
 *
 * ## v0.179 同时把它改成**可导入**
 *
 * 原先整个脚本是顶层副作用（读到哪、打印到哪）。`check-relation-actors-ledger.mjs`
 * 要拿同一套判据去核台账 ⇒ 判据必须能**在测试里跑**（照 v0.178 对 `audit-first-ch.mjs`
 * 的同一做法）。现在导出 `auditRelationActors()` / `renderReport()`，CLI 放在
 * `import.meta.url === pathToFileURL(process.argv[1])` 之后 ——
 * ⚠ 本仓库路径里带空格，不能用 `endsWith` 判断（会永远为假、主流程静默不跑）。
 *
 * ## 已知限制（如实记下来，别当成"没有"）
 *
 * · **D 级（章号不符）没实现。** 罪与罚的章号**无法机械核对**：原著按「部」重编号
 *   （每部都从第一章起），而数据里是顺序章号，两种口径在文件里还混用
 *   （`audit-first-ch.mjs` 把这本书标为 `unsupported` 也是同一个原因）。
 *   实测抽样 8 条对得上 2~3 条，但"对不上"里既有真错也有我的分章索引不准，
 *   分不清 ⇒ 宁可不做，也不报一片假红。要做先得有一份可靠的「罪与罚分章索引」。
 * · **A 级对"主名的一部分"会误报。** 例：事件文案写「费尔南达」，而角色的
 *   `name` 是「费尔南达·德尔·卡皮奥」、`aliases` 里也没登记这个简称
 *   ⇒ A 判据看不见它。**不能简单地按「·」切头**（《百年孤独》里一堆「奥雷里亚诺」，
 *   放宽会把「另一个人」当成当事人 —— 那正是 v0.101 那类错）。
 * · **B 级很粗，但粗得有用。** 家族关系边的事件里必然提到家人，所以 B 会成片报；
 *   而它**恰恰**是 v0.179 那条真错（玛尔美拉朵夫被当成生父）的发现路径。
 *   ⇒ 不"优化"掉它，而是把逐条读过的结论记进 `data/relation-actors-ok.json`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listBooks, listBooksIn } from './lib/data-files.mjs';
/* 原著文件名的**单一来源**（v0.179）。原先这里有一张硬编码的 SOURCES 表，
 * 且《百年孤独》指到了 `%TEMP%\opencode\epub.txt` —— 一个与 `ba-books/百年孤独.txt`
 * **不同**的抽取产物，而其余脚本用的都是后者。详见 lib 里的注释。 */
import { loadBookSource, missingSourceNote } from './lib/book-sources.mjs';
/* 亲子边部分用单一来源；下面「亲缘邻接」还要认 叔侄/兄弟/夫妻 等**非亲子**的家人边，
 * 所以是 `isParentChild(r) || 额外词`，不是自己再抄一份亲子正则。 */
import { isParentChild } from './kin-terms.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'reports', 'relation-actors.md');

/** 中文顿号/间隔号差异：布恩迪亚 / 布恩蒂亚 这类异译不该算"另一个人" */
const flat = (s) => String(s || '').replace(/[\s·・･]/g, '');

/**
 * 抽出这条事件里所有可能的"原文片段"，按长度从长到短。
 *
 * ⚠ 第一版只取**第一个**「」且要求 ≥4 字，于是
 *     「卢仁却连罗佳都不肯见，还在众人面前把索尼娅说成「女贼」」
 * 这种"引号里只有 2 个字"的事件全部匹配失败，回退去搜整句转述，
 * 而转述本来就搜不到原文 ⇒ C 级把 16 条全报成"证据不存在"。**纯 bug，不是数据问题。**
 *
 * 所以：把所有「」内容都收进来（不论长短），任一条能在原书里定位就算这条事件有原文支撑；
 * 最长的那条用来判断"引文里有没有把行为人写出来"。
 */
function quotesOf(text) {
  const s = String(text || '');
  const out = [...s.matchAll(/[「『]([^」』]+)[」』]/g)].map((m) => flat(m[1]));
  const whole = flat(s);
  out.push(whole);
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

/**
 * 这条事件是不是"**逐字引文**"？
 *
 * ⚠ 三本书的事件里，**绝大多数是转述**，不是原文句子：
 *     三国："桃园焚香结拜，誓同生死"
 *     罪与罚："母亲普尔赫莉雅从外省寄来长信：杜尼娅为了哥哥答应了卢仁的婚事…"
 *   这是既有的写法，不是不合格。**只有带「」的才当逐字引文。**
 *   第一版用"≥24 字"当判据 ⇒ 罪与罚 58 条"逐字引文"里有 49 条是转述，
 *   C 级全在报"证据不存在"，纯噪声。判据收紧到「」才看得出真问题。
 *
 * ⚠ v0.179 再收紧一格：引文必须 **≥2 字**。
 *   原先"只要有「」就算"，于是
 *     「阿尔卡蒂奥试图勾引皮拉尔·特内拉；她花钱请圣索菲亚·德拉·彼达替自己「挡」下这场乱伦。」
 *   这种**单字强调**（引号只是着重号，不是引用）被当成逐字引文，而整句转述在原书里
 *   当然搜不到 ⇒ 报成 C 级「查无此文」。全库实测只有这 1 条是这种写法，收紧的附带影响为零。
 */
function looksVerbatim(text) {
  return /[「『][^」』]{2,}[」』]/.test(String(text || ''));
}

const PRONOUN = /[他她其此人该]/;

/* 亲缘邻接还要认**非亲子**的家人边（B 级判"第三方与一方有亲属关系"用）。 */
const EXTRA_KIN = /叔侄|姑侄|舅甥|姨甥|祖孙|兄弟|姐妹|夫妻|父子|母子|父女|母女/;

/**
 * 跑一遍审计。
 *
 * @param {{root?:string, books?:string[], context?:number, dir?:string}} [opts]
 *   `root`   仓库根（默认本文件所在仓库）；给了它就从 `<root>/data` 取书单。
 *   `books`  显式指定书文件名（守卫测试用，优先于 root 推断）。
 *   `dir`    原著 txt 所在目录（默认 `%TEMP%\opencode\ba-books`，守卫测试可指到 tmp）。
 * @returns {{books:string[], stats:object, byFlag:object, rows:Array, srcInfo:object,
 *            missingSrc:Array, context:number}}
 *   ⚠ `missingSrc` 非空表示 **B 级与 C 级没判**，不是"没有"。
 */
export function auditRelationActors(opts = {}) {
  const root = opts.root ?? ROOT;
  const CTX = opts.context ?? 160;
  const bookFiles = opts.books ?? (opts.root ? listBooksIn(path.join(root, 'data')) : listBooks());

  const rows = [];
  const stats = {};
  /** slug → { slug, path, text }（text 为 null 表示**没判**，不是"没问题"）。 */
  const srcInfo = {};

  for (const bf of bookFiles) {
    const slug = bf.replace(/\.json$/, '');
    const info = loadBookSource(slug, opts.dir);
    srcInfo[slug] = info;
    const src = info.text;
    const book = JSON.parse(fs.readFileSync(path.join(root, 'data', bf), 'utf8'));
    const byId = new Map((book.characters || []).map((c) => [c.id, c]));
    const nm = (id) => byId.get(id)?.name ?? id;
    const allNames = (book.characters || []).map((c) => ({ id: c.id, name: c.name, flat: flat(c.name) }))
      .filter((x) => x.flat.length >= 2);

    /* 亲缘邻接：用于 B 级判定"第三方与一方有关系" */
    const kinAdj = new Map();
    for (const r of book.relations || []) {
      if (!isParentChild(r) && !EXTRA_KIN.test(String(r.type || '').replace(/[（(].*$/, ''))) continue;
      if (!kinAdj.has(r.from)) kinAdj.set(r.from, new Set());
      if (!kinAdj.has(r.to)) kinAdj.set(r.to, new Set());
      kinAdj.get(r.from).add(r.to);
      kinAdj.get(r.to).add(r.from);
    }

    /**
     * 一个人物在引文里可能以**全名、简称、别名、称号**出现。
     * 数据里 `name` 是全名（罗季昂·罗曼内奇·拉斯柯尔尼科夫），
     * 而事件文案里写的是简称（罗佳）—— 只比全名会把 12 条全误判成"代词无主"。
     */
    const namesOf = (id) => {
      const c = byId.get(id);
      if (!c) return [];
      return [c.name, ...(c.aliases ?? []), ...(c.altNames ?? [])]
        .map(flat).filter((x) => x.length >= 2);
    };

    let n = 0;
    let vCount = 0;
    for (const rel of book.relations || []) {
      const aliasA = namesOf(rel.from), aliasB = namesOf(rel.to);
      const mentions = (text, list) => list.some((x) => text.includes(x));
      for (const [evIndex, ev] of (rel.events || []).entries()) {
        if (ev.derived || /由.*推导/.test(String(ev.text || ''))) continue;   // 推导边不算引文
        const qs = quotesOf(ev.text);
        const q = qs[0];
        if (!q) continue;
        n++;
        const verbatim = looksVerbatim(ev.text);
        if (verbatim) vCount++;
        const flags = [];
        /* 任一候选片段能在原书里定位，就算这条事件有原文支撑 */
        let pos = -1;
        let hitQ = '';
        if (src) {
          for (const cand of qs) {
            if (cand.length < 2) continue;
            const p = src.indexOf(cand.slice(0, Math.min(40, cand.length)));
            if (p >= 0) { pos = p; hitQ = cand; break; }
          }
        }
        /* C 只对逐字引文判：转述本来就搜不到原文 */
        if (verbatim && src && pos < 0) flags.push('C');
        /* A：只在引文**一个当事人名字都没提**时才算"代词无主"。
         *   ⚠ 第一版要求"没有同时出现两个名字"就报 ⇒ 35 条里绝大多数是误报：
         *      「他第一次走进索尼娅的屋子，请她读《拉撒路复活》」——「他」就是关系的一方（罗佳），
         *      这是中文里最正常的写法，不是歧义。
         *      真正危险的只有"引文里连一个当事人名字都没有，光靠代词"。 */
        const longest = qs.find((x) => x.length >= 12) ?? q;
        const namesAny = mentions(longest, aliasA) || mentions(longest, aliasB);
        if (verbatim && PRONOUN.test(longest) && !namesAny) flags.push('A');
        /* B 级：引文里的第三方人物，且与某一方有亲属关系。
         *   ⚠ 第一版用 `includes` 做子串匹配 ⇒ 「阿尔卡蒂奥」被当成了第三方，
         *      而它只是「何塞·阿尔卡蒂奥（第二代）」的**子串**，8 条 B 全是这么来的。
         *   排除规则：第三方名字若与任一当事人的名字**互为子串**，就不算另一个人 ——
         *   中文人名大量共姓共名，不排除必然误报。 */
        const base = { book: slug, rel, evIndex, ev, q, A: nm(rel.from), B: nm(rel.to) };
        if (pos >= 0) {
          const ctx = src.slice(Math.max(0, pos - CTX), pos + hitQ.length + CTX);
          const partySet = [...aliasA, ...aliasB];
          const isSubstrOfParty = (s) => partySet.some((p) => p.includes(s) || s.includes(p));
          const thirds = allNames.filter((x) => x.id !== rel.from && x.id !== rel.to
            && longest.includes(x.flat) && !isSubstrOfParty(x.flat)
            && (kinAdj.get(rel.from)?.has(x.id) || kinAdj.get(rel.to)?.has(x.id)));
          if (thirds.length) flags.push('B');
          if (flags.length) rows.push({ ...base, flags, ctx, thirds });
        } else if (flags.length) {
          rows.push({ ...base, flags, ctx: null, thirds: [] });
        }
      }
    }
    stats[slug] = { events: n, verbatim: vCount, chars: (book.characters || []).length, rels: (book.relations || []).length };
  }

  const byFlag = { A: [], B: [], C: [] };
  for (const r of rows) for (const f of r.flags) byFlag[f].push(r);
  const missingSrc = Object.values(srcInfo).filter((i) => !i.text);
  return { books: bookFiles, stats, byFlag, rows, srcInfo, missingSrc, context: CTX };
}

/** 生成 markdown 报告正文（不含任何 IO）。 */
export function renderReport(res) {
  const L = [];
  L.push('# 关系引文的「行为人」审计');
  L.push('');
  L.push('> 由 `scripts/audit-relation-actors.mjs` 生成。起因是 v0.101 用户抓出一条**引文真实、行为人挂错**的关系');
  L.push('> （把「奥雷里亚诺第二哼着好汉弗朗西斯科的歌」挂到了上校名下）。');
  L.push('>');
  L.push('> **引文存在 ≠ 引文支持这条关系。** 这是本审计要抓的东西。');
  L.push('');
  L.push('分级：**A** 代词无主（引文里有「他/她/其」而没有双方名字，行为人无法判定）｜**B** 第三方在场（引文里有另一个**与一方有亲属关系**的人物，可能挂错人）｜**C** 查无此文（事件文字在原书里搜不到）。');
  L.push('');
  L.push('⚠ A/B/C 都可能是误报：引文本来就用简称、代词指的是不在数据里的人、章号是章节序号而非原书章节。**这一份是给人看的，不是判决。**');
  L.push('');
  L.push('⚠ 逐条读过的结论记在 `data/relation-actors-ok.json`，由 `scripts/check-relation-actors-ledger.mjs` 守着：');
  L.push('**新冒出来的 A/B/C 必须回原著读过并登记**，否则门禁报红。');
  L.push('');
  for (const [slug, s] of Object.entries(res.stats)) {
    L.push(`- \`${slug}\`：引文事件 ${s.events} 条 / 关系 ${s.rels} / 人物 ${s.chars}`);
  }
  L.push('');
  /* ⚠ 必须把"没判"说成"没判"。C 级判据是 `verbatim && src && pos < 0` ——
   *   src 为 null 时整条不判，报告上的 0 会被读成"没有"。 */
  if (res.missingSrc.length) {
    L.push(`## ⚠ 原文可用性　${res.missingSrc.length} 本缺原著 ⇒ B/C **未判**`);
    L.push('');
    L.push('**下面 B 级与 C 级的条数不含这些书** —— 它们不是"没有"，是"没判"。');
    L.push('');
    for (const m of res.missingSrc) L.push(`- ${missingSourceNote(m)}`);
    L.push('');
  }
  for (const f of ['A', 'B', 'C']) {
    L.push(`## ${f} 级　${res.byFlag[f].length} 条`);
    L.push('');
    if (!res.byFlag[f].length) { L.push('_（无）_'); L.push(''); continue; }
    for (const r of res.byFlag[f]) {
      L.push(`### \`${r.book}\`　${r.A} —${r.rel.type}— ${r.B}`);
      L.push('');
      L.push(`- 事件：${String(r.ev.text).slice(0, 200)}`);
      if (r.thirds?.length) L.push(`- ⚠ 引文里另有与一方有亲属关系的人物：${r.thirds.map((x) => x.name).join('、')}`);
      if (r.ctx) {
        L.push('');
        L.push('原文上下文：');
        L.push('');
        L.push('```');
        L.push(r.ctx);
        L.push('```');
      }
      L.push('');
    }
  }
  return L.join('\n');
}

/* ── CLI ─────────────────────────────────────────────────────────────
 * ⚠ 本仓库路径里**带空格**，所以必须用 `pathToFileURL` 比 href ——
 *   写成 `process.argv[1].endsWith(...)` 会永远为假，主流程静默不跑、退出 0。 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2);
  const STRICT = argv.includes('--strict');
  /* `--strict-sources`：缺原著就失败。**不进 CI** —— CI 上没有原著 txt
   * （不在版本库里），拿它当门禁会天天红。这是给本机用的。 */
  const STRICT_SOURCES = argv.includes('--strict-sources');
  const ci = argv.indexOf('--context');
  const ctx = ci >= 0 ? Number(argv[ci + 1]) || 160 : 160;

  const res = auditRelationActors({ context: ctx });
  const { stats, byFlag, missingSrc } = res;
  const risky = res.rows.filter((r) => r.flags.includes('A') || r.flags.includes('B'));

  console.log('关系引文 · 行为人审计\n');
  for (const [slug, s] of Object.entries(stats)) {
    const info = res.srcInfo[slug];
    console.log(`  ${slug.padEnd(30)} 事件 ${String(s.events).padStart(5)} 条（其中逐字引文 ${String(s.verbatim).padStart(4)}）`
      + ` / 关系 ${s.rels} / 人物 ${s.chars}`
      + (info.text ? '' : '   ' + missingSourceNote(info)));
  }
  console.log(`\n  A 代词无主 ${byFlag.A.length}　B 第三方在场 ${byFlag.B.length}　C 查无此文 ${byFlag.C.length}`);
  console.log(`  高风险（A 或 B）${risky.length} 条`);
  for (const [slug] of Object.entries(stats)) {
    const a = byFlag.A.filter((r) => r.book === slug).length;
    const b = byFlag.B.filter((r) => r.book === slug).length;
    const c = byFlag.C.filter((r) => r.book === slug).length;
    if (a || b || c) console.log(`    ${slug.padEnd(30)} A ${a}　B ${b}　C ${c}`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, renderReport(res), 'utf8');
  console.log(`\n报告 → ${path.relative(ROOT, OUT)}`);

  /* ⚠ 缺原文必须说出来：C 级（查无此文）与 B 级（第三方在场）都依赖 `src`，
   *   少了它这两个数会变成 0 —— 那看起来像"更干净"，实际是**没判**。 */
  if (missingSrc.length) {
    console.log(`\n⚠ ${missingSrc.length} 本书缺原著文本 ⇒ B 级与 C 级**本次未判**，上面的 0 不代表"没有"：`);
    for (const m of missingSrc) console.log(`    · ${missingSourceNote(m)}`);
  }

  if (STRICT && byFlag.A.length) {
    console.log(`\n✗ --strict：A 级 ${byFlag.A.length} 条未处理`);
    process.exit(1);
  }
  if (STRICT_SOURCES && missingSrc.length) {
    console.log(`\n✗ --strict-sources：${missingSrc.length} 本书缺原著文本（本机专属检查，CI 上不用）`);
    process.exit(1);
  }
}
