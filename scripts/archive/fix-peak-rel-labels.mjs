#!/usr/bin/env node
/**
 * 【已归档】2026-10-12　v0.206 新增《刻意练习》：一次性补丁，用完即归档。
 *                     结论去向：data/peak.json 的 relations[].type（40 条边标签压短）
 *                     留在这里是为了留痕「当时怎么改的」，不再是可执行入口。
 * 【一次性】《刻意练习》的**概念关联边标签**压短（v0.206）。
 *
 * ## 为什么要它
 *
 * 第一版把「这条边是什么意思」整句塞进了 `relations[].type`，例如
 *
 *     刻意练习 → 有目的的练习   type = "包含（刻意练习是有目的的练习的升级版）"
 *     反馈     → 刻意练习       type = "是它的必需条件"
 *
 * 三本原书的 `type` 都是**短标签 +（可选）短限定**（`结义兄弟` / `夫妻（表兄妹）` /
 * `义叔侄（认亲）` / `纠缠（家庭教师时期）`，最长 15 字）。而上面这种写法有两个硬伤：
 *
 *   ① **括注里重复了两个端点的名字** —— 边上已经写着 `刻意练习` 和 `有目的的练习`，
 *      中间再说一遍，读起来是「A — 包含（A 是 B 的升级版） — B」。
 *   ② **用代词「它」** —— 边标签要能**单独成立**：`relationText` 会把它单独印进
 *      卡片标题、tooltip、PNG/文本导出（`js/app.js` 的 `— ${r.type} —`），
 *      离了上下文那个「它」指谁完全不知道。
 *
 * 所以这里只改**我自己写的标签**：`events[].text`（依据事件）一个字不动 ——
 * 那边才是承载"这条边凭什么成立"的地方。
 *
 * ## 为什么是"按下标改写"而不是"按短语定位"
 *
 * 铁律 1 要求 `scripts/fix-*.mjs` 每条改动带一个**在原著里逐字存在**的 `locate` 短语 ——
 * 那条规矩管的是"改数据＝声称原著这么写"。而这里改的是**我给这条边起的名字**，
 * 原著里没有这句话，拿原文去定位反而是假的。
 * 所以判据换成"**这条边还在不在**"：按下标 + (from, to) 双确认，
 * 对不上就 `exit 1`（不静默跳过 —— 静默跳过会让"改好了"和"没改"长得一样）。
 *
 * 用法：
 *   node scripts/fix-peak-rel-labels.mjs            # 只打印将要改什么（dry-run 是默认）
 *   node scripts/fix-peak-rel-labels.mjs --write    # 落盘
 *
 * ⚠ 改完必须重生成三个产物（缺一个都有门禁拦）：
 *   node scripts/make-slim-packs.mjs
 *   node scripts/make-miniprogram-packs.mjs
 *   node scripts/make-anno-digest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'data', 'peak.json');
const write = process.argv.includes('--write');

/* 下标（0 起）→ 新标签。`from`/`to` 是**双确认**：下标对了但端点变了 ⇒ 拒绝。 */
const NEW_LABELS = [
  ['deliberate-practice', 'purposeful-practice', '属于（升级版）'],
  ['purposeful-practice', 'naive-practice', '区别于'],
  ['mental-representation', 'deliberate-practice', '核心产物'],
  ['long-term-memory', 'short-term-memory', '突破限制'],
  ['chunks', 'long-term-memory', '存放于'],
  ['chess-study', 'chunks', '建立方式'],
  ['blindfold-chess', 'mental-representation', '极端展示'],
  ['retrieval-structure', 'long-term-memory', '组织方式'],
  ['comfort-zone', 'purposeful-practice', '要求走出'],
  ['sweet-spot', 'comfort-zone', '紧邻外侧'],
  ['homeostasis', 'adaptability', '加码成因'],
  ['plasticity', 'adaptability', '生理基础'],
  ['myelin', 'plasticity', '物质基础'],
  ['bend-branch', 'plasticity', '时间窗口'],
  ['feedback', 'deliberate-practice', '必需条件'],
  ['mentor', 'feedback', '提供者'],
  ['golden-standard', 'deliberate-practice', '地位描述'],
  ['motivation', 'deliberate-practice', '前提'],
  ['keep-motivation', 'motivation', '维持方法'],
  ['new-year-resolution', 'keep-motivation', '典型失效'],
  ['willpower', 'keep-motivation', '旧解释'],
  ['plateau', 'purposeful-practice', '必经阶段'],
  ['ten-thousand-hours', 'deliberate-practice', '误读'],
  ['natural-talent', 'deliberate-practice', '对立信念'],
  ['paganini-miracle', 'deliberate-practice', '案例佐证'],
  ['mozart-legend', 'deliberate-practice', '案例佐证'],
  ['high-jumper', 'deliberate-practice', '案例佐证'],
  ['autistic-savant', 'deliberate-practice', '案例佐证'],
  ['self-fulfilling-prophecy', 'natural-talent', '放大错觉'],
  ['gene-difference', 'natural-talent', '限定作用范围'],
  ['perfect-pitch', 'deliberate-practice', '训练产物'],
  ['topgun', 'deliberate-practice', '组织应用'],
  ['learning-by-doing', 'deliberate-practice', '领域替代'],
  ['nigel-effect', 'mental-representation', '反面确认'],
  ['knowledge-telling', 'knowledge-transforming', '区别于（写作分界）'],
  ['knowledge-transforming', 'mental-representation', '写作化身'],
  ['memory-palace', 'mental-representation', '古老版本'],
  ['stage-serious', 'stage-interest', '承接'],
  ['stage-commitment', 'stage-serious', '承接'],
  ['stage-innovation', 'stage-commitment', '承接'],
];

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const rels = book.relations || [];

const errors = [];
if (rels.length !== NEW_LABELS.length) {
  errors.push(`relations 条数 ${rels.length} ≠ 名单 ${NEW_LABELS.length} 条`
    + '（加/删过边就必须同步这张名单 —— 静默按长度截断会让末尾几条悄悄不改）');
}
const changes = [];
NEW_LABELS.forEach(([from, to, type], i) => {
  const r = rels[i];
  if (!r) { errors.push(`第 ${i + 1} 条：数据里没有这条边`); return; }
  if (r.from !== from || r.to !== to) {
    errors.push(`第 ${i + 1} 条端点对不上：名单是 ${from}→${to}，数据是 ${r.from}→${r.to}`);
    return;
  }
  if (r.type === type) return;
  changes.push({ i, from, to, old: r.type, type });
  r.type = type;
});

if (errors.length) {
  console.error('✗ 名单与数据对不上，一条都不改：');
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}

console.log(`《刻意练习》概念关联边标签压短：${changes.length} 条要改 / 共 ${rels.length} 条`);
for (const c of changes) {
  console.log(`  ${String(c.i + 1).padStart(2)}  ${c.from} → ${c.to}`);
  console.log(`      - ${c.old}`);
  console.log(`      + ${c.type}`);
}
/* 顺带把"有没有漏网的代词/超长标签"量出来 —— 这是这一轮改动的**目的**，
 * 所以改完要能看到它确实变成 0（不然"改了 40 条"和"改对了"长得一样）。 */
const bad = rels.filter((r) => /[它其]/.test(r.type) || r.type.length > 12);
console.log(`\n改完后：含代词「它/其」或超 12 字的标签 ${bad.length} 条`);
for (const r of bad) console.log(`  ⚠ ${r.from} → ${r.to}：${r.type}`);

if (!write) {
  console.log('\n（dry-run；加 --write 落盘）');
  process.exit(0);
}
fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n');
console.log(`\n✓ 已写入 ${path.relative(ROOT, FILE)}`);
console.log('⚠ 接着必须重生成三个产物：make-slim-packs / make-miniprogram-packs / make-anno-digest');
