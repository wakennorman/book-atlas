/* 书型术语层（`js/app.js` 的 `TERMS`）的**判据本体** —— 纯函数、无顶层副作用。
 *
 * 为什么单独放这里（而不是写在 `test/type-terms-guard.mjs` 里）：
 *   ① 本仓惯例是"判据本体进 `scripts/lib/`，脚本/守卫只留 I/O"（v0.189 起）；
 *   ② `test/guard-hygiene.mjs` 的 H2 要求每个 `test/*-guard.mjs` 都 import `scripts/` 下的模块，
 *      否则"守卫"就是**自己判自己**，没有任何独立出处。
 *
 * 两类错误都不会有任何东西报红，正是本仓最常见的病：
 *   ① 给 `narrative` 加了词条、忘了给 `theory` 加 ⇒ 理论类上 `T().新词条` 取到 `undefined`；
 *   ② 措辞改回了叙事类（`'结局：'` 之类）⇒ 术语层那一句白写，界面看着完全正常。
 */

/** 小词法器：把注释与正则字面量剥掉，只认字符串字面量。
 *  ⚠ 为什么不能"遇到引号就当字符串"：`/[&<>"']/g` 这种**正则里带引号**的写法会让简易剥离器
 *    **永久失同步**（实测把整份文件的注释都当成代码）⇒ 报出一堆不存在的残留。
 *  @returns {{strings: {value:string,line:number,quote:string}[], code:string, noComments:string}}
 *    `code` 与原文**等长**（注释、字符串、正则全用空格补，换行保留）⇒ 行号与原文一一对应。
 *    `noComments` 只剥注释，**保留字符串/模板原文** —— 判"某个 `t.xxx` 引用在不在"必须用它：
 *    `code` 把模板字面量整段抹掉了，而 `${t.gen}` 这类引用**恰恰都在模板里**，
 *    用 `code` 判会把它们全看成"没引用过"（实测 G7 误报 21 条）。 */
export function lexJs(src) {
  const strings = [];
  let code = '';
  let noComments = '';
  let i = 0;
  let line = 1;
  let prev = '';                                  // 上一个"有意义"的字符（判断 `/` 是除号还是正则）
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '\n') { line++; code += c; noComments += c; prev = ''; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { code += ' '; noComments += ' '; i++; } continue; }
    if (c === '/' && n === '*') {
      code += '  '; noComments += '  '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        const ch = src[i] === '\n' ? '\n' : ' ';
        code += ch; noComments += ch;
        if (src[i] === '\n') line++;
        i++;
      }
      code += '  '; noComments += '  '; i += 2; continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; const startLine = line; let val = '';
      code += ' '; noComments += c; i++;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { val += src[i + 1] || ''; code += '  '; noComments += d + (src[i + 1] || ''); i += 2; continue; }
        if (d === q) { code += ' '; noComments += d; i++; break; }
        if (d === '\n') line++;
        val += d; code += (d === '\n' ? '\n' : ' '); noComments += d; i++;
      }
      strings.push({ value: val, line: startLine, quote: q });
      prev = q; continue;
    }
    /* 正则字面量：`/` 前面不是标识符/`)`/`]`/数字 ⇒ 当正则（`replace(/…/)`、`= /…/`） */
    if (c === '/' && !/[A-Za-z0-9_$)\]]/.test(prev)) {
      let j = i + 1; let inClass = false; let ok = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { ok = true; break; }
        j++;
      }
      if (ok) {
        while (i <= j) { code += ' '; noComments += ' '; i++; }
        while (i < src.length && /[a-z]/.test(src[i])) { code += ' '; noComments += ' '; i++; }
        prev = '/'; continue;
      }
    }
    code += c; noComments += c; if (!/\s/.test(c)) prev = c; i++;
  }
  return { strings, code, noComments };
}

/** 从 `js/app.js` 源码里取出 `TERMS` 对象字面量（纯数据 ⇒ 可以安全 eval）。
 *  @returns {{terms:object|null, start:number, end:number, error?:string}} */
export function extractTerms(appSrc) {
  const { code } = lexJs(appSrc);
  const at = code.indexOf('const TERMS = ');
  if (at < 0) return { terms: null, start: -1, end: -1, error: '找不到 `const TERMS = `' };
  const open = code.indexOf('{', at);
  let depth = 0; let close = -1;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close < 0) return { terms: null, start: -1, end: -1, error: 'TERMS 的花括号不闭合' };
  try {
    /* 用**原文**切片（保留引号与转义）来 eval；此处是纯对象字面量，无副作用。 */
    const terms = new Function(`return (${appSrc.slice(open, close + 1)});`)();
    return { terms, start: at, end: close + 1 };
  } catch (e) {
    return { terms: null, start: -1, end: -1, error: 'TERMS 不是合法的对象字面量：' + e.message };
  }
}

const phOf = (v) => [...String(v).matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');
/** 领属人称：`他的` / `她的`。这是**运行时**才定的那部分 —— 叙事类看 `c.gender`，
 *  理论类还要整个换成名词（「概念」）⇒ 它必须是 `{N}` 占位符，不能写死。 */
const POSSESSIVE = /[他她]的/;
/** 长词级值（≥4 个汉字、不含 `{N}`）—— 只有这种才适合做"残留写死"判据：
 *  短值（`人物`/`关系`/`概念`）在别处合法出现太多，查它们会造出一堆噪声
 *  —— **纯噪声门禁比没有更坏**。 */
export const isLongPlainCJK = (v) => typeof v === 'string' && !/\{\d\}/.test(v)
  && (v.match(/[\u4e00-\u9fa5]/g) || []).length >= 4;

/** 主判据：返回问题清单（空数组 = 通过）。
 *  @param {{appSrc:string, htmlSrc:string}} io */
export function checkTypeTerms({ appSrc, htmlSrc }) {
  const problems = [];
  const bad = (m) => problems.push(m);
  const { strings: appStrings, noComments: appNoComments } = lexJs(appSrc);
  const got = extractTerms(appSrc);
  if (!got.terms) return [got.error];
  const { terms, start, end } = got;
  const nar = terms.narrative || {};
  const the = terms.theory || {};
  const narKeys = Object.keys(nar);
  const theKeys = Object.keys(the);

  /* G1 两侧词条一一对应（双向） */
  for (const k of narKeys) if (!(k in the)) bad(`G1 theory 缺词条「${k}」（narrative 有、theory 没有 ⇒ 理论类会印出 undefined）`);
  for (const k of theKeys) if (!(k in nar)) bad(`G1 narrative 缺词条「${k}」（theory 有、narrative 没有）`);

  /* G2 占位符集合一致 */
  for (const k of narKeys) {
    if (!(k in the)) continue;
    if (phOf(nar[k]) !== phOf(the[k])) bad(`G2 词条「${k}」两侧占位符不一致：narrative {${phOf(nar[k])}} vs theory {${phOf(the[k])}}`);
  }

  /* G3/G4/G5 引用可解析、且取法正确。
   * ⚠ 一律在 `appNoComments` 上找：`${T().charN}`、`TW('chHead', …)` 这些**全在模板字面量里**，
   *   而 `appCode` 把模板整段抹成空格 ⇒ 用 `appCode` 会一条引用都找不到（实测 G7 误报 16 条）。 */
  const refCount = new Map();
  const countRef = (k) => refCount.set(k, (refCount.get(k) || 0) + 1);
  for (const m of appNoComments.matchAll(/\bT\(\)\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    const k = m[1]; countRef(k);
    if (!(k in nar)) bad(`G3 \`T().${k}\` 不是术语表里的词条`);
    else if (/\{\d\}/.test(nar[k])) bad(`G4 \`T().${k}\` 是**句级**词条（含 {N}），必须用 \`TW('${k}', …)\`，否则界面上会印出字面量 {0}`);
  }
  for (const m of appNoComments.matchAll(/\bTW\(\s*'([^']+)'/g)) {
    const k = m[1]; countRef(k);
    if (!(k in nar)) bad(`G3 \`TW('${k}')\` 不是术语表里的词条`);
    else if (!/\{\d\}/.test(nar[k])) bad(`G5 \`TW('${k}')\` 用于**词级**词条（不含 {N}），应改用 \`T().${k}\``);
  }
  /* `const t = T()` 之后用 `t.xxx` 取词 —— 只把"名字确实在术语表里"的算作引用。
   * ⚠ 必须在 `noComments`（**保留模板原文**）上找：`${t.gen}` 这类引用全在模板字面量里，
   *   而 `appCode` 把模板整段抹成空格了 ⇒ 用 `appCode` 会把它们全看成"没引用过"。 */
  for (const k of new Set([...narKeys, ...theKeys])) {
    if (refCount.get(k)) continue;
    if (new RegExp(`\\bt\\.${k}\\b`).test(appNoComments)) countRef(k);
  }

  /* G6 index.html 的 data-term / data-term-html 都能查到 */
  const htmlTerms = [...htmlSrc.matchAll(/data-term(?:-html)?="([^"]+)"/g)].map((m) => m[1]);
  for (const k of htmlTerms) {
    if (!(k in nar)) bad(`G6 index.html 的 data-term="${k}" 在 narrative 里没有`);
    if (!(k in the)) bad(`G6 index.html 的 data-term="${k}" 在 theory 里没有`);
  }

  /* G7 没有"死词条"（定义了却没人引用 = 加了没接线） */
  for (const k of new Set([...narKeys, ...theKeys])) {
    if (!refCount.get(k) && !htmlTerms.includes(k)) bad(`G7 词条「${k}」定义了但没有任何地方引用（T()/TW()/data-term）`);
  }

  /* G8 残留：长词级值不许再作为裸字符串字面量出现在 TERMS 之外 */
  const lineStart = (ln) => appSrc.split('\n').slice(0, ln - 1).join('\n').length;
  for (const { value, line } of appStrings) {
    if (!isLongPlainCJK(value)) continue;
    const idx = lineStart(line);
    if (idx >= start && idx <= end) continue;             // 落在 TERMS 区间内 ⇒ 是定义本身
    const side = narKeys.find((k) => nar[k] === value) ? 'narrative'
      : (theKeys.find((k) => the[k] === value) ? 'theory' : null);
    if (side) bad(`G8 第 ${line} 行：${side} 词条「${value}」的值被原样写死在这里（应该用 T()/TW() 取）`);
  }

  /* G9 运行时才定的人称不许写死。
   *
   * 为什么单列一条：G1–G8 全是"表自己跟自己"的判据（对称、占位符、引用、死词条），
   * 而这一类错的形状是**表内部完全自洽、调用点也完全合法**，只是**信息被丢掉了** ——
   * 没有任何一条现有判据会红。
   *
   * 真实事故（v0.208）：`epubLifeH` 从
   *   ``${c.gender === 'f' ? '她' : '他'}的一生（按章）``
   * 搬进词表时写成了固定值 `'他的一生（按章）'` ⇒ **女性角色**的 EPUB 人物小节标题
   * 变成「他的一生」。当时 84 步门禁里**没有一步为它红**（因为确实没有东西在守它）。
   *
   * 判据边界（故意收窄，避免造噪声）：
   *   · 只认**领属人称**（`他的` / `她的`）—— 「他人」不是人称代词（`aiCharTask` 里有）；
   *   · `charPron: '他/她'` 是**给用户看的占位说法**，不是渲染出来的人称 ⇒ 天然不含「他的」。
   * 两侧都查：理论类同样可能有"运行时才定的名词"。 */
  for (const [side, tbl] of [['narrative', nar], ['theory', the]]) {
    for (const k of Object.keys(tbl)) {
      const v = String(tbl[k]);
      if (!POSSESSIVE.test(v) || /\{\d\}/.test(v)) continue;
      bad(`G9 ${side} 词条「${k}」里写死了领属人称（「${(v.match(POSSESSIVE) || [''])[0]}」）：`
        + '人称是运行时才定的（叙事类看 c.gender，理论类还要换成名词）⇒ 必须做成 {N} 占位符、'
        + '由调用点用 TW() 传进去，否则只会对一半的人成立。');
    }
  }

  return problems;
}

/** 供守卫打印用的小结（词条数 / data-term 数）。 */
export function summarizeTypeTerms({ appSrc, htmlSrc }) {
  const got = extractTerms(appSrc);
  if (!got.terms) return { nar: 0, the: 0, htmlTerms: 0 };
  const htmlTerms = [...htmlSrc.matchAll(/data-term(?:-html)?="([^"]+)"/g)].map((m) => m[1]);
  return {
    nar: Object.keys(got.terms.narrative || {}).length,
    the: Object.keys(got.terms.theory || {}).length,
    htmlTerms: new Set(htmlTerms).size,
  };
}
