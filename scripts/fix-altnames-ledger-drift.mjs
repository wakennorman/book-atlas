#!/usr/bin/env node
/**
 * v0.161：修「又译出处台账」与数据的**两处漂移** —— 新门禁
 * `scripts/check-altnames-ledger.mjs` 首跑就抓到了它们。
 *
 * ## 起因：一份没有任何消费者、也没有任何门禁的台账
 *
 * `data/one-hundred-years-of-solitude.altnames-sources.json` 记录每个人物 `altNames`
 * （界面上显示为「又译 X」）的出处，`_说明` 里立着一条铁律：
 * **「查不到出处的一个字都不许写。」**
 *
 * 但全仓搜 `altnames-sources`，只有 `scripts/lib/data-files.mjs` 的 SIDECAR 正则
 * （用来把它排除出"书"）和一句注释 —— 它漂了、漏了，**没有任何一处会响**。
 *
 * 现场（门禁首跑）：
 *
 *     ✗ 「何塞·阿尔卡蒂奥（第二代）」的数据里有 altName 但台账没登记 —— ["霍塞·阿卡迪奥"]
 *     ✗ 「何塞·阿尔卡蒂奥（第二代）」的台账登记了但数据里没有 —— ["霍塞·阿卡迪奥第二"]
 *     ✗ 数据里「布鲁诺·克雷斯皮」有 altNames ["布鲁诺·克雷斯比"]，但明细里没有这个人的条目
 *     ✗ `altNames 计数` 写 26，数据实际 27 个
 *
 * ## 两处分别怎么修
 *
 * ### ① 第二代：台账是**修正前的旧值**，改台账（数据是对的）
 *
 * CHANGELOG 记着那次修正：`validate.mjs` 的「同一个名字形式挂在多个人物身上」抓出
 * 黄锦炎译本的「霍塞·阿卡迪奥第二」同时挂在「何塞·阿尔卡蒂奥（第二代）」与
 * 「何塞·阿尔卡蒂奥第二」名下 —— **两个完全不同的人**；而黄锦炎是靠**带不带姓**区分父子的
 * （带姓的是创始人，光杆的是儿子）。所以第二代身上的正确写法是光杆的「霍塞·阿卡迪奥」，
 * 数据已经改对，**台账没跟着改**。
 * 出处 S1 站得住：观察者网那篇的"激情段落对比"里，黄锦炎译本原文写的就是
 * 「别人的热恋激发了霍塞.阿卡迪奥的欲火」（同一个写法，只是间隔号不同）。
 *
 * ### ② 布鲁诺·克雷斯比：**没有出处** ⇒ 从 altNames 移到 aliases
 *
 * 它没有出处，四处来源逐个复核过（2026-10-08）：
 *   · S1 观察者网六译本并排 —— 通篇不含「克雷斯」二字
 *   · S3 新浪博客人物表   —— 用「克雷斯皮」，无「布鲁诺」
 *   · S4 白鹿书院人物表   —— 无「克雷斯」、无「布鲁诺」
 *   · S5 中文维基         —— 皮耶特·克雷斯畢的早期译名是「**克列斯比**」，不是「克雷斯比」；
 *                            整条词条没有「布鲁诺」
 * 而原著（范晔本）用「克雷斯皮」**73 次**、「克雷斯比」**0 次**。
 *
 * ⇒ 按铁律**不能登记为「又译」**。但也不该直接删掉 —— 先例就在数据里：
 *   `pietro-crespi`（皮埃特罗·克雷斯皮）的 `altNames` 是**空的**，
 *   而 `克雷斯比` 留在它的 `aliases` 里。这正是 v0.97 定下的分工：
 *   **`aliases` 是搜索池（画布标签/导出也读它），`altNames` 是展示层**；
 *   查不到出处的写法可以留在搜索池，但不能拿去当「又译」展示。
 * ⇒ 本条照办：从 `altNames` 移到 `aliases`，搜索能力不丢，无出处的展示声明去掉。
 *   同时在台账的 `已拒绝的候选` 里留一条记录（那个列表就是干这个的）。
 *
 * ⚠ 一条**没成立的怀疑**（记下来，免得以后又去查）：`bruno-crespi.note` 第一句现在写的是
 *   「皮埃特罗·**克雷斯皮**的弟弟」——**已经是对的**。
 *   我先前在 `git show 3772938`（v0.96 那次提交）的 diff 里看到的是「克雷斯比」，
 *   那是**当时的写法**，后来已改正。⇒ 脚本仍保留一条校验（若哪天真出现错写法会报出来），
 *   但本轮它是 no-op。**「在 diff 里看到」不等于「现状如此」—— 判断现状要读工作区的文件。**
 *
 * 用法：node scripts/fix-altnames-ledger-drift.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const SLUG = 'one-hundred-years-of-solitude';
const BOOK = path.join(ROOT, 'data', `${SLUG}.json`);
const LEDGER = path.join(ROOT, 'data', `${SLUG}.altnames-sources.json`);
const SRC = path.join(os.tmpdir(), 'opencode', 'ba-books', '百年孤独.txt');

if (!fs.existsSync(SRC)) { console.error(`✗ 找不到原著文本：${SRC}`); process.exit(1); }
const raw = fs.readFileSync(SRC, 'utf8');
const count = (n) => raw.split(n).length - 1;

const book = JSON.parse(fs.readFileSync(BOOK, 'utf8'));
const led = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));

/* ══════════════ 一、原文核验（不过就拒绝动数据） ══════════════ */
console.log('═══ 一、原文核验 ═══\n');
let ok = true;
for (const [needle, want, what] of [
  ['克雷斯皮', 73, '「克雷斯皮」（原著用字）出现次数'],
  ['克雷斯比', 0, '「克雷斯比」出现次数'],
]) {
  const got = count(needle);
  const pass = got === want;
  console.log(`  ${pass ? '✓' : '✗'} ${what}：${got}（期望 ${want}）`);
  if (!pass) ok = false;
}
for (const c of ['他的弟弟布鲁诺·克雷斯皮负责商店的业务']) {
  const hit = raw.includes(c);
  console.log(`  ${hit ? '✓' : '✗'} 原文片段「${c}」`);
  if (!hit) ok = false;
}
/* ⚠ 「霍塞·阿卡迪奥」是**黄锦炎**的写法，范晔本 txt 里 0 次（实测「霍塞」整个词 0 次）
 *   ⇒ 不能用 txt 核它。能核的是"那段文字本身在书里"：范晔本同一段写作
 *   「他人的激情唤醒了何塞·阿尔卡蒂奥的欲望」—— 证明 S1 并排引用的正是这一段。
 *   黄锦炎那一侧的原文（「别人的热恋激发了霍塞.阿卡迪奥的欲火」）来自 S1 的网页，
 *   2026-10-08 已抓取核对过，记在下面的注释里，不当作 txt 断言。 */
{
  const c = '他人的激情唤醒了何塞·阿尔卡蒂奥的欲望';
  const hit = raw.includes(c);
  console.log(`  ${hit ? '✓' : '✗'} 范晔本同段「${c}」（S1 并排引的那一段确实在书里）`);
  if (!hit) ok = false;
}
if (!ok) { console.error('\n  ⛔ 原文核验不过 —— 拒绝改动'); process.exit(1); }

/* 数据侧的前置状态：三者必须已经互相区分（这是 CHANGELOG 那次修正的结果） */
console.log('\n  数据侧前置状态（第二代 / 第二 / 创始人 必须是三种不同写法）：');
const nm = (id) => book.characters.find((c) => c.id === id);
const trio = [
  ['jose-arcadio-2', '霍塞·阿卡迪奥', '第二代 = 黄锦炎的光杆写法（儿子）'],
  ['jose-arcadio-segundo', '霍塞·阿卡迪奥第二', '「第二」是另一个人'],
  ['jose-arcadio-buendia', '霍塞·阿卡迪奥·布恩迪亚', '创始人 = 带姓'],
];
for (const [id, want, why] of trio) {
  const got = (nm(id)?.altNames || [])[0];
  const pass = got === want;
  console.log(`  ${pass ? '✓' : '✗'} ${id}：altNames[0] = ${JSON.stringify(got)}（期望 ${JSON.stringify(want)}）—— ${why}`);
  if (!pass) ok = false;
}
if (!ok) { console.error('\n  ⛔ 数据前置状态不符 —— 拒绝改动'); process.exit(1); }

/* ══════════════ 二、台账：第二代 的又译改成数据值 ══════════════ */
console.log('\n═══ 二、台账：第二代 的又译（旧值 → 数据值）═══\n');
{
  const row = led.明细.find((e) => e.人物 === '何塞·阿尔卡蒂奥（第二代）');
  if (!row) { console.error('  ✗ 台账里找不到该条'); process.exitCode = 1; }
  else if (JSON.stringify(row.又译) === JSON.stringify(['霍塞·阿卡迪奥'])) console.log('  (跳过) 已是数据值 ⇒ 已应用');
  else if (!(row.又译 || []).includes('霍塞·阿卡迪奥第二')) { console.error(`  ✗ 又译 现值 ${JSON.stringify(row.又译)} 既非旧值也非新值 —— 拒绝盲写`); process.exitCode = 1; }
  else {
    console.log(`  − 旧值 ${JSON.stringify(row.又译)}（修正前的写法，CHANGELOG 记着它被挪走过）`);
    row.又译 = ['霍塞·阿卡迪奥'];
    console.log(`  ＋ 新值 ${JSON.stringify(row.又译)}（出处 ${row.出处} 保持 —— S1 的激情段落里黄锦炎译本就写「霍塞.阿卡迪奥」）`);
  }
}

/* ══════════════ 三、数据：布鲁诺 的 altNames → aliases ══════════════ */
console.log('\n═══ 三、数据：布鲁诺·克雷斯比 从 altNames 移到 aliases（照 皮埃特罗 先例）═══\n');
const BRUNO_ALT = '布鲁诺·克雷斯比';
{
  const c = book.characters.find((x) => x.id === 'bruno-crespi');
  if (!c) { console.error('  ✗ 找不到 bruno-crespi'); process.exitCode = 1; }
  else {
    if (!(c.altNames || []).includes(BRUNO_ALT) && (c.aliases || []).includes(BRUNO_ALT)) console.log('  (跳过) 已在 aliases、不在 altNames ⇒ 已应用');
    else {
      if ((c.altNames || []).includes(BRUNO_ALT)) {
        c.altNames = c.altNames.filter((x) => x !== BRUNO_ALT);
        console.log(`  − altNames 去掉「${BRUNO_ALT}」（无出处，不能当「又译」展示）`);
      }
      if (!(c.aliases || []).includes(BRUNO_ALT)) {
        c.aliases = [...(c.aliases || []), BRUNO_ALT];
        console.log(`  ＋ aliases 补上「${BRUNO_ALT}」（搜索池保留，读者按旧译名仍能搜到）`);
      }
    }
    /* note 里同一个错写法 */
    if (c.note.includes('皮埃特罗·克雷斯比')) {
      c.note = c.note.replace('皮埃特罗·克雷斯比', '皮埃特罗·克雷斯皮');
      console.log('  ＋ note：「皮埃特罗·克雷斯比」→「皮埃特罗·克雷斯皮」（同一根因的错写法）');
    } else console.log('  (跳过) note 里没有那个错写法');
  }
}

/* ══════════════ 四、台账：补记 已拒绝的候选 + 更新计数 ══════════════ */
console.log('\n═══ 四、台账：补记「已拒绝的候选」并更新计数 ═══\n');
{
  const rej = led['已拒绝的候选'];
  if (!Array.isArray(rej)) { console.error('  ✗ `已拒绝的候选` 不是数组'); process.exitCode = 1; }
  else if (rej.some((e) => e.又译 === BRUNO_ALT)) console.log('  (跳过) 已拒绝的候选里已有它 ⇒ 已应用');
  else {
    rej.push({
      又译: BRUNO_ALT,
      页面挂在: '布鲁诺·克雷斯皮',
      拒绝理由: '★ 四个来源逐个复核过（2026-10-08）都查不到这个写法：'
        + 'S1 观察者网六译本并排**通篇不含「克雷斯」二字**；S3 新浪博客人物表用「克雷斯皮」、无「布鲁诺」；'
        + 'S4 白鹿书院人物表无「克雷斯」、无「布鲁诺」；S5 中文维基里皮耶特·克雷斯畢的早期译名是「**克列斯比**」'
        + '（用「列」不是「雷斯」），且整条词条没有「布鲁诺」。'
        + '而原著（范晔本）用「克雷斯皮」**73 次**、「克雷斯比」**0 次**。'
        + '⇒ 按台账铁律「查不到出处的一个字都不许写」，**不登记为「又译」**；'
        + '照 v0.97 处理「皮埃特罗·克雷斯比」的先例，它只留在 `aliases`（搜索池），不进 `altNames`（展示层）。'
        + '（v0.96 建 bruno-crespi 时把它当又译写了进去，此后一直没人发现 —— 这份台账没有任何消费者。）',
    });
    console.log(`  ＋ 已拒绝的候选 新增一条「${BRUNO_ALT}」（${rej.length} 条）`);
  }

  let dataTotal = 0;
  for (const c of book.characters) dataTotal += (c.altNames || []).length;
  const ledSum = led.明细.reduce((a, e) => a + ((e && e.又译) || []).length, 0);
  /* ⚠ 这里算的是**修完之后**的数据总数（上面已把 布鲁诺·克雷斯比 从 altNames 移走），
   *   所以它应当等于台账原来的 26。若不等，说明还有别处漂了。 */
  if (led['altNames 计数'] === dataTotal) {
    console.log(`  (无需改) 计数 ${dataTotal} 与**修后**的数据一致（明细合计 ${ledSum}）`
      + `—— 台账原来写 26 并非笔误，是数据多出来那 1 个 altName 造成的，移走之后就对齐了`);
  } else {
    console.log(`  − altNames 计数：${led['altNames 计数']} → ${dataTotal}（明细合计 ${ledSum}）`);
    led['altNames 计数'] = dataTotal;
  }
}

/* ══════════════ 五、体检 ══════════════ */
console.log('\n═══ 五、体检 ═══\n');
{
  const ledMap = new Map(led.明细.map((e) => [e.人物, new Set(e.又译 || [])]));
  let bad = 0;
  for (const c of book.characters) {
    const dat = new Set(c.altNames || []);
    const l = ledMap.get(c.name) || new Set();
    const only = [...dat].filter((x) => !l.has(x));
    const extra = [...l].filter((x) => !dat.has(x));
    if (only.length || extra.length) { console.log(`  ✗ ${c.name}：数据多 ${JSON.stringify(only)} / 台账多 ${JSON.stringify(extra)}`); bad++; }
  }
  let total = 0;
  for (const c of book.characters) total += (c.altNames || []).length;
  console.log(`  数据 altNames 总数 ${total}；台账 计数 ${led['altNames 计数']}，明细 ${led.明细.length} 条 / 合计 ${led.明细.reduce((a, e) => a + (e.又译 || []).length, 0)} 个  ${led['altNames 计数'] === total ? '✓' : '✗'}`);
  console.log(bad ? `  ⇒ 还有 ${bad} 处不一致` : '  ✓ 逐人双向一致');
  if (bad) process.exitCode = 1;
}

if (WRITE) {
  fs.writeFileSync(LEDGER, JSON.stringify(led, null, 2) + '\n', 'utf8');
  fs.writeFileSync(BOOK, JSON.stringify(book, null, 2) + '\n', 'utf8');
  console.log(`\n已写入 ${path.relative(ROOT, LEDGER)} 与 ${path.relative(ROOT, BOOK)}`);
} else {
  console.log('\n预览模式（加 --write 才落盘）');
}
