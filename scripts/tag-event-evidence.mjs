/**
 * 给 events[] 标注证据等级（v0.102 方案阶段 2/3 的可自动化部分）。
 *
 * 规则：**默认保守**
 *   evidence = 'quote'      仅当该段文字能在原书里逐字定位到
 *   evidence = 'paraphrase' 其余一切（默认，含"还没人工确认"）
 *
 * ⚠ 为什么不自动升级成 quote：「能定位」只说明"可以是引文"，
 *   不是"就是引文"——短引语（「女贼」2 个字）到处会撞上，
 *   转述里也可能嵌一句原文。自动升级就是我第四次用机械指标代替判据。
 *   那 30 条命中得到的引文**留给人工确认**，本脚本只标 paraphrase。
 *
 * ⚠ 不加「待定」档：没核过 ≠ 是转述。留一个"待定"然后默认当真，
 *   正是 v0.102 那条伪造引文能活下来的原因。
 *
 * 用法：node scripts/tag-event-evidence.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const SOURCES = {
  'three-kingdoms': 'C:/Users/chw/AppData/Local/Temp/opencode/ba-books/三国演义.txt',
  'one-hundred-years-of-solitude': 'C:/Users/chw/AppData/Local/Temp/opencode/epub.txt',
  'crime-and-punishment': 'C:/Users/chw/AppData/Local/Temp/opencode/ba-books/罪与罚.txt',
};
const flat = (s) => String(s || '').replace(/[\s·・･]/g, '');

let tagged = 0, quoted = 0, total = 0;
const pending = [];

for (const [slug, srcPath] of Object.entries(SOURCES)) {
  const file = path.join(ROOT, 'data', `${slug}.json`);
  if (!fs.existsSync(srcPath)) continue;
  const src = flat(fs.readFileSync(srcPath, 'utf8'));
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  /* ⚠ 计数器必须在循环**内**清零。第一版声明在外面，
   *   于是第二本书接着第一本累加，打出「非推导事件 3576 / 3661」这种数 ——
   *   真实值是 188 / 85。数字本身不影响落盘，但**报告里的数是错的**，
   *   而这正是这整轮在消灭的那类问题，不能自己犯。 */
  total = 0; quoted = 0;

  const mark = (ev) => {
    const s = String(ev.text || '');
    if (ev.derived === true || /由.*推导/.test(s)) { ev.evidence = 'derived'; return; }
    total++;
    const qs = [...s.matchAll(/[「『]([^」』]+)[」』]/g)].map((x) => flat(x[1]));
    const hit = qs.some((q) => q.length && src.indexOf(q.slice(0, Math.min(40, q.length))) >= 0);
    if (hit) {
      quoted++; pending.push({ slug, text: s.slice(0, 90) });
      ev.evidence = 'paraphrase';   // 保守：等人工确认
    } else {
      ev.evidence = 'paraphrase';
      tagged++;
    }
  };

  for (const rel of book.relations ?? []) for (const ev of rel.events ?? []) mark(ev);
  for (const ev of book.events ?? []) mark(ev);

  if (WRITE) fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
  console.log(`  ${slug}：非推导事件 ${total}，其中带引号且原文可定位 ${quoted}`);
}

console.log(`\n合计：非推导事件 ${total}　带引号可定位（待人工确认）${quoted}　纯转述 ${tagged}`);
console.log('\n待人工确认的引文清单：');
for (const p of pending) console.log(`  · [${p.slug}] ${p.text}`);
if (!WRITE) console.log('\n（预览模式，**未落盘**；加 --write 才写）');
