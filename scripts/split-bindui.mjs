#!/usr/bin/env node
/**
 * 【长期】工具：需要时手动跑，跑完不改仓库状态　（v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定）
 * 把 `bindUI()`（503 行）拆成 8 个函数（v0.197 · 债一 B2）
 *
 * ## 为什么拆
 *
 * `bindUI` 是 app.js 里**唯一**超过 400 行的函数（其余最大 139 行），
 * 它把 28 个互不相干的控件绑定堆在一起 ⇒ 改任何一处都要在 503 行里定位。
 * 方案见 `docs/债一B2-bindUI拆分方案.md`。
 *
 * ## 切分点是**机械**定的，不是拍脑袋
 *
 * 我扫了 `bindUI` 内全部 **35 个 `const`/`let` 局部变量**，
 * 再看每个注释块引用了哪些：
 *
 * > **34 个只在声明它的那一块内被用到；唯一的例外是 `clearQueryInputs`**
 * > （L5659 定义 → L5892 / L5894 使用，跨了 3 块）⇒ 提为顶层函数。
 *
 * ⚠ 顺带核实过一个看着像跨块的：`graphEl`（L6049 定义 / L6050 用）——
 *   L6026 那个是 **`initChart` 内的同名局部变量**，互不相干。名字相同 ≠ 同一个变量。
 *
 * ## ⭐ 核心自检：**把 8 个函数体拼回去，应当与原文逐行相同**
 *
 * 这是本脚本存在的理由。拆分最容易出的错就是**手滑改了一个字符**，
 * 而那种错在 review 时极难看出来（几千行 diff 里一个逗号）。
 * ⇒ 拆完之后，把各函数体按原顺序拼回去，与原文 `bindUI` 的函数体**逐行比对**，
 *   差一个字符就 exit 1。
 *
 * ## 另一个必须保证的：**调用顺序不变**
 *
 * 原来 503 行是**顺序执行**的；`document` 级委托是后注册的会盖掉先注册的，
 * 顺序错了会**静默失效**（表现为"点了没反应"，不报错）。
 * ⇒ `bindUI()` 里的 8 次调用严格按原分块顺序排，且 `bindUI` 本身排在原来的位置。
 *
 * 用法：
 *   node scripts/split-bindui.mjs          # 预览
 *   node scripts/split-bindui.mjs --write  # 落盘（幂等）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const APP = path.join(ROOT, 'js', 'app.js');

/**
 * 8 个新函数。每个给出在 `bindUI` 内的**行区间**（1-based，含）。
 *
 * ⚠ 区间是**按当前文件实测**出来的，不是估的。文件一改就可能不准 ——
 *   所以下面有自检：区间首行必须以 `function bindUI` 或某个注释开头，
 *   末尾必须以 `}` 或注释结尾，否则 exit 1。
 */
const CUTS = [
  { fn: 'bindSearchUI', from: 5608, to: 5670, title: '搜索 / 两人关系输入 / 标签按钮' },
  { fn: 'bindPlaceFilterUI', from: 5672, to: 5744, title: '地点筛选（自建 combo）' },
  { fn: 'bindSizeFilterUI', from: 5746, to: 5751, title: '人数过滤（大书只看主要人物）' },
  { fn: 'bindPanelDelegates', from: 5753, to: 5821, title: '面板事件委托 / 折叠 / 族谱补全 / 显示设置' },
  { fn: 'bindEdgeFilterUI', from: 5823, to: 5888, title: '关系过滤（亲缘桶 + 线条样式 + 预设）' },
  { fn: 'bindViewControls', from: 5889, to: 5979, title: '画布自救 / 复位 / 人物卡 / 使用说明' },
  { fn: 'bindChapterTimeUI', from: 5981, to: 6050, title: '长列表展开 / 聚焦条跟随 / 章节 / 时间旅行' },
  { fn: 'bindExportAiUI', from: 6052, to: 6108, title: '图上聚焦 / 导出 / AI 讲解 / 主题' },
];

/** `clearQueryInputs` 在原文里的区间（要提成顶层函数）。 */
/* ⚠ **从注释的第一行起**，不是从 const 那行起 —— 只摘 const 会把两行说明留在原处，
 *   拼回自检当场报出差异（第一版就是这么错的：from 写成 5658，差在第 50 行）。 */
const CLEAR_Q = { from: 5657, to: 5662 };

const src = fs.readFileSync(APP, 'utf8');
const srcLines = src.split('\n');
const lines = srcLines;

/* 幂等 */
if (src.includes('function bindSearchUI')) {
  console.log('（已拆分过，跳过。要重来请先 git checkout js/app.js）');
  process.exit(0);
}

/* ── 定位 bindUI 的范围（括号配平，跳过字符串/模板/注释） ── */
function matchBrace(from, arr) {
  const lines = arr || srcLines;
  let depth = 0, inStr = '', tpl = 0, inLine = false, inBlock = false;
  for (let i = from; i < lines.length; i++) {
    const L = lines[i];
    for (let k = 0; k < L.length; k++) {
      const c = L[k], n = L[k + 1];
      if (inLine) { if (c === '\n') inLine = false; continue; }
      if (inBlock) { if (c === '*' && n === '/') { inBlock = false; k++; } continue; }
      if (inStr) { if (c === '\\') { k++; continue; } if (c === inStr) inStr = ''; continue; }
      if (tpl) { if (c === '\\') { k++; continue; } if (c === '`') tpl--; continue; }
      if (c === '/' && n === '/') { inLine = true; break; }
      if (c === '/' && n === '*') { inBlock = true; k++; continue; }
      if (c === '"' || c === "'") { inStr = c; continue; }
      if (c === '`') { tpl = 1; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth--; if (depth === 0) return i; }
    }
    inLine = false;
  }
  return -1;
}

/* ⚠ 正则**不要**用 `$` 结尾：这个文件是 CRLF，`\r` 在行尾 ⇒ `/…\{$/` 永远不匹配。
 *   （实测 `grep -A` 能看到 `bindUI() {^M`，而 JS 读进来行尾带 `\r`。） */
const bindStart = lines.findIndex((l) => /^ {2}function bindUI\(\) \{\s*$/.test(l));
if (bindStart < 0) { console.error('✗ 找不到 bindUI 的声明行'); process.exit(1); }
const bindEnd = matchBrace(bindStart);
if (bindEnd < 0) { console.error('✗ bindUI 的括号没配平'); process.exit(1); }
const bindBodyFrom = bindStart + 1;          // 0-based，身体首行
const bindBodyTo = bindEnd;                  // 0-based，`  }` 那行

/* ── 校验 CUTS 覆盖了 bindUI 身体的全部，且区间首尾合理 ── */
const problems = [];
const bodyLen = bindBodyTo - bindBodyFrom + 1;   // 含结尾的 `  }`
console.log(`bindUI：L${bindStart + 1}–L${bindEnd + 1}，函数体 ${bodyLen} 行（含收尾）`);

/* 第一段应从 bindUI 身体的下一行开始，最后一段应到收尾前一行。 */
if (CUTS[0].from !== bindStart + 2) problems.push(`第一段应从 L${bindStart + 2} 开始，实际写的是 L${CUTS[0].from}`);
/* bindEnd 是 0-based 的收尾行下标；CUTS 用 1-based ⇒ 最后一段应止于 bindEnd + 1 - 1 = bindEnd。 */
if (CUTS[CUTS.length - 1].to !== bindEnd) problems.push(`最后一段应到 L${bindEnd}，实际写的是 L${CUTS[CUTS.length - 1].to}`);
/* 段与段之间允许有**空行 / 注释行**（那是上一段的收尾或下一段的开场白），
 * 但不允许夹着**代码** —— 夹了代码就意味着它被落在了两个函数之间（会变成全局泄漏）。
 * ⚠ 第一版要求「严格连续」，而实际每段末尾都有一行空行 ⇒ 误报；
 *   改成「跳过纯空行后仍连续」才是对的口径。 */
for (let i = 1; i < CUTS.length; i++) {
  const prevTo = CUTS[i - 1].to;
  const curFrom = CUTS[i].from;
  if (curFrom === prevTo + 1) continue;
  /* 中间只能有空行；有一行是代码就报。 */
  const gap = lines.slice(prevTo, curFrom - 1);   // 0-based: prevTo+1 .. curFrom-1（1-based）
  const hasCode = gap.some((l) => l.trim() !== '' && !/^ {4}(\/\/|\/\*)/.test(l));
  if (hasCode) {
    const at = prevTo + 1 + gap.findIndex((l) => l.trim() !== '' && !/^ {4}(\/\/|\/\*)/.test(l));
    problems.push(`第 ${i} 段与上一段之间夹着代码（L${at}）：「${lines[at - 1].trim().slice(0, 40)}」`);
  }
}
if (problems.length) {
  console.error('✗ 切分区间有问题：\n   ' + problems.join('\n   '));
  console.error('  ⇒ app.js 的行号变了（分区目录那轮插了标记）。先核对 CUTS 再改。');
  process.exit(1);
}

/* ── 取出各段（1-based → 0-based） ── */
/* ⚠ 每段要**吸收它后面的空行**，否则那些空行谁也不属于 ⇒
 *   拼回去时凭空少 6 行（实测 489 vs 495），而空行既不含代码也不影响行为。
 *   ⇒ 段尾一直吃到「下一个非空行为止」。 */
const segs = CUTS.map((c, i) => {
  let to = c.to;
  const limit = i + 1 < CUTS.length ? CUTS[i + 1].from : bindEnd + 1;
  while (to + 1 < limit && lines[to] !== undefined && lines[to].trim() === '') to++;
  return { ...c, realTo: to, body: lines.slice(c.from - 1, to) };
});

/* ── ⭐ 自检：拼回去与原文**剔除同一段之后**逐字相同 ──
 *
 * ## 判据为什么这么定（前两版都错在这里）
 *
 * 拆分后 `clearQueryInputs` 被提到顶层 ⇒ 它不再出现在任何一段里。
 * 所以「拼回去」那一坨比原文**必然少 6 行**。
 * ⇒ 要比就必须**两边剔掉同一段**：
 *
 *     拼出来（8 段，已不含 clearQueryInputs）  ==  原文（也剔掉那 6 行）
 *
 * 第一版拿「剔掉的」去比「没剔的」⇒ 495 vs 501 必然红。
 * 第二版改成「把 6 行插回」⇒ 而 body 里本来就有 ⇒ 变成 507 vs 501，还是红。
 * **两次都错在同一处：没把「比对双方的口径」对齐。**
 *
 * ## 它证明了什么
 *
 * 8 段合起来 == 原文去掉 clearQueryInputs ⇒ **一个字符都没改过**，只是搬了位置。
 * 这是「重构没改行为」最强的证据 —— 比任何"看起来对"都强，
 * 因为几千行 diff 里手滑改一个逗号，人眼是看不出来的。
 */
{
  const inCq = (ln) => ln >= CLEAR_Q.from && ln <= CLEAR_Q.to;
  const seg1 = segs[0].body.filter((_, i) => !inCq(CUTS[0].from + i));
  const full = [...seg1];
  for (let i = 1; i < segs.length; i++) full.push(...segs[i].body);

  /* 原文同样剔掉 clearQueryInputs 那几行，才是对等口径。 */
  const orig = lines.slice(bindBodyFrom, bindBodyTo)
    .filter((_, i) => !inCq(bindBodyFrom + 1 + i));

  if (full.length !== orig.length || JSON.stringify(full) !== JSON.stringify(orig)) {
    let at = -1;
    for (let k = 0; k < Math.max(full.length, orig.length); k++) if (full[k] !== orig[k]) { at = k; break; }
    console.error(`✗ 拼回去与原文不一致（第一处在第 ${at} 行；拼出来 ${full.length} 行 / 原文 ${orig.length} 行）：`);
    for (let d = -1; d <= 1; d++) {
      console.error(`     [${d >= 0 ? '+' : ''}${d}] 拼：${JSON.stringify((full[at + d] ?? '(无)').slice(0, 60))}`);
      console.error(`     [${d >= 0 ? '+' : ''}${d}] 原：${JSON.stringify((orig[at + d] ?? '(无)').slice(0, 60))}`);
    }
    process.exit(1);
  }
  console.log(`  ✓ 拼回自检通过：${segs.length} 段拼起来，与原文（同口径剔除 clearQueryInputs `
    + `${CLEAR_Q.to - CLEAR_Q.from + 1} 行后）${orig.length} 行**逐字相同**`);
}

/* ── 生成新代码 ── */
function bodyToFunction(fn, title, body) {
  return [
    `  /* ---------------- ${title} ---------------- */`,
    `  function ${fn}() {`,
    ...body,
    '  }',
    '',
  ];
}

const out = [];
/* clearQueryInputs 提成顶层 —— 放在 bindUI 之前。 */
out.push('  /* ---------------- 清空查询框（bindSearchUI 与 bindViewControls 都要用） ---------------- */');
out.push('  /* ⚠ v0.197：它原先是 bindUI 内的局部 const，是那个函数里**唯一**被跨块引用的局部变量');
out.push('     （定义于搜索块、被「复位视图」与「重置」两块调用）⇒ 拆成独立函数后就够不到了，');
out.push('     只能提到顶层。**这是本次拆分里唯一一处改变作用域的动作**，也是唯一有真实风险的点。 */');
out.push(...lines.slice(CLEAR_Q.from - 1, CLEAR_Q.to));
out.push('');

for (const s of segs) {
  let body = s.body;
  if (s.fn === 'bindSearchUI') {
    body = body.filter((_, i) => {
      const ln = CUTS[0].from + i;
      return !(ln >= CLEAR_Q.from && ln <= CLEAR_Q.to);
    });
  }
  out.push(...bodyToFunction(s.fn, s.title, body));
}

/* bindUI 缩成调度器。 */
out.push('  /* ---------------- 绑定所有控件（v0.197：由 503 行拆成 8 个函数） ---------------- */');
out.push('  /* ⚠ **调用顺序不能改**：document 级委托是后注册的会盖掉先注册的，');
out.push('     顺序错了会**静默失效**（表现为「点了没反应」，不报错）。');
out.push('     各段在原 bindUI 里本来就是这个先后，拆分时按原样保留。 */');
out.push('  function bindUI() {');
for (const s of segs) out.push(`    ${s.fn}();`);
out.push('  }');

/* 替换掉原来的 bindUI。 */
const newLines = [...lines.slice(0, bindStart), ...out, ...lines.slice(bindEnd + 1)];
const final = newLines.join('\n');

/* ── 写前自检 ── */
if (final.includes('function bindUI') === false) { console.error('✗ 结果里没有 bindUI'); process.exit(1); }
for (const s of segs) {
  if (!final.includes(`function ${s.fn}()`)) { console.error(`✗ 少了 ${s.fn}`); process.exit(1); }
}
/* bindUI 必须很短 */
{
  const bi = newLines.findIndex((l) => /^ {2}function bindUI\(\) \{\s*$/.test(l));
  const be = matchBrace(bi, newLines);
  const len = be - bi + 1;
  if (len > 20) { console.error(`✗ 新的 bindUI 有 ${len} 行，超过 20`); process.exit(1); }
  console.log(`  ✓ 新 bindUI ${len} 行（≤ 20）`);
}

if (!WRITE) {
  console.log(`\n（预览）${lines.length} 行 → ${newLines.length} 行`);
  console.log(`        新增 ${segs.length} 个函数 + 1 个顶层 clearQueryInputs`);
  process.exit(0);
}

fs.writeFileSync(APP, final, 'utf8');
console.log(`\n✓ 已拆分：${lines.length} → ${newLines.length} 行`);
console.log('  下一步：node --check js/app.js && node test/app-func-size-guard.mjs');
