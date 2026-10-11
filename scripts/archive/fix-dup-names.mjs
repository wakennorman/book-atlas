/* 把「去括号后同名」里**没带括号**的那几个主名补上括号（v0.181）。
 * 【已归档】2026-10-12　v0.195 债二 B1：一次性补丁，用完即归档。
 *                     结论去向：CHANGELOG.md 的 v0.181 段
 *                     留在这里是为了留痕「当时怎么改的」，不再是可执行入口。
 *
 * ## 为什么改
 *
 * `audit-search.mjs` 的 ④ 桶列的是「去掉括号补充后名字相同的多个人物」——
 * 7 组。其中 3 组是**真重名**，但主名**没带括号**：`张温`×2、`邓贤`×2，
 * 另有 2 组只带了**一半**（`王颀（长安）` / `王颀`、`李丰（…）`×2 / `李丰`）。
 * 项目约定（见 `.workbuddy-ai/memory/MEMORY.md`）是**同名多人必须带括号区分**，
 * 否则：① 网页搜索无法区分；② `validate` 的「文案提到谁」会误判。
 *
 * ## 每条改名都带「原文依据」
 *
 * 每条一个 `locate` 短语，必须在原著里**逐字存在**（去空白文本，走
 * `scripts/lib/book-sources.mjs` 的单一来源）—— 与 `fix-first-ch.mjs` /
 * `fix-marmeladov-kin.mjs` 同一套：**改数据必须带原文依据，否则拒绝执行**。
 *
 * ⚠ 逐条都是**回原著读过**才定的：判据是"两个地方都出现这个名字"**不等于**"两个人"
 *   （v0.160 在 `雷同` 上就栽过），所以每条都挑了**能把两个人分开**的那句原文。
 *
 * ## 落盘不能 parse→stringify
 *
 * 实测 `data/three-kingdoms.json`：1659708 字节、CRLF **65401** 行、裸 LF 0；
 * 而 `JSON.stringify(x, null, 2)` 的输出与原文**有 65429 行不同**
 * ⇒ 只能「定位对象块 → 块内字面替换 → 落盘后 parse 回来深比对」。
 *
 * 用法：node scripts/fix-dup-names.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');
const WRITE = process.argv.includes('--write');

/** 改名表。`locate` 必须逐字出现在原著里；`why` 说明"凭什么说是两个人"。 */
export const RENAMES = [
  {
    id: 'wang-qi-tianshui', from: '王颀', to: '王颀（天水）',
    locate: '天水太守王颀',
    why: '第9回「越骑校尉王颀皆死于国难」是洛阳那位（数据里已叫「王颀（长安）」）；'
      + '第116回「天水太守王颀」是邓艾伐蜀时的天水太守 ⇒ 两人。同组的「王颀（长安）」已带括号，这条漏了。',
  },
  {
    id: 'zhang-wen', from: '张温', to: '张温（汉司空）',
    locate: '揪司空张温下堂',
    why: '第8回被董卓所斩的汉司空张温（「揪司空张温下堂」「张温结连袁术」）。',
  },
  {
    id: 'zhang-wen-wu', from: '张温', to: '张温（吴臣）',
    locate: '难张温秦宓逞天辩',
    why: '第86回与秦宓逞天辩的吴臣张温（回目「难张温秦宓逞天辩」）。'
      + '原著有直接注：「同时有两张温。此一张温，乃汉张温也；后孙权使张温至蜀，乃吴张温也。」',
  },
  {
    id: 'li-feng-yuanshu', from: '李丰', to: '李丰（袁术部）',
    locate: '使李丰、梁纲、乐就为催进使',
    why: '第17回袁术的催进使李丰（守寿春、被吕布刺伤其手）；'
      + '同组的「李丰（李严之子）」（第94/101回）与「李丰（魏臣）」（第109回血诏）各是另一人。',
  },
  {
    id: 'deng-xian', from: '邓贤', to: '邓贤（刘璋部）',
    locate: '刘璝、泠苞、张任、邓贤',
    why: '第60–62回刘璋部将邓贤，与泠苞搭档守雒县，第62回被折（「刘璋听知折了邓贤」）。',
  },
  {
    id: 'deng-xian-2', from: '邓贤', to: '邓贤（孟达外甥）',
    locate: '达外甥邓贤',
    why: '第94–95回孟达的外甥邓贤，随李辅出首孟达谋反（「孟达心腹人李辅并达外甥邓贤随状出首」）。',
  },
];

const { loadBookSource, missingSourceNote } = await import(
  pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'book-sources.mjs')).href);
const src = loadBookSource('three-kingdoms');

let text = fs.readFileSync(FILE, 'utf8');

/* ---- ① 原文依据自检：locate 短语必须逐字存在 ---- */
if (!src.text) {
  console.error(`✗ ${missingSourceNote(src)}`);
  console.error('  改名必须带原文依据，读不到原著就不能改。');
  process.exit(1);
}
let bad = 0;
for (const r of RENAMES) {
  const n = src.text.split(r.locate).length - 1;
  if (n < 1) { console.error(`✗ ${r.id}：locate 短语不在原著里逐字存在 → ${JSON.stringify(r.locate)}`); bad++; }
  else console.log(`✓ ${r.id}：${JSON.stringify(r.locate)} 在原文里出现 ${n} 次`);
}
if (bad) { console.error(`\n有 ${bad} 条依据不成立，拒绝执行。`); process.exit(1); }

/* ---- ② 定位对象块并做字面替换 ---- */
const before = JSON.parse(text);
const byId = new Map(before.characters.map((c) => [c.id, c]));

for (const r of RENAMES) {
  const c = byId.get(r.id);
  if (!c) throw new Error(`找不到人物 id=${r.id}`);
  if (c.name !== r.from) throw new Error(`${r.id} 的主名是「${c.name}」，不是预期的「${r.from}」`);
  if (before.characters.some((x) => x.name === r.to)) throw new Error(`新名「${r.to}」已存在，会撞名`);

  /* 数据里 `id` 与 `name` 相邻（已核 6 处）⇒ 用最紧的模式，多一处少一处都报错 */
  const needle = `"id": ${JSON.stringify(r.id)},\r\n      "name": ${JSON.stringify(r.from)},`;
  const hits = text.split(needle).length - 1;
  if (hits !== 1) throw new Error(`${r.id}：待替换片段出现 ${hits} 次（应为 1）→ ${JSON.stringify(needle)}`);
  text = text.split(needle).join(
    `"id": ${JSON.stringify(r.id)},\r\n      "name": ${JSON.stringify(r.to)},`);
  console.log(`  · ${r.id}：${r.from} → ${r.to}`);
}

/* ---- ③ 落盘后 parse 回来深比对 ---- */
const after = JSON.parse(text);
for (const r of RENAMES) {
  const c = after.characters.find((x) => x.id === r.id);
  if (!c || c.name !== r.to) throw new Error(`${r.id} 落盘后主名不是「${r.to}」`);
}
if (after.characters.length !== before.characters.length) throw new Error('人物条数变了');
if (JSON.stringify(after.relations) !== JSON.stringify(before.relations)) throw new Error('关系被改动了');

const crlf = (text.match(/\r\n/g) || []).length;
console.log(`\n人物 ${after.characters.length} 条（不变）；CRLF ${crlf} 行；字节 ${Buffer.byteLength(text)}`);

if (!WRITE) { console.log('\n（演练：没有写盘。加 --write 才落盘）'); process.exit(0); }
fs.writeFileSync(FILE, text, 'utf8');
console.log('✓ 已写盘');
