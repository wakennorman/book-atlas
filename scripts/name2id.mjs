// 人名 → id 解析器。拆书条目里 chars 一律写中文名，由本脚本转成 id。
// 这样就彻底消灭「从中间输出手工转抄 id」这一类错误。
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function loadBook(slug) {
  return JSON.parse(fs.readFileSync(`data/${slug}.json`, 'utf8'));
}

export function makeResolver(slug) {
  const book = loadBook(slug);
  const byName = new Map();
  for (const c of book.characters) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
  const byId = new Set(book.characters.map((c) => c.id));
  return {
    book,
    byName,
    /** 名字 → id；查不到或重名都抛错，绝不猜 */
    id(name) {
      const hits = byName.get(name);
      if (!hits) throw new Error(`《${slug}》里查无此人：${name}`);
      if (hits.length > 1) {
        throw new Error(`《${slug}》里「${name}」有 ${hits.length} 个 id：${hits.map((h) => h.id).join(' / ')} —— 必须指明用哪个`);
      }
      return hits[0].id;
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
    const dup = [...r.byName.entries()].filter(([, v]) => v.length > 1);
    console.log(`《${slug}》共 ${r.byName.size} 个人名；其中重名的：${dup.length ? dup.map(([k, v]) => k + '→' + v.map((h) => h.id).join('/')).join('  ') : '（无）'}`);
    for (const q of ['张宝', '张苞', '张飞', '祝融夫人', '刘氏', '马良', '李恢', '邓芝', '孟获', '姜维']) {
      const h = r.byName.get(q);
      console.log(`  ${q} → ${h ? h.map((x) => x.id + '(第' + x.firstCh + '回)').join(' / ') : '★ 库里没有'}`);
    }
  } else {
    for (const n of names) {
      try { console.log(`${n} = ${r.id(n)}`); } catch (e) { console.log(`★ ${e.message}`); }
    }
  }
}