/**
 * 删掉 v0.108 里我造错的一条边：`公孙康 —父子— 公孙恭`
 *
 * ## 怎么错的
 *
 * 数据原本是 `公孙度 —父子— 公孙恭`，文案「公孙康死后，其弟公孙恭继其职」。
 * 公孙度是公孙康的**父亲**（公孙康的祖父），所以原边也不对。
 * 我 v0.108 用 REPOINT 把它改成 `公孙康 —父子— 公孙恭` ——
 * **改成了第三条错法**：「其弟」明写是兄弟，正确做法是**删掉这条父子边**，
 * 因为他们本来就有 `公孙康 —兄弟— 公孙恭` 这条边（文案「公孙恭为康谋」）。
 *
 * ## 危害
 *
 * 一条不存在的父子边会让族谱认为公孙恭是公孙康的儿子，于是
 * 公孙恭与公孙渊（公孙康真儿子）成了兄弟 ——
 * 对质因此误报「公孙恭 —叔侄— 公孙渊 族谱算出：同父异母的兄弟」。
 * 删掉这条边，两个问题一起消失。
 *
 * ## 怎么防止再来一次
 *
 * `fix-rest.mjs` 的 REPOINT 是"from 填错了人 ⇒ 改指向"。
 * 但**"from 填错了人"和"这条边根本不该存在"是两回事**。
 * 所以这里单列一条 DELETE，并在注释里点明区别。
 *
 * 用法：node scripts/fix-gongsun.mjs [--write]
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
const DROP = [['公孙康', '公孙恭', '「公孙康死后，其弟公孙恭继其职」⇒ 兄弟，非父子；且已有 兄弟 边']];

/* 反向自检：确认"兄弟边"确实存在，否则删了父子边就把关系弄丢了 */
for (const [a, b, why] of DROP) {
  const ca = byName.get(a), cb = byName.get(b);
  if (!ca || !cb) { console.log(`⛔ 找不到 ${!ca ? a : b}，跳过`); continue; }
  const sib = book.relations.find((r) =>
    ((r.from === ca.id && r.to === cb.id) || (r.from === cb.id && r.to === ca.id))
    && /兄弟/.test(String(r.type)));
  if (!sib) { console.log(`⛔ ${a}/${b} 之间没有兄弟边，删掉父子边会把关系弄丢，拒绝`); continue; }
  console.log(`  兄弟边确认存在：${nm(sib.from)} —${sib.type}— ${nm(sib.to)}`);
  console.log(`      ${(sib.events?.[0]?.text ?? '').slice(0, 60)}`);

  const i = book.relations.findIndex((r) => r.from === ca.id && r.to === cb.id
    && /^(亲生)?(父|母)(子|女)$/.test(String(r.type).replace(/[（(].*$/, '').trim()));
  if (i < 0) { console.log(`  (跳过) ${a} —父子— ${b} 已不存在`); continue; }
  const gone = book.relations[i];
  console.log(`  删掉：${a} —${gone.type}— ${b}`);
  console.log(`      ${why}`);
  book.relations.splice(i, 1);
}

if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
console.log(`\n${WRITE ? '已写入' : '预览模式（加 --write 才落盘）'}`);
