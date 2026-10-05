/**
 * v0.113：删掉两条"编造的姨母"关系
 *
 * ## 两条都是**多余且标签是编的**
 *
 *     吴太夫人 —姨母兼继母— 孙权    「吴国太见权寝食不安，问其心事」
 *     孙权 —姨母与外甥— 吴太夫人   「国太劝权请周瑜决外事」
 *
 * 吴太夫人**已经有正确的边**：`吴太夫人 —母子— 孙权`（「太夫人听策遗言，促权受印绶」）。
 * 两条事件的文案也都是"国太对权说话"，没有任何"姨母"的意思。
 * 对质判「族谱算出：母子」——**族谱是对的，标签是编的**。
 *
 * 「姨母」这个身份在三国里是有出处的，但**不是对孙权**：
 * 吴夫人（孙权之妹）嫁了刘备，所以吴太夫人是**刘备的岳母**，
 * 刘禅的继母是甘夫人。「姨母兼继母」贴在母子边旁边，是串了。
 *
 * ## 第三条不删，列出来给你定
 *
 *     孙权 —赐姓养侄孙— 孙韶   「孙权亲往辕门救下被斩的孙韶」
 *
 * 原文：「奈**此子虽本姓俞氏，然孤兄甚爱之，赐姓孙**，于孤颇有劳绩」
 *   · 赐姓的是孙权的**兄**，不是孙权 ⇒「赐姓」这个动作不属于孙权
 *   · 孙韶本姓俞氏（与孙河同姓），但没说他和孙河是什么关系
 * 所以「赐姓养侄孙」这个称谓**两处都没有依据**。
 * 但"孙权救下孙韶"这件事是真的（原文有）。
 * 删了会丢掉这条互动；留着就是编一个称谓。**所以不删，交给你定。**
 *
 * 用法：node scripts/fix-wu-tail.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byName = new Map(book.characters.map((c) => [c.name, c]));
const nm = (id) => book.characters.find((c) => c.id === id)?.name ?? id;

/** 要删的边：[from名, to名, 依据] */
const DROP = [
  ['吴太夫人', '孙权', '已有正确的母子边；「姨母兼继母」是编的，且与孙权无关'],
  ['孙权', '吴太夫人', '已有正确的母子边；「姨母与外甥」是编的，且与孙权无关'],
];

let dropped = 0;
for (const [a, b, why] of DROP) {
  const ca = byName.get(a), cb = byName.get(b);
  if (!ca || !cb) { console.log(`  ⛔ 找不到 ${!ca ? a : b}，跳过`); continue; }
  /* 反向自检：删之前必须确认"正确的边"确实存在，否则会把关系弄丢 */
  const good = book.relations.find((r) =>
    ((r.from === ca.id && r.to === cb.id) || (r.from === cb.id && r.to === ca.id))
    && /^(亲生)?(父|母)(子|女)$/.test(String(r.type).replace(/[（(].*$/, '').trim()));
  if (!good) { console.log(`  ⛔ ${a}/${b} 之间没有亲子边，删掉会丢关系，拒绝`); continue; }
  console.log(`  正确边确认存在：${nm(good.from)} —${good.type}— ${nm(good.to)}`);

  const i = book.relations.findIndex((r) => r.from === ca.id && r.to === cb.id && /姨母/.test(String(r.type)));
  if (i < 0) { console.log(`  (跳过) ${a} —姨母…— ${b} 已不存在`); continue; }
  const gone = book.relations[i];
  console.log(`  删掉：${nm(gone.from)} —${gone.type}— ${nm(gone.to)}　（${why}）`);
  book.relations.splice(i, 1);
  dropped++;
}

console.log(`\n合计删 ${dropped} 条`);
console.log('\n=== 留给你的（不删）===');
{
  const sq = byName.get('孙韶'), sq2 = byName.get('孙权');
  const r = book.relations.find((x) => (x.from === sq2?.id && x.to === sq?.id) && /侄孙/.test(String(x.type)));
  if (r) {
    console.log(`  ${nm(r.from)} —${r.type}— ${nm(r.to)}`);
    console.log(`     ${r.events?.[0]?.text ?? ''}`);
    console.log(`     原文：「此子虽本姓俞氏，然孤兄甚爱之，赐姓孙」`);
    console.log(`     ⇒ 赐姓的是孙权的**兄**；孙韶本姓俞氏，与孙河同姓但关系未交代。`);
    console.log(`     「赐姓养侄孙」这个称谓两处都没依据，但"孙权救孙韶"是真的。`);
    console.log(`     请定：删掉整条边（丢互动）／ 保留但换称谓 ／ 就这么留着`);
  }
}

console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
