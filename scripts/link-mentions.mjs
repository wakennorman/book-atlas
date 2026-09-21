#!/usr/bin/env node
/**
 * 文案反挂：事件 summary / 关系小事件里提到的人物，自动补进 events[].chars
 *
 * 整本生成时 AI 常把"提到的人"写进文案却忘了放进 chars —— 图上就不会高亮他。
 * 规则（宁可少挂不可错挂）：
 *   · 只认**全书中唯一**的名字/别名（重名人物如《三国演义》两个「马忠」一律不挂）
 *   · 名字长度 ≥ 2，且跳过「何塞·」这类嵌套前缀（沿用 validate.mjs 的口径）
 *   · 只补不删
 *
 * 用法：
 *   node scripts/link-mentions.mjs data/three-kingdoms.json           # 预览
 *   node scripts/link-mentions.mjs data/three-kingdoms.json --write   # 写回
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const files = argv.includes('--all')
  ? fs.readdirSync(path.join(process.cwd(), 'data')).filter((f) => f.endsWith('.json') && f !== 'books.json' && !f.startsWith('.')).map((f) => path.join(process.cwd(), 'data', f))
  : argv.filter((a) => !a.startsWith('--'));

if (!files.length) { console.error('用法：node scripts/link-mentions.mjs data/xx.json [--write]'); process.exit(1); }

const hidden = (text, name) => {   // 命中是不是"嵌套在更长的名字里"
  let i = text.indexOf(name);
  while (i !== -1) {
    const before = text.slice(Math.max(0, i - 3), i);
    const after = text.slice(i + name.length, i + name.length + 2);
    if (!(before.endsWith('何塞·') || before.endsWith('·') || after.startsWith('·') || after.startsWith('（第'))) return false;
    i = text.indexOf(name, i + 1);
  }
  return true;
};

for (const file of files) {
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = new Set((book.characters || []).map((c) => c.id));

  // 名字 → 候选人物（只保留唯一的）
  const byKey = new Map();
  for (const c of book.characters || []) {
    for (const key of [c.name, ...(c.aliases || [])]) {
      const k = String(key || '').trim();
      if (k.length < 2) continue;
      byKey.set(k, byKey.has(k) ? null : c.id);   // 重名置 null
    }
  }
  const unique = [...byKey.entries()].filter(([, id]) => id && ids.has(id));
  unique.sort((a, b) => b[0].length - a[0].length);   // 长名优先

  let added = 0, eventsTouched = 0;
  const hits = [];
  for (const e of book.events || []) {
    const text = `${e.summary || ''} ${e.impact || ''}`;
    if (!text.trim()) continue;
    const set = new Set(e.chars || []);
    const before = set.size;
    for (const [name, id] of unique) {
      if (set.has(id) || hidden(text, name)) continue;
      if (text.includes(name)) set.add(id);
    }
    if (set.size > before) { e.chars = [...set]; added += set.size - before; eventsTouched++; hits.push(`事件「${e.name}」+${set.size - before}`); }
  }
  console.log(`\n▶ ${path.basename(file)}：可补挂 ${added} 处（涉及 ${eventsTouched} 个事件）`);
  console.log(`   例：${hits.slice(0, 8).join('；')}`);
  if (write && added) {
    fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
    console.log('   ✓ 已写回');
  } else if (!write) {
    console.log('   （预览模式：加 --write 才写回）');
  }
}
