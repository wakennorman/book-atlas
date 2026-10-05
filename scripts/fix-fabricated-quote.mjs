/**
 * 修一处**已确认的伪造引文**（v0.102）。
 *
 * 《百年孤独》「上校 —叔侄— 阿尔卡蒂奥」这条事件写的是：
 *   「奥雷里亚诺上校临行前把马孔多交给侄子阿尔卡蒂奥：
 *     **到我们回来的时候，它该更好了。**」
 *
 * 拿 epub 全文逐字查：**「到我们回来」「它该更好」都搜不到。**
 * 原文实际写的是：
 *   「我们就把马孔多交给你了。」这便是他临行前对阿尔卡蒂奥的全部嘱托，
 *   「我们好好地交给你，你争取让它变得更好吧。」
 *
 * ⇒ 那句是**把转述装成了引文**。而我上一轮说这条"有第6章原文引文佐证"，
 *   依据只是"事件存在"，我**根本没拿原文比对过** —— 同一类错误我犯到第三次了。
 *
 * 这条关系本身是对的（上校与阿尔卡蒂奥确实是叔侄，差 1 代），
 * 要改的只是把编造的引文换成原文真句。
 *
 * 用法：node scripts/fix-fabricated-quote.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'one-hundred-years-of-solitude.json');
const WRITE = process.argv.includes('--write');

const FAKE = '到我们回来的时候，它该更好了。';
/** 原文真句（范晔译本，epub 全文核对过） */
const REAL = '我们就把马孔多交给你了。」这便是他临行前对阿尔卡蒂奥的全部嘱托，'
  + '「我们好好地交给你，你争取让它变得更好吧。';

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byName = new Map(book.characters.map((c) => [c.name, c]));
const COL = byName.get('奥雷里亚诺·布恩迪亚上校')?.id;
const ARC = byName.get('阿尔卡蒂奥')?.id;

/* 这条关系在数据里是**反向**存的（arcadio → colonel），两个方向都找一下 */
const rel = book.relations.find((r) => (r.from === COL && r.to === ARC) || (r.from === ARC && r.to === COL));
if (!rel) { console.error('找不到那条关系'); process.exit(1); }

console.log(`关系：${byName.get(rel.from)?.name} —${rel.type}— ${byName.get(rel.to)?.name}`);
for (const ev of rel.events ?? []) {
  if (!String(ev.text).includes(FAKE)) continue;
  console.log(`\n  旧：${ev.text}`);
  /* ⚠ 说明里**不能复述那句伪造的原文** —— 一复述，审计就会永远把它当"查无此文的引文"报出来，
   *   而它已经被改掉了。改成只描述"旧版那句在 epub 里逐字查不到"。 */
  const next = `奥雷里亚诺上校临行前把马孔多交给侄子阿尔卡蒂奥：「${REAL}」`
    + '（第6章。⚠ v0.102 更正：旧版此处是一句**转述被写成了引文**，拿 epub 全文逐字查不到，已按原文替换。）';
  console.log(`  新：${next}`);
  if (WRITE) { ev.text = next; ev.chapter = '第6章'; }
}

if (WRITE) {
  fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
  console.log(`\n写入 ${path.relative(ROOT, FILE)}`);
} else {
  console.log('\n（预览模式，加 --write 才落盘）');
}
