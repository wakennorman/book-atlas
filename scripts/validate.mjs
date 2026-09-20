#!/usr/bin/env node
/**
 * 数据校验：node scripts/validate.mjs data/one-hundred-years-of-solitude.json
 *          node scripts/validate.mjs --all          （校验 data/ 下所有书）
 *
 * 检查项：
 *  - 必填字段与类型
 *  - id 唯一、关系/事件引用的 id 必须存在
 *  - faction / phase 必须已定义
 *  - relations[].style 必须是 solid|dashed|dotted
 *  - 每条关系至少有一个「定义关系的小事件」
 * 退出码：有 error 时为 1（方便接 CI）。
 */
import fs from 'node:fs';
import path from 'node:path';

const STYLES = new Set(['solid', 'dashed', 'dotted']);
let errors = 0, warns = 0;
const err = (m) => { errors++; console.error('  ✗ ' + m); };
const warn = (m) => { warns++; console.warn('  ⚠ ' + m); };

function validate(file) {
  console.log(`\n▶ ${file}`);
  let book;
  try {
    book = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    err(`JSON 解析失败：${e.message}`);
    return;
  }

  const req = (obj, key, where) => {
    const v = obj?.[key];
    if (v === undefined || v === null || v === '') { err(`${where} 缺少 ${key}`); return null; }
    return v;
  };

  req(book.meta, 'slug', 'meta');
  req(book.meta, 'title', 'meta');
  const factions = new Set((book.factions || []).map((f) => f.key));
  if (!factions.size) err('factions 为空');

  const chars = book.characters || [];
  if (!chars.length) err('characters 为空');
  const ids = new Set();
  const names = new Map();
  for (const c of chars) {
    const where = `角色 ${c.id || '(无 id)'}`;
    req(c, 'id', where); req(c, 'name', where); req(c, 'faction', where);
    req(c, 'title', where); req(c, 'desc', where); req(c, 'fate', where);
    if (typeof c.generation !== 'number') err(`${where} generation 必须是数字`);
    if (c.faction && !factions.has(c.faction)) err(`${where} 的 faction「${c.faction}」未在 factions 中定义`);
    if (ids.has(c.id)) err(`角色 id 重复：${c.id}`);
    ids.add(c.id);
    const n = names.get(c.name) || [];
    n.push(c.id); names.set(c.name, n);
  }
  for (const [name, list] of names) if (list.length > 1) warn(`角色名重复：${name}（${list.join(', ')}）——记得用 note 写清消歧提示`);

  const rels = book.relations || [];
  if (!rels.length) err('relations 为空');
  for (const r of rels) {
    const where = `关系 ${r.from}→${r.to}`;
    if (!ids.has(r.from)) err(`${where} 的 from 不存在`);
    if (!ids.has(r.to)) err(`${where} 的 to 不存在`);
    req(r, 'type', where);
    if (!STYLES.has(r.style)) err(`${where} 的 style「${r.style}」不合法（solid|dashed|dotted）`);
    if (!Array.isArray(r.events) || !r.events.length) warn(`${where} 没有「定义关系的小事件」`);
    for (const e of r.events || []) if (!e.text) err(`${where} 的事件缺少 text`);
  }

  const phases = new Set((book.phases || []).map((p) => p.id));
  if (!phases.size) err('phases 为空');
  const events = book.events || [];
  if (!events.length) err('events 为空');
  const evIds = new Set();
  for (const e of events) {
    const where = `事件 ${e.id || '(无 id)'}`;
    req(e, 'id', where); req(e, 'name', where); req(e, 'summary', where); req(e, 'impact', where);
    if (evIds.has(e.id)) err(`事件 id 重复：${e.id}`);
    evIds.add(e.id);
    if (e.phase && !phases.has(e.phase)) err(`${where} 的 phase「${e.phase}」未定义`);
    if (typeof e.order !== 'number') err(`${where} order 必须是数字`);
    for (const cid of e.chars || []) if (!ids.has(cid)) err(`${where} 引用了不存在的角色 ${cid}`);
  }

  console.log(`  角色 ${chars.length} · 关系 ${rels.length} · 事件 ${events.length} ⇒ ${errors ? 'FAIL' : 'OK'}（${errors} error / ${warns} warning）`);
}

const args = process.argv.slice(2);
if (!args.length || args[0] === '--all') {
  const dir = path.join(process.cwd(), 'data');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'books.json').map((f) => path.join(dir, f));
  files.forEach(validate);
} else {
  args.filter((a) => !a.startsWith('--')).forEach((a) => validate(a));
}
console.log('');
process.exit(errors ? 1 : 0);
