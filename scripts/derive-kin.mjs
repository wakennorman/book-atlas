#!/usr/bin/env node
/**
 * 族谱补全：从"亲子关系"推导出祖孙 / 曾祖孙 / 叔侄舅甥，补成 `derived: true` 的关系
 *
 * 为什么需要：一本书里如果只记录了父母-子女，祖父那一侧往往没有直接互动事件，
 * 图上就会出现"老何塞连不到孙辈"这种断线。这些边**不是编造**：
 * 每一跳都在数据里标出来（例：由「老何塞 —父子→ 巨人」「巨人 —父子→ 阿尔卡蒂奥」推导）。
 *
 * 规则：
 *   · 亲子边 = type 匹配 父/母 + 子/女（含 养父/养母，标 kin=adoptive 的按收养算）
 *   · 推导 2 代 → 祖孙；3 代 → 曾祖孙；旁系（父母的手足）→ 叔侄/姑侄/舅甥/姨甥
 *   · 已有直接关系的两个人不再推导
 *   · 方向统一为「长辈 → 晚辈」；style=dotted、derived=true、chapter 留空
 *   · 可重复执行：先删掉旧的 derived 关系再重算
 *
 * 用法：
 *   node scripts/derive-kin.mjs --all            # 预览所有书
 *   node scripts/derive-kin.mjs data/xx.json --write
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const files = argv.includes('--all')
  ? fs.readdirSync(path.join(process.cwd(), 'data')).filter((f) => f.endsWith('.json') && f !== 'books.json' && !f.startsWith('.')).map((f) => path.join(process.cwd(), 'data', f))
  : argv.filter((a) => !a.startsWith('--'));

if (!files.length) { console.error('用法：node scripts/derive-kin.mjs data/xx.json [--write]  |  --all [--write]'); process.exit(1); }

const PARENT_CHILD = /^(亲生)?(父|母)(子|女)$|^养(父|母)(子|女)$/;   // 父子/母子/父女/母女/养父子…
const isParentChild = (r) => PARENT_CHILD.test(String(r.type || '').replace(/[（(].*$/, '').trim());

for (const file of files) {
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chars = book.characters || [];
  const byId = new Map(chars.map((c) => [c.id, c]));
  const name = (id) => (byId.get(id) || {}).name || id;
  const gender = (id) => (byId.get(id) || {}).gender || 'm';

  // 0) 清掉上一轮推导出来的
  const base = (book.relations || []).filter((r) => !r.derived);

  // 1) 亲子边（去重，方向：长辈 → 晚辈）
  const parents = new Map();   // child -> [parentId]
  const children = new Map();  // parent -> [childId]
  const parentEdge = new Map(); // "p|c" -> 那条关系（取 type 用于说明）
  for (const r of base) {
    if (!r) continue;
    if (!byId.has(r.from) || !byId.has(r.to)) continue;
    if (!isParentChild(r)) continue;
    if (/^养/.test(String(r.type))) {
      // 收养：照旧算亲子（族谱上仍然是一条边）
    }
    if (!parents.has(r.to)) parents.set(r.to, []);
    if (!parents.get(r.to).includes(r.from)) parents.get(r.to).push(r.from);
    if (!children.has(r.from)) children.set(r.from, []);
    if (!children.get(r.from).includes(r.to)) children.get(r.from).push(r.to);
    parentEdge.set(`${r.from}|${r.to}`, r.type);
  }

  const has = (a, b) => base.some((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
  const derived = [];
  const skipped = [];
  const chainText = (pairs) => '由 ' + pairs.map(([a, b]) => `「${name(a)} —${parentEdge.get(`${a}|${b}`) || '亲子'}→ ${name(b)}」`).join('、') + ' 推导（原文没有直接互动）';
  // 兜底：自己和"同名不同 id"（数据里可能有重名的两个人）都不推导
  const baseName = (id) => {
    const n = String(name(id));
    const cut = [n.indexOf('（'), n.indexOf('(')].filter((i) => i >= 0);
    return (cut.length ? n.slice(0, Math.min(...cut)) : n).trim();
  };
  const sameName = (a, b) => baseName(a) === baseName(b);
  const push = (item, label) => {
    if (item.from === item.to) { skipped.push(`自环：${name(item.from)}`); return; }
    if (sameName(item.from, item.to)) { skipped.push(`同名不同 id（疑似重复人物，建议先合并）：${name(item.from)}`); return; }
    derived.push(item);
  };

  // 2) 祖孙 / 曾祖孙（长辈 → 晚辈）
  const ancestorChains = new Map();   // "a|d" -> [[a,b],[b,d]]
  for (const [mid, ps] of parents) {
    for (const p of ps) {
      for (const child of children.get(mid) || []) {
        const key = `${p}|${child}`;
        ancestorChains.set(key, [[p, mid], [mid, child]]);
      }
      // 三代：p → mid → g → x
      for (const g of children.get(mid) || []) {
        for (const x of children.get(g) || []) {
          ancestorChains.set(`${p}|${x}`, [[p, mid], [mid, g], [g, x]]);
        }
      }
    }
  }
  for (const [key, pairs] of ancestorChains) {
    const [a, d] = key.split('|');
    if (has(a, d)) continue;
    const gen = pairs.length;
    push({
      from: a, to: d,
      type: gen === 2 ? '祖孙（推导）' : '曾祖孙（推导）',
      kin: 'blood', style: 'dotted', derived: true,
      events: [{ text: chainText(pairs), chapter: '' }],
    });
  }

  // 3) 旁系：父母的手足 → 叔侄/姑侄/舅甥/姨甥
  //    兄弟姐妹 = **同一对父母的两个孩子**（不是"同一个孩子的两个父母"！）
  const siblingPairs = new Map();   // "a|b" -> 共同的父母（用于说明）
  for (const [parent, kids] of children) {
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i], b = kids[j];
        siblingPairs.set(a < b ? `${a}|${b}` : `${b}|${a}`, parent);
      }
    }
  }
  for (const [key, viaParent] of siblingPairs) {
    const [s1, s2] = key.split('|');
    const kids1 = children.get(s1) || [];
    const kids2 = children.get(s2) || [];
    // 称谓看"长辈自己的性别 + 连接父母的性别"：兄弟→伯叔侄，兄妹→姑侄，姐弟→舅甥，姐妹→姨甥
    const label = (au, parent) => {
      const auM = gender(au) === 'm';
      const paM = gender(parent) === 'm';
      if (auM) return paM ? '伯叔侄（推导）' : '舅甥（推导）';
      return paM ? '姑侄（推导）' : '姨甥（推导）';
    };
    const link = (au, parent, kid) => {
      if (has(au, kid)) return;
      push({
        from: au, to: kid, type: label(au, parent), kin: 'blood', style: 'dotted', derived: true,
        events: [{ text: `由「${name(s1)} 与 ${name(s2)} 同为 ${name(viaParent)} 的子女」＋「${name(parent)} 有子女 ${name(kid)}」推导（原文没有直接互动）`, chapter: '' }],
      });
    };
    for (const c1 of kids1) link(s2, s1, c1);
    for (const c2 of kids2) link(s1, s2, c2);
  }

  console.log(`\n▶ ${path.basename(file)}：现有关系 ${base.length} 条，可推导 ${derived.length} 条`);
  if (skipped.length) console.log(`   ⚠ 跳过 ${skipped.length} 条：${[...new Set(skipped)].slice(0, 6).join('；')}`);
  const byType = {};
  for (const d of derived) byType[d.type] = (byType[d.type] || 0) + 1;
  console.log('   ' + Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(' · '));
  const sample = derived.slice(0, 6).map((d) => `      ${name(d.from)} → ${name(d.to)}（${d.type}）`);
  console.log(sample.join('\n'));

  if (write && derived.length) {
    book.relations = [...base, ...derived];
    fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
    console.log(`   ✓ 已写回：关系 ${base.length} → ${book.relations.length}`);
  } else if (!write) {
    console.log('   （预览模式：加 --write 才写回）');
  }
}
