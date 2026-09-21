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
import { checkKin, KIN, KIN_KEYS } from './kin.mjs';

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
    if (!c.gender || !['m', 'f'].includes(c.gender)) warn(`${where} 缺少 gender（m/f）——用于形状区分男女`);
    if (typeof c.firstCh !== 'number') warn(`${where} 缺少 firstCh（首次出场章）——剧透保护要用`);
    if (c.tier && !['main', 'minor', 'mentioned'].includes(c.tier)) warn(`${where} 的 tier「${c.tier}」不合法（main | minor | mentioned）`);
    if (c.faction && !factions.has(c.faction)) err(`${where} 的 faction「${c.faction}」未在 factions 中定义`);
    if (ids.has(c.id)) err(`角色 id 重复：${c.id}`);
    ids.add(c.id);
    const n = names.get(c.name) || [];
    n.push(c.id); names.set(c.name, n);
  }
  for (const [name, list] of names) if (list.length > 1) warn(`角色名重复：${name}（${list.join(', ')}）——记得用 note 写清消歧提示`);

  // ---------- 分组标准（代际轴 / 阵营轴） ----------
  const genSet = new Set(chars.map((c) => Number(c.generation)));
  const facSet = new Set(chars.map((c) => c.faction).filter(Boolean));
  const declared = book.meta && book.meta.groupMode;
  const inferred = genSet.size > 1 ? 'generation' : 'faction';
  if (declared && !['generation', 'faction'].includes(declared)) {
    err(`meta.groupMode「${declared}」不合法（应为 generation | faction，或留空自动判定）`);
  } else if (declared === 'generation' && genSet.size < 2) {
    warn('meta.groupMode=generation，但数据里只有 1 种代际——没有代际差异就不要按代际分组（补全 generation，或改为 faction）');
  } else if (declared === 'faction' && genSet.size > 1) {
    console.log(`  ℹ 声明按阵营分组；数据里有 ${genSet.size} 种代际（想按代际就把 meta.groupMode 改成 generation）`);
  }
  const groupModeNow = declared || inferred;
  console.log(`  ℹ 分组：${groupModeNow === 'generation' ? `按代际（${genSet.size} 组）` : `按阵营（${facSet.size} 组）`}${declared ? '（显式声明）' : '（自动判定）'}`);

  const rels = book.relations || [];
  if (!rels.length) err('relations 为空');
  for (const r of rels) {
    const where = `关系 ${r.from}→${r.to}`;
    if (!ids.has(r.from)) err(`${where} 的 from 不存在`);
    if (!ids.has(r.to)) err(`${where} 的 to 不存在`);
    req(r, 'type', where);
    if (!STYLES.has(r.style)) err(`${where} 的 style「${r.style}」不合法（solid|dashed|dotted）`);
    for (const k of checkKin(r)) (k.level === 'error' ? err : warn)(`${where} ${k.msg}`);
    if (!Array.isArray(r.events) || !r.events.length) warn(`${where} 没有「定义关系的小事件」`);
    for (const e of r.events || []) {
      if (!e.text) err(`${where} 的事件缺少 text`);
      else if (e.chapter && !/(\d+)/.test(e.chapter)) warn(`${where} 的事件章节「${e.chapter}」里没有数字（剧透保护要靠它）`);
    }
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
    if (typeof e.ch !== 'number') warn(`${where} 缺少 ch（发生章）——剧透保护要用`);
    for (const cid of e.chars || []) if (!ids.has(cid)) err(`${where} 引用了不存在的角色 ${cid}`);
  }

  // ---------- 「仅被提及」人物与地点 ----------
  const mentioned = chars.filter((c) => c.tier === 'mentioned');
  const orphanMentioned = mentioned.filter((c) => !(book.relations || []).some((r) => r.from === c.id || r.to === c.id));
  for (const c of orphanMentioned) warn(`「仅被提及」人物「${c.name}」没有任何关系——纯背景名字建议不建节点，写进 note 即可`);
  if (mentioned.length) console.log(`  ℹ 人物层级：仅被提及 ${mentioned.length} 人（默认折叠，可在图上开关）`);

  const places = book.places || [];
  const placeIds = new Set();
  for (const p of places) {
    const where = `地点 ${p.id || '(无 id)'}`;
    req(p, 'id', where); req(p, 'name', where);
    if (typeof p.firstCh !== 'number') warn(`${where} 缺少 firstCh（首次出现章）——剧透保护与地点筛选要用`);
    if (placeIds.has(p.id)) warn(`地点 id 重复：${p.id}`);
    placeIds.add(p.id);
  }
  const checkPlace = (ev, where) => { if (ev.place && !placeIds.has(ev.place)) err(`${where} 的 place「${ev.place}」不在 places[] 里`); };
  for (const e of events) checkPlace(e, `事件 ${e.id}`);
  for (const r of rels) for (const ev of r.events || []) checkPlace(ev, `关系 ${r.from}→${r.to}`);
  if (places.length) console.log(`  ℹ 地点 ${places.length} 个，已挂到 ${events.filter((e) => e.place).length} 个事件`);

  const kinRels = rels.filter((r) => r.kin);
  if (kinRels.length) {
    const detail = KIN_KEYS.filter((k) => kinRels.some((r) => r.kin === k)).map((k) => `${KIN[k]} ${kinRels.filter((r) => r.kin === k).length}`).join(' · ');
    console.log(`  ℹ 亲属关系 ${kinRels.length} 条：${detail}`);
  }

  // ---------- 文案规范检查（v0.3 起：防「主语跳来跳去 / 称谓不明 / 提到的人不在 chars 里」） ----------
  const KIN_WORD = /(哥哥|弟弟|姐姐|妹妹|父亲|母亲|儿子|女儿|丈夫|妻子|叔叔|姑姑|侄子|侄女|祖父|祖母|外公|外婆|曾祖|孙子|孙女)/;
  const nameIndex = chars.map((c) => ({ id: c.id, n: [c.name, ...(c.aliases || [])].filter(Boolean) }));
  const hasName = (text) => nameIndex.some((x) => x.n.some((nn) => text.includes(nn)));
  const sentences = (s) => String(s || '').split(/[。；！？]/).map((x) => x.trim()).filter(Boolean);
  const firstSentence = (s) => sentences(s)[0] || '';

  for (const e of events) {
    const where = `事件 ${e.id}`;
    const text = e.summary || '';
    const mentions = (name) => {
      let i = text.indexOf(name);
      while (i !== -1) {
        const before = text.slice(Math.max(0, i - 3), i);
        const after = text.slice(i + name.length, i + name.length + 2);
        const nested = before.endsWith('何塞·') || before.endsWith('·') || after.startsWith('·') || after.startsWith('（第');
        if (!nested) return true;
        i = text.indexOf(name, i + 1);
      }
      return false;
    };
    for (const { id, n } of nameIndex) {
      if (n.some((nn) => mentions(nn)) && !(e.chars || []).includes(id)) {
        warn(`${where} 文案提到「${n[0]}」但 chars 未包含该角色`);
      }
    }
    if (/^[他她]/.test(firstSentence(text))) {
      warn(`${where} 文案以代词开头（「${firstSentence(text).slice(0, 6)}…」），主语不明`);
    }
    for (const s of sentences(text)) {
      if (KIN_WORD.test(s) && !hasName(s)) warn(`${where} 这句「${s.slice(0, 20)}…」用了亲属称谓却没配具体人名`);
    }
  }
  for (const r of rels) {
    const where = `关系 ${r.from}→${r.to}`;
    for (const ev of r.events || []) {
      for (const s of sentences(ev.text)) {
        if (KIN_WORD.test(s) && !hasName(s)) warn(`${where} 这句「${s.slice(0, 20)}…」用了亲属称谓却没配具体人名`);
      }
    }
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
