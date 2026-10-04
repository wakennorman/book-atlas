// 开发用：把 v93 的每一处修复单独退回，用来验证对应测试**真的会红**。
// 「改完了跑一下绿不绿」证明不了什么 —— 断言要是恒绿，绿色的门禁就是假的。
//
// 用法：
//   node test/_patch-v93.mjs list              列出所有可回退项
//   node test/_patch-v93.mjs <项>              回退某项
//   node test/_patch-v93.mjs <项> --run        回退后顺便跑对应测试（应当失败）
//   node test/_patch-v93.mjs restore           全部还原
//
// 为什么要合并成一个脚本（而不是每处改动一个文件）：
//   五六个 _revert-*.mjs 散在 test/ 下，光看文件名就知道仓库里"正在进行过多少轮改动"，
//   而每一处补丁的正则改法都差不多、维护方式也一样，集中在一处更好读也更好改。
//   统一一份备份机制（%TEMP%\ba-v93-patch\），restore 一条命令全还原。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BAK = path.join(os.tmpdir(), 'ba-v93-patch');
const p = (rel) => path.join(ROOT, rel);

/* ---------- 备份 / 还原 ---------- */
const FILES = ['js/app.js', 'js/editor.js', 'index.html', 'css/style.css'];
function stash(label) {
  fs.mkdirSync(BAK, { recursive: true });
  fs.writeFileSync(path.join(BAK, 'label'), label);
  for (const f of FILES) fs.copyFileSync(p(f), path.join(BAK, f.replace(/[\\/]/g, '__')));
}
function unstash() {
  const label = fs.readFileSync(path.join(BAK, 'label'), 'utf8');
  for (const f of FILES) fs.copyFileSync(path.join(BAK, f.replace(/[\\/]/g, '__')), p(f));
  console.log(`已还原（对应回退项：${label}）`);
}
const read = (rel) => fs.readFileSync(p(rel), 'utf8');
const write = (rel, s) => fs.writeFileSync(p(rel), s);
const countIn = (s, frag) => s.split(frag).length - 1;

/** 把所有补丁列出来；每项 = { id, desc, test, edits: [[文件, 源, 目标]] } */
const PATCHES = [
  {
    id: 'nav-gap',
    desc: '两段导航的间隔 550 → 1800ms（右栏那段先被看完，再去事件轴）',
    test: 'test/canvas-hint.mjs',
    edits: [['js/app.js', 'const NAV_STEP2_DELAY = 1800;', 'const NAV_STEP2_DELAY = 550;']],
  },
  {
    id: 'view-memory',
    desc: '记住每本书的视野（zoom + center），且首屏稳定期的 resize 不抹掉它（pendingView）',
    test: 'test/layout-stable.mjs',
    edits: [
      /* ⚠ 回退方向：第一版把 pvLive 退回 `!!pv`（"永远采纳 pendingView"），
       * 结果测试照样全绿 —— 因为那只会让视野**更**被保住当然不会红。
       * 要复现原来的 bug，得让 resetRoam 根本看不到 pendingView。 */
      ['js/app.js', / {4}state\.pendingView = \{ z: m\.z, c: m\.c, until: Date\.now\(\) \+ 3000 \};\r?\n/, ''],
    ],
  },
  {
    id: 'layout-stable',
    desc: '「自由」视图改用固定种子+固定轮数的确定性力导向（不再走 ECharts 的帧驱动）',
    test: 'test/layout-stable.mjs',
    edits: [
      /* ⚠ 只把 series.layout 那行改回去是**无效回退**：force 分支里 state.frozen = true，
       * 而 layout 的条件是 (state.frozen && !state.focus)，求值本来就是 'none'。
       * 第一版就踩了这个坑 —— 回退"成功"了、对应测试却一项没红，看上去像"这个改动没被测到"。
       * 真正要退的是「让 ECharts 自己去跑力导向」：frozen 改回 false、不调 forceLayoutVisible、
       * 并且 series.layout 也要让它走 'force'。 */
      ['js/app.js', 'layout: (state.view === \'force\' || (state.frozen && !state.focus)) ? \'none\' : \'force\',',
        "layout: (state.frozen && !state.focus) ? 'none' : 'force',"],
      ['js/app.js', / {6}state\.frozen = true;\r?\n {6}state\.pos = new Map\(\);\r?\n {6}for \(const c of state\.book\.characters\) \{\r?\n {8}if \(!isCharHidden\(c\)\) state\.pos\.set\(c\.id, \{ x: 0, y: 0 \}\);\r?\n {6}\}/,
        '      state.frozen = false;\n      state.pos = new Map();'],
      ['js/app.js', / {6}forceLayoutVisible\(\);\r?\n/, ''],
    ],
  },
  {
    id: 'lock-offcanvas',
    desc: '从图外导航进画布一律建锁（右栏人名/关系列表/事件卡/时间轴芯片/阵营图例/地点筛选）＋换锁时按被丢掉那把锁清输入框',
    test: 'test/lock.mjs',
    edits: [
      // clearOtherQuery 回到按"新锁来源"判断的旧写法（只有 search/path 两种来源时才恰好成立）
      ['js/app.js', "    if (droppedLockOrigin === 'path') clearPathQuery(); else clearSearchQuery();",
        "    if (origin === 'path') clearSearchQuery(); else clearPathQuery();"],
      ['js/app.js', / {6}chooseCharById\(goto\.dataset\.goto\);\r?\n {6}return;/,
        '      if (state.clickLock) chooseCharById(goto.dataset.goto);\r\n      else selectCharacter(goto.dataset.goto);\r\n      return;'],
      ['js/app.js', /^\s*if \(lock\) lockFromHighlight\(`\$\{charName\(rel\.from\)\}.*\r?\n/m, ''],
      ['js/app.js', /^\s*if \(lock && nodes\.size\) lockFromHighlight\(ev\.name.*\r?\n/m, ''],
      ['js/app.js', /^\s*lockFromHighlight\(fname, 'faction'.*\r?\n/m, ''],
      ['js/app.js', /^\s*lockFromHighlight\(\(placeName\(state\.placeFilter\).*\r?\n/m, ''],
      ['js/app.js', /^\s*lockFromHighlight\(`\$\{c\.name\}.*\r?\n/m, ''],
    ],
  },
  {
    id: 'place-desc',
    desc: '地点介绍：筛选下拉换成 combobox（说明跟当前行走）＋页面别处悬停/聚焦弹出说明',
    test: 'test/place.mjs',
    edits: [
      ['index.html', /<span class="combo" id="place-combo">[\s\S]*?<\/span>/,
        '<select id="place-filter" title="按地点筛选事件与人物"></select>'],
      ['css/style.css', /\.combo-desc \{[\s\S]*?\.place-ref \{ cursor: help; border-bottom: 1px dotted var\(--line\); \}/, ''],
      // 下拉行不再带介绍
      ['js/app.js', '${it.desc ? `<p class="combo-desc">${esc(it.desc)}</p>` : \'\'}', ''],
      ['js/app.js', /<button type="button" class="\$\{cls \|\| 'linkbtn'\}" data-place-filter="\$\{esc\(id\)\}" data-place-id="\$\{esc\(id\)\}">\$\{inner\}<\/button>/,
        '<button type="button" class="${cls || \'linkbtn\'}" data-place-filter="${esc(id)}">${inner}</button>'],
      ['js/app.js', /<span class="place-ref \$\{cls\}" data-place-id="\$\{esc\(id\)\}" tabindex="0" role="button">\$\{inner\}<\/span>/,
        '<span>${inner}</span>'],
    ],
  },
  {
    id: 'ai-followup',
    desc: 'AI 讲解的「继续追问」＋默认模型名 deepseek-chat → deepseek-flash',
    test: 'test/ai.mjs',
    edits: [
      ['index.html', 'placeholder="deepseek-flash"', 'placeholder="deepseek-chat"'],
      ['js/editor.js', "'deepseek-flash'", "'deepseek-chat'"],
      ['js/app.js', "const AI_DEFAULT_MODEL = 'deepseek-flash';", "const AI_DEFAULT_MODEL = 'deepseek-chat';"],
      ['js/app.js', / {6}<form class="ai-ask" data-ai-ask>[\s\S]*?<\/form>\r?\n/, ''],
      ['js/app.js', / {4}const turns = aiThread\.turns\.map[\s\S]*?\}\)\.join\(''\);/,
        "    const turns = aiThread.turns.filter((t) => t.role === 'assistant').map((t) => `<div class=\"ai-a\">${esc(t.content)}</div>`).join('');"],
      ['js/app.js', / {10}messages: \[\{ role: 'system', content: aiThread\.system \}, \.\.\.aiThread\.turns\],/,
        "          messages: [{ role: 'system', content: aiThread.system }, aiThread.turns[aiThread.turns.length - 1]],"],
      ['js/app.js', / {4}document\.addEventListener\('submit', \(ev\) => \{\r?\n {6}const form = ev\.target\.closest && ev\.target\.closest\('\[data-ai-ask\]'\);\r?\n {6}if \(!form\) return;\r?\n {6}ev\.preventDefault\(\);\r?\n {6}aiFollowUp\(form\.querySelector\('\.ai-ask-input'\)\);\r?\n {4}\}\);\r?\n/, ''],
      ['js/app.js', / {6}if \(ev\.target\.closest\('\[data-ai-ask-clear\]'\)\) \{ aiThread = null; renderAiThread\(\); return; \}\r?\n/, ''],
    ],
  },
];

/* ---------- 主体 ---------- */
const [, , cmd, arg] = process.argv;
if (!cmd || cmd === 'list') {
  console.log('可回退项：');
  for (const x of PATCHES) console.log(`  ${x.id.padEnd(16)} ${x.desc}\n  ${''.padEnd(16)} → 验证 ${x.test}`);
  console.log('\n用法：node test/_patch-v93.mjs <项> [--run]   /   node test/_patch-v93.mjs restore');
  process.exit(0);
}
if (cmd === 'restore') {
  if (!fs.existsSync(BAK)) { console.error('没有可还原的备份（也许还没回退过任何一项）'); process.exit(1); }
  unstash();
  process.exit(0);
}

const patch = PATCHES.find((x) => x.id === cmd);
if (!patch) { console.error('没有这一项：' + cmd + '（用 list 看可选项）'); process.exit(1); }
if (!fs.existsSync(BAK)) stash(patch.id);
else fs.writeFileSync(path.join(BAK, 'label'), patch.id);

let n = 0, miss = [];
for (const [file, from, to] of patch.edits) {
  const s = read(file);
  if (typeof from === 'string') {
    if (!s.includes(from)) { miss.push(`${file}: ${from.slice(0, 46)}`); continue; }
    write(file, s.split(from).join(to));
  } else {
    if (!from.test(s)) { miss.push(`${file}: /${from.source.slice(0, 40)}/`); continue; }
    write(file, s.replace(from, to));
  }
  n++;
}
console.log(`已回退「${patch.id}」：${n}/${patch.edits.length} 处`);
for (const m of miss) console.error('  没找到：' + m);
console.log('还原：node test/_patch-v93.mjs restore');

if (process.argv.includes('--run')) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, patch.test)], { cwd: ROOT, stdio: 'inherit' });
    console.log(`\n⚠ ${patch.test} 竟然通过了 —— 这条断言可能恒绿，回退验证没意义`);
    process.exit(1);
  } catch {
    console.log(`\n✓ ${patch.test} 如期变红 —— 回退验证通过`);
  }
}