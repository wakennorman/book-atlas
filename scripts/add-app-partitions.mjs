#!/usr/bin/env node
/**
 * 【一次性】一次性补丁前缀　（v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定）
 * 给 `js/app.js` 加分区目录（v0.196 · 债一 B1）
 *
 * ## 为什么
 *
 * app.js **6039 行、251 个顶层符号、零分区标记**
 * （实测 `grep -c "^/\* " js/app.js` = 1，只有一个文件头注释）。
 * 所有组织全靠函数名约定 ⇒ 在这个文件里定位一段逻辑只能 grep 6000 行。
 *
 * 这个脚本**只加注释**，不改任何逻辑。
 *
 * ## 为什么不手工写分区标记
 *
 * 手工插的标记会**过期**：函数挪了位置、名字改了，标记还留在原地，
 * 于是它开始骗人 —— 而一个骗人的目录比没有目录更糟。
 * 所以分区由**行号 + 符号名**机械生成，且每次重跑都会按当前文件重新对拍：
 * 对不上就 exit 1。
 *
 * ⚠ 与 v0.195 那两个教训同源：
 *   ① 注释里**不能**出现「斜杠 + 星」相邻的字面组合（否则注释提前闭合，
 *      报错落在后面十几行的模板字符串上）；
 *   ② 写文件前必须验「标记落在注释里」且「标记行之后能找到闭合符」。
 *
 * 用法：
 *   node scripts/add-app-partitions.mjs          # 预览
 *   node scripts/add-app-partitions.mjs --write  # 落盘（幂等）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
  const FORCE = process.argv.includes('--force');
const APP = path.join(ROOT, 'js', 'app.js');
/* v0.196：导出给守卫 `test/app-partitions-guard.mjs` —— 分区表必须**只有一份**。
 *   守卫抄一份的话，改了这边忘了那边，它就会拿旧表去对新文件，报出一堆假红。 */
export { PARTS };
export const APP_PATH = APP;

/**
 * 取分区表（给守卫用）。
 *
 * ⚠ `test/guard-hygiene.mjs` 要求「被守卫 import 的模块必须**导出函数**」——
 *   只 `export const PARTS`（数据）过不了那一关。第一版只导出了数据，
 *   于是 guard-hygiene 当场报「没有 ⇒ 守卫没法直接调判据」。
 *   ⇒ 这里导出一个取表函数；守卫也改用它。
 *
 * @returns {{anchor:string,title:string}[]}
 */
export function partitionTable() {
  return PARTS.map((p) => ({ anchor: p.anchor, title: p.title }));
}

/**
 * 分区表。`anchor` 是该区的**第一个符号名**（不是行号 —— 行号会漂，名字不会）。
 * 顺序必须与文件里出现的顺序一致。
 *
 * ⚠ 这份表是**人定的**（按语义），其余全是机械生成。
 *   分界点选在「函数名开始讲另一件事」的地方，不是按行数硬切。
 */
const PARTS = [
  { anchor: 'bandTextWidth', title: '图注量算与分组图注' },
  { anchor: 'edgeKey', title: '边的基础工具与扇形布局' },
  { anchor: 'prefetchText', title: '文案包预取（首屏只下图包，文案空闲时再取）' },
  { anchor: 'foldVM', title: '折叠（次要人物默认收起）' },
  { anchor: 'kinBadge', title: '称谓徽章' },
  { anchor: 'cssVar', title: '阵营 / 颜色 / 分组' },
  { anchor: 'syncDisplayUI', title: '显示设置（色盲配色、字号）' },
  { anchor: 'passEdgeFilter', title: '关系过滤（亲缘 / 实虚线）' },
  { anchor: 'isCharHidden', title: '可见性与地点筛选' },
  { anchor: 'charCh', title: '剧透：登场章 / 时间旅行判定' },
  { anchor: 'boot', title: '启动与数据加载' },
  { anchor: 'renderHeader', title: '页眉 / 图例 / 页脚' },
  { anchor: 'comboSub', title: '下拉与搜索候选' },
  { anchor: 'nodeDegree', title: '节点大小、分类与排序' },
  { anchor: 'focusSet', title: '聚焦（1–2 跳）' },
  { anchor: 'forceLayout', title: '力导向布局' },
  { anchor: 'buildOption', title: 'ECharts option 装配' },
  { anchor: 'relaxPositions', title: '位置松弛、适配与标签' },
  { anchor: 'freezeNow', title: '视口记忆与全屏' },
  { anchor: 'buildGenerationPositions', title: '代际布局（横 / 纵）' },
  { anchor: 'measureBands', title: '图注抽稀' },
  { anchor: 'setView', title: '视图切换与记忆' },
  { anchor: 'applyZoom', title: '缩放与离屏提示' },
  { anchor: 'updateCountHint', title: '人数提示 / 聚焦条 / 提示气泡' },
  { anchor: 'flashTo', title: '跳转与清除查询' },
  { anchor: 'neighborhoodOf', title: '锁定（只看这一片）' },
  { anchor: 'onGraphClick', title: '图上点击与栈栏' },
  { anchor: 'initChart', title: '图表初始化与监听清理' },
  { anchor: 'findRel', title: '查找 / 无障碍播报' },
  { anchor: 'focusNode', title: '键盘游标' },
  { anchor: 'refreshHighlightCaches', title: '高亮缓存' },
  { anchor: 'renderLockedPanel', title: '右栏：锁定态' },
  { anchor: 'selectCharacter', title: '右栏：人物 / 关系 / 事件' },
  { anchor: 'handlePanelClick', title: '右栏事件委托' },
  { anchor: 'fullTip', title: '截断文字气泡' },
  { anchor: 'placeTip', title: '地点气泡与地点面板' },
  { anchor: 'applyPlaceFilter', title: '地点筛选' },
  { anchor: 'renderCharacterPanel', title: '人物卡 / 关系卡 / 事件卡' },
  { anchor: 'bfs', title: '两人关系（BFS 最短路）' },
  { anchor: 'renderTimeline', title: '重大事件轴' },
  { anchor: 'annotationsReady', title: '拆书素材（分章解读）' },
  { anchor: 'timeCeiling', title: '时间旅行' },
  { anchor: 'goChapter', title: '章节视图与推进' },
  { anchor: 'jsSafe', title: '导出：通用工具' },
  { anchor: 'standaloneBook', title: '导出：单文件 HTML' },
  { anchor: 'roundRectPath', title: '导出：分享图 PNG' },
  { anchor: 'buildGraphSvg', title: '导出：位置 / 打印版 SVG' },
  { anchor: 'toast', title: '导出：toast 与文字换行' },
  { anchor: 'buildCharacterPng', title: '导出：人物卡 PNG' },
  { anchor: 'aiConfig', title: 'AI 讲解：配置' },
  { anchor: 'aiCeiling', title: 'AI 讲解：剧透天花板与上下文' },
  { anchor: 'aiPrompt', title: 'AI 讲解：提示词与渲染' },
  { anchor: 'aiAsk', title: 'AI 讲解：发问与追问' },
  { anchor: 'rasterizeSvg', title: '导出：位图化' },
  { anchor: 'epubPage', title: '导出：阅读伴侣 EPUB' },
  { anchor: 'runExport', title: '导出：总入口' },
  { anchor: 'syncSpoilerButton', title: '剧透设置' },
  { anchor: 'runHelpAct', title: '「怎么用」演示' },
  { anchor: 'revealChar', title: '人物揭示' },
  { anchor: 'bindSearchUI', title: 'UI 绑定：搜索 / 两人关系' },
  { anchor: 'bindPlaceFilterUI', title: 'UI 绑定：地点筛选' },
  { anchor: 'bindSizeFilterUI', title: 'UI 绑定：人数过滤' },
  { anchor: 'bindPanelDelegates', title: 'UI 绑定：面板委托 / 折叠 / 显示' },
  { anchor: 'bindEdgeFilterUI', title: 'UI 绑定：关系过滤' },
  { anchor: 'bindViewControls', title: 'UI 绑定：画布 / 复位 / 使用说明' },
  { anchor: 'bindChapterTimeUI', title: 'UI 绑定：章节 / 时间旅行' },
  { anchor: 'bindExportAiUI', title: 'UI 绑定：导出 / AI / 主题' },
  { anchor: 'bindUI', title: 'UI 绑定总入口（v0.197 由 503 行拆成上面 8 个）' },
];

/** 找出所有顶层符号的行号。
 *  ⚠ v0.209 起**导出**给 `test/app-partitions-guard.mjs` —— 守卫要拿它去核目录里
 *    自称的「M 个顶层符号」。**只此一份**：抄一份的话，改了这边忘了那边，
 *    守卫就会拿旧口径去对新文件（同 `PARTS` 那条教训）。 */
export function topLevelSymbols(lines) {
  const out = [];
  lines.forEach((l, i) => {
    const m = /^ {2}(?:async )?function (\w+)|^ {2}const (\w+) = (?:function|\()/.exec(l);
    if (m) out.push({ line: i + 1, name: m[1] || m[2] });
  });
  return out;
}

/** 主流程：只在**直接运行时**才做，import 时不动文件。
 * ⚠ v0.196：守卫 `test/app-partitions-guard.mjs` 要 import 这个文件拿 `PARTS`，
 *   而第一版的顶层代码一 import 就开始读 app.js / 跑插入逻辑 ⇒ 守卫那边直接跑了整个脚本。
 *   ⇒ 包进 main() 并加下面的直接运行判断。
 */
/** 纯函数：把 `src` 变成「分区目录已生成」的版本。**不做 I/O、不 `process.exit`。**
 *  @param {string} src  `js/app.js` 的原文
 *  @param {{force?:boolean}} [opt]  `force` = 无视「已打过分区」，重生成目录
 *  @returns {{out:string, problems:string[], skipped?:boolean, stats?:object}}
 *    `problems` 非空 ⇒ `out` 不可信（调用方必须当成失败）。
 *
 * ⚠ v0.209：从 `main()` 里抽出来。原因是「**重跑一次不该改动任何一行**」这件事
 *   只有抽成纯函数才验得了 —— `test/app-partitions-guard.mjs` 在**进程内** import 它、
 *   断言 `out === src`。本机起不了子进程，守卫没法"跑一遍脚本再看 `git diff`"。
 *   抽出来的直接收益：脚本自己那句「落盘（幂等）」终于**有东西守**了 ——
 *   实测它**并不幂等**（`--force --write` 每跑一次多塞空行），而当时没有任何门禁会红。
 */
export function partitionedSource(src, { force = false } = {}) {
  const problems = [];
  let lines = src.split('\n');

  /* 幂等：已打过分区就 skip，除非 force。
   * ⚠ v0.197 加 force 的原因：拆分 bindUI 之后分区表变了（多了 8 个函数），
   *   而旧目录已经打在文件里 ⇒ 「跳过」就意味着目录停在旧状态。
   *   原来的提示是「先 git checkout js/app.js」—— 可那会把**拆分一起回滚掉**
   *   （本轮真踩了：一次 git checkout 把刚做完的拆分抹了）。
   *   ⇒ 提供 force：只重生成目录，不动逻辑。 */
  if (src.includes('══ 区域') && !force) return { out: src, problems, skipped: true };
  if (src.includes('══ 区域') && force) {
    /* 去掉旧的顶部目录（到第一个块结束符）与所有分区标记行（含它们后面的空行）。 */
    const end = src.indexOf('*/');
    /* ⚠ v0.209 修：`end + 2` 之后紧跟的那个换行是**旧目录最后一行自己的换行**，
     *   而下面重建时会再写一行目录收尾 ⇒ 必须把这个换行吃掉，否则每重跑一次多一个空行
     *   （另一个来源见下面 `lines = [...]` 那段 —— 两个加起来才是"每跑一次涨几行"）。
     *   `\r?` 是给本机 CRLF 工作区留的 —— 本仓 `core.autocrlf=true`，
     *   但生成出来的目录行是 LF ⇒ 那个换行可能是 `\n` 也可能是 `\r\n`。 */
    const body = src.slice(end + 2).replace(/^\r?\n/, '');
    const outLines = [];
    const ls0 = body.split('\n');
    for (let i = 0; i < ls0.length; i++) {
      if (/^ {2}\/\* ══ 区域 /.test(ls0[i])) {
        if (ls0[i + 1] !== undefined && ls0[i + 1].trim() === '') i++;   // 连带吃掉空行
        continue;
      }
      outLines.push(ls0[i]);
    }
    /* ⚠ v0.209 修：原来这里多写了一个 `''` —— 那是"每跑一次多几个空行"的另一个来源
     *   （`body` 那一段和它前面的换行被数了两遍）。
     *   ⚠ 写这段注释时又踩了本文件开头警告过的坑：注释里**不能**出现「星 + 斜杠」相邻的组合，
     *     第一版就那么写了 ⇒ 注释提前闭合，`node --check` 把错报在十几行之后。
     *   脚本的注释写着「落盘（幂等）」，而实测每跑一次行数就涨（本轮手工还原过
     *   6655 → 6656 → 6657 → 6659 —— 增量不固定，因为两个来源是分两次修的），
     *   **没有任何门禁会红**：P4c 只核目录里那个数，而那个数每次都会被重算 ⇒ 永远是对的。
     *   ⇒ 现在由守卫的 P5 在进程内跑这个函数、断言 `out === src`（见本文件顶部的说明）。 */
    lines = ['/* 书脉 BookAtlas · 前端逻辑', ' * 数据与渲染分离：每本书一个 JSON，见 data/ 目录。', ' */', ...outLines];
  }

  const syms = topLevelSymbols(lines);
  const byName = new Map(syms.map((s) => [s.name, s]));

  /* 校验每个 anchor 都存在，且顺序与文件一致。 */
  const missing = [];
  const resolved = [];
  let lastLine = 0;
  for (const p of PARTS) {
    const s = byName.get(p.anchor);
    if (!s) { missing.push(p.anchor); continue; }
    if (s.line <= lastLine) { missing.push(`${p.anchor}（顺序不对：L${s.line} <= L${lastLine}）`); continue; }
    lastLine = s.line;
    resolved.push({ ...p, line: s.line, next: null });
  }
  if (missing.length) {
    problems.push('有 anchor 找不到或顺序不对：' + missing.join('、')
      + ' ⇒ app.js 的结构变了（函数改名/挪位），先核对再改这张表。');
    return { out: src, problems };
  }
  /* 填 next（每个区的结束行 = 下一个区的起始行 - 1）。 */
  for (let i = 0; i < resolved.length; i++) {
    resolved[i].next = i + 1 < resolved.length ? resolved[i + 1].line : lines.length;
  }

  /* ── 顶部目录 ──
   * ⚠ 那个「文件共 N 行」先写占位 0：此刻还没插标记，行数不是最终的 ——
   *   真正的行数在 `lines.splice(0, 3, ...idx)` 之后回填，见那一段的注释。 */
  const idx = [
    '/* 书脉 BookAtlas · 前端逻辑',
    ' * 数据与渲染分离：每本书一个 JSON，见 data/ 目录。',
    ' *',
    ' * ## 分区目录（v0.196 由 scripts/add-app-partitions.mjs 生成，勿手改）',
    ' *',
    ' * 这个文件是**单文件**的（纯静态、零构建，见 docs/工程债立项-2026-10-12.md），',
    ' * 所以「找代码在哪」只能靠下面这张表。加新代码时请把函数落进已有的区；',
    ' * 确实要开新区，在 `scripts/add-app-partitions.mjs` 的 `PARTS` 里加一行再重跑。',
    ' *',
    ' * 文件共 0 行、0 个顶层符号，0 个分区。',   // ← 占位，插完标记后回填（见下方 splice 之后）
    ' *',
    ' * | 区域 | 起始符号 | 本区符号数 |',
    ' * |---|---|---|',
    ...resolved.map((r, i) => {
      const n = syms.filter((s) => s.line >= r.line && s.line < r.next).length;
      return ` * | ${i + 1}. ${r.title} | \`${r.anchor}\` | ${n} |`;
    }),
    ' *',
    ' * ⚠ **表里刻意不写行号。** 第一版写了，结果是**假的**：',
    ' *   插入这些标记本身会让行号整体后移，表里的坐标立刻对不上',
    ' *   （实测插入后 L19 已经不是「图注量算」，而是这张表自己的一行）。',
    ' *   ⇒ 一个会骗人的目录比没有目录更糟。改用**符号名**定位：',
    ' *   在编辑器里搜 `function <符号名>` 就是这一区的开头。',
    ' */',
  ];

  /* ── 逐个分区插标记 ──
   * ⚠ 从后往前插，前面的行号才不被前面的插入影响。 */
  for (let i = resolved.length - 1; i >= 0; i--) {
    const r = resolved[i];
    const at = r.line - 1;                    // 0-based
    /* ⚠ 标记里**不写行号** —— 插入标记本身会让行号后移，写上去就是假坐标（同顶部目录）。 */
    lines.splice(at, 0, `  /* ══ 区域 ${i + 1}/${resolved.length}：${r.title} ══ */`, '');
  }

  /* 顶部目录替换掉原来的 3 行文件头。 */
  lines.splice(0, 3, ...idx);

  /* ⚠ v0.209 修：`idx` 是在**插标记之前**造的，那时 `total` 还是"没插标记"的行数
   *   ⇒ 目录里那个「文件共 N 行」**永远偏小**，偏小的量正好是**本次插入的总行数** ——
   *   68 个标记 × 2 行（标记 + 空行）= 136，加上目录比原来的 3 行文件头多出的 85 行，合计 **221**。
   *   而在 HEAD 上它已经偏了 **385** 行（自称 6255 / 实际 6640；连「265 个顶层符号」
   *   也是过期的，实际 266）—— 因为守卫 `test/app-partitions-guard.mjs` 的 P4b
   *   只查"那句话在不在"、**不核数** ⇒ 十几轮都没人发现。
   *   ⇒ 两处一起修：守卫补 P4c 真的核数，这里在**最终形状**上回填。
   *   （按内容定位那一行，不写死下标 —— 写死的话改一次目录就要跟着改。） */
  {
    const hi = lines.findIndex((l) => /^ \* 文件共 \d+ 行、\d+ 个顶层符号，\d+ 个分区。$/.test(l));
    if (hi < 0) {
      problems.push('顶部目录里找不到「文件共 …」那一行，没法回填行数');
      return { out: src, problems };
    }
    lines[hi] = ` * 文件共 ${lines.length} 行、${syms.length} 个顶层符号，${resolved.length} 个分区。`;
  }

  const out = lines.join('\n');

  /* ⚠ 写前自检（v0.195 的教训：判据必须真的能挡住坏结果） */
  /* ① 每个分区标记**自己就是**一条自闭合注释（`/* … *\/`），不依附任何块 ——
   *    ⚠ 第一版误判成"必须在某个块内"，于是 57 条标记全被报成"落在注释块外"。
   *    真正要验的是：① 标记行本身以注释形式开头且自闭合；② 标记之后仍有闭合符
   *    （证明后面原有的块没被我劈开）。 */
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!/══ 区域/.test(t)) continue;
    if (!t.startsWith('/*') || !t.endsWith('*/')) {
      problems.push(`L${i + 1}：分区标记不是自闭合注释`);
    }
    /* 标记之后必须还有闭合符 —— 否则说明它插进了某个块中间，把那个块劈开了。 */
    if (!lines.slice(i + 1).some((l) => l.includes('*/'))) {
      problems.push(`L${i + 1}：标记之后找不到块闭合（可能插进了某个块中间）`);
    }
  }
  /* ② 去掉**我插入的那些行**（分区标记行 + 它们后面的空行 + 新顶部目录）后，
   *    剩下的必须与原文逐行相同。
   * ⚠ 第一版写的是「过滤掉所有空行」，那会把**原文里本来就有的空行**也滤掉，
   *   于是两边必然不等 —— 一个判据不准的自检会把每次改动都拒掉。 */
  if (!force) {
    /* ⚠ `force` 重生成时**不做**这条比对：此时「原文」里含**旧目录**，
     *   而新目录会替换它 ⇒ 必然不等（实测第一处差在第 4 行）。
     *   这条比对的本意是「**逻辑**没被动」，而 force 只换目录不换逻辑
     *   ⇒ 跳过是对的，但必须在 force 时显式跳过，否则它会永远红。
     * ⚠ v0.209：这里原来写的是**模块级** `FORCE`（argv）而不是函数参数 `force` ——
     *   抽成纯函数后它就错了：不带 `--force` 跑（守卫就是这么调的）时会去比对
     *   「slice(3) 之后的原文」，而文件头早就是生成的那 88 行 ⇒ 必报一条假红。 */
    const kept = [];
    let i = 0;
    let skippedDirs = 0;
    while (i < lines.length) {
      if (i < idx.length) { i++; continue; }                      // 跳过新顶部目录
      if (/^\s*\/\* ══ 区域/.test(lines[i])) { i += 2; skippedDirs++; continue; }  // 标记 + 其后的空行
      kept.push(lines[i]); i++;
    }
    const orig = src.split('\n').slice(3);                          // 原文件头是 3 行
    if (skippedDirs !== PARTS.length) problems.push(`跳过的标记数 ${skippedDirs} ≠ ${PARTS.length}`);
    if (JSON.stringify(kept) !== JSON.stringify(orig)) {
      /* 找出第一处不同，便于定位。 */
      let at = -1;
      for (let k = 0; k < Math.max(kept.length, orig.length); k++) if (kept[k] !== orig[k]) { at = k; break; }
      problems.push(`去掉新增标记后与原文不一致（第一处在第 ${at + 4} 行）：`
        + `\n     现在： ${JSON.stringify((kept[at] || '').slice(0, 70))}`
        + `\n     原来： ${JSON.stringify((orig[at] || '').slice(0, 70))}`);
    }
  }
  /* ③ 原有符号一个都不能少。 */
  {
    const n1 = topLevelSymbols(src.split('\n')).length;
    const n2 = topLevelSymbols(lines).length;
    if (n1 !== n2) problems.push(`顶层符号数变了：${n1} → ${n2}`);
  }
  /* ④ 分区标记的数量必须等于分区表的长度 —— 少一个就意味着有一区没插上。 */
  {
    const n = lines.filter((l) => /══ 区域/.test(l)).length;
    if (n !== PARTS.length) problems.push(`分区标记数 ${n} ≠ 分区表 ${PARTS.length}`);
  }

  if (problems.length) return { out: src, problems };
  return {
    out,
    problems,
    stats: { headerLines: idx.length, parts: resolved.length, from: src.split('\n').length, to: lines.length },
  };
}

/** I/O 层：读文件、打印、落盘。**判据全在 `partitionedSource()` 里**（纯函数 ⇒ 守卫能直接调）。 */
function main() {
  const src = fs.readFileSync(APP, 'utf8');
  const { out, problems, skipped, stats } = partitionedSource(src, { force: FORCE });

  if (skipped) {
    console.log('（已打过分区标记，跳过。要重新生成加 --force）');
    return;
  }
  if (problems.length) {
    console.error('✗ 自检失败：\n   ' + problems.join('\n   '));
    process.exit(1);
  }
  if (!WRITE) {
    console.log(`（预览）将加：顶部目录 ${stats.headerLines} 行 + ${stats.parts} 个分区标记。`);
    console.log(`        ${stats.from} 行 → ${stats.to} 行（+${stats.to - stats.from}）`);
    return;
  }
  if (out === src) {
    console.log('✓ 分区目录已是最新 —— 重跑一次不会改动任何一行（幂等）');
    return;
  }
  fs.writeFileSync(APP, out, 'utf8');
  console.log(`✓ 已给 js/app.js 加分区目录：${stats.parts} 个区，${stats.from} → ${stats.to} 行`);
  console.log(`  字节 ${src.length} → ${out.length}（+${(((out.length - src.length) / src.length) * 100).toFixed(2)}%）`);
  console.log('  下一步：node scripts/make-scripts-index.mjs && npm run check 里的 eslint');
}

/* 直接运行才执行（`node scripts/add-app-partitions.mjs`）；被 import 时不跑。 */
/* ⚠ 判「直接运行」用 `pathToFileURL`，不要自己拼路径 ——
 *   自己拼在 Windows 上要处理盘符反斜杠，第一版就是这么写的，结果判断永远不成立，
 *   于是脚本「直接运行」时也不执行。同款写法见 make-scripts-index.mjs 文件末尾。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
