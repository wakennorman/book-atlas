#!/usr/bin/env node
/**
 * v0.179：把玛尔美拉朵夫一家 6 条亲属边改对 —— 玛尔美拉朵夫是**继父**，不是生父。
 *
 * ## 这一批是怎么来的
 *
 * `audit-relation-actors.mjs`（行为人审计）的 B 级「第三方在场」报了
 * `玛尔美拉朵夫 —父子— 柯里亚`，回原著一读发现 **B 级本身是误报**，
 * 但顺着读下去撞到一条真错：
 *
 *   原著人物表（译者自带的名单，就在正文开头）写着：
 *     「索菲雅谢敏诺芙娜玛尔美拉朵娃（昵称索尼雅，索涅奇卡）**玛尔美拉朵夫的女儿**」
 *     「波丽娜（昵称波莉卡，波连卡，波丽雅）**卡捷莉娜与前夫生的长女**」
 *
 *   玛尔美拉朵夫自己在小酒馆里说：
 *     「我是在她**守寡**的时候娶她的，那时候她**带着三个孩子**，一个比一个小。
 *       当初她是出于爱情才嫁给她第一个丈夫，一个**步兵军官**的……她丈夫死后，
 *       撇下她一个人带着三个年纪很小的孩子」
 *
 *   ⇒ 波丽娜 / 廖尼娅 / 柯里亚 三个孩子都是**卡捷莉娜与前夫（步兵军官）**所生，
 *     玛尔美拉朵夫是他们的**继父**；索尼雅才是玛尔美拉朵夫与前妻的女儿。
 *     ⇒ 数据里「玛尔美拉朵夫 —父子/父女— 柯里亚/廖尼娅」标 `kin: blood` **是错的**。
 *
 * ## 连带的 4 条（同一棵树上长出来的）
 *
 * 改掉两条父边之后，族谱里玛尔美拉朵夫不再挂在柯里亚/廖尼娅下面，
 * 于是 `derive-kin.mjs` 会**丢掉**索尼雅↔廖尼娅、索尼雅↔柯里亚 两条推导边，
 * 并把「柯里亚—廖尼娅」从「兄妹」算成「同母异父的兄妹」——**那是新的错**
 * （两人同父同母，只是那位父亲不是数据里的人物）。
 *
 * 所以一并把这 4 条冻结成**手写边**（去掉 `derived: true`，`dotted` → `solid`）：
 *
 * | 边 | 旧 | 新 | 为什么 |
 * |---|---|---|---|
 * | 玛尔美拉朵夫 → 廖尼娅 | 父女 / blood | **继父女 / step** | 继父 |
 * | 玛尔美拉朵夫 → 柯里亚 | 父子 / blood | **继父子 / step** | 继父 |
 * | 索尼雅 → 波丽娜 | 姐妹 / blood | **继姐妹 / step** | 不共父母，靠父母再婚相连 |
 * | 廖尼娅 → 索尼雅 | 同父异母的姐妹（推导）/ blood | **继姐妹 / step** | 同上；推导边已不再可复现 |
 * | 柯里亚 → 索尼雅 | 同父异母的兄妹（推导）/ blood | **继兄妹 / step** | 同上 |
 * | 柯里亚 → 廖尼娅 | 兄妹（推导）/ blood | **兄妹 / blood**（改为手写） | 冻结，否则会被算成「同母异父」 |
 *
 * ## ⚠ 为什么不动 `scripts/kin-terms.mjs`（把继亲边接进族谱）
 *
 * 那才是"根本解"，但它牵动三处：
 *   ① `PARENT_CHILD` 正则在 `scripts/kin-terms.mjs` 与 `js/editor.js` 里**逐字相同**
 *      （`test/parent-child.mjs` 守着），改就要动前端资源 + 升版本号；
 *   ② 三国另有 4 条继亲边（`刘琦—继母—蔡夫人`、`袁谭—继母继子—刘夫人`），
 *      一进族谱就是**全库 2335 条关系重算**，爆炸半径没量过；
 *   ③ 与 v0.111「养亲边进族谱、称谓加『养』字」是同一套设计，需要一次成体系的改动。
 *   ⇒ 本轮用**受控的手写边**把这一家改对，把上面这件事记进 CHANGELOG 当下一轮的候选。
 *
 * ## 纪律
 *
 * ⚠ 每条改动都必须有**逐字存在**的原文定位短语，否则本脚本拒绝并 exit 1。
 * ⚠ 落盘前解析回来**深比对**：除这 6 条边外不许有任何别的差异。
 * ⚠ `data/crime-and-punishment.json` **不是** `JSON.stringify(x, null, 2)` 的输出
 *   （实测往返会重排 2822 行，且文件是 CRLF），所以走"关系块内字面替换"，
 *   绝不 parse→stringify 落盘。
 *
 * 用法：`node scripts/fix-marmeladov-kin.mjs`（预览）／`… --write`
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'crime-and-punishment.json');
const SRC = path.join(os.tmpdir(), 'opencode', 'ba-books', '罪与罚.txt');

if (!fs.existsSync(SRC)) {
  console.error(`✗ 找不到原著文本：${SRC}`);
  console.error('  没有原文不许改亲属关系 —— 中止。');
  process.exit(1);
}
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');
const F = flat(fs.readFileSync(SRC, 'utf8'));

/** 引用原文的公共片段，写进事件文案里，避免各处手抄走样。 */
const Q_ORPHAN = '因为我们原先的爸爸已经死了';
const Q_TWOCHILD = '柯里亚和廖尼娅呢，跟着妈妈一句句念';
const Q_FAVORITE = '在我们这些孩子当中，他最喜欢的是廖尼娅';
const Q_WIDOW = '我是在她守寡的时候娶她的，那时候她带着三个孩子';
const Q_ELDEST = '卡捷莉娜与前夫生的长女';

/* ── 六个作业 ─────────────────────────────────────────────
 * locate：必须在原著里逐字存在（去空白后）。
 * ev：新的「定义关系的小事件」（旧的那条整体替换掉）。
 */
const JOBS = [
  {
    from: 'marmeladov', to: 'lonyusha',
    newType: '继父女', newKin: 'step',
    locate: [Q_FAVORITE, Q_ORPHAN],
    why: '玛尔美拉朵夫是继父：廖尼娅是卡捷莉娜与前夫所生（人物表「' + Q_ELDEST + '」）。',
    ev: {
      text: `「${Q_FAVORITE}」——廖尼娅是卡捷莉娜与前夫（步兵军官）所生，玛尔美拉朵夫是她的继父：波连卡称他为「我们的第二个爸爸」，「${Q_ORPHAN}」。`,
      chapter: '第7章',
      evidence: 'quote',
    },
  },
  {
    from: 'marmeladov', to: 'korya',
    newType: '继父子', newKin: 'step',
    locate: [Q_TWOCHILD, Q_ORPHAN, Q_WIDOW],
    why: '玛尔美拉朵夫是继父，不是生父：柯里亚是卡捷莉娜与前夫（步兵军官）所生。',
    note: `原标「父子 / 血缘」是错的。柯里亚是卡捷莉娜与前夫（步兵军官）所生，玛尔美拉朵夫是继父 —— 依据：玛尔美拉朵夫自述「${Q_WIDOW}」，波连卡称他为「我们的第二个爸爸」，且「${Q_ORPHAN}」。`,
    ev: {
      text: `柯里亚是卡捷莉娜与前夫（步兵军官）所生，玛尔美拉朵夫是继父：波连卡说「${Q_TWOCHILD}」，又把玛尔美拉朵夫叫作「我们的第二个爸爸」——「${Q_ORPHAN}」。`,
      chapter: '第7章',
      evidence: 'paraphrase',
    },
  },
  {
    from: 'sonya', to: 'polina',
    newType: '继姐妹', newKin: 'step',
    locate: [Q_ELDEST, Q_WIDOW],
    why: '索尼雅与波丽娜不共父母：索尼雅是玛尔美拉朵夫与前妻的女儿，波丽娜是卡捷莉娜与前夫的长女，两人靠父母再婚相连。',
  },
  {
    from: 'lonyusha', to: 'sonya',
    newType: '继姐妹', newKin: 'step', newStyle: 'solid', dropDerived: true,
    locate: [Q_WIDOW, Q_ELDEST],
    why: '旧的「同父异母的姐妹（推导）」不再可复现（玛尔美拉朵夫已不是廖尼娅的族谱父），且「同父异母」本身就错 —— 两人连父都不共。',
    ev: {
      text: `索尼娅是玛尔美拉朵夫与前妻的女儿，廖尼娅是卡捷莉娜与前夫的女儿；父母再婚后两人成为继姐妹（玛尔美拉朵夫：「${Q_WIDOW}」）。`,
      chapter: '第2章',
      evidence: 'paraphrase',
    },
  },
  {
    from: 'korya', to: 'sonya',
    newType: '继兄妹', newKin: 'step', newStyle: 'solid', dropDerived: true,
    locate: [Q_WIDOW, Q_ELDEST],
    why: '同 廖尼娅↔索尼雅：旧推导边不可复现，且「同父异母」错（两人不共父也不共母）。',
    ev: {
      text: `索尼娅是玛尔美拉朵夫与前妻的女儿，柯里亚是卡捷莉娜与前夫的儿子；父母再婚后两人成为继兄妹（玛尔美拉朵夫：「${Q_WIDOW}」）。`,
      chapter: '第2章',
      evidence: 'paraphrase',
    },
  },
  {
    from: 'korya', to: 'lonyusha',
    newType: '兄妹', newKin: 'blood', newStyle: 'solid', dropDerived: true,
    locate: [Q_TWOCHILD],
    why: '两人同父同母（都是卡捷莉娜与前夫所生）⇒ 真血缘。冻结成手写边，否则玛尔美拉朵夫退出族谱后会被算成「同母异父的兄妹」（新的错）。',
    ev: {
      text: `两人同为卡捷莉娜与前夫（步兵军官）所生，是全血亲兄妹：波连卡说「${Q_TWOCHILD}」，把两人并列。`,
      chapter: '第7章',
      evidence: 'paraphrase',
    },
  },
];

/* ── 一、定位短语核验（没有原文依据直接拒绝） ── */
console.log('═══ 一、定位短语核验（必须在原著里逐字存在）═══\n');
let bad = 0;
for (const j of JOBS) {
  for (const loc of j.locate) {
    const n = F.split(flat(loc)).length - 1;
    if (n < 1) { bad++; console.log(`  ✗ ${j.from}→${j.to}：「${loc}」原文里找不到`); }
    else console.log(`  ✓ ${j.from}→${j.to}：「${loc}」出现 ${n} 次`);
  }
  console.log(`      ${j.why}`);
}
if (bad) { console.error(`\n⇒ ${bad} 条定位短语核验不过 —— 拒绝改任何数据`); process.exit(1); }

/* ── 二、关系块内字面替换 ── */
const raw = fs.readFileSync(FILE, 'utf8');
const book = JSON.parse(raw);
const relOf = (from, to) => (book.relations || []).find((r) => r.from === from && r.to === to);

/**
 * 在 `from`+`to` 唯一确定的关系对象块内做字面替换。
 * ⚠ 关系边**没有 id 字段**，只能靠 from/to 定位；两个字段都在同一个 4 空格缩进的块里。
 */
function patchRelation(text, from, to, buildEdits) {
  const key = `"from": ${JSON.stringify(from)},`;
  let i = -1;
  let found = null;
  while ((i = text.indexOf(key, i + 1)) >= 0) {
    const start = text.lastIndexOf('\n    {', i);
    const end = text.indexOf('\n    }', i);
    if (start < 0 || end < 0 || end < i) continue;
    const block = text.slice(start, end);
    if (block.includes(`"to": ${JSON.stringify(to)},`)) { found = { start, end, block }; break; }
  }
  if (!found) throw new Error(`找不到关系 ${from} → ${to}`);
  let block = found.block;
  for (const [a, b] of buildEdits(found.block)) {
    const cnt = block.split(a).length - 1;
    if (cnt !== 1) throw new Error(`${from}→${to}：待替换片段出现 ${cnt} 次（应为 1）→ ${JSON.stringify(a)}`);
    block = block.split(a).join(b);
  }
  return text.slice(0, found.start) + block + text.slice(found.end);
}

function editsFor(cur, job) {
  return (block) => {
    const out = [];
    /* ⚠ 不能假定字段后面有逗号 —— 每个块里**最后一个字段**没有尾逗号
     *   （`"kin": "blood"` / `"note": "…"` 都是常见收尾）。第一版写死了逗号，
     *   于是 "kin" 那条替换报「出现 0 次」。这里改成匹配「键 + 值」本体，
     *   再核后面一个字符必须是 `,` 或 `\r`（防止 `blood` 命中 `bloodline` 这类前缀）。 */
    const field = (name, oldV, newV) => {
      if (newV === undefined || oldV === newV) return;
      const a = `"${name}": ${JSON.stringify(oldV)}`;
      const b = `"${name}": ${JSON.stringify(newV)}`;
      const cnt = block.split(a).length - 1;
      if (cnt !== 1) throw new Error(`${job.from}→${job.to}：字段 ${name} 的旧值片段出现 ${cnt} 次（应为 1）→ ${JSON.stringify(a)}`);
      const next = block[block.indexOf(a) + a.length];
      if (next !== ',' && next !== '\r') throw new Error(`${job.from}→${job.to}：字段 ${name} 的匹配后面是 ${JSON.stringify(next)}，疑似命中更长值的前缀`);
      out.push([a, b]);
    };
    field('type', cur.type, job.newType);
    field('kin', cur.kin, job.newKin);
    field('style', cur.style, job.newStyle);
    field('note', cur.note, job.note);
    if (job.dropDerived) {
      if (cur.derived !== true) throw new Error(`${job.from}→${job.to}：预期有 derived: true`);
      out.push(['      "derived": true,\r\n', '']);
    }
    if (job.ev) {
      const s = block.indexOf('\n        {');
      const e = block.indexOf('\n        }', s);
      if (s < 0 || e < 0) throw new Error(`${job.from}→${job.to}：事件对象边界找不到`);
      const oldEv = block.slice(s, e + '\n        }'.length);
      const lit = '\n        {\r\n'
        + `          "text": ${JSON.stringify(job.ev.text)},\r\n`
        + `          "chapter": ${JSON.stringify(job.ev.chapter)},\r\n`
        + `          "evidence": ${JSON.stringify(job.ev.evidence)}\r\n`
        + '        }';
      out.push([oldEv, lit]);
    }
    if (!out.length) throw new Error(`${job.from}→${job.to}：没有产生任何改动`);
    return out;
  };
}

console.log('\n═══ 二、改动 ═══\n');
let out = raw;
const plan = [];
for (const job of JOBS) {
  const cur = relOf(job.from, job.to);
  if (!cur) { console.error(`  ✗ 找不到关系 ${job.from} → ${job.to}`); process.exit(1); }
  const before = JSON.stringify(cur);
  out = patchRelation(out, job.from, job.to, editsFor(cur, job));
  plan.push({ job, before });
  console.log(`  ${job.from} → ${job.to}`);
  console.log(`      type ${cur.type}  →  ${job.newType}`);
  console.log(`      kin  ${cur.kin}  →  ${job.newKin}`
    + (job.newStyle ? `　style ${cur.style} → ${job.newStyle}` : '')
    + (job.dropDerived ? '　（去掉 derived）' : ''));
}

/* ── 三、落盘前深比对 ── */
const got = JSON.parse(out);
if (out.length === raw.length) { console.error('\n  ✗ 字节数没变，说明什么都没改'); process.exit(1); }
for (const { job, before } of plan) {
  const r = got.relations.find((x) => x.from === job.from && x.to === job.to);
  if (!r) { console.error(`  ✗ ${job.from}→${job.to} 深比对：改完之后找不到这条边`); process.exit(1); }
  if (before === JSON.stringify(r)) { console.error(`  ✗ ${job.from}→${job.to} 深比对：记录没变化`); process.exit(1); }
  if (r.type !== job.newType || r.kin !== job.newKin) {
    console.error(`  ✗ ${job.from}→${job.to} 深比对失败：type=${r.type} kin=${r.kin}`);
    process.exit(1);
  }
  if (job.dropDerived && r.derived) { console.error(`  ✗ ${job.from}→${job.to}：derived 没去掉`); process.exit(1); }
  if (job.ev && r.events.length !== 1) { console.error(`  ✗ ${job.from}→${job.to}：事件条数 ${r.events.length}（应为 1）`); process.exit(1); }
}
/* 除这 6 条外不许有任何别的差异 */
const relKey = (r) => `${r.from}|${r.to}|${r.type}`;
const beforeSet = new Set(book.relations.map((r) => JSON.stringify(r)));
const afterSet = new Set(got.relations.map((r) => JSON.stringify(r)));
const changed = book.relations.filter((r) => !afterSet.has(JSON.stringify(r)));
const added = got.relations.filter((r) => !beforeSet.has(JSON.stringify(r)));
const allowed = new Set(JOBS.map((j) => `${j.from}|${j.to}`));
const stray = [...changed, ...added].filter((r) => !allowed.has(`${r.from}|${r.to}`));
if (stray.length) {
  console.error(`  ✗ 有意料之外的改动：${stray.map(relKey).join(', ')}`);
  process.exit(1);
}
console.log(`\n  深比对：改动 ${changed.length} 条，新增 ${added.length} 条 —— 全部落在预期范围内`);
console.log(`  关系总数 ${book.relations.length} → ${got.relations.length}`);
console.log(`  文件字节 ${raw.length} → ${out.length}（差 ${out.length - raw.length}）`);
/* 行尾必须是 CRLF（与改动前一致） */
const crlf = (out.match(/\r\n/g) || []).length;
const loneLf = (out.match(/(?<!\r)\n/g) || []).length;
if (loneLf !== 1) { console.error(`  ✗ 行尾异常：裸 LF ${loneLf} 个（改动前是 1 个）`); process.exit(1); }
console.log(`  CRLF ${crlf} 行 / 裸 LF ${loneLf} 个（与改动前一致）`);

console.log(`\n═══ 三、结果 ═══\n  共改 ${plan.length} 条关系`);
console.log(WRITE ? '  已写入' : '  预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, out, 'utf8');
