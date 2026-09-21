#!/usr/bin/env node
/**
 * 同名/别名人物合并（整本生成后必做一遍）
 *
 * 逐章生成时，同一个人可能被写成不同 id/名字（曹操 / 曹操（孟德）/ 曹孟德），
 * 合并规则：名字或别名「归一化后」相同 → 视为同一人，并成一个，关系端点跟着改。
 *
 * 用法：
 *   node scripts/dedupe-chars.mjs data/three-kingdoms.json            # 预览
 *   node scripts/dedupe-chars.mjs data/three-kingdoms.json --write    # 写回
 *   node scripts/dedupe-chars.mjs --all [--write]
 *
 * 归一化：去掉括号补充（（第二代）、(孟德)）、空格、「·」以外的标点、去掉「阿/小/老」前缀之外的修饰
 * 注意：宁可少合不可错合——只按"完整名字/别名相等"合并，不做模糊匹配
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const aliasMerge = argv.includes('--alias-merge');   // 名字=别名 的合并（默认只列出来，人工确认后再开）
const files = argv.includes('--all')
  ? fs.readdirSync(path.join(process.cwd(), 'data')).filter((f) => f.endsWith('.json') && f !== 'books.json' && !f.startsWith('.')).map((f) => path.join(process.cwd(), 'data', f))
  : argv.filter((a) => !a.startsWith('--'));

if (!files.length) { console.error('用法：node scripts/dedupe-chars.mjs data/xx.json [--write]'); process.exit(1); }

const norm = (s) => String(s || '')
  .replace(/[（(][^）)]*[）)]/g, '')      // 去掉括号补充
  .replace(/[\s　]/g, '')
  .replace(/[·・．.\-—_、,，]/g, '')
  .trim();

// 泛称别名（AI 常把「主公」「丞相」这类泛称写成别名，不能拿来判同一人）
const GENERIC = /^(主公|魏主|汉主|吴主|先主|后主|大王|将军|都督|太守|军师|丞相|夫人|某氏|太后|皇后|贵妃|贵人|太子|王子|义父|义子|使者|信使)$/;

for (const file of files) {
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chars = book.characters || [];
  const byId = new Map(chars.map((c) => [c.id, c]));
  const relCount = (id) => (book.relations || []).filter((r) => r.from === id || r.to === id).length;

  const parent = new Map(chars.map((c) => [c.id, c.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };

  // 1) 只按**名字**归一化后完全相同来合并（最安全）
  const byNormName = new Map();
  for (const c of chars) {
    const k = norm(c.name);
    if (k.length < 2) continue;
    if (byNormName.has(k)) union(byNormName.get(k).id, c.id);
    else byNormName.set(k, c);
  }
  // 2) 名字 = 别人别名 的候选（默认只列出，--alias-merge 才自动合）
  const nameIndex = new Map();   // 归一化名字 → 人物
  for (const c of chars) { const k = norm(c.name); if (k.length >= 2 && !nameIndex.has(k)) nameIndex.set(k, c); }
  const aliasPairs = [];
  for (const c of chars) {
    for (const a of c.aliases || []) {
      const k = norm(a);
      if (k.length < 2 || GENERIC.test(k)) continue;
      const owner = nameIndex.get(k);
      if (owner && owner.id !== c.id && !(byNormName.get(k) === undefined) && find(owner.id) !== find(c.id)) {
        aliasPairs.push({ name: owner.name, nameId: owner.id, alias: a, aliasId: c.id, sameFaction: owner.faction === c.faction });
      }
    }
  }
  if (aliasMerge) {
    for (const p of aliasPairs) if (p.sameFaction) union(p.nameId, p.aliasId);
  }

  const groups = new Map();
  for (const c of chars) { const r = find(c.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c.id); }
  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  const factionsOf = (g) => new Set(g.map((id) => byId.get(id).faction).filter(Boolean));

  console.log(`\n▶ ${path.basename(file)}：${chars.length} 人，同名合并 ${dupGroups.length} 组、名字=别名候选 ${aliasPairs.length} 组`);
  if (aliasPairs.length && !aliasMerge) {
    console.log('   名字=别名（默认不自动合，人工确认后用 --alias-merge 或手工处理）：');
    for (const p of aliasPairs.slice(0, 20)) {
      console.log(`     · 「${p.name}」 ⇔ 「${p.alias}」是 ${byId.get(p.aliasId).name} 的别名${p.sameFaction ? '' : '（阵营不同，先别合）'}`);
    }
    if (aliasPairs.length > 20) console.log(`     … 共 ${aliasPairs.length} 组`);
  }
  const remap = new Map();
  for (const g of dupGroups) {
    const fs = factionsOf(g);
    // 安全规则：同名但阵营不同 → 多半是重名的不同人（三国里两个马忠、两个张南…），不自动合
    if (fs.size > 1) {
      console.log(`   ⚠ 跳过「${byId.get(g[0]).name}」：${g.map((id) => `${byId.get(id).name}(${byId.get(id).faction})`).join(' vs ')} —— 阵营不同，疑似重名的不同人，请人工判断`);
      continue;
    }
    const keep = g.slice().sort((a, b) => relCount(b) - relCount(a) || b.length - a.length)[0];
    const others = g.filter((id) => id !== keep);
    console.log(`   · 保留「${byId.get(keep).name}」(${keep}, ${relCount(keep)} 关系) ⇐ 并入 ${others.map((id) => `「${byId.get(id).name}」(${id})`).join('、')}`);
    for (const id of others) remap.set(id, keep);
  }
  if (!write || !remap.size) { console.log(write ? '   没有可合并的' : '   （预览模式：加 --write 才写回）'); continue; }

  // 2) 合并人物
  const kept = [];
  for (const c of chars) {
    if (!remap.has(c.id)) { kept.push(c); continue; }
    const t = byId.get(remap.get(c.id));
    t.aliases = [...new Set([...(t.aliases || []), c.name, ...(c.aliases || [])].filter(Boolean))].filter((a) => a !== t.name);
    for (const k of ['desc', 'fate', 'title', 'faction', 'note', 'gender', 'firstCh', 'tier']) if (!t[k] && c[k]) t[k] = c[k];
  }
  book.characters = kept;

  // 3) 关系端点改写；合并后自己连自己、以及重复的关系要去掉
  const seen = new Map();
  const rels = [];
  let dropped = 0, mergedEv = 0;
  for (const r of book.relations || []) {
    const from = remap.get(r.from) || r.from;
    const to = remap.get(r.to) || r.to;
    if (from === to) { dropped++; continue; }
    const key = `${from}|${to}|${(r.type || '').trim()}`;
    if (seen.has(key)) {
      const t = seen.get(key);
      const texts = new Set((t.events || []).map((e) => e.text));
      for (const e of r.events || []) if (e.text && !texts.has(e.text)) { t.events.push(e); mergedEv++; }
      dropped++;
      continue;
    }
    r.from = from; r.to = to;
    seen.set(key, r);
    rels.push(r);
  }
  book.relations = rels;

  // 4) 事件里的 chars 改写 + 去重
  for (const e of book.events || []) {
    if (Array.isArray(e.chars)) e.chars = [...new Set(e.chars.map((id) => remap.get(id) || id))];
  }

  fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
  console.log(`   ✓ 合并 ${remap.size} 人；关系去重/自环丢了 ${dropped} 条（吸收 ${mergedEv} 条小事件）`);
}
console.log(`\n${write ? '已写回' : ''}`);
