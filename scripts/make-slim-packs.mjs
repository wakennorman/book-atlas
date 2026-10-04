#!/usr/bin/env node
/**
 * 生成「图 + 文案」两份数据包（v85）
 *
 * 为什么拆
 * --------
 * data/<slug>.json 现在一份文件同时装着"画图要的"和"读了才知道的"。
 * 实测三国：整份 gzip 230.4 KB，而画图真正需要的只有 79.4 KB（-66%）。
 * 拆开后：
 *   · 首屏只下 <slug>.graph.json（79.4 KB）⇒ 图能画出来的快得多
 *   · <slug>.text.json（137.2 KB）在图画完之后**空闲时后台预取**，
 *     所以用户点开人物/事件时通常已经就绪，不会有"面板先空一下"的观感损失
 *   · 两份合计 216.6 KB，比现在还略少
 *
 * 为什么不直接 minify 就完事
 * -------------------------
 * 只去掉缩进的话 gzip 只从 230.4 → 216.3 KB（-6%），因为长串缩进空格本来就很好压。
 * 真正的体积在散文（desc/fate/summary/quote…），那部分只有拆开才拿得到。
 *
 * 字段选择依据（严格按 js/app.js 启动路径实际读到的，不能凭感觉砍）
 * --------------------------------------------------------------
 * 人物：id name gender faction generation tier firstCh aliases altNames factionHistory
 *   · firstCh     charCh() / charVisibleAt() / 剧透锁定
 *   · aliases     搜索与下拉要
 *   · altNames    「又译」：搜索、联想、人物卡、人物志、EPUB 导出都要（v0.97 补）
 *   · factionHistory effectiveFactionKey()（分组与阵营色）
 *   · tier        次要人物/仅提及 的折叠
 *
 * ⚠⚠ **白名单是这类漏字段的根源**：加新字段时忘了在这里 put，图包里就没有，
 *   而前端测试往往用**运行时注入的探针**去测那个字段 ⇒ 一路绿灯，功能在浏览器里却是死的。
 *   实测踩过：`altNames` 从 v0.95 起就接进了前端、v0.97 填了 27 条真实译名，
 *   却因为白名单漏了它，网页端一条都显示不出来。
 *   ⇒ 防它靠 `check-packs-sync.mjs` 的**字段覆盖检查**（拿源数据的字段名集合
 *     减去图包，再减去一份显式的"故意不带"清单），不要靠前端断言。
 * 关系：from to type kin style derived fromCh toCh events[].chapter/place
 *   · events[].chapter **必须留**：relCh() 取它算"这段关系第几章成立"，
 *     charLastCh() 也靠它算人物最后出场章。只留条数会让剧透判定全错。
 *   · events[].place 要留（地点筛选与图注要用）
 * 事件：id ch name phase order place chars
 *   · chars  **必须留**：charLastCh() 靠它判断这个人最后一次出场在哪一章
 *   其余 summary / impact / desc / quote 归到文案包
 *
 * 用法：node scripts/make-slim-packs.mjs          # 生成
 *       node scripts/make-slim-packs.mjs --check   # 只校验是否与源文件同步（CI 用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const check = process.argv.includes('--check');

/** 从 data/books.json 读出三本书的 slug（以它为准，不猜文件名） */
function bookList() {
  const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'books.json'), 'utf8'));
  return (idx.books || []).map((b) => b.slug);
}

const has = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
const put = (o, k, v) => { if (has(v)) o[k] = v; };

function split(book) {
  /* ---------- 图包：画图 + 剧透判定 + 搜索全靠它 ---------- */
  const graph = {
    meta: book.meta,
    factions: book.factions || [],
    phases: book.phases || [],
    places: book.places || [],
    characters: book.characters.map((c) => {
      const o = {};
      put(o, 'id', c.id);
      put(o, 'name', c.name);
      put(o, 'firstCh', c.firstCh);
      put(o, 'gender', c.gender);
      put(o, 'faction', c.faction);
      put(o, 'generation', c.generation);
      put(o, 'tier', c.tier);
      put(o, 'aliases', c.aliases);
      /* ⚠ altNames（「又译」）**必须**进图包。
       *   v0.95 把 altNames 接进了搜索/联想/人物卡/人物志/EPUB 导出，
       *   v0.97 又给它填了 27 条真实译名 —— 而这个白名单里**漏了它**，
       *   于是网页端读到的 graph.json 里 altNames 恒为 0，
       *   **整个「又译」功能在浏览器里一条都显示不出来**。
       *
       *   为什么门禁没抓到：`test/browser.mjs` 里那几条 altNames 断言用的是
       *   **运行时注入的探针 altName**，绕过了数据通路 ——
       *   典型的"测试用探针、于是真数据缺字段也照样绿"。
       *   ⇒ 防这类错要靠 `check-packs-sync.mjs` 的字段覆盖检查（比字段名逐字比），
       *     不能靠前端断言。 */
      put(o, 'altNames', c.altNames);
      /* lordHistory：三国用它记「历任主公」，app.js 的君主更替线要读。
       * 它同样一度只存在于 data/*.json、两个包里都没有 ⇒ 那条线在浏览器里是空的。 */
      put(o, 'lordHistory', c.lordHistory);
      put(o, 'factionHistory', c.factionHistory);
      return o;
    }),
    relations: book.relations.map((r) => {
      const o = {};
      put(o, 'from', r.from);
      put(o, 'to', r.to);
      put(o, 'type', r.type);
      put(o, 'kin', r.kin);
      put(o, 'style', r.style);
      if (r.derived) o.derived = true;
      put(o, 'fromCh', r.fromCh);
      put(o, 'toCh', r.toCh);
      // chapter/place 是剧透与地点判定的输入，不能进文案包
      if (r.events && r.events.length) {
        o.events = r.events.map((e) => {
          const x = {};
          put(x, 'chapter', e.chapter);
          put(x, 'place', e.place);
          return x;
        });
      }
      return o;
    }),
    events: book.events.map((e) => {
      const o = {};
      put(o, 'id', e.id);
      put(o, 'ch', e.ch);
      put(o, 'name', e.name);
      put(o, 'phase', e.phase);
      put(o, 'order', e.order);
      put(o, 'place', e.place);
      put(o, 'chars', e.chars);
      return o;
    }),
  };

  /* ---------- 文案包：按 id / 索引回填 ---------- */
  // 人物与事件都有稳定 id；关系没有 id，只能按 relations 数组下标 ——
  // 因此两份必须由同一个源文件、同一次遍历生成（checkSlim 会校验顺序与数量）。
  const charText = {};
  for (const c of book.characters) {
    const o = {};
    put(o, 'title', c.title);
    put(o, 'desc', c.desc);
    put(o, 'fate', c.fate);
    put(o, 'note', c.note);
    if (Object.keys(o).length) charText[c.id] = o;
  }
  const relText = {};
  book.relations.forEach((r, i) => {
    const evs = r.events || [];
    const out = [];
    // ⚠ 必须带上该事件在 r.events 里的**下标**：有些关系事件是没有文案的
    // （只有 chapter/place），若只靠顺序对齐，遇到中间跳过一条就会整体错位。
    evs.forEach((e, j) => {
      if (!has(e.text) && !has(e.quote)) return;
      const x = { i: j };
      put(x, 't', e.text);
      put(x, 'q', e.quote);
      out.push(x);
    });
    if (out.length) relText[i] = out;
  });
  const eventText = {};
  for (const e of book.events) {
    const o = {};
    put(o, 'summary', e.summary);
    put(o, 'impact', e.impact);
    put(o, 'desc', e.desc);
    if (Object.keys(o).length) eventText[e.id] = o;
  }

  return {
    graph,
    text: { characters: charText, relEvents: relText, events: eventText },
  };
}

/** 把文案包贴回图包（app.js 的行为，这里用来验证数据本身自洽）。
 *  关系事件按**下标**配对，不按文案内容 —— 内容可能为空、可能重复，位置才是稳的。 */
function merge(graph, text) {
  const book = JSON.parse(JSON.stringify(graph));
  for (const c of book.characters) Object.assign(c, text.characters[c.id] || {});
  for (const e of book.events) Object.assign(e, text.events[e.id] || {});
  book.relations.forEach((r, i) => {
    const src = text.relEvents[i];
    if (!src) return;
    // 文案条目自带下标 i ⇒ 直接贴回对应位置，不会因为中间跳过无文案的事件而错位
    const evs = (r.events || []).slice();
    for (const t of src) {
      const j = t.i;
      if (j >= 0 && j < evs.length) {
        const x = { ...evs[j] };
        if (t.t) x.text = t.t;
        if (t.q) x.quote = t.q;
        evs[j] = x;
      }
    }
    r.events = evs;
  });
  return book;
}

/** 校验：两份合起来必须和源文件语义等价 */
function checkSlim(slug, src, graph, text) {
  const problems = [];
  const merged = merge(graph, text);

  if (merged.characters.length !== src.characters.length) problems.push(`人物数 ${merged.characters.length} ≠ ${src.characters.length}`);
  if (merged.relations.length !== src.relations.length) problems.push(`关系数 ${merged.relations.length} ≠ ${src.relations.length}`);
  if (merged.events.length !== src.events.length) problems.push(`事件数 ${merged.events.length} ≠ ${src.events.length}`);

  // 剧透判定依赖的字段必须一字不差地保留
  const STRESS = ['id', 'name', 'firstCh', 'gender', 'faction', 'generation', 'tier'];
  for (let i = 0; i < src.characters.length; i++) {
    for (const k of STRESS) {
      const a = src.characters[i][k], b = merged.characters[i][k];
      if (a !== b) problems.push(`人物 ${src.characters[i].id} 的 ${k}：${JSON.stringify(b)} ≠ ${JSON.stringify(a)}`);
    }
  }
  // 关系的 events[].chapter 决定 relCh → 剧透
  // ⚠ 源数据里有些事件的 chapter 是空字符串 ""（不是 undefined）。图包里空值被省掉了，
  //   所以这里用 chOf 的等价口径比较："" 和 undefined 经 chOf 都得到 null，语义相同。
  const chEq = (a, b) => {
    const norm = (x) => (x === '' || x === undefined || x === null ? null : x);
    return norm(a) === norm(b);
  };
  for (let i = 0; i < src.relations.length; i++) {
    const a = src.relations[i].events || [], b = merged.relations[i].events || [];
    if (a.length !== b.length) { problems.push(`关系 ${i} 的事件数 ${b.length} ≠ ${a.length}`); continue; }
    for (let j = 0; j < a.length; j++) {
      if (!chEq(a[j].chapter, b[j].chapter)) problems.push(`关系 ${i} 第 ${j} 个事件的 chapter：${JSON.stringify(b[j].chapter)} ≠ ${JSON.stringify(a[j].chapter)}`);
    }
  }
  // 事件的 chars 决定 charLastCh → 结局剧透
  for (let i = 0; i < src.events.length; i++) {
    const a = src.events[i].chars || [], b = merged.events[i].chars || [];
    if (a.join('|') !== b.join('|')) problems.push(`事件 ${src.events[i].id} 的 chars 不一致`);
  }
  return problems;
}

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;

let bad = 0;
let totalGraph = 0, totalText = 0, totalNow = 0;

for (const slug of bookList()) {
  const srcPath = path.join(DATA, `${slug}.json`);
  const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  const { graph, text } = split(src);

  const problems = checkSlim(slug, src, graph, text);
  if (problems.length) {
    bad++;
    console.error(`✗ ${slug}：拆分后与源文件不一致（${problems.length} 处）`);
    for (const p of problems.slice(0, 8)) console.error(`    ${p}`);
  }

  const gPath = path.join(DATA, `${slug}.graph.json`);
  const tPath = path.join(DATA, `${slug}.text.json`);
  const gStr = JSON.stringify(graph), tStr = JSON.stringify(text);

  totalNow += fs.statSync(srcPath).size;
  totalGraph += Buffer.byteLength(gStr, 'utf8');
  totalText += Buffer.byteLength(tStr, 'utf8');

  if (check) {
    for (const [p, want] of [[gPath, gStr], [tPath, tStr]]) {
      if (!fs.existsSync(p)) { console.error(`✗ ${path.basename(p)} 不存在，跑一次 node scripts/make-slim-packs.mjs`); bad++; continue; }
      const got = fs.readFileSync(p, 'utf8');
      if (got !== want) { console.error(`✗ ${path.basename(p)} 与 data/${slug}.json 不同步（跑 node scripts/make-slim-packs.mjs）`); bad++; }
    }
  } else {
    fs.writeFileSync(gPath, gStr, 'utf8');
    fs.writeFileSync(tPath, tStr, 'utf8');
  }

  console.log(`${problems.length ? '✗' : '✓'} ${slug.padEnd(30)} 图 ${kb(Buffer.byteLength(gStr, 'utf8')).padStart(9)}  文案 ${kb(Buffer.byteLength(tStr, 'utf8')).padStart(9)}  （源 ${kb(fs.statSync(srcPath).size)}）`);
}

console.log(`\n合计：源 ${kb(totalNow)} → 图 ${kb(totalGraph)} + 文案 ${kb(totalText)} = ${kb(totalGraph + totalText)}`);
if (check && bad) { console.error('\n数据包与源文件不同步'); process.exit(1); }
if (bad) process.exit(1);
