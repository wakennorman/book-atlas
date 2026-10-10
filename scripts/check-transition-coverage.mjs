#!/usr/bin/env node
/**
 * `transition` 覆盖检查：状态规则里改的属性，基础块必须列进 transition。
 *
 * ## 为什么需要它
 *
 * v0.171 把 15 处 `transition: all` 展开成显式属性列表时，**漏了两个属性**：
 *   · `.icon-btn` 组（`.icon-btn / .ghost / .primary`）的 `filter`
 *     —— `.primary:active` 里写的是 `filter: brightness(.94)`，而列表里没有 `filter`
 *   · `shared .btn` 的 `color`
 * 漏掉的后果：这两个属性从「跟着缓动过渡」变成「瞬间跳变」。
 * 同轮 `check-transition-ease.mjs` 只守住了"缓动/时长不许混用"，
 * 而"**属性不许漏**"这一面当时被判为"靠人工核对"（历史 hover 规则大量改属性，
 * 一刀切会天天误报）。v0.172 靠人工核对补上了这两处，但**人工核对没有门禁**——
 * 也就是说下一轮谁再展开一次 `transition: all`，同一类漏属性不会有人拦。
 * 本脚本把那条人工判据**机检化**。
 *
 * ## 判据
 *
 * 对 `css/style.css` 与 `shared/design-system.css`：
 * 找每个选择器里含 `:hover / :focus / :focus-visible / :active` 的规则块，
 * 取其**基础选择器**（剥掉伪类）。**仅当**基础选择器与某个 transition 块
 * 的逗号项**精确同名**时，才逐属性比对：
 *   状态规则声明的每个可过渡属性，必须被该 transition 块覆盖。
 *
 * 「覆盖」的判法：
 *   · 列表里同名属性        ⇒ 覆盖
 *   · 列表里有简写的任一 longhand（`background` ↔ `background-color`）⇒ 覆盖
 *     —— `background: var(--soft)` 实际只改 `background-color`，必须认。
 *     （v0.172 首次人工核对时，8 条告警里 7 条都是这个简写误报。）
 *   · 列表是 `transition: none` 或含 `all` ⇒ 整块跳过
 *
 * ## 刻意保守（这是它能活下来的原因）
 *
 * 只在**基础选择器精确同名**时比对。像 `.card:hover .title { color: … }`
 * 这种"伪类在祖先、属性在后代"的规则**不查**——它的 transition 该写在 `.title` 上，
 * 而项目里没有 `.title` 的 transition 块，判红属于"判据没有的守卫"。
 * 那类漏属性仍然靠人工。**跳过的条数会打印出来**，避免用"检查了 N 条"虚报覆盖度。
 *
 * ## 豁免
 *
 * 确有理由让某属性瞬变的（例如 `:focus-visible` 的焦点环就该瞬间出现），
 * 在该状态规则**上方 3 行内**写：
 *   hover-cov-ok: <至少 8 字理由>
 * 与项目其它豁免一致 —— 没理由的豁免等于没豁免。
 *
 * ## 本脚本第一版"全绿"但是假的
 *
 * 首版跑出「比对 28 条，0 缺失」，看着挺好，其实**大半判据根本没执行**：
 *   ① 剥伪类的正则写成 `/:(hover|focus|focus-visible|active)\b/`，
 *      而 `:focus` 在 `:focus-visible` 上也能匹配（`focus` 后是 `-`，`\b` 成立）
 *      ⇒ `:focus-visible` 被削成 `-visible`，整块**静默跳过**；
 *   ② transition 块的选择器是逗号组（`.icon-btn, .ghost, .primary`），
 *      按整串做 Map 键 ⇒ `.icon-btn:hover` 一条也匹配不上，**静默跳过**。
 * 两处都表现为"绿"，所以"跳过多少条"必须打印出来 —— 否则这个门禁就是装饰品。
 * （同源教训：`test/gate-effectiveness.mjs` 守的「步骤在、却永远不会红」。）
 *
 * 用法：node scripts/check-transition-coverage.mjs
 *       BOOKATLAS_ROOT=<dir> node scripts/check-transition-coverage.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['css/style.css', 'shared/design-system.css'];

/* ---- 简写 → 可能的 longhand。命中任一即算覆盖 ---- */
const SHORTHAND = {
  background: ['background-color', 'background-image', 'background-position', 'background-size',
    'background-repeat', 'background-origin', 'background-clip', 'background-attachment'],
  border: ['border-color', 'border-width', 'border-style',
    'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-color'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-width'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'border-style'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  font: ['font-size', 'font-weight', 'font-family', 'font-style', 'line-height', 'font-variation-settings'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  gap: ['row-gap', 'column-gap'],
  overflow: ['overflow-x', 'overflow-y'],
  'text-decoration': ['text-decoration-color', 'text-decoration-line', 'text-decoration-style', 'text-decoration-thickness'],
  inset: ['top', 'right', 'bottom', 'left'],
  'place-items': ['align-items', 'justify-items'],
  'grid-area': ['grid-row', 'grid-column'],
  'grid-template': ['grid-template-columns', 'grid-template-rows', 'grid-template-areas'],
  'place-content': ['align-content', 'justify-content'],
};

/* ---- 不该要求进 transition 的属性 ---- */
const NON_ANIMATED = new Set([
  // 焦点环必须瞬间出现：延迟出现会让键盘用户失去反馈
  'outline', 'outline-color', 'outline-style', 'outline-width', 'outline-offset',
  // 这些属性按规范不可过渡（离散类型），列进 transition 也是白列
  'display', 'position', 'z-index', 'content', 'cursor', 'pointer-events',
  'user-select', 'overflow-anchor', 'text-align', 'font-family',
]);

const isCovered = (prop, set) => {
  if (set.has(prop)) return true;
  const longs = SHORTHAND[prop];
  return longs ? longs.some((l) => set.has(l)) : false;
};

/* ---- 豁免判定 ----
 * ⚠ 不能写成 `/hover-cov-ok:\s*\S{8,}/`：那要求冒号后**紧邻** 8 个连续非空白字符，
 *   而中文理由里只要出现一个空格（「hover-cov-ok: 该按钮的 transition …」，
 *   `该按钮的` 只有 4 字就被空格截断）就判不成立 ⇒ **豁免静默失效**。
 *   本项目已栽过同类跟头（`check-kin-terms.mjs` 的 reason <8 字）。
 *   口径改成：**忽略空白**后，理由本身 ≥8 字。 */
function hasExemption(ctx) {
  const m = ctx.match(/hover-cov-ok:([^\n]*)/);
  return m ? m[1].replace(/\s+/g, '').length >= 8 : false;
}

/* ---- 极简 CSS 解析：注释 → 规则块 → 声明，**并保留 at-rule 上下文** ----
 * ⚠ 必须按花括号深度走，不能拿 `/([^{}]+)\{([^{}]*)\}/g` 一把梭：
 *   那个正则会把 `@media (prefers-reduced-motion: reduce) { … }` **拍平成顶层规则**，
 *   于是里面那句 `.seg, .badge, …, .icon-btn, .ghost, .primary { transition: none }`
 *   会和真正的 `.icon-btn, .ghost, .primary { transition: … }` 合并进同一个键，
 *   把 `none = true` 写上去 ⇒ **整组被静默跳过**。
 *   实测这正是 v0.172 修过 `filter` 的那一组 —— 门禁"全绿"，却恰好不检查出问题的那块。
 *   所以：基础 transition 只认**顶层规则**（atRule === ''），reduced-motion 块天然被排除；
 *   若有 transition 落在别的 at-rule 里，会单独打印出来（避免又一次静默丢覆盖）。 */
function parseRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '{') { stack.push(buf.trim()); buf = ''; continue; }
    if (ch === '}') {
      const prelude = stack.pop() ?? '';
      const body = buf;
      buf = '';
      if (!prelude.startsWith('@')) {
        const props = [];
        for (const d of body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;}]+)/g)) {
          props.push({ prop: d[1].trim(), val: d[2].trim() });
        }
        rules.push({ selector: prelude.replace(/\s+/g, ' '), props, atRule: stack.join(' >> ') });
      }
      continue;
    }
    buf += ch;
  }
  return rules;
}

/* ⚠ 备选顺序必须 `focus-visible` 在 `focus` 之前：正则从左到右取第一个能匹配的备选，
 *   而 `:focus` 在 `:focus-visible` 上也能匹配（`focus` 后面是 `-`，\b 成立）
 *   ⇒ 会把 `:focus-visible` 削成 `-visible`。这个坑让本脚本第一版**整块跳过了**
 *   `.input:focus-visible`（详见下方"跳过的条数"为什么必须打印出来）。
 * ⚠ 用于 `.test()` 的那个**不能带 `g`**：带 `g` 的正则 `test()` 会记忆 lastIndex，
 *   同一实例连续调用会隔一次返回 false —— 又是一处"静默跳过"。 */
const PSEUDO_SRC = ':(hover|focus-visible|focus|active)(?![\\w-])';
const PSEUDO_TEST = new RegExp(PSEUDO_SRC);
const PSEUDO = new RegExp(PSEUDO_SRC, 'g');
const stripPseudo = (s) => s.trim().replace(PSEUDO, '').replace(/\s+/g, ' ').trim();

/* ---- 收集每个基础块的 transition 属性集合（只认顶层规则）----
 * ⚠ 必须把 transition 块的**逗号组拆开**逐个登记：
 *   块选择器是 `.icon-btn, .ghost, .primary`，而状态规则是 `.icon-btn:hover`
 *   ⇒ 按整串做 Map 键会一条也匹配不上（第一版就是这个毛病）。 */
const atRuleTransitions = [];   // 落在 at-rule 里的 transition 块，供打印
function transitionSets(rules) {
  const map = new Map(); // 基础选择器 → { props:Set, all:bool, none:bool }
  for (const r of rules) {
    const tds = r.props.filter((p) => p.prop === 'transition' || p.prop.startsWith('transition-'));
    if (!tds.length) continue;
    if (r.atRule) { atRuleTransitions.push(`${r.atRule} 内：${r.selector}`); continue; }
    for (const one of r.selector.split(',')) {
      const key = one.trim().replace(/\s+/g, ' ');
      if (!key) continue;
      let entry = map.get(key);
      if (!entry) { entry = { props: new Set(), all: false, none: false }; map.set(key, entry); }
      for (const d of tds) {
        if (d.prop !== 'transition') continue;           // 只看简写 transition，长手写不参与本判据
        const val = d.val.trim();
        if (val === 'none') { entry.none = true; continue; }
        for (const part of val.split(',')) {
          const p = part.trim().split(/\s+/)[0];
          if (p === 'all') entry.all = true;
          else if (p) entry.props.add(p);
        }
      }
    }
  }
  return map;
}

const problems = [];
let checked = 0;
let skipped = 0;

/* ---- 哪些 CSS 真的会被浏览器加载（扫 *.html 的 <link rel="stylesheet">）----
 * 用途：把「本文件没人加载」这件事**打印出来**。v0.173 实测 `shared/design-system.css`
 * 没有任何 HTML 引用它 —— 于是 v0.171 声称"按指南整改了 15 处 transition"里，
 * 有 4 处在**不影响 UI 的死文件**里。不打印的话，下一轮会把"门禁绿了"误读成
 * "UI 受保护了"。**判据要盯行为，不盯语法。** */
function loadedCss() {
  const set = new Set();
  for (const f of fs.readdirSync(ROOT)) {
    if (!f.endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)) {
      const href = (m[0].match(/href=["']([^"']+)["']/) || [])[1];
      if (href) set.add(href.split('?')[0].replace(/^\.?\//, ''));
    }
  }
  return set;
}
const LOADED = loadedCss();
const scanned = [];
const dead = [];

for (const rel of FILES) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) continue;
  scanned.push(rel);
  if (!LOADED.has(rel)) dead.push(rel);
  const raw = fs.readFileSync(fp, 'utf8');
  const lines = raw.split(/\r?\n/);
  const rules = parseRules(raw);
  const trans = transitionSets(rules);

  for (const r of rules) {
    if (!PSEUDO_TEST.test(r.selector)) continue;
    // reduced-motion 块里的 `:hover { transform: none }` 是**刻意的压制**，不是"漏列属性"
    if (/prefers-reduced-motion/.test(r.atRule)) continue;

    // 找与"基础选择器"精确同名的 transition 块
    let entry = null;
    let baseSel = null;
    for (const cand of r.selector.split(',')) {
      const b = stripPseudo(cand);
      if (trans.has(b)) { entry = trans.get(b); baseSel = b; break; }
    }
    if (!entry) { skipped += r.props.length; continue; }   // 基础块没写 transition（或伪类在祖先）⇒ 不判
    if (entry.none || entry.all) continue;                 // none / all ⇒ 无"漏"可言

    // 定位该规则在文件里的行号（用于豁免注释与报错定位）
    // ⚠ 不能用 `lines.findIndex(l => l.includes(needle))`：注释里只要**提到**过这个选择器
    //   （例如「用例3：.c:hover 改 transform」），行号就会指到注释上，
    //   于是真正的豁免注释落到 3 行窗口之外 —— 豁免静默失效。
    //   只认「该选择器作为规则开头」的行：行首是它，后面跟 `{` 或 `,`。
    const first = r.selector.split(',')[0].trim();
    const headRe = new RegExp('^\\s*' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[,{]');
    const lineIdx = lines.findIndex((l) => headRe.test(l));

    for (const p of r.props) {
      if (p.prop.startsWith('--') || p.prop.startsWith('transition')) continue;
      if (NON_ANIMATED.has(p.prop)) continue;
      checked++;
      if (isCovered(p.prop, entry.props)) continue;

      const ctx = lines.slice(Math.max(0, lineIdx - 3), lineIdx + 1).join('\n');
      if (hasExemption(ctx)) continue;

      problems.push({
        loc: `${rel}:${lineIdx + 1}`,
        selector: baseSel,
        prop: p.prop,
        list: [...entry.props].join(', '),
      });
    }
  }
}

if (problems.length) {
  console.error('✗ 状态规则改了属性，但基础块的 transition 没列它（该属性会从"过渡"退化成"瞬变"）：');
  for (const p of problems) {
    console.error(`    ${p.loc}  ${p.selector}`);
    console.error(`        状态规则声明了 \`${p.prop}\`，transition 列表里没有`);
    console.error(`        当前列表：${p.list}`);
  }
  console.error('');
  console.error('  修：把该属性加进基础块的 transition 列表（沿用它原有的缓动/时长，别改手感）；');
  console.error('  确有理由让它瞬变 ⇒ 在状态规则上方 3 行内写 `hover-cov-ok: <至少 8 字理由>`。');
  process.exit(1);
}

console.log(`✓ transition 覆盖完整（比对 ${checked} 条「状态属性 × 基础块」对应关系，`
  + `另有 ${skipped} 条因基础块无 transition 而跳过 —— 那类仍靠人工）`);
console.log(`  扫描：${scanned.join('、')}`);
for (const d of dead) {
  console.log(`  ⚠ ${d} 没有被任何 *.html 加载 ⇒ 它改了也不影响 UI（本判据扫它只是顺带体检）`);
}
if (atRuleTransitions.length) {
  console.log(`  以下 transition 块在 at-rule 内，未参与本判据（reduced-motion 属预期）：`);
  for (const t of atRuleTransitions) console.log(`    · ${t}`);
}
