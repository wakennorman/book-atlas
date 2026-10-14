/* 「简体 → 繁体」判据库 —— v0.219 新增。
 *
 * ## 这个库是什么
 *
 * 繁体版**不是翻译**，是文本转换：查两张表（字表 + 歧义词组表），语义不会漂移。
 * 本模块只放**判据**（哪些文本要转、什么算漏、什么算死条目、什么算歧义没覆盖），
 * 表本身在 `data/s2t.json`，人工覆盖在 `s2t-overrides.mjs`。
 *
 * ## 为什么判据放这里而不是 test/
 *
 * 与 `prose-bold.mjs` / `ui-notes.mjs` 同一个理由：判据只写一份，
 * `scripts/make-s2t-dict.mjs`（生成表）与 `test/s2t-guard.mjs`（守表）都 import 它。
 * `test/guard-hygiene.mjs` 的 H2/H3 就是在守这件事 —— 判据抄两份必漂。
 *
 * 本模块**纯函数、无顶层副作用、不依赖网络**（生成器需要的 opencc 只在生成期用）。
 */

/** 汉字判定。含扩展 A 与兼容区，和浏览器 `conv()` 的扫描范围保持一致。 */
export const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 书籍数据里**读者能看见**的字段（路径里的 `[]` 表示逐元素展开）。
 *
 * 刻意**不含**：`id` / `from` / `to` / `chars` 等机器键（值是 id，不是文字）、
 * `meta.style`（内部写作规范，不上界面）、`meta.sources`（出处原文）、
 * `meta.license` / `meta.titleEn`（后者本来就是拉丁文）。
 */
export const CORPUS_FIELDS = [
  ['meta.note', ['meta', 'note']],
  ['meta.prophecy', ['meta', 'prophecy']],
  ['ch.name', ['characters', '[]', 'name']],
  ['ch.title', ['characters', '[]', 'title']],
  ['ch.desc', ['characters', '[]', 'desc']],
  ['ch.fate', ['characters', '[]', 'fate']],
  ['ch.note', ['characters', '[]', 'note']],
  ['ch.aliases', ['characters', '[]', 'aliases']],
  ['rel.type', ['relations', '[]', 'type']],
  ['rel.text', ['relations', '[]', 'events', '[]', 'text']],
  ['ev.name', ['events', '[]', 'name']],
  ['ev.summary', ['events', '[]', 'summary']],
  ['ev.impact', ['events', '[]', 'impact']],
  ['ev.quote', ['events', '[]', 'quote']],
  ['pl.name', ['places', '[]', 'name']],
  ['pl.desc', ['places', '[]', 'desc']],
  ['pl.aliases', ['places', '[]', 'aliases']],
  ['ph.name', ['phases', '[]', 'name']],
];

/** 界面文案所在的文件（字符串字面量里的中文就是读者可见文案）。 */
export const UI_SOURCES = ['js/app.js', 'index.html', 'js/editor.js'];

/** 展开一条路径，逐元素下钻。返回 `[{node, at}]`。 */
export function resolve(root, segs) {
  let cur = [{ node: root, at: '' }];
  for (const seg of segs) {
    const next = [];
    for (const { node, at } of cur) {
      if (node == null) continue;
      if (seg === '[]') {
        if (Array.isArray(node)) node.forEach((x, i) => next.push({ node: x, at: `${at}[${i}]` }));
      } else if (!Array.isArray(node) && typeof node === 'object' && seg in node) {
        next.push({ node: node[seg], at: at ? `${at}.${seg}` : seg });
      }
    }
    cur = next;
    if (!cur.length) return [];
  }
  return cur;
}

/** 一本书（doc）里所有读者可见字符串。 */
export function bookStrings(doc) {
  const out = [];
  for (const [label, p] of CORPUS_FIELDS) {
    for (const { node, at } of resolve(doc, p)) {
      if (typeof node === 'string' && CJK.test(node)) out.push({ field: label, at, text: node });
    }
  }
  return out;
}

/** 一份源码里的中文**字符串字面量**（剥掉注释行，避免把注释当语料）。 */
export function sourceStrings(src) {
  const out = [];
  src.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    for (const m of line.matchAll(/(['"`])((?:[^'\\`|]|\\.)*?)\1/g)) {
      const s = m[2];
      if (CJK.test(s) && !/^[a-z0-9_./:?=&-]+$/i.test(s)) out.push({ text: s, at: `行 ${i + 1}` });
    }
  });
  return out;
}

/** `index.html` 里 `<script>/<style>` 之外的可见文本节点。 */
export function htmlStrings(src) {
  const out = [];
  const bare = src.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  for (const m of bare.matchAll(/>([^<>]+)</g)) {
    const s = m[1].trim();
    if (s && CJK.test(s)) out.push({ text: s, at: '文本节点' });
  }
  return out;
}

/** 语料总表：`[{src, text}]`（src 形如 `sapiens ch.desc[7]` / `app.js 行 449`）。 */
export function collectCorpus(books, readJson, readText) {
  const out = [];
  for (const b of books) {
    const doc = readJson(b.file);
    for (const s of bookStrings(doc)) out.push({ src: `${b.slug} ${s.field}`, text: s.text });
  }
  for (const f of UI_SOURCES) {
    const src = readText(f);
    if (!src) continue;
    const picked = f.endsWith('.html') ? htmlStrings(src) : sourceStrings(src);
    for (const s of picked) out.push({ src: `${f} ${s.at}`, text: s.text });
  }
  return out;
}

/** 语料里出现过的汉字集合 → `Map<char, 次数>`。 */
export function corpusCharCounts(corpus) {
  const m = new Map();
  for (const { text } of corpus) {
    for (const ch of text) {
      if (!CJK.test(ch)) continue;
      m.set(ch, (m.get(ch) || 0) + 1);
    }
  }
  return m;
}

/** 语料总字数（只数汉字）。 */
export function corpusCharTotal(counts) {
  let n = 0;
  for (const v of counts.values()) n += v;
  return n;
}

/* ────────────────────────────── 判据 ────────────────────────────── */

/**
 * H1 漏字：语料里出现、却**转换后仍是简体**的字。
 *
 * 这是本项目最怕的静默故障 —— 繁中模式下某个生僻字悄悄保持简体，
 * 页面看着"对"，但那一个字露馅。返回 `['甲', '乙', …]`，空数组＝干净。
 *
 * 什么样的字算"有交代"（三种都算）：
 *   ① 在 `chars` 里（会转成别的形）；
 *   ② 在 `same` 里（繁简同形，本来就不用动）；
 *   ③ 是 `chars` / `phrases` 的**值**（已经是繁体了，比如源码里本来就写着「繁體」）。
 */
export function uncoveredChars(counts, dict) {
  const out = [];
  const trad = new Set();
  for (const v of Object.values(dict.chars || {})) for (const c of String(v)) trad.add(c);
  for (const v of Object.values(dict.phrases || {})) for (const c of String(v)) trad.add(c);
  for (const ch of counts.keys()) {
    if (convertedChar(ch, dict)) continue;
    if (String(dict.same || '').includes(ch)) continue;
    if (trad.has(ch)) continue;
    out.push(ch);
  }
  return out;
}

/**
 * 查一个字在 `dict` 下的繁体形：先看词组表里有没有**单字条目**，再看字表。
 * 两处都没有 ⇒ 返回 `''`（＝没登记，H1 报红）。
 */
export function convertedChar(ch, dict) {
  if (dict.phrases && Object.prototype.hasOwnProperty.call(dict.phrases, ch)) return dict.phrases[ch];
  return (dict.chars && dict.chars[ch]) || '';
}

/**
 * H2 死条目：表里有、语料里一次都没出现的字或词组。
 *
 * ⚠ `manual` 是**人工词表**（`PHRASE_FIX`）—— 那些是留给将来新书的通用词条
 * （「旅游」「战斗」本书没用到，但下本书可能有），不按死条目论；
 * 本函数只管**派生规则**（由语料推出来、语料一改就可能失效的那种）。
 * 返回 `['甲', '并州', …]`。
 */
export function deadDictEntries(corpus, dict, manual = []) {
  const hay = corpus.map((c) => c.text).join('\n');
  const manualSet = new Set(manual);
  const out = [];
  for (const k of Object.keys(dict.chars || {})) if (!hay.includes(k)) out.push(k);
  for (const k of Object.keys(dict.phrases || {})) {
    if (manualSet.has(k)) continue;
    if (!hay.includes(k)) out.push(k);
  }
  return out;
}

/**
 * H3 歧义没覆盖：同一个字在语料里产出 **≥2 种繁体形**。
 *
 * 怎么找：按连续汉字段切开，用**带词组表**的转换器整段转，再按位比对 —— 只有这样
 * 才看得出「只」在「一只」里是「隻」、在「只看」里是「只」。只看字表的话两边都是「只」，
 * 这个检查会永远返回 0 条，等于没守。
 * 返回 `[{ch, forms: {'隻': 12, '只': 5}, 例: ['一只', '只看']}]`。
 */
export function ambiguousChars(corpus, dict) {
  const forms = new Map();   // ch -> Map(form -> n)
  const samples = new Map(); // ch -> Set(词)
  const conv = makeConverter(dict);
  for (const { text } of corpus) {
    for (const seg of text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g) || []) {
      const out = conv(seg);
      if (out.length !== seg.length) continue;      // 长度变了不能按位归并
      for (let i = 0; i < seg.length; i++) {
        const ch = seg[i];
        if (!forms.has(ch)) forms.set(ch, new Map());
        const fm = forms.get(ch);
        fm.set(out[i], (fm.get(out[i]) || 0) + 1);
        if (fm.size === 1) {
          if (!samples.has(ch)) samples.set(ch, new Set());
          const s = samples.get(ch);
          if (s.size < 6) s.add(seg.substr(Math.max(0, i - 1), 3));
        }
      }
    }
  }
  const out = [];
  for (const [ch, fm] of forms) {
    if (fm.size < 2) continue;
    out.push({ ch, forms: Object.fromEntries([...fm].sort((a, b) => b[1] - a[1])), 例: [...(samples.get(ch) || [])] });
  }
  return out.sort((a, b) => a.ch.localeCompare(b.ch));
}

/**
 * S3/S4 对拍：把语料交给一个"逐字转换"实现（生成器里是 opencc），
 * 返回**它与我们最终表不一致的位置**，按词组归并 —— 生成器用它出复核清单，
 * 守卫用它断言"每一处不一致都有明确条目，不许蒙对"。
 * 返回 `[{ctx, opencc, ours, n}]`。
 */
export function disagreements(corpus, convert, dict) {
  const m = new Map();
  const conv = makeConverter(dict);
  for (const { src, text } of corpus) {
    for (const seg of text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g) || []) {
      const theirs = convert(seg);
      const ours = conv(seg);
      if (theirs === ours) continue;
      // 定位第一个不同的字，取它所在的 2~4 字窗口做归并键
      let i = 0;
      while (i < seg.length && theirs[i] === ours[i]) i++;
      const lo = Math.max(0, i - 1);
      const key = seg.slice(lo, Math.min(seg.length, i + 3));
      if (!m.has(key)) m.set(key, { ctx: key, opencc: theirs.slice(lo, lo + key.length), ours: ours.slice(lo, lo + key.length), n: 0, src });
      m.get(key).n++;
    }
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

/* ─────────────────────────── 运行时转换 ─────────────────────────── */

/**
 * 用 `dict` 造一个 `conv(text)`。**最长匹配优先**：先试词组表（长 → 短），再逐字查字表。
 *
 * 这段是**机制**不是判据（判据在上面），`js/app.js` 里有一份等价的运行期实现；
 * `test/s2t-guard.mjs` 的 S5 会对拍两份实现，全语料必须逐字一致。
 */
export function makeConverter(dict) {
  const chars = dict.chars || {};
  const phraseKeys = Object.keys(dict.phrases || {}).sort((a, b) => b.length - a.length);
  const maxLen = phraseKeys.length ? phraseKeys[0].length : 0;
  const phrases = dict.phrases || {};
  return function conv(text) {
    if (!text || !CJK.test(text)) return text;
    let out = '';
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (!CJK.test(ch)) { out += ch; i++; continue; }
      let hit = '';
      for (let n = Math.min(maxLen, text.length - i); n >= 2; n--) {
        const k = text.substr(i, n);
        if (Object.prototype.hasOwnProperty.call(phrases, k)) { hit = phrases[k]; i += n; break; }
      }
      out += hit || chars[ch] || ch;
      if (!hit) i++;
    }
    return out;
  };
}