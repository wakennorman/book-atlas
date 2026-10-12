/**
 * 守卫：`scripts/validate.mjs` 的「warning 一行汇总」三条判据（v0.205）。
 *
 * ## 为什么值得单独测一条**输出行为**
 *
 * v0.205 把 validate 的 warning 从「每本书刷 112 行」改成「一行汇总」。
 * 这类改动有两个方向的坏法，而且都表现为**全绿**：
 *
 *   ① **汇太多** —— error 也被折叠，或汇总条数少于实际条数（藏回归）；
 *   ② **汇没有** —— 第一版的真实形态：`flushWarnings()` 写好了却**从没被调用**，
 *      warning 收进数组后再也没人打印 ⇒ 日志里一行都没有。
 *      噪音和静默是两个方向的病，但**静默更坏**：下一个读日志的人会以为
 *      "这本书没有 warning"（而 `validate` 的口径是"warning 是建议不是 KPI"，
 *       连建议都看不见时，它就从工具变成了装饰）。
 *
 * 顺带守退出码的一个假绿：`errors` 原本每本书清零，而退出码只看它 ⇒
 * `--all` 时**前面的书报红、最后一本干净就 exit 0**（三本书常年 0 error，
 * 这个洞一直没露出来过）。
 *
 * ## 怎么测：**不起子进程**，直接 import 判据函数
 *
 * 本机 node 起不了任何子进程（spawnSync 一律 EBUSY，见 test/guard-hygiene.mjs H1）
 * ⇒ 像其它守卫一样 import `validateBook()` / `flushWarnings()` / `summarizeWarnings()`
 * 在进程内跑，用**夹具书**（tmp 目录里写的最小 data）驱动，捕获 console 输出对拍。
 *
 * ## 判据（对应 validate.mjs 文件头那三条）
 *
 *   ① error 一条都不许被折叠 —— 夹具书里造一个 error，stderr 必须逐条看到；
 *   ② 汇总行里的条数 = 实际收集到的条数（= validateBook 返回的 warns，自己算自己）；
 *   ③ `--detail` 打印的条数与默认模式**完全相同**。
 *   ④（退出码）跨书累计：坏书之后的干净书，errorsAll 不许被清零。
 *
 * ⚠ 入口那段（isMain + process.exit）**不在这里测** —— 由手工跑一次
 *   `node scripts/validate.mjs --all` 确认（v0.205 已跑：三本 0 error，exit 0）。
 *
 * ⚠ 有效性已实测（变异测试，注一类坏还原一类）：注掉 flushWarnings 的调用 ⇒ 红 5 条；
 *   汇总条数手填 999 ⇒ 红 4 条；--detail 少打最后一条 ⇒ 红 2 条；
 *   error 也折进汇总 ⇒ 红 2 条；还原后全绿。
 *
 * 用法：node test/validate-summary-guard.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateBook, flushWarnings, summarizeWarnings } from '../scripts/validate.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

/* ── 捕获 console：validate 全程用 console 输出，守卫逐字符对拍 ── */
function capture() {
  const logs = [], warns = [], errs = [];
  const ol = console.log, ow = console.warn, oe = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.warn = (...a) => warns.push(a.join(' '));
  console.error = (...a) => errs.push(a.join(' '));
  return {
    logs, warns, errs,
    restore() { console.log = ol; console.warn = ow; console.error = oe; },
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-vsg-'));
const write = (name, obj) => {
  const fp = path.join(tmp, name);
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return fp;
};

/* 最小夹具书。**warning 精确可数**（ trace 过一遍 validate 的每条 warn 调用点）：
 *   · c2 缺 title/desc/fate                      → 3 条「角色字段缺」
 *   · meta.schemaVersion 缺失                    → 1 条
 *   · 关系 c1→c2 没有「定义关系的小事件」        → 1 条「关系没有定义事件」
 *   = 5 warning / 0 error。改夹具 ⇒ 这里的三处计数会红，不会静默失真。 */
const fixture = write('fixture.json', {
  meta: { slug: 'fixture', title: '夹具书' },
  factions: [{ key: 'wei', name: '魏' }],
  phases: [{ id: 'p1', name: '第一阶段' }],
  places: [],
  characters: [
    { id: 'c1', name: '甲', generation: 1, faction: 'wei', gender: 'm', firstCh: 1, tier: 'minor', title: '官位', desc: '简介', fate: '结局', aliases: [] },
    { id: 'c2', name: '乙', generation: 1, faction: 'wei', gender: 'm', firstCh: 1, tier: 'minor', aliases: [] },
  ],
  relations: [
    { from: 'c1', to: 'c2', type: '友', style: 'solid' },
  ],
  events: [
    { id: 'e1', name: '初见', summary: '两人初次相见，并无交谈', impact: '结识', order: 1, ch: 1, phase: 'p1', chars: ['c1'] },
  ],
});

/* 同一本书 + 一个**未定义阵营**的人物 ⇒ 恰好 1 条 error（faction 未定义）。
 * ⚠ 故意**只加 error 不减 warning** —— 判据①要同时看"error 逐条在"和"warning 仍汇总"。 */
const errFixture = write('err-fixture.json', {
  ...JSON.parse(fs.readFileSync(fixture, 'utf8')),
  characters: [
    ...JSON.parse(fs.readFileSync(fixture, 'utf8')).characters,
    { id: 'c3', name: '丙', generation: 1, faction: 'nowhere', gender: 'm', firstCh: 1, tier: 'minor', title: 't', desc: 'd', fate: 'f', aliases: [] },
  ],
});

console.log('══ validate.mjs「warning 一行汇总」的守卫 ══\n');

console.log('▶ 判据②的零件：summarizeWarnings 自己算自己');
ok(summarizeWarnings([]) === '', '空列表 ⇒ 空串（不许打「0 条」这种空汇总行）');
{
  const list = [
    { kind: '角色字段缺', msg: 'x' }, { kind: '角色字段缺', msg: 'x' }, { kind: '角色字段缺', msg: 'x' },
    { kind: 'meta.schemaVersion', msg: 'x' },
    { kind: '关系没有定义事件', msg: 'x' }, { kind: '关系没有定义事件', msg: 'x' },
    { kind: '未归类', msg: 'x' },
  ];
  const s = summarizeWarnings(list);
  ok(s.includes('7 条'), `汇总行写「7 条」（实际 ${list.length} 条）—— 条数由数组长度算`);
  /* ⚠ 只数 `条：` **后面**那段的归类计数 —— 连开头那个「⚠ 7 条」一起数会得 14
   *   （守卫第一版就栽在这：/(\S+) (\d+)/g 把总数也吃进去了）。 */
  const nums = [...s.slice(s.indexOf('条：') + 2).matchAll(/(\S+) (\d+)/g)].map((m) => Number(m[2])).reduce((a, b) => a + b, 0);
  ok(nums === list.length, `各归类条数加起来 = ${nums}（= 总条数；少一项就说明有桶被吞了）`);
  ok(s.indexOf('角色字段缺 3') < s.indexOf('关系没有定义事件 2'), '归类按条数从多到少排（好扫读）');
}

console.log('\n▶ 判据②③的零件：flushWarnings 的输出形状');
{
  const list = [{ kind: 'A', msg: '甲缺 title' }, { kind: 'B', msg: '乙缺 desc' }, { kind: 'A', msg: '甲缺 fate' }];
  const c1 = capture();
  const line = flushWarnings(list, { detail: false });
  c1.restore();
  ok(line.includes('3 条'), '默认模式：汇总行写「3 条」');
  ok(c1.logs.filter((l) => l.includes('⚠')).length === 1, '默认模式：⚠ 行**只有一行**（汇总，不是 112 行）');
  ok(c1.warns.length === 0, '默认模式：不走逐条通道（console.warn 一次都没用）');
  ok(line.includes('warning 是建议不是 KPI'), '汇总行带口余地：warning 不进退出码');

  const c2 = capture();
  flushWarnings(list, { detail: true });
  c2.restore();
  ok(c2.warns.length === 3, `--detail：逐条打 3 行（实际 ${c2.warns.length}）`);
  ok(c2.logs.filter((l) => l.includes('⚠')).length === 1, '--detail：汇总行仍在（先逐条再汇总）');
  ok(c2.warns.every((l) => l.includes('缺')) && !c2.warns.some((l) => /条：/.test(l)), '--detail 的逐条行是原文，不是汇总');

  const c3 = capture();
  const empty = flushWarnings([], { detail: true });
  c3.restore();
  ok(empty === '' && c3.logs.length === 0 && c3.warns.length === 0, '没有 warning 时一行都不打（不许有「0 条」空汇总）');
}

console.log('\n▶ 判据①：error 一条都不许被折叠');
{
  const c = capture();
  const r = validateBook(errFixture);
  c.restore();
  ok(r.errors === 1, `夹具书有恰好 1 条 error（实际 ${r.errors}）`);
  ok(c.errs.some((l) => l.includes('✗') && l.includes('nowhere')), 'error 原文逐条打在 stderr 上（没被折叠进汇总）');
  ok(c.logs.some((l) => /⚠ \d+ 条/.test(l)), '有 warning 的书仍打出汇总行（error 不把 warning 的通道关掉）');
  ok(c.logs.some((l) => l.includes('1 error / 5 warning')),
    '结果行仍逐本给计数（1 error / 5 warning）—— 汇总不替换逐本账');
}

console.log('\n▶ 判据②③端到端：汇总条数 == warn() 实际收到的条数');
{
  const c1 = capture();
  const dflt = validateBook(fixture);
  c1.restore();
  const sumLine = c1.logs.find((l) => /⚠ \d+ 条/.test(l));
  const n = sumLine ? Number((/⚠ (\d+) 条/.exec(sumLine) || [])[1]) : -1;
  ok(!!sumLine, '默认模式：**打出了汇总行**（第一版就是漏了调用，一行都没有）');
  ok(n === dflt.warns, `汇总条数 ${n} == 实际 ${dflt.warns} 条（自己算自己，不许手填）`);
  ok(dflt.errors === 0, '夹具书 0 error（warning 与 error 分开计数）');

  const c2 = capture();
  const det = validateBook(fixture, { detail: true });
  c2.restore();
  ok(c2.warns.length === det.warns, `--detail 逐条 ${c2.warns.length} 行 == 默认模式汇总 ${det.warns} 条（两个模式条数必须相同）`);
  const n2 = Number((/⚠ (\d+) 条/.exec(c2.logs.find((l) => /⚠ \d+ 条/.test(l)) || '') || [])[1]);
  ok(n2 === det.warns, '--detail 的汇总行条数与逐条行数一致');
}

console.log('\n▶ 退出码假绿：跨书累计（errorsAll 不许被后面的干净书清零）');
/* ⚠ 断言必须用**增量**（相对进入本组时的累计值），不能写绝对值 ——
 *   上面的判据①已经跑过一本坏书，errorsAll 这时已经是 1 了。
 *   守卫第一版写的就是绝对值，结果自己的断言先红，还因为 restore() 放晚了
 *   把 ✓/✗ 吞进捕获里没打出来（输出看着只有一条红，实际三条）。 */
{
  const runQuiet = (f, o) => { const c = capture(); const r = validateBook(f, o); c.restore(); return r; };
  const base = runQuiet(fixture).errorsAll;                 // 干净书：累计不变
  ok(runQuiet(fixture).errorsAll === base, `干净书不改变累计（${base}）`);
  const afterBad = runQuiet(errFixture);
  ok(afterBad.errors === 1 && afterBad.errorsAll === base + 1,
    `坏书进来：本书 1 error、累计 ${base} → ${afterBad.errorsAll}`);
  const afterBadThenClean = runQuiet(fixture);              // 干净书在坏书**之后**
  ok(afterBadThenClean.errors === 0 && afterBadThenClean.errorsAll === base + 1,
    `坏书之后的干净书：本书 0 error，累计仍是 ${afterBadThenClean.errorsAll}`
    + ' ⇒ 退出码看累计（旧代码这里会只看最后一本 ⇒ exit 0）');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过（含 24 条断言）`}`);
process.exit(fail ? 1 : 0);
