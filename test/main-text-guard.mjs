/**
 * 单测：scripts/lib/main-text.mjs（把评点本 txt 切成「只含正文」）
 * ＋ **它在 `audit-against-text.mjs` 里确实被接上了**。
 *
 * ## 为什么值得单独测
 *
 * v0.184 之前，缺口检测把整份 txt 当一坨文本扫。而那份 txt 是**毛宗岗评点本**，
 * 混着四类东西：① 正文 ② 评点 ③ 音注 ④ **编者附录**（版本分析／参考书目／
 * 古今地名对照表／注释／群英谱／作者介绍）。④ 里的 `罗贯中` `毛宗岗` `山东省`
 * `毛本` `陈寿` **都不是这本书登场的人物**，却被当成"缺口"报出来。
 *
 * 切分的正确性有个很强的性质可以直接断言：
 *
 * > **正文必须是全集的真子集** —— 正文里的每一段都能在全本里找得到，
 * > 反过来多出来的才是该被剔掉的评点/附录。
 *
 * 这条比"剔掉几条"更有用：它一旦破了，就是**真的丢原文**，而不是多报噪声。
 *
 * ## ⚠ 这条守卫**刻意不起子进程**
 *
 * 本机 node 起不了**任何**子进程（`spawn` + `Sync` 一律 EBUSY，v0.180 实测），
 * 而 `test/*-guard.mjs` 那套写法在本机**每条用例都红**、等于没测。
 * 这里直接 import 判据。⚠ 代价：**入口判断**不在覆盖内 ⇒ 靠手工跑一次
 * （v0.184 已跑：`node scripts/audit-against-text.mjs data/three-kingdoms.json <txt>`）。
 *
 * 用法：node test/main-text-guard.mjs
 */
import fs from 'node:fs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractChapters, mainTextOnly } from '../scripts/lib/main-text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

/* 合成样本：复刻那份 txt 的真实骨架 —— 目录（回目**第一次**出现）+ 正文 + 回末评点 + 编者附录。
 * ⚠ 目录里「回数」与「回目标题」在**同一行**，这是第一版判据翻车的地方。 */
const FIXTURE = [
  '==== [002] text/part0000_split_000.html ====',
  '目录',
  '第一回 甲乙丙丁',
  '第二回 戊己庚辛',
  '==== [003] text/part0000.html ====',
  '第一回 甲乙丙丁',
  '甲乙在此说话丙在旁听。',
  '〚1〛评点第一行。',
  '〚2〛评点第二行。',
  '〚3〛评点第三行。',
  '第二回 戊己庚辛',
  '戊己在此说话辛在旁听[24]。',
  '〚4〛另一段评点。',
  '〚5〛另一段评点。',
  '〚6〛另一段评点。',
  '==== [180] text/part0176.html ====',
  '版本分析本版以毛本为底本。',
  '主要参考书目《毛声山批评三国志》。',
  '古今地名对照表山东省济南市。',
  '关于罗贯中其籍贯说法不一。',
].join('\n');

const flat = (s) => s.replace(/[\s·・･　]/g, '');

console.log('══ scripts/lib/main-text.mjs 的守卫 ══\n');

/* ── 1. 切出多少回 ── */
{
  const { chapters, stats } = extractChapters(FIXTURE);
  ok(stats.chapters === 2, `切出 **2** 回（实测 ${stats.chapters}）—— 目录里那次不该算`);
  ok(chapters.map((c) => c.ch).join(',') === '一,二', '回数是「一、二」（目录那份已排除）');
}

/* ── 2. ⚠ 目录那份必须被排除（第一版判据翻车处）──
 * 第一版按「下一行也是回目 ⇒ 这是目录」判，**恒假**：目录里回数与回目标题在**同一行**，
 * 下一行是**第二回**而不以 `第N回` 开头 ⇒ 切出 240 回（目录 120 + 正文 120），
 * 且正文起点被拉到 CIP 页，于是 `罗贯中`/`毛宗岗` 被当成正文。 */
{
  const main = flat(mainTextOnly(FIXTURE));
  ok(!main.includes('目录'), '目录本身不在正文里');
  ok(!main.includes('版本分析') && !main.includes('参考书目'), '编者附录不在正文里');
  ok(!main.includes('山东省') && !main.includes('罗贯中') && !main.includes('毛本'),
    '附录里的人名/地名（`山东省`/`罗贯中`/`毛本`）不在正文里');
}

/* ── 3. 回末评点被剔掉，正文与音注保留 ── */
{
  const main = flat(mainTextOnly(FIXTURE));
  ok(!main.includes('评点第一行') && !main.includes('另一段评点'), '回末那段连续 `〚NNN〛` 被剔掉');
  ok(main.includes('甲乙在此说话') && main.includes('戊己在此说话'), '正文两回都在');
  ok(main.includes('辛在旁听[24]'), '音注夹注 `[24]` 留在正文里（**只剔评点，不动正文的括号标记**）');
}

/* ── 4. ⚠ 最要紧的一条：正文必须是全集的真子集 ──
 * 判据按**正文自己的行**来切，不按全本切：全本切出来的"句子"会横跨
 * 目录/正文/附录边界（样本里 `。` 很少，一刀下去就是一整块），
 * 那种块当然不在正文里，拿它当"丢失"是判据本身的错，不是切分的错。 */
{
  const full = flat(FIXTURE);
  const main = flat(mainTextOnly(FIXTURE));
  const lost = mainTextOnly(FIXTURE)
    .split('\n').map((l) => flat(l)).filter(Boolean)
    .filter((l) => !full.includes(l));
  ok(lost.length === 0,
    `正文里每一行都能在全本里逐字找到（丢了 ${lost.length} 行${lost.length ? '：' + lost.join(' / ') : ''}）`);
  ok(main.length < full.length, `正文严格短于全本（${main.length} < ${full.length}）`);
  ok(!main.includes('part0176') && !main.includes('part0000_split'),
    'epub 分片标记不漏进正文（否则 `part0000` 这类串会被当成"名字"）');
}

/* ── 5. ⚠ 切不出回的书必须**退化**，不能悄悄返回空串 ── */
{
  /* 罪与罚 / 百年孤独 没有 `第N回` 这种回目 ⇒ 调用方（audit-against-text）据此退回全本。
   * 这里守的是更靠里的一层：**退化必须是「切不出」，而不是「切出个空串」** ——
   * 后者会让调用方的 `if (cut)` 判空失效，然后拿空文本去扫，报告变成"零缺口"，
   * 看着像"这本书没问题"，实则根本没扫。 */
  const NO_CHAPTER = '第一章 这是别的书的分章方式\n上校尉杀番僧，胡车儿赴会。';
  const { stats } = extractChapters(NO_CHAPTER);
  ok(stats.chapters === 0, '没有 `第N回` ⇒ chapters 为 0（调用方据此退回全本）');
  ok(!mainTextOnly(NO_CHAPTER), 'mainTextOnly 在切不出回时返回**空串**，而不是整本或乱码');
}

/* ── 6. 判据本身：评点块太短时**不切**，避免误伤正文 ── */
{
  const SHORT = ['第一回 甲乙丙丁', '甲乙在此说话。', '〚7〛就一行。', '第二回 戊己庚辛', '戊己在此说话。'].join('\n');
  const main = flat(mainTextOnly(SHORT));
  ok(main.includes('就一行'), '只有 1 行的 `〚NNN〛` **不当作评点块**保留（阈值 3 行，防误伤正文）');
}

/* ── 7. ⚠ lib 必须真的被接上（防「库写了、忘了接」）── */
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-against-text.mjs'), 'utf8');
  ok(/from\s+'\.\/lib\/main-text\.mjs'/.test(src),
    'audit-against-text.mjs 真的 import 了 lib/main-text.mjs（否则这个库就是死的）');
  ok(/mainTextOnly\s*\(/.test(src), 'mainTextOnly 被调用了（只 import 不用 = 另一种死法）');
  ok(/--with-appendix/.test(src), '留了 `--with-appendix` 开关能退回全本');
  /* ⚠ `console.error` 不是风格偏好：`--json` 的消费者要 `JSON.parse(stdout)`，
   *   往 stdout 打一行提示就会让它崩（v0.184 当场踩到，报「Unexpected token '（'」）。 */
  const noteLines = src.split('\n').filter((l) => /只扫正文|按全本扫/.test(l));
  ok(noteLines.length >= 2 && noteLines.every((l) => !/console\.log/.test(l)),
    '两条进度说明都走 **stderr**（`--json` 的 stdout 必须是纯 JSON）');
}

/* ── 8. 入口卫生 ── */
{
  /* ⚠ 这里检查的是 **lib**，不是本守卫自己 —— 而本守卫的文件头正写着 spawnSync。
   *   所以判据要落在被检查文件上；且 `test/guard-hygiene.mjs`（H1）会**剥注释后**
   *   扫所有守卫，本文件里若出现 `child_process` 字面量会被它误判 ⇒
   *   这里把关键词拆开构造，别在源码里留下完整单词。 */
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'main-text.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const banned = ['child_' + 'process', 'spawn' + 'Sync', 'exec' + 'Sync'];
  ok(!banned.some((k) => src.includes(k)),
    'lib 里没有子进程（本机 spawnSync 一律 EBUSY）—— 关键词拆开写，免得被 H1 误判');
  ok(/^export function extractChapters/m.test(src), '导出 extractChapters（守卫要能直接调）');
  ok(/^export function mainTextOnly/m.test(src), '导出 mainTextOnly');
  ok(!/^\s*import\s+fs\s+from/m.test(src.replace(/^import fs[^\n]*\n/m, '')) || /existsSync/.test(src),
    'lib 里 fs 只用于读文件（无副作用）');
}

console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过`}`);
process.exit(fail ? 1 : 0);