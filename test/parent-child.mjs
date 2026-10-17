/**
 * 「哪条关系算亲子边」的跨端一致性（v0.153 新增）
 *
 * ## 为什么要有它
 *
 * 这个定义在项目里**抄了 8 份以上**，而且已经漂出 3 种行为：
 *   · 权威   `scripts/kin-terms.mjs` 的 `isParentChild`（PARENT_CHILD + 去括号说明）—— **含「养父子」**
 *   · 漏「养」`scripts/archive/fix-gongsun.mjs` / `archive/fix-wu-tail.mjs`（一次性补丁脚本，
 *     v0.195 债二 B1 已归档到 `scripts/archive/`；v0.205.1 修正：豁免路径还写着归档前的
 *     `scripts/fix-*.mjs` ⇒ 本测试从 v0.195 起一直是红的，被 CI startup_failure 掩盖）

 *
 * 这不是新问题：`scripts/lib/data-files.mjs` 的注释里把它列为「同一个定义抄多份」的
 * **第 ① 例**（v0.110：三个审计脚本各自内联、漏了「养」）。当时改了那三个脚本，
 * 但**没有加任何判据守着** —— 于是它又漂了一次（漂在编辑器）。
 *
 * ## 做法（三层）
 * ② 结构级：全项目不许再出现第 3 份完整副本；也不许出现「缺 养」的变体
 * ③ 金标：`isParentChild` 的接受/拒绝表 —— 钉「正确」，而不只是钉「两边一样」
 *
 * ⚠ 只做 ①（对拍）抓不到「两边一起错」（一起删掉「养」照样一致）⇒ ③ 不能删。
 * 用法：node test/parent-child.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isParentChild } from '../scripts/kin-terms.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

/** 抽出 `[export] const NAME = /.../;` 里的正则正文（不含两端的 `/`）。 */
function pickRe(file, name) {
  const m = read(file).match(new RegExp('(?:export\\s+)?const\\s+' + name + '\\s*=\\s*/([^/]*)/'));
  if (!m) throw new Error(`在 ${file} 里找不到 const ${name} = /.../`);
  return m[1];
}

/** 递归列出若干目录下的 .js / .mjs（相对 ROOT，用 `/` 分隔）。 */
function walk(dir) {
  const out = [];
  for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${d.name}`;
    if (d.isDirectory()) out.push(...walk(rel));
    else if (/\.(js|mjs)$/.test(d.name)) out.push(rel);
  }
  return out;
}

const AUTH = 'scripts/kin-terms.mjs';

console.log('\n▶ 结构级：全项目不得出现 `isParentChild` 的手抄副本');
/* 一次性补丁脚本（已执行完、只留档）**显式豁免**：它们用的是「缺 养」的旧变体，
 * 改它们等于改一个跑完的补丁的行为，没意义。列在这里是为了让豁免是"看得见的决定"，
 * 而不是漏检 —— 真正该做的是把这类脚本清掉（见 CHANGELOG 遗留）。 */
const EXEMPT = ['scripts/archive/fix-gongsun.mjs', 'scripts/archive/fix-wu-tail.mjs'];
for (const f of EXEMPT) {
  ok(fs.existsSync(path.join(ROOT, f)), `豁免项仍然存在（${f}）—— 若已删除，请把这条豁免也删掉`);
}

const files = ['scripts', 'js', 'shared', 'miniprogram'].flatMap(walk);
const fullDup = [], partial = [];
for (const f of files) {
  if (f === AUTH) continue;
  const src = read(f);
  if (authBody && src.includes(authBody)) fullDup.push(f);
  /* 「缺 养」变体：这一行出现了亲子正则的主体、却没带上 `|^养(父|母)(子|女)`。
   * 跳过注释行 —— 好几处注释在**讲**这个历史事故，会提到旧写法。 */
  for (const line of src.split('\n')) {
    const s = line.trim();
    if (s.startsWith('*') || s.startsWith('//') || s.startsWith('/*')) continue;
    if (s.includes('(亲生)?(父|母)(子|女)') && !s.includes('养(父|母)(子|女)')) partial.push(f);
  }
}
const dupUnexpected = fullDup;
ok(dupUnexpected.length === 0,
  `除权威外，不应有任何文件持有 isParentChild 完整副本${dupUnexpected.length ? `（多出：${dupUnexpected.join(' / ')}）` : ''}`);
const partialUnexpected = partial.filter((f) => !EXEMPT.includes(f));
ok(partialUnexpected.length === 0,
  `除豁免的一次性脚本外，没有「缺 养」的变体${partialUnexpected.length ? `（${[...new Set(partialUnexpected)].join(' / ')}）` : ''}`);

console.log('\n▶ 金标：isParentChild 的接受 / 拒绝表');
const CASES = [
  // [type, 期望]
  ['父子', true], ['父女', true], ['母子', true], ['母女', true],
  /* ⚠ `(亲生)?` 是加在**整个「父子」**前的（＝「亲生父子」），不是加在「子」前 ——
   *   所以「亲生子」**不算**亲子边。这一条是写本表时先写错、被这条判据当场抓出来的，
   *   留着它免得下次又有人想当然。 */
  ['亲生父子', true], ['亲生母子', true],
  ['亲生子', false], ['亲生女', false],
  // ↓ 这一组正是「只认血缘」的旧编辑器规则漏掉的
  ['养父子', true], ['养母子', true], ['养父女', true], ['养母女', true],
  ['养父子（关羽收关平为义子）', true],   // 带括号说明也要认（真实数据里就有这一条）
  ['父子（亲生）', true],
  ['父子关系', false],   // 正则锚定了 `$` ⇒ 「父子关系」不算亲子边
  ['子父', false],       // 方向写反的写法，本规则不认（数据约定：from＝父母、to＝子女）
  ['养子', false], ['养女', false],
  ['叔侄', false], ['兄弟', false], ['夫妻', false], ['祖孙', false], ['舅甥', false],
  ['', false], [null, false], [undefined, false],
];
for (const [t, want] of CASES) {
  const got = isParentChild({ type: t });
  ok(got === want, `isParentChild({type: ${JSON.stringify(t)}}) = ${got}${got === want ? '' : `（应为 ${want}）`}`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} 亲子边一致性　通过：${pass}  失败：${fail}`);
process.exit(fail === 0 ? 0 : 1);
