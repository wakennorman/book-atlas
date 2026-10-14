/* 「散文的 `**` 渲染不渲染」判据库 —— v0.218 新增。
 *
 * ## 这条规则哪来的
 *
 * 作者在数据里写 `**哥哥何塞·阿尔卡蒂奥**`、`**他连被人听见都还没准备好，却已经说给人听**`
 * 这类强调。实测（v0.218，按渲染面统计）：`characters[].note` 60 个、`events[].impact` 194 个、
 * `events[].summary` 16 个、`characters[].desc` 2 个 —— 共 **272 个 `**` ＝ 136 段成对粗体，
 * 0 段落单**。而这些字段全部走 `esc()` 直出 ⇒ 读者在人物卡 / 事件面板 / 时间轴上看到的是
 * **字面星号**。只有拆书正文经 `annoBody()` 渲染过（v0.141 的先例：「193/222 条的 body
 * 写过粗体，而原来走 esc()，星号原样显示给读者」→ 那次选了渲染）。
 *
 * ⇒ 判据：**有粗体就渲染**，不删作者写的强调。
 *
 * ## 两条出口，别混用
 *   · `escBold()` —— 进 innerHTML 的散文（人物卡 / 事件面板 / 关系依据 / 时间轴 / EPUB）；
 *   · `unbold()`  —— 进**纯文本**的地方（canvas 分享图、tooltip、title 属性）。
 * 混用就会出现「HTML 里字面星号」或「纯文本里冒出 `<strong>`」。
 *
 * ## 为什么判据在这里（不在 test/ 里）
 * 与 `ui-notes.mjs` 同一个理由：判据只写一份，守卫 import 它
 * （`test/guard-hygiene.mjs` 的 H2/H3 就是在守这件事 —— 判据抄两份必漂）。
 *
 * 本模块**纯函数、无顶层副作用**。
 */

/** 作者可能写强调的整句文字。`c.title` 不算（短身份标签，不是散文）。 */
export const PROSE_FIELDS = [
  'c.desc', 'c.fate', 'c.note', 'p.desc', 'it.desc',
  'e.summary', 'e.impact', 'e.text', 'ev.summary', 'ev.impact',
];

/** 这些字段里出现 `**` 时，读者看到的应该是什么（其余字段不上界面或没有粗体）。 */
export const BOLD_RENDERED_FIELDS = [
  '.characters[].note', '.characters[].desc', '.events[].summary', '.events[].impact',
];

/** `meta.style` 是**内部写作规范**（不上界面），里面写 `**` 与 `characters[]` 是应该的。 */
export const BOLD_EXEMPT_FIELDS = ['.meta.style'];

/** 机器键容器（值是 id / 机器值，不是散文）。 */
const MACHINE_KEYS = new Set(['id', 'chars', 'slug', 'key', 'from', 'to', 'place', 'firstCh', 'ch']);

/** `esc(field` —— 散文字段**直接**进 esc()。`escBold(` 与 `esc(unbold(…)` 都不匹配。 */
const directEsc = (field) => new RegExp(`(?<![A-Za-z])esc\\(\\s*${field.replace('.', '\\.')}`);
const escBoldOf = (field) => new RegExp(`escBold\\(\\s*(?:unbold\\(\\s*)?${field.replace('.', '\\.')}`);

/** app.js 里散文字段直接进 `esc()` 的地方：`['行 4751 esc(e.summary)', …]`（空数组＝干净）。 */
export function findDirectEscUses(src) {
  const out = [];
  src.split('\n').forEach((line, i) => {
    for (const f of PROSE_FIELDS) if (directEsc(f).test(line)) out.push(`行 ${i + 1} esc(${f})`);
  });
  return out;
}

/** app.js 里 `escBold()` / `unbold()` 各被用了几次。 */
export function boldUsage(src) {
  return {
    escBold: (src.match(/escBold\(/g) || []).length,
    unbold: (src.match(/\bunbold\(/g) || []).length,
  };
}

/** 在 app.js 里**一次都没走 escBold** 的散文字段。 */
export function fieldsWithoutBold(src) {
  return PROSE_FIELDS.filter((f) => !escBoldOf(f).test(src));
}

/** 属性 / canvas 这些纯文本面里误用 `escBold`（会冒出标签）的行号。 */
export function findBoldInPlainText(src) {
  return src.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /(data-tip-full|title=)="\$\{escBold/.test(l) || /wrapText\(ctx,\s*escBold/.test(l))
    .map(([n]) => `行 ${n}`);
}

/**
 * 扫一份 book json，按渲染面统计 `**`：`{ '.events[].impact': 194, … }`。
 * 路径按 `key[N]` 归一，机器键容器整键跳过（值是 id 不是散文）。
 */
export function tallyBoldByField(doc, prefix = '') {
  const out = {};
  const walk = (node, p) => {
    if (typeof node === 'string') {
      const n = (node.match(/\*\*/g) || []).length;
      if (n) out[p.replace(/\[\d+\]/g, '[]')] = (out[p.replace(/\[\d+\]/g, '[]')] || 0) + n;
      return;
    }
    if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (MACHINE_KEYS.has(k)) continue;
        walk(v, `${p}.${k}`);
      }
    }
  };
  walk(doc, prefix);
  return out;
}

/** 真数据里"既不在会渲染的面、又不在豁免清单"的 `**`。 */
export function strayBoldFields(tally) {
  const ok = new Set([...BOLD_RENDERED_FIELDS, ...BOLD_EXEMPT_FIELDS]);
  return Object.entries(tally).filter(([k]) => !ok.has(k)).map(([k, v]) => `${k}=${v}`);
}

/**
 * `**` 落单（个数为奇数）的字符串：`['characters[7].note', …]`（空数组＝干净）。
 *
 * 为什么单独查：落单的那一个 `**` 在 `escBold()` 的 `\*\*([^*]+)\*\*` 下**匹配不上**
 * ⇒ 读者会看到字面星号（v0.218 实测全库 0 处，但这条是"数据一改就可能长出来"的）。
 * 拆书正文有同款判据（`check-annotations.mjs` 规则⑧「`**` 必须偶数次」），这里是散文面那一半。
 */
export function unpairedBoldStrings(doc, prefix = '') {
  const out = [];
  const walk = (node, p) => {
    if (typeof node === 'string') {
      if ((node.match(/\*\*/g) || []).length % 2 === 1) out.push(p);
      return;
    }
    if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (MACHINE_KEYS.has(k)) continue;
        walk(v, `${p}.${k}`);
      }
    }
  };
  walk(doc, prefix);
  return out;
}