// ⚠⚠⚠ 这个脚本会**直接改写 js/app.js**，只为验证闸门不是假绿。跑完必须 restore。
//    git status 里 js/app.js 有未提交改动时**不要**用 —— backup 会把当时的改动一起存进去。
// ⚠⚠⚠ 用法：node test/_patch.mjs grid | focus | px | restore
//   grid  —— 回退「分组·横折成网格」布局（恢复成一群人排一根长线）
//   focus —— 回退 focusViewOn 的 target 换算（恢复成把 zoom 当像素尺度）
//   px    —— 回退 pxScale（恢复成拿 fitLast 当真实尺度）
//   restore —— 从 %TEMP%\app.js.bak 恢复
// 首次使用前先手动存一份：Copy-Item js/app.js $env:TEMP\app.js.bak -Force
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'js', 'app.js');
const BAK = path.join(process.env.TEMP || '.', 'app.js.bak');
const which = process.argv[2] || 'restore';

if (which === 'restore') {
  fs.copyFileSync(BAK, FILE);
  console.log('已从备份还原 js/app.js');
  process.exit(0);
}

let s = fs.readFileSync(FILE, 'utf8');
const sub = (from, to, tag) => {
  if (!s.includes(from)) { console.error(`✗ 找不到待回退处：${tag}\n  ${from.slice(0, 90)}`); process.exit(1); }
  if (s.split(from).length - 1 !== 1) { console.error(`✗ 待回退处不唯一：${tag}`); process.exit(1); }
  s = s.replace(from, to);
  console.log(`  ✓ 回退 ${tag}`);
};

if (which === 'grid') {
  // 原版：一群人排一根长线（曹魏 250 人 ⇒ 12500 长），群组间距固定 240
  const ORIGINAL = [
    '    const stepMain = Math.max(200, 240);',
    '    const mainLen = Math.max(viewMain, (groups.length - 1) * stepMain);',
    '    const crossLen = Math.max(viewCross, (maxCount - 1) * stepCross);',
    '    groups.forEach((g, gi) => {',
    '      const center = groups.length === 1 ? 0 : -mainLen / 2 + (mainLen * gi) / (groups.length - 1);',
    '      state.bands.set(g, center);',
    '      const sample = byGen.get(g)[0];',
    '      state.bandLabels.set(g, sample ? groupLabelOf(sample) : String(g));',
    '      const list = byGen.get(g);',
    '      const step = list.length > 1 ? crossLen / (list.length - 1) : 0;',
    '      list.forEach((c, ci) => {',
    '        const off = list.length === 1 ? 0 : -crossLen / 2 + ci * step;',
    '        state.pos.set(c.id, view === \'gen-h\' ? { x: center, y: off } : { x: off, y: center });',
    '      });',
    '    });',
  ].join('\r\n');
  const gStart = s.search(/ {4}const GUT = 26;[^\n]*/);
  const gEnd = s.indexOf('\r\n  }\r\n\r\n  function syncViewButtons', gStart);
  if (gStart === -1 || gEnd === -1) { console.error('✗ 找不到网格那段的起止'); process.exit(1); }
  s = s.slice(0, gStart) + ORIGINAL + s.slice(gEnd);
  console.log('  ✓ 回退 布局：整段网格 → 原来的「一群人一根线」');
} else if (which === 'focus') {
  sub('const unitPx = (state.pxScale || 1) / (Math.abs(state.fitLast) || 1);   // px / 适配后单位（zoom=1）',
    'const unitPx = 1;   // REVERT', 'focusViewOn 的尺度换算');
} else if (which === 'px') {
  sub('state.pxScale = s * fitK;', 'state.pxScale = s;   // REVERT', '真实尺度 pxScale');
} else {
  console.error('未知开关: ' + which);
  process.exit(1);
}

fs.writeFileSync(FILE, s);
console.log(`已回退「${which}」，现在跑闸门（记得跑完 node test/_patch.mjs restore）`);