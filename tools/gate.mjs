#!/usr/bin/env node
/**
 * 本地跑**和 CI 完全一样**的门禁。
 *
 *   node tools/gate.mjs              # 按 .github/workflows/check.yml 的顺序全跑
 *   node tools/gate.mjs --list       # 只列出会跑什么
 *   node tools/gate.mjs --only 布局   # 只跑名字里含"布局"的步骤
 *   node tools/gate.mjs --skip-slow  # 跳过三个已知最慢的（layout-stable / place-visible / lock）
 *
 * ## 为什么要有这个文件
 *
 * 之前我是临时写个脚本正则抓 `run: node xxx` 来跑门禁。**它抓漏了参数**：
 * 正则 `run:\s*node\s+([^\s#]+)` 只吃到脚本名，于是
 *
 *   · `node scripts/make-slim-packs.mjs --check`  → 变成「**重新生成**」
 *     ⇒ 永远 exit=0，**同步检查完全失效**，而且还会顺手把产物改掉
 *   · `node scripts/validate.mjs --all`            → 变成「无参运行」
 *   · `node scripts/audit-search.mjs --all`       → 变成「无参运行」⇒ exit=1
 *
 * 结果是"25 步全绿"里混着一个假绿和三个跑错命令的。
 * ⇒ **跑门禁必须连参数一起照抄**，所以这个文件直接**解析 check.yml**，
 *   并且启动时做一次参数自检（每个步骤抓到的参数必须和 yml 里写的一样），
 *   不一致就 exit=2 直接拒绝跑。
 *
 * 判断"门禁绿了"的唯一可靠办法是 `npm run gate`，
 * 不是"我记得我跑过那些命令"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YML = path.join(ROOT, '.github', 'workflows', 'check.yml');

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : '';
const skipSlow = argv.includes('--skip-slow');

/* check.yml 里带参数的步骤：`node xxx.mjs --all` 这种。
 * 抓的时候**把参数一起抓**，这是本文件存在的头号理由（见顶部说明）。
 *
 * ⚠⚠ 这里是**按行扫**，不是一条大正则、也不是按 `- name:` 切块。两次都栽过：
 *
 *   第一版 `/run:\s*node\s+([^\s#]+)/` —— 只吃脚本名，把 `--all`/`--check` 全丢了：
 *     `make-slim-packs.mjs --check` 变成「重新生成」⇒ 永远 exit=0，**同步检查完全失效**。
 *
 *   第二版 `/name:\s*(.+?)\n[\s\S]{0,400}?run:\s*node/` —— `name:` 与 `run:` 之间
 *     注释超过 400 字就**整步漏掉**（实测漏了 5 步，全是浏览器测试），
 *     而报告里"21 步全绿"看着完全正常。
 *
 *   而"数 run 出现次数"这个自检本身也有洞：写成 `- run: node …`（**没有 - name:**）的步骤，
 *     `^\s*run:` 匹配不到 ⇒ 抓取和计数**同时**漏掉 ⇒ 计数照样相等 ⇒ 断言失效。
 *
 * ⇒ 现在的做法：逐行扫。记住"当前步骤"（`- xxx:` 开头）和它有没有自己的 `- name:`，
 *   见到 `run: node` 就记一步。**没有 `- name:` 的步骤单独报出来**——
 *   第三版才补上这条：`- run: node` 会**继承上一步的名字**，报告里显示成
 *   「小程序页面逻辑冒烟」多跑一次 validate，看着比漏掉更可信。实测过。
 */
function parseSteps() {
  const lines = fs.readFileSync(YML, 'utf8').split(/\r?\n/);
  const out = [];
  let name = '';
  let stepHasName = false;   // 当前这个 `- xxx:` 步骤有没有自己的 - name:
  const unnamed = [];
  for (const raw of lines) {
    const nm = /^\s*-\s+name:\s*(.+?)\s*$/.exec(raw);
    if (nm) { name = nm[1].replace(/^["']|["']$/g, ''); stepHasName = true; continue; }
    const rm = /^\s*(?:-\s+)?run:\s*node\s+([^\s#]+(?:[ \t]+--[\w-]+)*)/.exec(raw);
    if (rm) {
      const parts = rm[1].trim().split(/[ \t]+/);
      /* ⚠ 行首带 `- ` 的 `run:` 自己就是**新步骤的开头** ⇒ 它没有名字。
       *   这一条是第三版补的：只判 `stepHasName` 的话，上一步的 name 还在，
       *   `run: node` 又在 rm 分支里 continue 掉了，结果守卫永远不响（实测）。 */
      const startsStep = /^\s*-\s+run:/.test(raw);
      if (startsStep || !stepHasName) unnamed.push(parts.join(' '));
      out.push({ name: startsStep ? '(这一步没有 - name:)' : name, argv: parts, cmd: parts.join(' ') });
      if (startsStep) { name = ''; stepHasName = false; }
      continue;
    }
    // 任何别的 `- xxx:` 都是**新步骤的开头** ⇒ 当前步骤到此结束
    if (/^\s*-\s+\S/.test(raw)) { name = ''; stepHasName = false; }
  }
  if (unnamed.length) {
    console.error(`  ✗ 有 ${unnamed.length}  条 \`run: node\` 不在任何 \`- name:\` 步骤里：`);
    for (const u of unnamed) console.error('     ' + u);
    console.error('     ⇒ 这种步骤以前会被静默跳过，而且会**继承上一步的名字**，看着更可信、更容易骗过人。');
    console.error('     ⇒ 给它在 check.yml 里补上「- name:」，或修这里的解析。');
    process.exit(2);
  }
  return out;
}

const SLOW = ['layout-stable', 'place-visible', 'lock', 'render-scale'];
const steps0 = parseSteps();

/* ---- 参数自检：yml 里写了参数的步骤，这里必须也抓到参数 ----
 * parseSteps 是"按行扫 + 吃完整行尾"，理论上不会漏参数；
 * 这里的自检是为了"哪天有人把解析改简单了"时不至于静默失效。 */
const ymlRaw = fs.readFileSync(YML, 'utf8');
let mismatched = 0;
for (const s of steps0) {
  const esc = s.argv[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('run:\\s*node\\s+' + esc + '((?:[ \\t]+--[\\w-]+)*)').exec(ymlRaw);
  const want = (m ? m[1] : '').trim();
  const got = s.argv.slice(1).join(' ');
  if (want !== got) {
    console.error(`  ✗ 参数没抓对：${s.argv[0]}  yml="${want}"  实际="${got}"`);
    mismatched++;
  }
}
if (mismatched) {
  console.error(`\n有 ${mismatched} 步的命令没照抄全（多半是 yml 改了、解析该更新了）。`);
  console.error('宁可现在拒绝跑，也不要跑一个"看起来全绿"的门禁。');
  process.exit(2);
}

let steps = steps0;

if (only) steps = steps.filter((s) => (s.name + ' ' + s.cmd).includes(only));
if (skipSlow) steps = steps.filter((s) => !SLOW.some((k) => s.cmd.includes(k)));

console.log(`门禁共 ${steps.length} 步（从 check.yml 读出来的，含参数；参数自检通过）\n`);
if (argv.includes('--list')) {
  for (const s of steps) console.log('  ' + s.cmd.padEnd(40) + s.name);
  process.exit(0);
}

/* ---- 先探一次：本机到底能不能起子进程？----
 * ⚠ 起不了就**别假装在跑门禁**。下面那个循环会把每一步报成 `✗ …起不来`，
 *   末尾再汇总成「✗ 66 步失败」—— 读起来像 **66 处回归**，实际是**一步都没执行**。
 *   v0.180 实测（2026-10-10）：本机 `spawnSync(process.execPath, ['-e','0'])` 也 EBUSY，
 *   连 spawn 一个 node 自己都起不来。⇒ "门禁没执行"与"门禁报红"必须分开说，
 *   混在一起就是又一个假信号（本项目最怕的那一族）。
 * ⚠ 探针写 `['-e','0']`：spawn 成功时 stdout 是**空 Buffer**（对象，真值），
 *   失败时是 `null` ⇒ 用 `!probe.stdout` 判，与下面循环里的判法**同一套**。 */
const probe = spawnSync(process.execPath, ['-e', '0'], { encoding: 'buffer' });
if (!probe.stdout) {
  console.log(`⚠ 本机 node 起不了子进程（${(probe.error && probe.error.code) || '无 stdout'}）：这个运行器**一步都跑不了**。`);
  console.log('  ⇒ 因此下面的 ✗ 不是"门禁红"，是"门禁**没执行**"——别读成回归。');
  console.log('  ⇒ 逐条跑：`node tools/gate.mjs --list` 打印全部命令（含参数），从 shell 一条条跑；或交给 CI。');
  console.log(`  ⇒ 共 ${steps.length} 步，全部跳过。`);
  process.exit(1);
}

let bad = 0;        /* 报红 + 没跑成（决定退出码）*/
let blocked = 0;    /* 子进程根本没起来（环境问题，不是判据问题）*/
let failed = 0;     /* 跑起来了、但 exit≠0 或输出里有 ✗（真报红）*/
for (const s of steps) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, s.argv, { encoding: 'buffer', cwd: ROOT });
  /* ⚠ 子进程**根本没起来**时，spawnSync 返回的对象没有 stdout/stderr，只有 error。
   *   原来直接 `r.stdout.toString()` ⇒ 抛 TypeError，整个门禁在第一步就崩，
   *   报出来的是一段栈而不是"哪一步起不来、为什么"。
   *   本机实测（2026-10-10）：node 里 spawnSync 任何可执行文件都 EBUSY
   *   （连 spawnSync(process.execPath, ['scripts/validate.mjs']) 也是），
   *   所以本机跑不了这个运行器 —— 逐条从 shell 跑 check.yml 里的命令才行。 */
  if (!r.stdout) {
    bad++; blocked++;
    console.log('  ✗ ' + s.cmd.padEnd(40)
      + `起不来（没跑成，不是失败）：${r.error ? r.error.message : '无 stdout'}`);
    continue;
  }
  const all = r.stdout.toString('utf8') + '\n' + (r.stderr ? r.stderr.toString('utf8') : '');
  const red = all.split(/\r?\n/).filter((l) => /✗/.test(l));
  const pass = r.status === 0 && red.length === 0;
  if (!pass) { bad++; failed++; }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log((pass ? '  ✓ ' : '  ✗ ') + s.cmd.padEnd(40) + `exit=${r.status}  红 ${red.length}  ${secs}s`
    + (red.length ? '\n      ' + red[0].trim().slice(0, 96) : ''));
}
/* ⚠ 汇总必须把"没跑成"与"报红"分开报：原来两者都算进 `bad`、末尾统一写成
 *   「✗ N 步失败」，于是"环境跑不了"看起来和"N 处回归"一模一样。 */
if (blocked === steps.length) {
  console.log(`\n⚠ 全部 ${steps.length} 步**都没跑成**（本机起不了子进程）——这不是"门禁红"，是"门禁**没执行**"。`);
} else if (blocked) {
  console.log(`\n${bad ? '✗' : '✓'} 共 ${steps.length} 步：通过 ${steps.length - bad}、**报红 ${failed}**、**没跑成 ${blocked}**`);
} else {
  console.log('\n' + (bad ? `✗ ${bad} 步失败` : `✓ 全部 ${steps.length} 步通过`));
}
process.exit(bad ? 1 : 0);
