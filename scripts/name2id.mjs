// 人名 → id 解析器。拆书条目里 chars 一律写中文名，由本脚本转成 id。
// 这样就彻底消灭「从中间输出手工转抄 id」这一类错误。
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function loadBook(slug) {
  return JSON.parse(fs.readFileSync(`data/${slug}.json`, 'utf8'));
}

/** 从全名拆出可作简称的段：去掉「·」分隔后的每一段，以及首段 */
function nameSegments(full) {
  const out = new Set();
  const parts = String(full).split('·').map((s) => s.trim()).filter(Boolean);
  for (const p of parts) out.add(p);
  // 首段（名）+ 末段（姓）单独也可作简称
  if (parts.length >= 2) { out.add(parts[0]); out.add(parts[parts.length - 1]); }
  return out;
}

export function makeResolver(slug) {
  const book = loadBook(slug);
  /* 精确名与别名/简称分开存 —— 诊断输出才不会把一个人列两遍 */
  const exact = new Map();
  const loose = new Map();
  const addTo = (m, k, c) => { if (!k) return; if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(c)) m.get(k).push(c); };
  for (const c of book.characters) {
    addTo(exact, c.name, c);
    /* 简称：库里存的是全名（「罗季昂·罗曼内奇·拉斯柯尔尼科夫」），
     * 而正文里写的是简称（「拉斯柯尔尼科夫」）。 */
    for (const seg of nameSegments(c.name)) if (seg !== c.name) addTo(loose, seg, c);
    for (const alt of [...(c.aliases || []), ...(c.altNames || [])]) if (alt) addTo(loose, alt, c);
  }
  /* 合并视图：精确名覆盖简称 */
  const byName = new Map();
  for (const [k, v] of loose) byName.set(k, v);
  for (const [k, v] of exact) byName.set(k, v);
  const byId = new Set(book.characters.map((c) => c.id));
  return {
    book,
    byName,
    /** 名字（全名/简称/异译名）→ id；查不到或撞名都抛错，绝不猜 */
    id(name) {
      const raw = byName.get(name);
      /* 精确全名命中多个 = 真重名，必须报错；简称命中多个 = 简称有歧义，同样报错 */
      const hits = raw ? [...new Set(raw.map((h) => h.id))] : [];
      if (!hits.length) {
        const near = [...byName.keys()].filter((k) => k.includes(name) || name.includes(k)).slice(0, 5);
        throw new Error(`《${slug}》里查无此人：${name}${near.length ? `（相近：${near.join(' / ')}）` : ''}`);
      }
      if (hits.length > 1) {
        throw new Error(`《${slug}》里「${name}」有 ${hits.length} 个 id：${hits.join(' / ')} —— 简称有歧义，必须用全名`);
      }
      return hits[0];
    },
    /** 把 [{chars: [中文名...]}] 转成 id 列表，并报告解析失败的 */
    convert(items) {
      const bad = [];
      let n = 0;
      for (const it of items) {
        if (!it.chars) continue;
        const ids = [];
        for (const name of it.chars) {
          try { ids.push(this.id(name)); n++; } catch (e) { bad.push(`ch${it.ch} 「${it.title}」: ${e.message}`); }
        }
        it.chars = ids;
      }
      return { bad, resolved: n };
    },
    has: (id) => byId.has(id),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const slug = process.argv[2] || 'three-kingdoms';
  const r = makeResolver(slug);
  const names = process.argv.slice(3);
  if (!names.length) {
    /* 只报**真歧义**：同一个名字指向不同 id。同一 id 出现多次不算歧义。 */
    const amb = [...r.byName.entries()]
      .map(([k, v]) => [k, [...new Set(v.map((h) => h.id))]])
      .filter(([, ids]) => ids.length > 1);
    console.log(`《${slug}》${r.byName.size} 个可解析名字；其中有歧义的：${amb.length} 个`);
    for (const [k, ids] of amb.slice(0, 30)) console.log(`  ${k} → ${ids.join(' / ')}`);
    if (amb.length > 30) console.log(`  …另有 ${amb.length - 30} 个`);
    const probe = { 'three-kingdoms': ['张宝', '张苞', '张飞', '王颀'], 'crime-and-punishment': ['拉斯柯尔尼科夫', '索尼娅', '玛尔美拉朵夫', '伊凡诺芙娜'], 'one-hundred-years-of-solitude': ['乌尔苏拉', '奥雷里亚诺·布恩迪亚上校', '奥雷里亚诺', '何塞·阿尔卡蒂奥'] }[slug] || [];
    for (const q of probe) {
      try { const c = r.book.characters.find((x) => x.id === r.id(q)); console.log(`  ✓ ${q} → ${c.id}（${c.name}，第 ${c.firstCh} 章）`); }
      catch (e) { console.log(`  ✗ ${e.message}`); }
    }
  } else {
    for (const n of names) {
      try { console.log(`${n} = ${r.id(n)}`); } catch (e) { console.log(`★ ${e.message}`); }
    }
  }
}