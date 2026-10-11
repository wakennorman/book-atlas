#!/usr/bin/env node
/**
 * 对着**原著正文**核一遍人物/地点/名字（规程 §零 第③步的工具）
 *
 * `audit-search.mjs` 扫的是本项目自己的文案（事件、关系小事件、人物档案）——
 * 也就是说它只能发现"**我们自己写的字里**提到了谁"，看不到原著正文里提到谁。
 * 所以它查不出用户已经抓到的那类缺口：
 * 「布鲁诺·克雷斯皮和安帕萝·摩斯科特结了婚」这种只出现在原著里、
 * 我们压根没收录的人，audit-search 永远看不到。
 *
 * 这个脚本补的就是这一环：拿原著正文（`scripts/extract-epub.mjs` 抽出来的 txt）
 * 对着数据核一遍，输出**缺口清单 + 出现次数 + 首现行原文片段**，供人工逐条确认。
 *
 * 用法：
 *   node scripts/audit-against-text.mjs data/one-hundred-years-of-solitude.json 原文.txt
 *   node scripts/audit-against-text.mjs --all .text/            # 目录里每本书的同名 .txt
 *   … --min 3            # 只报出现 ≥3 次的（默认 2）
 *   … --top 0            # 全列（默认只显示前 60 条；⚠ ≤0 = 不截断）
 *   … --json             # 机器可读（给后续批处理用）
 *
 * ## ⚠ 报告里的"待判候选 N 条"才是缺口规模，不是"本页显示了几条"（v0.189）
 *
 * 老实现把 `slice(0, topN)` 之后的窗口条数当"扫出 N 个疑似漏人"印出来 ——
 * 《百年孤独》真实待判 280 条却印「5 个」，《罪与罚》708 条印「16 个」。
 * 于是"把清单判干净"在工具上永远做不到（判掉几条、窗口滑一格、又顶上来一批）。
 * 判据链现在按"先质量筛、后显示截断"排，两个数**分开报**（见 lib 文件头）。
 * 顺带修掉 `--top 0`：老写法是 `Number(x || 60)` 直接 `slice`，所以 `--top 0`
 * 会**一条都不显示** —— 想看全反而什么都看不到。
 *
 * ## ⚠ 这条规则在**译本**上判别力很低
 *
 * 见 `scripts/lib/against-text.mjs` 文件头的实测数据。译本请以 `--names` 为主。
 *
 * ## 所以有**两条**规则，报告分两节（v0.190）
 *
 *   规则一（姓氏+1~2 字）—— 中文姓名模型，只在中文原著上成立；
 *   规则二（**间隔号**全名）—— 译本那条线，找 `名·父名·姓`，在中文原著上应当报 0。
 *
 * 起因：用户拿《百年孤独》第 16/17 章那段问"乌尔苏拉的母亲佩德罗妮拉·伊瓜兰
 * 为什么没加进去"—— 她的外祖母、父亲、表兄、曾外祖父**全在建档**，唯独母亲不在。
 * 原因是规则一锚在"首字＝姓"上，而 `佩德罗妮拉·伊瓜兰` 的首字「佩」不是百家姓，
 * 唯一锚得上的 `伊瓜兰` 又恰好是已知名 `乌尔苏拉·伊瓜兰` 的子串。
 * 两条规则**必须分开报**：它们对"什么算候选"的定义不同，判的标准也不同。
 *
 * 为什么要有 `--known-missing` 忽略名单：
 *   缺口清单会**反复**跑。人工确认过"这个确实是噪声/确实不必建档"的名字，
 *   写进 data/<slug>.missing-ok.json，下次就不会再冒出来 ——
 *   否则每次跑都要重新判一遍同样的 200 条，工具很快就会被弃用。
 */
import fs from 'node:fs';
import path from 'node:path';
/* 「只含正文」的切分（v0.184）。那份原著 txt 是毛宗岗评点本，混着评点/音注/编者附录；
 * 缺口检测只该在**正文**上跑（详见 main-text.mjs 的文件头，⚠ 那里也写了为什么不能设成全局默认）。 */
import { mainTextOnly, extractChapters as chaptersOf } from './lib/main-text.mjs';
/* 判据本体（候选扫描 / 门槛 / 台账扣除 / 粗筛 / 截断 / 渲染）在 lib 里，**纯函数**。
 * ⚠ v0.189 之前它内联在本文件里，于是"报的数"和"算的数"悄悄分了家（见 lib 文件头）。
 * 抽出来还有第二个好处：`test/against-text-guard.mjs` 能直接 import 判据断言 ——
 * 原著 txt 不在仓库里，这条链**没法**做成跑 CLI 的门禁（本机也起不了子进程）。 */
import { buildGapReport, renderGapReport, buildInterpReport, renderInterpReport, plain, MIN, TOP_N, NEAR } from './lib/against-text.mjs';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const minIdx = argv.indexOf('--min');
const MIN_ARG = minIdx >= 0 ? Number(argv[minIdx + 1] || MIN) : MIN;
/* ⚠ `--top 0` = 不截断（全列）。老实现是 `Number(argv[i+1] || 60)` 直接 `slice(0, topN)`，
 *   所以 `--top 0` 会**一条都不显示** —— 想看全反而什么都看不到。 */
const topIdx = argv.indexOf('--top');
const topN = topIdx >= 0 ? Number(argv[topIdx + 1] || TOP_N) : TOP_N;
const all = argv.includes('--all');
const textDirIdx = argv.indexOf('--all');
const dir = textDirIdx >= 0 ? argv[textDirIdx + 1] || '.text' : '';
/* ⚠ 默认**只扫正文**（v0.184）。`--with-appendix` 退回「整份 txt 全扫」。
 *
 * 那份原著 txt 是**毛宗岗评点本**，混着四类东西：正文 / 评点 / 音注 / **编者附录**。
 * 附录里有 `山东省`（古今地名对照表）、`毛本`（版本分析）、`陈寿`（参考书目）、
 * `罗贯中`（作者介绍）—— 它们**不是这本书登场的人物**，却被当成缺口候选报出来。
 *
 * ⚠ **不能把它设成全局默认**：台账引文核验必须能搜到**评点** ——
 *   v0.181 的张温证据「同时有两张温。此一张温，乃汉张温也」就是毛宗岗评点，
 *   而且是最硬的依据（原著自己承认是两个人）。所以这是**缺口检测这一个用途**的口径。
 *
 * ⚠ 进度/说明一律走 **stderr**：`--json` 的消费者要 `JSON.parse(stdout)`，
 *   往 stdout 打一行提示就会让它崩（v0.184 当场踩到：`JSON.parse` 报
 *   「Unexpected token '（'」—— 而报错本身完全看不出是哪一行污染的）。
 */
const WITH_APPENDIX = argv.includes('--with-appendix');


function audit(bookFile, textFile) {
  const book = JSON.parse(fs.readFileSync(bookFile, 'utf8'));
  const fullRaw = plain(fs.readFileSync(textFile, 'utf8'));
  /* v0.184：默认切掉评点与附录，只留 120 回正文。切不出回（别的书没有回目标题）⇒ 原样用全文。 */
  let raw = fullRaw;
  if (!WITH_APPENDIX) {
    const cut = mainTextOnly(fullRaw);
    if (cut) {
      raw = cut;
      const a = fullRaw.replace(/[\s·・･　]/g, '').length;
      const b = cut.replace(/[\s·・･　]/g, '').length;
      const nCh = chaptersOf(fullRaw).stats.chapters;
      console.error(`  （只扫正文：${nCh} 回，去掉 ${a - b} 字非正文 `
        + `＝${(((a - b) / a) * 100).toFixed(1)}%；加 --with-appendix 可扫全本）`);
    } else {
      console.error(`  （本书正文切不出回目标题 ⇒ 按全本扫）`);
    }
  }
  const okFile = bookFile.replace(/\.json$/, '.missing-ok.json');
  /* 忽略名单有两种条目，纯字符串和 {name, why} 对象都收。
   *
   * ⚠ 为什么必须两种都收（v0.97 踩过）：文件里原本 272 条是纯字符串，
   *   我往里加 21 条 {name, why}（带判定理由，因为规程要求名单可审计），
   *   结果 `new Set(数组)` 装进去的是**对象**，`okSet.has('齐美尔')` 永远 false
   *   —— 名单看着写了、实际一条都不生效，工具照旧报那 21 条。
   *   而"没生效的忽略名单"比"没有名单"更坏：它让人以为已经判过了。
   *
   * ⚠ `_` 开头的是文件头的说明（收集规则与红线），不是名字，要跳过，
   *   否则它们会混进名字集合，将来报告里出现莫名其妙的行。
   */
  const okRaw = fs.existsSync(okFile) ? JSON.parse(fs.readFileSync(okFile, 'utf8')) : [];
  const okSet = new Set(okRaw
    .map((e) => (typeof e === 'string' ? e : (e && e.name)))
    .filter((n) => typeof n === 'string' && n && !n.startsWith('_')));

  const chars = book.characters || [];
  const places = book.places || [];

  /* 已知名字（长名优先，避免「何塞」把「何塞·阿尔卡蒂奥」先吃掉）。
   * ⚠ 排序在**这里**做（lib 内部还会再去重/排序一遍，不影响结果）——
   *   掩码是"逐个 replace"，短名先替换会把长名切碎。 */
  const names = [];
  for (const c of chars) for (const n of [c.name, ...(c.aliases || []), ...(c.altNames || [])]) if (n && n.length >= 2) names.push(n);
  for (const p of places) for (const n of [p.name, ...(p.aliases || [])]) if (n && n.length >= 2) names.push(n);
  names.sort((a, b) => b.length - a.length);

  const report = buildGapReport({ raw, names, okSet, min: MIN_ARG, near: NEAR, topN });
  /* 规则二（v0.190）：译本那条线 —— 找带**间隔号**的全名。
   * ⚠ 必须吃 `raw`（保留 `·`）。`scripts/lib/book-sources.mjs` 的 `flatSource()`
   *   会把间隔号一起删掉，用它就等于把这条规则的锚点先毁了。 */
  const interp = buildInterpReport({ raw, names, okSet, min: MIN_ARG, topN });
  return {
    slug: (book.meta || {}).slug || path.basename(bookFile, '.json'),
    report,
    interp,
    okLabel: okFile,
    /* 老字段名保留（`--json` 的消费者用 `rows`/`total`），但 `total` 现在指**待判总数**。
     * ⚠ v0.189 之前 `total` 是"已知名字个数"、`rows.length` 是截断后的窗口数，
     *   报告把后者当缺口总数印出来（280 → 印 5）。两个字段的语义都改了。 */
    total: report.total,
    rows: report.rows,
  };
}

/* ---------- v0.97 新增：每个人物在原文里能不能被搜到 ---------- */
/**
 * 查「数据里的人名，原文里那个写法搜不搜得到」。
 *
 * 为什么必须单独一个模式（不并进 audit）：audit 找的是**漏人**
 * （书里出现了、数据里没有），这个查的是**反过来**那一种 ——
 * 数据里有这个人，但书上的写法一个都不命中，读者拿着书里的名字点不进来。
 * 后者更阴险：人数对得上、门禁全绿，只有真人对着书找人才会发现。
 *
 * 《百年孤独》上真实踩到 7 个（每一处都是"读起来完全合理"的错）：
 *   数据「维克多里奥·麦丁纳」   / 原文「维多利奥·梅迪纳」   别名「维多里奥」连字都对不上
 *   数据「尼格罗曼妲」旧作「尼格罗曼塔」/ 原文「尼格罗曼妲」  旧别名「尼格罗·曼塔」0 次
 *   数据「加布里埃尔」/ 原文「加布列尔」/ 旧别名「加夫列尔」0 次
 *   数据「阿方索」/ 原文「阿尔丰索」
 *   数据「皮拉尔·特内拉」/ 原文「庇拉尔·特尔内拉」/ 旧别名「皮拉·苔列娜」0 次
 *   数据「特兰奇丽娜·玛丽亚…」/ 原文「特兰奇丽娜·玛利亚…」一字之差
 *   数据「…雷伊纳神父」/ 原文「…雷伊纳神甫」
 *
 * ⚠ 这类错**在版本库里查不出来**：原著文本不在仓库里（extract-epub.mjs 注明了），
 *   所以做不成 CI 门禁，只能做成"拿到 epub 就能跑"的独立检查，
 *   并写进 docs/新书处理规程.md 的必做步骤。
 *
 * 「主名不在原文、但某个别名在」是**正常的译名差异**，不算错，
 * 单独列出来让人一眼看见，不混进 dead 列表。
 */
function checkNames(bookFile, textFile) {
  const book = JSON.parse(fs.readFileSync(bookFile, 'utf8'));
  const raw = plain(fs.readFileSync(textFile, 'utf8'));
  const slug = (book.meta || {}).slug || path.basename(bookFile, '.json');
  /* 去掉「（第二代）」这类括注：那是给读者消歧的标记，原文里当然不会有 */
  const bare = (n) => String(n || '').replace(/（[^）]*）/g, '').trim();
  /* 「主名不是原书原样字」的申报名单（v0.97）。
   *
   * 为什么需要它 —— 中文史传体写「姓娄名子伯」「其父名河」「其叔玄」，
   * **全名从不连着出现**；加上演义里有一批人从头到尾没被点名
   * （陶谦的两个儿子只叫「二子」、管辂的舅父只叫「舅」）。
   * 所以"主名必须逐字出现在原文"这条规矩对它们**永远不成立**，
   * 而一条永远不成立的规矩等于没有规矩 —— 只会让人学会无视它。
   *
   * 口径改成：**每个人物要么在原文里逐字出现，要么在这份名单里写明理由。**
   * 和 missing-ok.json 同一个纪律：只申报"确实如此"，
   * 不许把"还没查清楚"塞进来。名单里没写的人物，照样当错误报。 */
  const okFile = bookFile.replace(/\.json$/, '.name-form-ok.json');
  const okJson = fs.existsSync(okFile) ? JSON.parse(fs.readFileSync(okFile, 'utf8')) : [];
  /* ⚠ 名单文件两种形状都要收：纯数组，或者 `{_说明…, 明细:[...]}`。
   *   我第一版只写死了数组形状，结果脚本对着 `{明细:…}` 直接
   *   `okRaw.filter is not a function` 崩掉 —— 而崩掉的红和"检查不通过"的红
   *   在门禁里长得一样，都是 exit=1，极容易误判成"名单没生效"。 */
  const okList = Array.isArray(okJson) ? okJson : (Array.isArray(okJson.明细) ? okJson.明细 : []);
  const declared = new Map(okList
    .filter((e) => e && typeof e === 'object' && !String(e.name || '').startsWith('_'))
    .map((e) => [String(e.name), String(e.why || '')]));
  const rows = [];
  for (const c of book.characters || []) {
    const forms = [...new Set([c.name, ...(c.aliases || []), ...(c.altNames || [])].map(bare))]
      .filter((s) => s.length >= 2);
    const hits = [];
    for (const f of forms) { const n = raw.split(f).length - 1; if (n > 0) hits.push([f, n]); }
    rows.push({
      name: c.name, hits, alt: (c.altNames || []).length, id: c.id, title: c.title || '',
      declared: declared.get(c.name) || '',
    });
  }

  /* v0.97：对"一个形式都命中不到"的人物给**分诊**，否则这份清单没法处理。
   *
   * 为什么必须分诊：实测四种成因的处理方式完全相反 ——
   *   ① 异体字（车胄/车冑、傅彤/傅肜、梁刚/梁纲）⇒ 改名，读者就能搜到
   *   ② 只以身份出现（卓母、佗之妻、曹爽从弟文叔之妻）⇒ 拿书里的说法当别名
   *   ③ 只有一字可用（"父名冏"）⇒ 单字过不了搜索门槛，得给可读的主名 + 别名
   *   ④ 名字只存在于史书、演义根本没写 ⇒ 按规程"从原著出发"应当**删掉**
   * 而单看"0 命中"这四个字，①②③④ 长得一模一样。
   *
   * 判据（都是机械可算的）：
   *   · 逐字命中 —— 哪个字在原文里出现过。异体字通常只错一个字。
   *   · 官职/身份命中 —— title 在原文里出现 ⇒ 人一定在，只是没被点名。
   *   · 共姓命中数 + 样例 —— 共姓很多却全名没有，通常是"演义里是另一个人"。
   */
  const ctxOf = (needle, n = 3) => {
    /* ⚠ 只取**像人名**的上下文：姓氏后面紧跟 1–2 个字才算。
     *   第一版直接取任意位置，于是「陶」给的样本是回目标题「陶恭祖三让徐州」
     *   和「谏议大夫刘陶」—— 全是噪声，看完还是不知道这个人在不在。 */
    const out = [];
    let i = -1;
    while ((i = raw.indexOf(needle, i + 1)) >= 0 && out.length < n) {
      const seg = raw.slice(i, i + needle.length + 3).replace(/\s+/g, '');
      /* ⚠⚠ 这里必须是**显式**的码位范围，不能图省事写 `/^[一龥]{2,3}/`。
     字符类里两个汉字连写会被解析成**范围**（U+4E00–U+9FA5），本意虽通、行为却和
     写法不符，改的人根本看不出来；而且实测它对「陶恭祖三」返回 false，
     于是"像人名的用法"一栏永远为空 —— 静默失效最难查。 */
      if (/^[一-鿿]{2,3}/.test(seg)) out.push(raw.slice(Math.max(0, i - 14), i + needle.length + 16).replace(/\s+/g, ' '));
    }
    return out;
  };
  const triage = (r) => {
    const nm = bare(r.name);
    const chars = [...new Set(nm.replace(/[（）()之]/g, ''))];
    const perChar = chars.map((ch) => [ch, raw.split(ch).length - 1]);
    /* ⚠ 这里存的是 title 的**字符串**，不是布尔值 —— 第一版存了 boolean，
     *   输出变成「官职「true」在原文里出现过」，等于没说。 */
    const titleHit = (r.title && r.title.length >= 2 && raw.includes(r.title)) ? r.title : '';
    const surname = nm[0] || '';
    const surnameN = surname ? raw.split(surname).length - 1 : 0;
    const missChars = perChar.filter(([, n]) => n === 0).map(([ch]) => ch);
    /* 四类成因，处理方式完全相反，所以要分开：
     *   A 有字命中不到 ⇒ **异体字/错字**方向，先查那几个 0 命中字的写法
     *   B 字全命中、整名没有 ⇒ 这个组合原文里没有（可能是错字，也可能书里根本没这个人）
     *   C title 命中 ⇒ 人一定在，只是没被点名（只以官职/身份出现）
     *   D 字全 0 ⇒ 只存在于史书，按规程应删或注明 */
    let kind = 'B';
    if (missChars.length) kind = 'A';
    else if (titleHit) kind = 'C';
    if (perChar.every(([, n]) => n === 0)) kind = 'D';
    return { id: r.id, name: r.name, title: r.title, titleHit, perChar, missChars, surname, surnameN, kind, samples: surnameN > 0 ? ctxOf(surname, 3) : [] };
  };

  return {
    slug,
    total: rows.length,
    declared: rows.filter((r) => r.declared),
    dead: rows.filter((r) => !r.hits.length && !r.declared),
    offName: rows.filter((r) => r.hits.length && !r.declared && !r.hits.some(([f]) => f === bare(r.name))),
    triage: rows.filter((r) => !r.hits.length).map(triage),
  };
}

/* ---------- 主流程 ---------- */
const nameMode = argv.includes('--names');
const pairs = [];
if (all) {
  const dataDir = path.join(process.cwd(), 'data');
  const idx = JSON.parse(fs.readFileSync(path.join(dataDir, 'books.json'), 'utf8'));
  for (const b of idx.books || []) {
    const bf = path.join(dataDir, `${b.slug}.json`);
    const tf = path.join(dir, `${b.slug}.txt`);
    if (fs.existsSync(bf) && fs.existsSync(tf)) pairs.push([bf, tf]);
    else console.error(`  (跳过 ${b.slug}：${fs.existsSync(bf) ? '缺 ' + tf : '缺 ' + bf})`);
  }
} else {
  const pos = argv.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a) && a !== dir);
  if (pos.length < 2) {
    console.error('用法：node scripts/audit-against-text.mjs data/xx.json 原文.txt [--min N] [--json]');
    console.error('  或：node scripts/audit-against-text.mjs --all .text/   # 每本书配 data/<slug>.txt');
    console.error('  加 --names 改成查「已建档的人名在原文里搜不搜得到」：');
    console.error('    node scripts/audit-against-text.mjs --all .text/ --names');
    process.exit(1);
  }
  pairs.push([pos[0], pos[1]]);
}

if (nameMode) {
  const strict = argv.includes('--strict');
  const rep = pairs.map(([bf, tf]) => checkNames(bf, tf));
  if (asJson) { console.log(JSON.stringify(rep, null, 1)); process.exit(0); }
  for (const r of rep) {
    console.log(`\n=== ${r.slug}（--names：原文里能不能搜到）===`);
    console.log(`  共 ${r.total} 个人物；书里那个写法一个都不命中的 ${r.dead.length} 个`);
    console.log(`  主名不是本书用字、靠别名才搜得到的 ${r.offName.length} 个`
      + (strict ? '（--strict：这是错误）' : '（这是正常的译名差异，不算错）'));
    console.log(`  已申报"主名不可能是原书原样字"的 ${r.declared.length} 个`
      + '（依据见 ' + r.slug.replace(/\.json$/, '') + '.name-form-ok.json）\n');
    for (const d of r.dead) {
      console.log(`  ✗ 搜不到：${d.name}`);
      const t = (r.triage || []).find((x) => x.id === d.id);
      if (t) {
        console.log(`      逐字命中：${t.perChar.map(([ch, n]) => `${ch}=${n}`).join(' ')}`);
        if (t.titleHit) console.log(`      ★ 官职「${t.titleHit}」在原文里出现过`);
        console.log(`      共姓「${t.surname}」原文 ${t.surnameN} 次`);
        t.samples.forEach((s) => console.log(`        像人名的用法：…${s}…`));
        if (t.kind === 'A') {
          console.log(`      ⇒ **A 异体字/错字**：这些字在原文里一次都没有 —— ${t.missChars.join('、')}；`
            + '先查它们的写法（胄/冑、彤/肜、刚/纲 这类），改主名或补别名即可');
        } else if (t.kind === 'C') {
          console.log('      ⇒ **C 只以身份出现**：书里没有这个名字，但官职能对上。'
            + '拿书里的说法当别名（卓母、佗之妻、「曹爽从弟文叔之妻」这种）');
        } else if (t.kind === 'D') {
          console.log('      ⇒ **D 只存在于史书**：名字的每个字原文里都没有。'
            + '按规程「从原著出发」，演义没写的人应当删掉，或注明出自史书');
        } else {
          console.log('      ⇒ **B 组合不存在**：每个字都在，但这个组合原文里没有 —— '
            + '要么写错了字/顺序，要么书里根本没点名。逐个核；'
            + '共姓很多时尤其要怀疑「演义里是另一个人」（如 钟毓 vs 钟繇、公孙晃 vs 公孙渊）');
        }
      }
    }
    for (const o of r.offName) {
      console.log(`  ${strict ? '✗' : '·'} ${o.name}  →  原文用的是「${o.hits.map(([f, n]) => `${f}（${n} 次）`).join('、')}」`);
    }
    if (r.declared.length) {
      console.log('  ── 以下已申报，不再当错误（每条都有理由，可点开名单文件核对）──');
      for (const d of r.declared) {
        const brief = d.declared.length > 62 ? d.declared.slice(0, 62) + '…' : d.declared;
        console.log(`  · ${d.name}：${brief}`);
      }
    }
  }
  /* 有搜不到的人就非零退出：这样它能当手动门禁用（"修完再跑一次"），
   * 也能挂进任何拿到 epub 的本地流程。 */
  if (rep.some((r) => r.dead.length)) {
    console.error('\n✗ 有已建档的人物在原文里搜不到 —— 名字写错了，或别名漏了书上的写法。');
    process.exit(1);
  }
  /* --strict：主名也必须是本书用字。
   *
   * 为什么加这个：用户 2026-10-04 明确"人名一律按他发的那本书的版本定"。
   * 而"主名不是本书用字、靠别名才搜得到"这种状态**功能上不算坏**（能搜到），
   * 所以默认只提示、放过 —— 但它正是"读者在书上看到 A、数据里显示 B"的来源。
   * 想守住那条约定就把 --strict 打开。 */
  if (strict && rep.some((r) => r.offName.length)) {
    console.error('\n✗ --strict：有人物的主名不是本书用字（见上）。按用户约定，主名一律用他发的那本书的写法。');
    process.exit(1);
  }
  console.log('\n✓ 全部人物都能在原文里搜到。' + (strict ? '（且主名全部是本书用字）' : ''));
  process.exit(0);
}

const report = pairs.map(([bf, tf]) => audit(bf, tf));
if (asJson) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }

for (const r of report) {
  console.log('');
  for (const line of renderGapReport(r.report, {
    slug: r.slug, min: MIN_ARG, near: NEAR, topN, okLabel: r.okLabel,
  })) console.log(line);
  /* 规则二单独一节（v0.190）。为什么不并进上面那份：两条规则的**失败模式完全不同** ——
   * 规则一（姓氏）只在中文姓名上成立、在译本上判别力极低；规则二（间隔号）只在译本上有意义、
   * 在中文原著上应当报 0。混在一起报，人分不清"这条是谁报的、该按哪套标准判"。 */
  console.log('');
  for (const line of renderInterpReport(r.interp, {
    slug: r.slug, min: MIN_ARG, okLabel: r.okLabel,
  })) console.log(line);
}