#!/usr/bin/env node
/**
 * 守卫：`scripts/` 的归档卫生（v0.195）
 *
 * ## 为什么要有这条
 *
 * v0.195 立项时实测：`scripts/*.mjs` 共 **99** 个（不含 `archive/` 与 `lib/`），
 * 其中一次性补丁 **44** 个（`fix-*` 40 + `add-*` 4）。
 * `scripts/archive/` 里已经躺了 8 个 —— **说明归档这件事做过，但没做成规范**，
 * 所以又攒回 44 个。
 *
 * 「没做成规范」的根因很具体：**没有任何东西在守它**。
 * `make-scripts-index.mjs` 只是**生成物索引**，它会如实列出这 44 个"一次性补丁"，
 * 但那只是**记账**，不是**约束** —— 下一个 `fix-` 又会照样躺在 `scripts/` 根目录。
 *
 * ⇒ 这条守卫补的就是那个「约束」。
 *
 * ## 四条判据
 *
 * | # | 判据 | 防的是什么 |
 * |---|---|---|
 * | P1 | `scripts/` **顶层**（不含 `archive/`）出现一次性补丁 ⇒ 报「该归档了」 | 又攒回来 |
 * | P2 | `scripts/archive/*.mjs` 缺归档标记 ⇒ 报错 | 归档目录变成垃圾桶，事后没人知道那脚本干嘛过 |
 * | P3 | 脚本文件头没写明「一次性 / 长期」⇒ 报错 | 分类靠猜 |
 * | P4 | **双向**：门禁 `run:` 到的脚本必须在顶层；顶层/归档里的脚本不得被门禁 import | 归档把在跑的东西搬走 |
 *
 * ⚠ **判据一律复用 `make-scripts-index.mjs` 的定义，不另抄一份**：
 *   - 「谁在门禁里」⇒ import 它的 `collectUsage().ci`（它已经处理了
 *     「check.yml 里被提到 ≠ 在门禁跑」这个坑 —— 见该文件 L141 的注释）
 *   - 「什么是一次性补丁」⇒ 同一个文件里的 `PATCH_PREFIX`
 *   抄第二份的后果是本项目反复踩的那族病：**判据漂移**，且漂移了没人知道。
 *
 * ## ⚠ 这条守卫**必须能红**
 *
 * 立项时写了「有效性自测」，本文件末尾的 `SELF_TEST` 就是那个自测的**可执行版本**：
 * 它在临时目录里造出四种违规形态，跑一遍同样的判据，确认**每一种都真的被抓到**。
 * 一个不能因真原因变红的守卫＝装饰品（v0.193 那条 profile 守卫的教训）。
 *
 * 用法：node test/scripts-hygiene-guard.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectUsage, ROOT, PATCH_PREFIX, KEEP_TOOL } from '../scripts/make-scripts-index.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (HERE !== ROOT) console.error(`  （ROOT 与预期不同：${ROOT}）`);

/* ⚠ 判据一律复用 `make-scripts-index.mjs` 的定义，不另抄一份：
 *   - 「谁在门禁里」⇒ 它的 `collectUsage().ci`（已处理「被提到 ≠ 在门禁跑」这个坑）
 *   - 「什么是一次性补丁」⇒ 它的 `PATCH_PREFIX`
 *   这里**没有 fallback** —— 第一版写了个「import 失败就用本地副本正则」的兜底，
 *   那意味着 `PATCH_PREFIX` 真出问题时守卫会**悄悄换一套判据**继续跑，
 *   而报告仍然全绿。宁可 import 直接炸。 */

/* 顶层不算 archive / lib / _tmp* / node_modules。 */

/** 「文件头声明了生命周期」的判据：注释块里出现「一次性」/「长期」/「常驻」任一即可。 */
const LIFETIME_TAG = /一次性|长期|常驻/;

function topLevelScripts(root) {
  const dir = path.join(root, 'scripts');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && fs.statSync(path.join(dir, f)).isFile());
}
function archiveScripts(root) {
  const dir = path.join(root, 'scripts', 'archive');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && fs.statSync(path.join(dir, f)).isFile());
}

/* ── 判据本体（拆成纯函数，自测要复用，所以不能只写成一个循环） ── */

/**
 * ⚠ **不是补丁的常驻工具 / 维护脚本**（前缀会误伤它们）。
 *
 * 三条，都不是"我觉得"，各自有硬理由：
 *
 * 1. `merge-duplicate-relations.mjs` —— 被 `merge-` 归进「一次性补丁」，
 *    但 `scripts/validate.mjs` 第 199 行会**主动建议用户跑它**
 *    （「关系重复…跑 node scripts/merge-duplicate-relations.mjs 合并」）
 *    ⇒ 常驻工具，归档它等于删掉 validate 指向的出口。
 *
 * 2. `tag-script-lifetime.mjs` —— 被 `tag-` 归进「一次性补丁」，
 *    但它是**给脚本补生命周期声明的维护脚本**，P3 靠它才过得去。
 *    ⇒ 守卫把自己这条的执行脚本判红了。**自指陷阱**：
 *      凡是"用来维持规范"的脚本，都要在这份名单里，否则它会第一个被自己的守卫咬。
 *
 * 3. `archive-one-offs.mjs` —— 归档动作本身，一次性执行脚本。
 *
 * ⚠ 这份名单与 `scripts/archive-one-offs.mjs` / `scripts/tag-script-lifetime.mjs`
 *   里的 `KEEP_TOOL` **必须一致** —— 两边不一致会出现「归档脚本放过了、守卫却报错」或反之，
 *   而两边都会觉得自己是对的。守卫 P1 的自测会验这一点。
 */
export { KEEP_TOOL };

/**
 * P1：顶层的一次性补丁都该归档。
 * @returns {{file:string, why:string}[]}
 */
export function findUnarchivedPatches(root) {
  return topLevelScripts(root)
    .filter((f) => PATCH_PREFIX.test(f))
    .filter((f) => !KEEP_TOOL.has(f))
    .map((f) => ({ file: f, why: '在 scripts/ 顶层，且名字是一次性补丁前缀' }));
}

/**
 * P2：archive 里的脚本必须有归档标记。
 * 标记形如 `【已归档】` 或 `@archived`，认这两种之一。
 */
export function findUnmarkedArchived(root) {
  return archiveScripts(root).filter((f) => {
    const src = fs.readFileSync(path.join(root, 'scripts', 'archive', f), 'utf8');
    /* 只看文件头 2000 字符 —— 标记必须在头部，写在末尾等于没写。 */
    const head = src.slice(0, 2000);
    return !head.includes('【已归档】') && !head.includes('@archived');
  }).map((f) => ({ file: f, why: '在 scripts/archive/ 里，但文件头没有归档标记' }));
}

/**
 * P3：脚本文件头要写明「一次性」还是「长期」。
 * 认两种写法：`一次性` / `长期`（含"常驻"）。
 */
export function findMissingLifetimeTag(root) {
  const out = [];
  const scan = (dir, label) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      /* 文件头 = 开头**连续**的注释行。
       *
       * ⚠ 第一版用「第一个块结束符之前」当文件头，于是两种**正常**写法被误判：
       *   ① 块注释**单行闭合**（`_patch-v11.mjs` 就是，开头斜杠星星、中间接说明、
       *     同一行以「斜杠星」收尾）⇒ 取到空串；
       *   ② 文件头**之前还有一段块注释**（`check-annotations.mjs` 就是）⇒ 取到错的块。
       *   ⇒ 改成按行扫：从第一行起，只要还是注释行就并入文件头；
       *   单行闭合的块到那一行为止，碰到空行也不停（部分文件头有空行）。
       *
       * ⚠⚠ 这段注释里**不能**出现「斜杠 + 星」相邻的字面组合 ——
       *   写它进去会提前闭合块注释，而报错落在**下面**的代码行上，
       *   跟真正的出错行隔着好几行，极难定位（本文件已因此栽了两次：
       *   一次在守卫文件头、一次在这里）。 */
      const headLines = [];
      for (const line of src.split('\n')) {
        const t = line.trim();
        /* ⚠ **shebang 必须放行**：绝大多数脚本第一行是 `#!/usr/bin/env node`，
         *   它不是注释、也不以任何注释符号开头 ⇒ 第二版忘了处理它，
         *   于是文件头长度直接算成 0，79 个文件全被判成"没写生命周期"。
         *   ⇒ 判据补上 `t.startsWith('#!')`。 */
        const isComment = t === '' || t.startsWith('#!') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.endsWith('*/');
        if (!isComment) break;
        headLines.push(line);
        if (t.endsWith('*/')) break;
        if (headLines.length > 80) break;
      }
      const head = headLines.join('\n');
      if (!LIFETIME_TAG.test(head)) out.push({ file: `${label}/${f}`, why: '文件头没写明「一次性」还是「长期」' });
    }
  };
  scan(path.join(root, 'scripts'), 'scripts');
  scan(path.join(root, 'scripts', 'archive'), 'scripts/archive');
  return out;
}

/**
 * P4（双向）：门禁 `run:` 到的脚本必须在顶层，且顶层/归档的脚本不得被门禁 import。
 * @returns {{file:string, why:string}[]}
 */
export function findGatePlacementProblems(root) {
  const out = [];
  const { ci } = collectUsage(root);
  const archived = new Set(archiveScripts(root));
  for (const [name, cmd] of ci) {
    if (archived.has(name)) out.push({ file: name, why: `门禁里跑着（${cmd}），却被归档了` });
    if (!fs.existsSync(path.join(root, 'scripts', name))) {
      out.push({ file: name, why: `门禁里跑着（${cmd}），但 scripts/ 顶层找不到这个文件` });
    }
  }
  return out;
}

/* ── 跑真实仓库 ── */
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

console.log('══ scripts/ 归档卫生守卫 ══\n');

const p1 = findUnarchivedPatches(ROOT);
ok(p1.length === 0,
  `P1 顶层没有未归档的一次性补丁${p1.length ? `（还有 ${p1.length} 个）` : ''}`);
for (const x of p1) console.error(`      · ${x.file} —— ${x.why}`);

const p2 = findUnmarkedArchived(ROOT);
ok(p2.length === 0, `P2 archive 里每个脚本都有归档标记${p2.length ? `（${p2.length} 个缺）` : ''}`);
for (const x of p2) console.error(`      · ${x.file} —— ${x.why}`);

const p3 = findMissingLifetimeTag(ROOT);
ok(p3.length === 0, `P3 每个脚本文件头都写明了「一次性 / 长期」${p3.length ? `（${p3.length} 个缺）` : ''}`);
for (const x of p3) console.error(`      · ${x.file} —— ${x.why}`);

const p4 = findGatePlacementProblems(ROOT);
ok(p4.length === 0, `P4 门禁脚本都在顶层、没被归档${p4.length ? `（${p4.length} 处）` : ''}`);
for (const x of p4) console.error(`      · ${x.file} —— ${x.why}`);

/* ── 有效性自测：造违规形态，确认每条判据都真的会红 ──
 * ⚠ 这一段不是"多余的自测"，它是本守卫**存在的理由**：
 *   判据写错了但恰好没触发，P1~P4 会全绿，而守卫什么也没守。 */
console.log('\n── 有效性自测（在临时目录里造违规形态）──');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-hyg-'));
try {
  const mk = (rel, content) => {
    const fp = path.join(sandbox, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content, 'utf8');
  };
  /* 一个最小可用的 check.yml：让 collectUsage 有东西可读。 */
  mk('.github/workflows/check.yml', 'name: t\njobs:\n  c:\n    steps:\n      - run: node scripts/real-gate.mjs\n');
  mk('scripts/real-gate.mjs', '/** 长期：常驻门禁 */\n');
  mk('scripts/keep-maybe.mjs', '/** 长期：工具 */\n');

  const t1 = findUnarchivedPatches(sandbox);
  ok(t1.length === 0 && true, '　（基线）干净目录不报 P1');
  mk('scripts/fix-v999-demo.mjs', '/** 一次性：v0.999 演示 */\n');
  ok(findUnarchivedPatches(sandbox).length === 1, '　① 顶层放 fix-* ⇒ P1 抓到');

  ok(findUnmarkedArchived(sandbox).length === 0, '　（基线）archive 空时不报 P2');
  mk('scripts/archive/fix-old.mjs', '/** 一次性：早年的东西 */\n');
  ok(findUnmarkedArchived(sandbox).length === 1, '　② archive 里缺归档标记 ⇒ P2 抓到');
  fs.writeFileSync(path.join(sandbox, 'scripts/archive/fix-old.mjs'), '/** 【已归档】一次性：早年的东西 */\n', 'utf8');
  ok(findUnmarkedArchived(sandbox).length === 0, '　③ 加上【已归档】标记 ⇒ P2 放行');

  ok(findMissingLifetimeTag(sandbox).filter((x) => x.file.includes('keep-maybe')).length === 0,
    '　（基线）写明「长期」的不报 P3');
  mk('scripts/no-tag.mjs', 'export const a = 1;\n');
  ok(findMissingLifetimeTag(sandbox).some((x) => x.file.includes('no-tag')), '　④ 文件头没写一次性/长期 ⇒ P3 抓到');

  ok(findGatePlacementProblems(sandbox).length === 0, '　（基线）门禁脚本在顶层时不报 P4');
  fs.renameSync(path.join(sandbox, 'scripts/real-gate.mjs'), path.join(sandbox, 'scripts/archive/real-gate.mjs'));
  const p4s = findGatePlacementProblems(sandbox);
  ok(p4s.some((x) => x.file === 'real-gate.mjs'), '　⑤ 把门禁脚本挪进 archive ⇒ P4 抓到');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${'─'.repeat(56)}`);
console.log(`通过 ${pass}　失败 ${fail}`);
if (fail) { console.error('✗ 有守卫没站住'); process.exit(1); }
console.log('✓ 归档卫生达标');
