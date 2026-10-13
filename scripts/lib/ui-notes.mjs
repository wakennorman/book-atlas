/* 「内部措辞不进 UI」判据库 —— v0.213 新增。
 *
 * ## 这条规则哪来的
 *
 * 用户在人物卡里看到：「安帕萝·摩斯科特 …… 用户 2026-10-04 报"搜不到"的人之一」。
 * 原话：「都说了不要把这种对用户无用的信息显示出来」。全类排查命中 **35 处**
 * （29 处 characters[].note + relations[].note + relations[].events[].text
 *  + 2 处 meta.style + annotations note）—— 施工台账（版本号、本轮、合并拆分史、
 * 用户报告、机器 id 引用）混进了**浏览器直取的渲染字段**。
 *
 * ## 判据范围（对准渲染面，不是全仓库）
 *
 * 只扫**浏览器会 fetch 的源文件**：data/books.json、data/<slug>.json、
 * data/annotations/<slug>.json（发现方式从 books.json 来，不写死清单）。
 * 明确**不扫**（check-ui-notes.mjs 会打印）：
 *   · data/<slug>.graph.json / .text.json —— 生成物，源干净它们才干净，
 *     且新鲜度由 check-packs-sync.mjs 守；
 *   · data/*-ok.json / *.altnames-sources.json 等台账 —— 浏览器从不 fetch，
 *     版本号与判据笔记是它们的**正常工作内容**。
 *
 * ## 误报防护（假信号源比没有更坏）
 *
 *   · `id[=＝]` 必须带 `\b`：peak 的 meta.style 里 `solid＝支撑派生`
 *     含 `id＝` 子串，裸模式会误报（v0.213 实测踩到）。
 *   · 裸 `搜不到` **不收**：未来合法文案可能写「这个名字原著里搜不到」，
 *     而它的真实泄漏形态（用户…报…）已被模式 3/4 覆盖。
 *   · 裸 `本轮` **不收**：只收 `本轮[补改修拆合新清]`（施工动词紧跟），
 *     体育类书可能出现「本轮比赛」。
 *   · 机器键容器整键跳过：`id`（事件 id 形如 e-92-3）、`events`（anno 的
 *     字符串数组是 id 列表）、`chars`，以及 `relations[N].basis`
 *     （审计痕迹，浏览器不渲染——app.js 只渲染 anno 的 basis）。
 *   · `内部事件 id` 模式**不扫 annotations 的 `body`**：那是 annoBody() 的
 *     行内引用锚点，会替换成「事件短名」按钮渲染（v0.141/v0.174 既有设计），
 *     不是给读者看裸 id；解析不了的情形由 check-annotations.mjs ⑨ 守。
 *     `title` 不链接化（esc() 直出）⇒ 仍然扫。
 *
 * 本模块**纯函数、无顶层副作用**（被 check-ui-notes.mjs 与测试共同 import）。
 */

/** 施工痕迹模式。每条带 name（报告用）与 why（人话解释）。 */
export const LEAK_PATTERNS = [
  { name: '版本号', re: /v\d+\.\d+/, why: '施工版本号（v0.x）是内部台账，读者不需要知道哪一版改的' },
  { name: '本轮施工', re: /本轮[补改修拆合新清]/, why: '「本轮补/改/修…」是施工会话用语' },
  { name: '带日期的用户报告', re: /用户 ?20\d\d-\d\d-\d\d/, why: '「用户 20xx-xx-xx 报…」把内部报告过程渲染给了读者' },
  { name: '用户视角内部话', re: /用户曾误以为|用户误以为|用户报|用户反馈/, why: '读者不需要知道谁误以为过、谁报过' },
  { name: '待办标记', re: /待填|TODO|FIXME|施工|⬜/, why: '施工待办不是读者信息' },
  { name: '合并拆分史', re: /误并为|并成一个人|曾把.{1,12}(?:并为|误并)/, why: '合并/拆分历史属施工台账（ docs 与记忆，不进数据）' },
  { name: '旧字段引用', re: /原 desc|原 fate|原先写|原先拆|原标[「『"]/, why: '「原 desc」指内部旧数据，读者眼里只有现在这一份' },
  { name: '内部文档引用', re: /docs\/\S/, why: 'docs/ 路径是维护者路径' },
  { name: '内部数据文件引用', re: /\bdata\/[\w.-]+\.json\b|本项目\s*data\//, why: '「本项目 data/xxx.json」是仓库路径，读者眼里没有这个文件（v0.213 两处 annotations note 实测）' },
  { name: '内部 id 引用', re: /\bid[=＝]/, why: 'id=xxx 是机器键，不是读者语言（\b 边界防 solid＝ 误报）' },
  { name: '内部事件 id', re: /\be-?\d[\w-]*/, why: 'e-92-3 / e1 / e01 这类事件 id 是机器键；读者该看事件名（mode: 拆书 body 的行内引用除外——那是链接锚点）' },
];

/** annotations 里 `body` 是 annoBody() 链接化的字段（行内 id → 事件短名按钮）。 */
export const INLINE_REF_PATH = /^(\.items\[\d+\]|\.global\[\d+\])\.body$/;

/** 该键是否为「机器键容器」（值直接跳过，不递归也无妨——它们的值本就是 id/URL）。 */
function isMachineKey(key) {
  return key === 'id' || key === 'chars' || key === 'slug' || key === 'key'
    || key === 'from' || key === 'to' || key === 'place' || key === 'evidence'
    || key === 'file' || key === 'graphFile' || key === 'textFile'
    || key === 'firstCh' || key === 'ch' || key === 'generation' || key === 'gender';
}

/**
 * 深度遍历 JSON，对每个「可能渲染给读者」的字符串调用 visit(str, path)。
 * path 形如 `characters[12].note` / `relations[3].events[0].text` / `meta.style`。
 *
 * 豁免（见头部「误报防护」）：
 *   · isMachineKey 的键；
 *   · `events` 键且值为**字符串数组**（anno 的 id 列表；relations 的 events
 *     是对象数组，含渲染文本 ⇒ 照样递归）；
 *   · `relations[N].basis`（不渲染的审计痕迹）。
 */
export function walkRenderedStrings(node, visit, path = '') {
  if (typeof node === 'string') { visit(node, path, INLINE_REF_PATH.test(path)); return; }
  if (Array.isArray(node)) {
    node.forEach((x, i) => walkRenderedStrings(x, visit, `${path}[${i}]`));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (isMachineKey(k)) continue;
      if (k === 'events' && Array.isArray(v) && v.every((x) => typeof x === 'string')) continue;
      if (/^\.relations\[\d+\]$/.test(path) && k === 'basis') continue;
      walkRenderedStrings(v, visit, `${path}.${k}`);
    }
  }
}

/** 单串命中第一条模式则返回 { name, why, sample }，否则 null。 */
export function matchLeak(text, opts = {}) {
  for (const p of LEAK_PATTERNS) {
    if (opts.allowEventIds && p.name === '内部事件 id') continue;
    const m = p.re.exec(text);
    if (m) return { name: p.name, why: p.why, sample: text.slice(Math.max(0, m.index - 20), m.index + 30) };
  }
  return null;
}

/** 扫一份 book json（或任意结构），返回 [{ path, text, name, why }]（空数组＝干净）。 */
export function collectLeaks(doc) {
  const leaks = [];
  walkRenderedStrings(doc, (text, path, inlineRef) => {
    const hit = matchLeak(text, { allowEventIds: inlineRef });
    if (hit) leaks.push({ path, text, name: hit.name, why: hit.why, sample: hit.sample });
  });
  return leaks;
}
