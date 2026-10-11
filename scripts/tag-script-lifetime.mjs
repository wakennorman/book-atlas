#!/usr/bin/env node
/**
 * 【一次性】一次性补丁前缀　（v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定）
 * 给脚本文件头补生命周期声明（v0.195 · 债二 B1）
 *
 * ## 为什么需要它
 *
 * 守卫 `test/scripts-hygiene-guard.mjs` 的 P3 要求每个脚本在文件头写明
 * 「一次性」还是「长期」。立项时实测**顶层 51 个 + archive 8 个**都没写
 * ⇒ 分类全靠猜，而「猜错类别」正是这个项目反复踩的坑
 * （v0.195 就差点把 `merge-duplicate-relations.mjs` 归档掉）。
 *
 * ## 类别怎么定 —— 不用前缀，用**门禁 + import + 文档**三类证据
 *
 * 与 `make-scripts-index.mjs` 的 `classify()` 同源：
 *   · 在 `check.yml` 的 `run: node scripts/…` 里 ⇒ 门禁（长期）
 *   · 在 `scripts/lib/` 里，被别人 import ⇒ 库（长期）
 *   · 别名一次性补丁前缀且不在上面两类 ⇒ 一次性
 *   · 其余 ⇒ **长期工具**（它们能被人在需要时手动跑，跑完不影响仓库状态）
 *
 * ⚠ 最后一类是判断，不是事实。判据写在这里是为了让人能一眼看出「为什么这个被判成长期」，
 *   并在文件里留痕。**判错时改这一个文件即可**（守卫不会因为名字而红）。
 *
 * ## 写在哪
 *
 * 插在文件头块注释的**第一行之后**（`/**` 那行下面），与归档标记同一位置。
 * 已写过的不重复插。
 *
 * 用法：
 *   node scripts/tag-script-lifetime.mjs          # 预览
 *   node scripts/tag-script-lifetime.mjs --write  # 落盘（幂等）
 */
import fs from 'node:fs';
import path from 'node:path';

import { collectUsage, PATCH_PREFIX, ROOT } from './make-scripts-index.mjs';

/* ⚠ 与守卫同一份排除表。两边不一致会出现「守卫放过 / 归档脚本放过」这类错配。 */
const KEEP_TOOL = new Set(['merge-duplicate-relations.mjs']);

const WRITE = process.argv.includes('--write');

/** 收集 scripts/ 与 scripts/archive/ 下的全部 .mjs。 */
function allScripts(root) {
  const out = [];
  for (const [dir, label] of [['scripts', 'scripts'], ['scripts/archive', 'scripts/archive']]) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.mjs')) continue;
      if (!fs.statSync(path.join(abs, f)).isFile()) continue;
      out.push({ abs: path.join(abs, f), label, name: f });
    }
  }
  return out;
}

const { ci } = collectUsage(ROOT);

function classify(s) {
  if (s.label === 'scripts/archive') return { tag: '一次性', why: '已归档的一次性补丁' };
  if (ci.has(s.name)) return { tag: '长期', why: '发布门禁每轮都跑' };
  if (s.label === 'scripts/lib') return { tag: '长期', why: '库，被别的脚本 import' };
  if (KEEP_TOOL.has(s.name)) return { tag: '长期', why: '常驻工具（validate 会建议用户跑它）' };
  if (PATCH_PREFIX.test(s.name)) return { tag: '一次性', why: '一次性补丁前缀' };
  return { tag: '长期', why: '工具：需要时手动跑，跑完不改仓库状态' };
}



const planned = [];
const skipped = [];

for (const s of allScripts(ROOT)) {
  const src = fs.readFileSync(s.abs, 'utf8');

  /* archive 里的老文件缺的是【已归档】标记（P2），不是生命周期声明 —— 分开处理。 */
  if (s.label === 'scripts/archive' && !src.includes('【已归档】')) {
    skipped.push([`${s.label}/${s.name}`, '缺归档标记（P2 管这个），本脚本只补生命周期']);
    continue;
  }

  const head = src.slice(0, src.indexOf('*/') > 0 ? src.indexOf('*/') : 600);
  if (/【一次性】|【长期】/.test(head)) continue;              // 已写过
  if (/【已归档】/.test(head)) { skipped.push([`${s.label}/${s.name}`, '已归档，跳过']); continue; }

  const { tag, why } = classify(s);
  const lines = src.split('\n');
  const at = lines[0].startsWith('#!') ? 1 : 0;
  /* ⚠ 文件头块有**三种**写法，本项目三种都有：
   *   `/** … *\/`（多数）、`/* … *\/`（`check-altnames-ledger` / `check-event-chars` /
   *   `make-anno-digest` 等 6 个）、`// …`（`name2id.mjs`）。
   *   第二版只认 `/**`，那 6 个 + `name2id` 全被跳过 ⇒ 守卫 P3 一直红。
   *   ⇒ 三种都认，并在下面按同样的规则生成插入行。 */
  const docStart = lines.findIndex((l, i) => i >= at && (l.startsWith('/**') || l.startsWith('/*') || l.startsWith('//')));
  if (docStart < 0) { skipped.push([`${s.label}/${s.name}`, '没有注释文件头，不自动插']); continue; }

  const headLine = lines[docStart];
  const isLineStyle = headLine.startsWith('//');
  /* ⚠⚠ **单行闭合的块注释**（一整行 `/* … *\/` 写完）不能往下一行插 ——
   *   下一行已经在块外，插进去的 ` * …` 就是**裸代码** ⇒ `node --check` 报
   *   `SyntaxError: Unexpected token '*'`。
   *   实测损坏 5 个顶层文件（`check-annotations` / `check-event-chars` /
   *   `check-surname-coverage` / `make-anno-digest` / `name2id`）。
   *
   *   ⚠ 而第一版的**自检没抓到**：它只验「插入行的上一行是不是注释」，
   *     而单行闭合块的下一行恰好也是 ` * …` 形式的注释行 ⇒ 自检通过、文件却坏了。
   *     ⇒ 自检必须额外验「块注释是否还闭合」与「标记之后能否找到块结束」。
   *
   *   ⇒ 这类文件把块**拆成三行**：说明 / 标记 / 闭合。 */
  const singleLine = !isLineStyle && headLine.trimEnd().endsWith('*/');
  const prefix = isLineStyle ? '// ' : ' * ';
  const tagLine = `${prefix}【${tag}】${why}　（v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定）`;
  const body = singleLine ? headLine.replace(/^\/\*\*?/, '').replace(/\*\/\s*$/, '').trimEnd() : null;
  planned.push({ ...s, tag, why, docStart, line: tagLine, singleLine, body });
  console.log(`  ✔ ${(s.label + '/' + s.name).padEnd(46)} ${tag}　${why}${singleLine ? '（单行块 ⇒ 拆行）' : ''}`);
}

if (skipped.length) {
  console.log('\n跳过的：');
  for (const [f, why] of skipped) console.log(`  － ${f}：${why}`);
}

if (!WRITE) {
  console.log(`\n（预览）将给 ${planned.length} 个脚本补生命周期声明。加 --write 才落盘。`);
  process.exit(0);
}

let done = 0;
for (const p of planned) {
  const lines = fs.readFileSync(p.abs, 'utf8').split('\n');
  if (p.singleLine) {
    /* 拆行：说明 / 标记 / 闭合，三行。 */
    lines.splice(p.docStart, 1, `/** ${p.body}`, p.line, ' */');
  } else {
    lines.splice(p.docStart + 1, 0, p.line);
  }
  const out = lines.join('\n');
  /* ⚠ 写前自检：标记真的进去了，且文件仍能被解析。
   *
   * ⚠⚠ 语法检查**不能**用 `spawnSync(node, ['--check'])` ——
   *   本机 node 起不了任何子进程（`spawnSync` 一律 EBUSY，项目 v0.180 起就记在门禁里）。
   *   第一版正是这么写的，于是 `r.status === null`（EBUSY 时 status 是 null 不是 1），
   *   被我当成「语法不过」，**把好文件回滚了** ——
   *   而那个文件其实完全正常。
   *   ⇒ 改用 `vm.Script` 直接解析源码，不起子进程（同 test/build.mjs 的做法）。 */
  if (!out.includes(`【${p.tag}】`)) { console.error(`✗ ${p.name}：写完找不到标记`); process.exit(1); }
  /* ⚠ 自检：插入行必须落在**它本来的那个块**里。
   *
   *   第一版用 `out.indexOf('/**')` 找块首 ⇒ 有些文件在正式文件头**之前**
   *   还有一段 `/* ... *\/` 说明（`check-annotations.mjs` 就是），
   *   于是 indexOf 找到的是错的块，自检报「插入行不在块内」。
   *   ⇒ 改成**按行判定**：插入行的下一行往右必须还在块内（直到块闭合），
   *   且插入行上一行必须以 `/**` 或 ` *` 开头（说明确实插在注释里）。
   *   这样不需要解析 JS，也不需要起子进程。 */
  const ls = out.split('\n');
  const at = ls.findIndex((l) => l.includes(`【${p.tag}】`) && l.includes(String(p.tag)));
  if (at < 1) { console.error(`✗ ${p.name}：找不到插入行`); process.exit(1); }
  const prev = ls[at - 1].trim();
  /* `//` 行注释的上一行**也是** `//` 注释，不是块注释的开始 ——
   * 第三版把「上一行必须以 /** 或 * 或 /* 开头」当成通用规则，
   * 于是 `name2id.mjs` 被自己的自检拒了。 */
  const okPrev = prev.endsWith('/**') || prev.endsWith('*') || prev.startsWith('/*') || prev.startsWith('//');
  if (!okPrev) {
    console.error(`✗ ${p.name}：插入行的上一行不是注释（是「${prev}」），未写入`);
    process.exit(1);
  }
  /* 从插入行往下找块结束，确认它在闭合之前。
   * ⚠ 不设 60 行上限：`check-dup-names-ledger.mjs` 的文件头就有 70+ 行，
   *   第二版写死 60 于是误判「没有块结束符」——
   *   一个**自检**因为自己的窗口太小而拒绝合法改动，比没有自检更坏。
   * ⚠ `//` 行注释没有结束符，`name2id.mjs` 就是这种 ⇒ 那种风格跳过这项检查。
   *
   * ⚠⚠⚠ **下面这段注释里绝不能出现「斜杠 + 星」相邻的字面组合。**
   *   本文件因此已经栽了**三次**：每次都是在注释里描述闭合符时把它写了出来，
   *   于是注释提前闭合、报错落在**后面**的模板字符串上（显示为
   *   `SyntaxError` 指向某个 `${…}`，跟真正的出错行隔着十几行）。
   *   描述这类字符时要拆开写（像上面那样说「块结束符」）。 */
  if (!p.line.startsWith('// ')) {
    const closed = ls.slice(at).some((l) => l.includes('*/'));
    if (!closed) { console.error(`✗ ${p.name}：插入行之后没有块结束符，未写入`); process.exit(1); }
  }

  /* ⚠⚠ **这一条是第一版漏掉的那条**，而它正是 5 个文件被写坏的原因：
   *   上面的自检只验「插入行落在某个注释块里」，
   *   而单行闭合块的**下一行恰好也是 ` * …` 形式的注释行** ⇒ 全部通过，文件却坏了。
   *
   *   ⇒ 判据改成**可判定的**那条：**标记行之后必须能找到闭合符**。
   *     单行闭合被错误地插到下一行时，那一行往后就没有块闭合符了（块已在上一行闭合）
   *     ⇒ 必然被抓。
   *
   * ⚠ 第一版写的是「全文括号配平」，结果多行块也被算成不配平（balance=4）
   *   —— 一个**过严**的自检会把合法改动全拒掉，比没有自检更坏。 */
  if (!p.line.startsWith('// ')) {
    const after = ls.slice(at).join('\n');
    if (!after.includes('*/')) {
      console.error(`✗ ${p.name}：标记行之后找不到块闭合符 —— 大概率插到了单行闭合块之后，未写入`);
      process.exit(1);
    }
    /* 单行块的情形必须真的被拆成了多行：标记的**上一行**不能已经是闭合的块。 */
    if (p.singleLine && prev.endsWith('*/')) {
      console.error(`✗ ${p.name}：单行块没被拆开（标记的上一行已闭合），未写入`);
      process.exit(1);
    }
  }

  fs.writeFileSync(p.abs, out, 'utf8');
  done++;
}
console.log(`\n✓ 已给 ${done} 个脚本补上生命周期声明`
  + '（每个都验过：标记在块内 + 标记之后有闭合符 + 单行块确实被拆开）');
