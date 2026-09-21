#!/usr/bin/env node
/**
 * 整本生成（命令行版）—— 逐章抽取 → 合并去重 → 写出 data/<slug>.json
 *
 * 和编辑器「整本生成」同一套提示词与合并规则，但跑在 Node 里：
 *   · 不用开浏览器、不怕标签页被关；每章结果即时落盘，断了可以接着跑
 *   · 不限每章人物数量（上限只受模型输出长度约束，截断了会自动保留完整部分）
 *
 * 用法：
 *   node scripts/wholebook.mjs --text 三国演义.txt --title 三国演义 --slug three-kingdoms
 *   node scripts/wholebook.mjs --epub 三国演义.epub --title 三国演义 --slug three-kingdoms --only 6-120
 *   node scripts/wholebook.mjs --text x.txt --title X --slug y --only 1-5 --dry    # 只跑不合并
 *
 * 环境变量（也可以写进 --env 文件）：
 *   LLM_BASE_URL   默认 https://api.deepseek.com/v1（可带 /chat/completions）
 *   LLM_API_KEY    必填
 *   LLM_MODEL      默认 deepseek-chat
 *
 * 状态文件：data/.gen-<slug>.json（存每章草稿与进度；删掉就是重跑）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { guessKin } from './kin.mjs';

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const get = (name, def = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? true) : def;
};
const has = (name) => argv.includes(name);

const textFile = get('--text');
const epubFile = get('--epub');
const title = get('--title');
const slug = (get('--slug') || title || '').toString().trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');
const outFile = path.resolve(get('--out') || `data/${slug}.json`);
const stateFile = path.resolve(get('--state') || `data/.gen-${slug}.json`);
const only = get('--only');           // 例：1-30,35,40-120（按回/章号）
const maxTokens = Number(get('--max-tokens') || 16000);
const jobs = Math.max(1, Number(get('--jobs') || 3));   // 并发章数（每章两轮请求：人物关系 + 事件）
const rosterMax = Math.max(20, Number(get('--roster-max') || 400));   // 提示词里带多少人名（太长会挤掉输出）
const dry = has('--dry');

if (!title || (!textFile && !epubFile)) {
  console.error('用法：node scripts/wholebook.mjs --text book.txt --title 书名 [--slug slug] [--only 1-10] [--epub book.epub]');
  process.exit(1);
}
const baseUrlRaw = (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const baseUrl = baseUrlRaw.replace(/\/chat\/completions$/, '');
const apiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
const model = process.env.LLM_MODEL || 'deepseek-chat';
if (!apiKey) { console.error('缺少 LLM_API_KEY（或 DEEPSEEK_API_KEY）环境变量'); process.exit(1); }

/* ---------------- 分章：EPUB 自带目录优先，txt 退回正则 ---------------- */
function chaptersFromDocs(text) {
  const docs = [];
  const parts = text.split(/^==== \[(\d+)\] (\S+) ====\s*$/m);
  // 形如 ['', '001', 'xhtml/1.xhtml', '正文…', '002', ...]
  for (let i = 1; i + 2 < parts.length + 1; i += 3) {
    const href = parts[i + 1];
    const body = parts[i + 2];
    if (!body) continue;
    const firstLine = (body.split('\n').map((s) => s.trim()).find(Boolean) || '').slice(0, 40);
    const m = firstLine.match(/^第\s*([一二三四五六七八九十百千零〇两\d]+)\s*[回章节卷]/);
    if (!m) continue;
    docs.push({ no: hanToNum(m[1]), title: firstLine, text: body.trim() });
  }
  return docs;
}

function hanToNum(s) {
  const str = String(s || '').trim();
  if (/^\d+$/.test(str)) return Number(str);
  const D = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const U = { 十: 10, 百: 100, 千: 1000 };
  let section = 0, num = 0;
  for (const ch of str) {
    if (ch in D) num = D[ch];
    else if (ch in U) { section += (num || 1) * U[ch]; num = 0; }
    else return 0;
  }
  return section + num;
}

function splitByRegex(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n');
  const re = /^[ \t　]*第[ \t　]*[一二三四五六七八九十百千零〇两\d]+[ \t　]*[章回节卷][^\n]{0,40}$/gm;
  const marks = [...t.matchAll(re)].map((m) => ({ idx: m.index, title: m[0].trim() }));
  if (marks.length < 2) return t.trim() ? [{ no: 0, title: '全文', text: t.trim() }] : [];
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].idx : t.length;
    const m = marks[i].title.match(/^第\s*([一二三四五六七八九十百千零〇两\d]+)\s*[回章节卷]/);
    out.push({ no: m ? hanToNum(m[1]) : 0, title: marks[i].title.slice(0, 40), text: t.slice(marks[i].idx, end).trim() });
  }
  return out;
}

let raw;
if (epubFile) {
  const tmp = path.join(os.tmpdir(), `bookatlas-${slug}-epub.txt`);
  console.log(`▶ 先抽 EPUB 正文 → ${tmp}`);
  execFileSync(process.execPath, [path.resolve('scripts/extract-epub.mjs'), path.resolve(epubFile), tmp], { stdio: 'inherit' });
  raw = fs.readFileSync(tmp, 'utf8');
} else {
  raw = fs.readFileSync(path.resolve(textFile), 'utf8');
}
let chapters = chaptersFromDocs(raw);
if (chapters.length < 3) chapters = splitByRegex(raw);
chapters.sort((a, b) => (a.no || 0) - (b.no || 0));
console.log(`▶ ${path.basename(epubFile || textFile)}：${chapters.length} 章（${chapters[0]?.title?.slice(0, 20)} … ${chapters[chapters.length - 1]?.title?.slice(0, 20)}）`);

/* ---------------- 提示词（与编辑器 batchSystem/batchUser 同源，改一处要改两处） ---------------- */
const SCHEMA = `{
  "meta": { "title": "", "author": "", "chapters": 120, "note": "" },
  "factions": [{ "key": "", "name": "", "color": "#hex" }],
  "characters": [{ "id": "拼音-kebab", "name": "", "aliases": [], "generation": 1, "gender": "m|f", "firstCh": 1, "faction": "", "title": "", "desc": "", "fate": "", "note": "" }],
  "relations": [{ "from": "id", "to": "id", "type": "", "kin": "blood|marriage|inlaw|adoptive|foster|step|sworn（只有亲属才填，不是亲属就省略这个字段）", "style": "solid|dashed|dotted", "events": [{ "text": "", "chapter": "第X章", "place": "地点 id 或空" }] }],
  "places": [{ "id": "拼音-kebab", "name": "", "aliases": [], "type": "", "firstCh": 1, "desc": "" }],
  "phases": [{ "id": "p1", "name": "", "order": 1 }],
  "events": [{ "id": "e-章号-序号", "phase": "p1", "order": 1, "ch": 1, "name": "", "chars": ["id"], "place": "地点 id 或空", "summary": "", "impact": "", "quote": "" }]
}`;

const systemPrompt = '你是文学作品的资料整理员，正在**逐章**整理一本书，供「人物关系 + 事件时间轴」应用使用。硬性要求：' +
  '严格输出 JSON（不要 markdown 围栏、不要解释）；**只从给定章节抽取**，不要引入本章没出现的内容；' +
  '**本章出现的人物尽量都收**（有名有姓、有行动或对话的都算，不要为了省字数漏掉重要人物）；' +
  '**写短一点来省长度**：desc/fate/note/title 各 ≤ 30 字，事件 summary ≤ 45 字，每条关系小事件文案 ≤ 35 字、只写 1 条；' +
  '人物 id 用拼音 kebab-case；**已有名单里的人必须沿用名单里的 id**；' +
  '带血缘/姻亲/收养关系的人物，relation 的 type 要写清是哪一种（血缘=父子/母子/兄弟…，收养=养父/养女…，姻亲=继母/岳父…），并给出 kin 字段（blood 血缘 / marriage 婚姻 / inlaw 姻亲 / adoptive 收养 / foster 抚养 / step 继亲 / sworn 结义；不是亲属就省略 kin）；' +
  'relations 每条至少 1 个「定义关系的小事件」，chapter 写「第N章」，place 写这条小事件发生的地点 id（有把握才写）；**关系的两端、事件的 chars 都必须出现在本次 characters 里**；' +
  'events 的 ch 写这一章的章号，**id 用「e-章号-序号」**（例：e-3-2），place 写地点 id，phase 可省略；phases 只在第 1 章输出；' +
  'places：沿用「已有地点名单」的 id，本章新出现的地点可以新增（id 拼音 kebab）；' +
  'faction 必须沿用「已有阵营」里的 key（确实不属于任何已有阵营才新起 key）；' +
  'style 约定 solid=亲缘/同盟、dashed=对立/伤害、dotted=情人/过去/间接；多个人物共用一个名字或绰号时，必须在 name 里带世代/身份；易混同名人物在 note 里写消歧提示；全部字段中文。';

function userPrompt(ch, roster, placeRoster, factionRoster, total) {
  const n = ch.no || 1;
  const body = ch.text.length > 40000 ? ch.text.slice(0, 40000) + '\n…（本章过长，已截断）' : ch.text;
  return `书名《${title}》，共 ${total} 章。现在是第 ${n} 章：${ch.title}。\n\n` +
    (roster ? `已有名单（同一个人必须沿用这些 id）：\n${roster}\n\n` : '') +
    (placeRoster ? `已有地点名单（同一个地点必须沿用这些 id）：\n${placeRoster}\n\n` : '') +
    (factionRoster ? `已有阵营（faction 用这些 key）：\n${factionRoster}\n\n` : '') +
    `JSON schema：\n${SCHEMA}\n\n` +
    `请只从本章抽取，输出 JSON。events[].ch = ${n}；relations[].events[].chapter 写「第${n}章」。\n\n` +
    `<<<本章原文开始>>>\n${body}\n<<<本章原文结束>>>`;
}

/* ---------------- 调用模型（JSON 模式 + 截断修复） ---------------- */
function parseLooseJson(raw) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  if (start < 0) throw new Error('返回里没有找到 JSON：' + text.slice(0, 120));
  const body = text.slice(start);
  try { return JSON.parse(body.slice(0, body.lastIndexOf('}') + 1 || undefined)); } catch (e) { /* 修复 */ }
  const marks = [];
  const stack = [];
  let inStr = false, esc = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') { stack.pop(); marks.push(i); }
  }
  for (let k = marks.length - 1; k >= 0; k--) {
    const cand = body.slice(0, marks[k] + 1);
    const s = [];
    let inS = false, es = false;
    for (const ch of cand) {
      if (inS) { if (es) es = false; else if (ch === '\\') es = true; else if (ch === '"') inS = false; continue; }
      if (ch === '"') { inS = true; continue; }
      if (ch === '{' || ch === '[') s.push(ch === '{' ? '}' : ']');
      else if (ch === '}' || ch === ']') s.pop();
    }
    if (inS) continue;
    try { return JSON.parse(cand + s.reverse().join('')); } catch (e) { /* 再往前退 */ }
  }
  throw new Error('返回的 JSON 无法解析（多半是这一章太长、输出被截断）；可以重跑这一章');
}

async function callLLM(system, user) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const payload = (jsonMode, tokens) => JSON.stringify(jsonMode
    ? { model, temperature: 0.4, max_tokens: tokens, response_format: { type: 'json_object' }, messages }
    : { model, temperature: 0.4, max_tokens: tokens, messages });
  const call = (jsonMode, tokens) => fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: payload(jsonMode, tokens),
  });
  let res = await call(true, maxTokens);
  if (res.status === 400) {
    const t = await res.text().catch(() => '');
    if (/max_tokens/i.test(t)) {
      res = await call(true, 8192);                       // 端点不认大 max_tokens
    } else if (/response_format/i.test(t)) {
      res = await call(false, maxTokens);                 // 端点不认 JSON 模式
    } else {
      throw new Error(`API 400：${t.slice(0, 200)}`);
    }
  }
  if (!res.ok) throw new Error(`API ${res.status}：${(await res.text().catch(() => '')).slice(0, 200)}`);
  const json = await res.json();
  const choice = json.choices?.[0] || {};
  if (choice.finish_reason && choice.finish_reason !== 'stop') {
    console.warn(`   ⚠ finish_reason=${choice.finish_reason}（输出可能被截断；已自动保留完整部分）`);
  }
  return parseLooseJson(choice.message?.content || '');
}

/** 第二次调用：只抽本章事件（保证事件不因截断被丢掉） */
async function callLLMEvents(ch, roster, total) {
  const n = ch.no || 1;
  const body = ch.text.length > 30000 ? ch.text.slice(0, 30000) : ch.text;
  const sys = '你是文学作品的资料整理员。只做一件事：从给定章节里抽出**重大事件**（推动剧情、改变人物关系的节点），输出 JSON。' +
    '硬性要求：严格输出 {"events": [...]}（不要 markdown 围栏、不要解释）；**3–6 个**事件；每个事件：' +
    'id 用「e-章号-序号」（例 e-3-1）、ch 写本章章号、name ≤ 14 字、summary ≤ 45 字（谁·对谁·做了什么·后果）、' +
    'impact ≤ 30 字、chars 必须从「人物名单」里选 id、place 用「地点名单」里的 id（没把握就省略 place）、quote 可省略；' +
    'phase 省略（我会按章号自动归入阶段）；全部中文。';
  const user = `书名《${title}》，共 ${total} 章。现在是第 ${n} 章：${ch.title}。\n\n` +
    (roster ? `人物名单（chars 只能从这里选 id）：\n${roster}\n\n` : '') +
    `只输出 JSON：{"events":[{"id":"e-${n}-1","ch":${n},"name":"","summary":"","impact":"","chars":["id"],"place":""}]}\n\n` +
    `<<<本章原文开始>>>\n${body}\n<<<本章原文结束>>>`;
  return callLLM(sys, user);
}

/* ---------------- 合并（与编辑器 mergeDraft 同规则） ---------------- */
function mergeInto(book, draft) {
  const st = { cAdd: 0, rAdd: 0, eAdd: 0, evAdd: 0, pAdd: 0, dropped: 0 };
  const byId = new Map(book.characters.map((c) => [c.id, c]));
  const byName = new Map(book.characters.map((c) => [c.name, c]));
  const fill = (t, c) => {
    t.aliases = [...new Set([...(t.aliases || []), ...(c.aliases || [])])];
    for (const k of ['desc', 'fate', 'title', 'faction', 'note', 'gender', 'firstCh', 'tier']) if (!t[k] && c[k]) t[k] = c[k];
  };
  for (const c of draft.characters || []) {
    const id = String(c.id || '').trim();
    if (!id) continue;
    if (byId.has(id)) { fill(byId.get(id), c); continue; }
    if (c.name && byName.has(c.name)) { fill(byName.get(c.name), c); continue; }
    const item = { ...c, id };
    book.characters.push(item);
    byId.set(id, item);
    if (item.name) byName.set(item.name, item);
    st.cAdd++;
  }
  for (const f of draft.factions || []) if (f.key && !book.factions.some((x) => x.key === f.key)) book.factions.push(f);
  const placeById = new Map(book.places.map((p) => [p.id, p]));
  const placeByName = new Map(book.places.map((p) => [p.name, p]));
  for (const p of draft.places || []) {
    const id = String(p.id || '').trim();
    if (id && placeById.has(id)) continue;
    if (p.name && placeByName.has(p.name)) continue;
    const item = { ...p, id: id || `pl-${Math.random().toString(36).slice(2, 7)}`, firstCh: p.firstCh ?? 0 };
    book.places.push(item);
    placeById.set(item.id, item);
    if (item.name) placeByName.set(item.name, item);
    st.pAdd++;
  }
  for (const p of draft.phases || []) if (p.id && !book.phases.some((x) => x.id === p.id && !x.from)) book.phases.push(p);
  const fallbackPhase = (book.phases[0] || { id: 'p1' }).id;
  const relKey = (r) => `${r.from}|${r.to}|${(r.type || '').trim()}`;
  const relMap = new Map(book.relations.map((r) => [relKey(r), r]));
  for (const r of draft.relations || []) {
    if (!byId.has(r.from) || !byId.has(r.to)) { st.dropped++; continue; }
    const k = relKey(r);
    if (relMap.has(k)) {
      const t = relMap.get(k);
      if (!t.kin && r.kin) t.kin = r.kin;
      const seen = new Set((t.events || []).map((e) => e.text));
      for (const e of r.events || []) if (e.text && !seen.has(e.text)) { t.events.push(e); st.evAdd++; }
    } else {
      const item = { ...r, events: [...(r.events || [])] };
      book.relations.push(item);
      relMap.set(k, item);
      st.rAdd++;
    }
  }
  const evIds = new Set(book.events.map((e) => e.id));
  const evSig = (e) => `${e.ch ?? 0}|${e.name || ''}|${String(e.summary || '').slice(0, 24)}`;
  const evSigs = new Set(book.events.map(evSig));
  for (const e of draft.events || []) {
    const ev = { ...e, id: e.id || `e-${Math.random().toString(36).slice(2, 7)}`, ch: e.ch ?? 0 };
    if (!book.phases.some((p) => p.id === ev.phase)) ev.phase = fallbackPhase;
    if (evSigs.has(evSig(ev))) continue;
    if (evIds.has(ev.id)) ev.id = `e-${Math.random().toString(36).slice(2, 7)}`;
    if (Array.isArray(ev.chars)) ev.chars = ev.chars.filter((cid) => byId.has(cid));
    book.events.push(ev);
    evIds.add(ev.id);
    evSigs.add(evSig(ev));
    st.eAdd++;
  }
  // 悬空 place / kin 清洗
  const fixPlace = (o) => {
    if (!o || !o.place) return;
    if (placeById.has(o.place)) return;
    if (placeByName.has(o.place)) { o.place = placeByName.get(o.place).id; return; }
    o.place = '';
    st.dropped++;
  };
  for (const e of book.events) fixPlace(e);
  for (const r of book.relations) {
    for (const ev of r.events || []) fixPlace(ev);
    if (r.kin && /^(空|无|none|null|-|否)$/i.test(String(r.kin).trim())) delete r.kin;
    if (!r.kin) { const g = guessKin(r.type); if (g) r.kin = g; }
  }
  return st;
}

/* ---------------- 主流程 ---------------- */
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { chapterCount: chapters.length, results: {} };
if (state.chapterCount !== chapters.length) { console.warn(`⚠ 状态文件里的章数（${state.chapterCount}）与本次分章（${chapters.length}）不一致，按新章数重置`); state.results = {}; state.chapterCount = chapters.length; }
if (!state.book && fs.existsSync(outFile)) { state.book = JSON.parse(fs.readFileSync(outFile, 'utf8')); }
if (!state.book) {
  state.book = {
    meta: { slug, title, author: get('--author') || '', translator: '', chapters: chapters.length, groupMode: get('--group-mode') || '', note: '', license: 'CC BY-SA 4.0', updated: '', sources: [] },
    factions: [], characters: [], relations: [], places: [], phases: [], events: [],
  };
}
const book = state.book;

const picks = (() => {
  const want = new Set();
  if (!only) return chapters.map((c, i) => i);
  for (const seg of String(only).split(',')) {
    const m = seg.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { for (let n = Number(m[1]); n <= Number(m[2]); n++) want.add(n); }
    else if (/^\d+$/.test(seg.trim())) want.add(Number(seg.trim()));
  }
  return chapters.map((c, i) => i).filter((i) => want.has(chapters[i].no));
})();

console.log(`▶ 模型：${model} @ ${baseUrl}（max_tokens ${maxTokens}，并发 ${jobs}）`);
console.log(`▶ 本次要跑 ${picks.length} 章；状态文件 ${path.relative(process.cwd(), stateFile)}`);

let ok = 0, fail = 0;
const done = new Set();

async function runChapter(idx, slot) {
  const ch = chapters[idx];
  const key = String(idx);
  const roster = book.characters.slice(0, rosterMax).map((c) => `${c.id}: ${c.name}`).join('；');
  const placeRoster = book.places.slice(0, 150).map((p) => `${p.id}: ${p.name}`).join('；');
  const factionRoster = book.factions.map((f) => `${f.key}: ${f.name}`).join('；');
  const t0 = Date.now();
  try {
    const draft = await callLLM(systemPrompt, userPrompt(ch, roster, placeRoster, factionRoster, chapters.length));
    // 事件单独跑一轮：第一轮输出里 events 常被网关截断丢掉
    let evDraft = { events: [] };
    try {
      evDraft = await callLLMEvents(ch, roster, chapters.length);
    } catch (e) {
      console.warn(`   ⚠ 第${ch.no}章事件抽取失败（人物/关系照常保留）：${e.message}`);
    }
    const merged = { ...draft, events: evDraft.events || [] };
    state.results[key] = merged;
    mergeInto(book, merged);
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
    ok++;
    console.log(`✓ [${ok + fail}/${picks.length}] 第${ch.no}章 ${ch.title.slice(0, 18)}：${(draft.characters || []).length}人/${(draft.relations || []).length}关系/${(merged.events || []).length}事件（累计 ${book.characters.length}人/${book.relations.length}关系/${book.events.length}事件，${Math.round((Date.now() - t0) / 1000)}s）`);
  } catch (e) {
    fail++;
    console.error(`✗ 第${ch.no}章 ${ch.title.slice(0, 18)}：${e.message}`);
  }
  done.add(idx);
}

const queue = picks.filter((idx) => {
  if (state.results[String(idx)]) { ok++; done.add(idx); return false; }
  return true;
});
if (ok) console.log(`▶ 已有 ${ok} 章结果，跳过`);

const workers = Array.from({ length: Math.min(jobs, queue.length) }, (_, w) => (async () => {
  for (let i = w; i < queue.length; i += Math.min(jobs, queue.length)) {
    await runChapter(queue[i], w + 1);
  }
})());
await Promise.all(workers);

/* ---------------- 写书 ---------------- */
if (!dry) {
  book.meta.updated = new Date().toISOString().slice(0, 10);
  book.meta.chapters = book.meta.chapters || chapters.length;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(book, null, 2) + '\n', 'utf8');
  console.log(`\n✅ 已写出 ${path.relative(process.cwd(), outFile)}：${book.characters.length} 人 / ${book.relations.length} 关系 / ${book.events.length} 事件 / ${book.places.length} 地点`);
  console.log(`📌 下一步：node scripts/assign-phases.mjs ${path.relative(process.cwd(), outFile)} --write && node scripts/validate.mjs ${path.relative(process.cwd(), outFile)}`);
}
console.log(`\n本轮：成功 ${ok} / 失败 ${fail}（状态文件可续跑；删掉即重跑）`);
