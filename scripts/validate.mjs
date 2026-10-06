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
  errors = 0; warns = 0;                 // 每个文件单独计数（--all 时不要累加）
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
  const ids = new Set();  const names = new Map();
  for (const c of chars) {
    const where = `角色 ${c.id || '(无 id)'}`;
    req(c, 'id', where); req(c, 'name', where);
    if (typeof c.generation !== 'number') err(`${where} generation 必须是数字`);
    for (const k of ['faction', 'title', 'desc', 'fate']) {
      const v = c?.[k];
      if (v === undefined || v === null || v === '') {
        warn(`${where} 缺少 ${k}${k === 'faction' ? '（图上不会有阵营色）' : '（档案里会空着，建议补一句）'}`);
      }
    }
    if (!c.gender || !['m', 'f'].includes(c.gender)) warn(`${where} 缺少 gender（m/f）——用于形状区分男女`);
    if (typeof c.firstCh !== 'number') warn(`${where} 缺少 firstCh（首次出场章）——剧透保护要用`);
    if (c.tier && !['main', 'minor', 'mentioned'].includes(c.tier)) warn(`${where} 的 tier「${c.tier}」不合法（main | minor | mentioned）`);    if (c.faction && !factions.has(c.faction)) err(`${where} 的 faction「${c.faction}」未在 factions 中定义`);
    if (ids.has(c.id)) err(`角色 id 重复：${c.id}`);
    ids.add(c.id);
    const n = names.get(c.name) || [];
    n.push(c.id); names.set(c.name, n);
  }
  for (const [name, list] of names) if (list.length > 1) warn(`角色名重复：${name}（${list.join(', ')}）——记得用 note 写清消歧提示`);

  /* ---------- v0.94：血缘必须可核对（parents 字段 + 双向一致检查） ----------
   *
   * 为什么加这个字段：本项目的数据模型里**没有"父母"字段**，父子关系只是一条普通 relations 边。
   * 后果就是漏一条边**没有任何机制会发现它** —— 只能靠人记得加。已经被用户抓到过：
   * 「奥雷里亚诺·布恩迪亚上校」和「奥雷里亚诺第二 / 何塞·阿尔卡蒂奥第二 / 美人儿蕾梅黛丝」
   * 明明是叔侄，图上一条线都没有；而 validate.mjs 当时一声不响（关系表是自洽的，
   * 它只检查"边的两端存在"，没法检查"该有的边在不在"）。
   *
   * 有了 `parents: []`，"该有的边在不在"就变成可判定的：
   *   正向：parents 里的每个 id，都必须有一条父子边
   *   反向：有父子边的两个人，必须在双方的 parents/children 里登记
   * 这样血缘由**结构化字段声明**，边可以由脚本派生，而不是手工维护一堆看不见全貌的边。
   *
   * 字段可选（没填不报错，只提示），这样老数据不会因为加字段而红一片；
   * 但**填了就要一致** —— 半填比不填更危险。
   */
  /* 亲子边判定：只认"父母 ↔ 子女"这条轴。
   * 先把旁系/姻亲词剔掉再判，否则「婆媳（无名的儿媳）」「外祖母与外孙女」
   * 「同母异父的兄弟（也是堂兄弟）」「岳母」全都会被误判成亲子边 —— 那样警告会变成噪声，
   * 而噪声是"让人忽略警告"的根源（这正是 `kin.mjs` 里 NOT_KIN 干的事，这里是同一类问题）。 */
  const COLLATERAL = /外祖母|外孙女|外祖父|外孙|婆媳|儿媳|儿媳妇|女婿|媳妇|岳母|岳父|岳丈|祖母|祖父|岳|姑|舅|叔|伯|侄|甥|兄弟|姐妹|兄妹|姐弟|堂兄|堂弟|表兄|表姐|孪生/g;
  const isParentEdge = (t) => {
    const s = String(t || '').replace(COLLATERAL, '');
    return /父子|父女|母子|母女|父母/.test(s)
      || /父[儿女子女]/.test(s) || /母[儿女子女]/.test(s) || /[儿女子女][父母]/.test(s);
  };
  const relList = book.relations || [];
  const parentEdge = (a, b) => relList.some((r) =>
    (r.from === a && r.to === b || r.from === b && r.to === a) && isParentEdge(r.type));
  const byId = new Map(chars.map((c) => [c.id, c]));
  let parentsDeclared = 0;
  for (const c of chars) {
    const ps = c.parents;
    if (ps === undefined || ps === null) continue;
    if (!Array.isArray(ps)) { err(`角色 ${c.id} 的 parents 必须是数组（没填就整个字段省略，别写 null/字符串）`); continue; }
    parentsDeclared++;
    for (const pid of ps) {
      if (!byId.has(pid)) { err(`角色 ${c.id} 的 parents 里「${pid}」不是本书人物 id`); continue; }
      if (!parentEdge(c.id, pid)) {
        err(`角色 ${c.name} 声明了父母 ${byId.get(pid).name}，但图上没有他们之间的亲子边 —— 声明与关系不一致`);
      }
    }
  }
  // 反向：有亲子边但没在 parents 里登记（只提示，且只在已经有人在填 parents 时才提示）
  if (parentsDeclared) {
    for (const r of relList) {
      if (!isParentEdge(r.type)) continue;
      const p = byId.get(r.from), k = byId.get(r.to);
      if (!p || !k) continue;
      const kHas = Array.isArray(k.parents) && k.parents.includes(p.id);
      const pHas = Array.isArray(p.parents) && p.parents.includes(k.id);
      if (!kHas && !pHas) warn(`亲子边 ${p.name} —${r.type}→ ${k.name} 双方都没有用 parents 登记 —— 建议在子女那侧写 parents（长辈那侧写 children）`);
    }
  }
  console.log(`  ℹ 血缘声明：${parentsDeclared}/${chars.length} 个人物填了 parents（填了就会双向校验一致性）`);

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
  // 数据格式版本：让以后改 schema 时能识别老数据
  const SCHEMA = 2;
  const sv = book.meta && book.meta.schemaVersion;
  if (sv === undefined) warn('meta.schemaVersion 缺失（当前格式建议写 2）');
  else if (typeof sv !== 'number' || sv < 1) warn(`meta.schemaVersion「${sv}」不合法（应为正整数）`);
  else if (sv > SCHEMA) warn(`meta.schemaVersion=${sv} 比本工具支持的 ${SCHEMA} 新——升级脚本再跑`);
  const metaNow = book.meta || {};
  if (metaNow.prophecy && !metaNow.prophecySrc) warn('meta.prophecy 写了「一句话」但缺 prophecySrc（页脚会没有出处）');
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
    // 时间区间（时间旅行用）：fromCh＝成立章、toCh＝结束章（独占）
    if (r.fromCh !== undefined && (!Number.isInteger(r.fromCh) || r.fromCh < 1)) err(`${where} 的 fromCh 必须是 ≥1 的整数`);
    if (r.toCh !== undefined && (!Number.isInteger(r.toCh) || r.toCh < 1)) err(`${where} 的 toCh 必须是 ≥1 的整数`);
    if (typeof r.fromCh === 'number' && typeof r.toCh === 'number' && r.toCh <= r.fromCh) {
      err(`${where} 的 toCh（${r.toCh}）必须大于 fromCh（${r.fromCh}）——区间是 [fromCh, toCh)`);
    }
    if (typeof r.fromCh === 'number' || typeof r.toCh === 'number') {
      const lo = typeof r.fromCh === 'number' ? r.fromCh : 0;
      const hi = typeof r.toCh === 'number' ? r.toCh - 1 : Infinity;
      for (const e of r.events || []) {
        const n = (String(e.chapter || '').match(/\d+/) || [null])[0];
        if (n === null) continue;
        const num = Number(n);
        if (num < lo || num > hi) warn(`${where} 的第 ${num} 章事件落在时间区间 [${lo}, ${hi === Infinity ? '∞' : hi}] 之外（时间旅行时这条事件看不到）`);
      }
    }
  }

  // ---------- 重复关系（同一对人物 + 同一类型画多条线，图上会扇开成重复线）----------
  {
    const groups = new Map();
    for (const r of rels) {
      const k = `${[r.from, r.to].sort().join('|')}||${(r.type || '').trim()}`;
      (groups.get(k) || groups.set(k, []).get(k)).push(r);
    }
    for (const [k, members] of groups) {
      if (members.length < 2) continue;
      // 允许"阶段关系"（区间之间有空档，如同盟→分裂→再同盟）；连续/无区间的重复要合并
      const periods = members.map((r) => ({ from: r.fromCh || 0, to: r.toCh || Infinity }));
      const sorted = [...periods].sort((a, b) => a.from - b.from);
      let reach = sorted[0].from, gap = false;
      for (const p of sorted) { if (p.from > reach) { gap = true; break; } reach = Math.max(reach, p.to); }
      if (gap) continue;
      const [pair, type] = k.split('||');
      err(`关系重复：${pair.split('|').join(' ↔ ')} 的「${type}」有 ${members.length} 条（区间连续或未标区间）——图上会画出重复线，跑 node scripts/merge-duplicate-relations.mjs 合并`);
    }
  }

  // ---------- 阵营变化（factionHistory）----------
  for (const c of chars) {
    const h = c.factionHistory;
    if (!h) continue;
    if (!Array.isArray(h) || !h.length) { err(`角色 ${c.id} 的 factionHistory 必须是数组`); continue; }
    let last = -1;
    for (const seg of h) {
      if (!seg || !factions.has(seg.faction)) err(`角色 ${c.id} 的 factionHistory 引用了未定义的阵营「${seg && seg.faction}」`);
      if (typeof seg.fromCh !== 'number') err(`角色 ${c.id} 的 factionHistory 缺少 fromCh（第几章起）`);
      else if (seg.fromCh < last) err(`角色 ${c.id} 的 factionHistory 没有按 fromCh 升序`);
      else last = seg.fromCh;
    }
    const finalSeg = h[h.length - 1];
    if (finalSeg && finalSeg.faction !== c.faction) {
      warn(`角色 ${c.id} 最后一段阵营（${finalSeg.faction}）与 faction（${c.faction}）不一致——final 归属应当等于最后一段`);
    }
  }
  const withHist = chars.filter((c) => Array.isArray(c.factionHistory) && c.factionHistory.length > 1);
  if (withHist.length) console.log(`  ℹ 阵营变化人物：${withHist.length} 人（${withHist.slice(0, 6).map((c) => c.name).join('、')}${withHist.length > 6 ? ' …' : ''}）`);

  // ---------- 效力变化（lordHistory：旧主 → 新主）----------
  const charIds = new Set(chars.map((c) => c.id));
  for (const c of chars) {
    const h = c.lordHistory;
    if (!h) continue;
    if (!Array.isArray(h) || !h.length) { err(`角色 ${c.id} 的 lordHistory 必须是数组`); continue; }
    let last = -1;
    for (const seg of h) {
      if (!seg) { err(`角色 ${c.id} 的 lordHistory 有空条目`); continue; }
      if (seg.lord && !charIds.has(seg.lord)) err(`角色 ${c.id} 的 lordHistory 引用了不存在的人物「${seg.lord}」`);
      if (seg.lord === c.id) err(`角色 ${c.id} 的 lordHistory 把自己当主公了`);
      if (typeof seg.fromCh !== 'number') err(`角色 ${c.id} 的 lordHistory 缺少 fromCh`);
      else if (seg.fromCh < last) err(`角色 ${c.id} 的 lordHistory 没有按 fromCh 升序`);
      else last = seg.fromCh;
    }
  }
  const withLord = chars.filter((c) => Array.isArray(c.lordHistory) && c.lordHistory.length > 1);
  if (withLord.length) console.log(`  ℹ 换过主公的人物：${withLord.length} 人（${withLord.slice(0, 6).map((c) => c.name).join('、')}${withLord.length > 6 ? ' …' : ''}）`);

  // ---------- 别名覆盖（搜索命中率）----------
  // 读者习惯用「字/号/俗称/自己那版译名」搜——没有别名就等于搜不到。
  // 只对"有关系、关系不少、却一个别名都没有"的人物提示（次要人物不苛求）。
  const relCount = new Map();
  for (const r of rels) { relCount.set(r.from, (relCount.get(r.from) || 0) + 1); relCount.set(r.to, (relCount.get(r.to) || 0) + 1); }
  const noAlias = chars.filter((c) => !(c.aliases || []).length && (relCount.get(c.id) || 0) >= 8);
  if (noAlias.length) {
    const names = noAlias.slice(0, 6).map((c) => `${c.name}(${relCount.get(c.id)})`).join('、');
    warn(`${noAlias.length} 个主要人物没有任何别名（${names}${noAlias.length > 6 ? ' …' : ''}）——建议补字号/俗称/异体译名，否则按俗称搜不到（跑 node scripts/audit-search.mjs 看全量报告）`);
  }

  // ---------- altNames 卫生 + 名字形式跨人物冲突 ----------
  /* v0.97。三条都是**纯数据错误**（不是"建议"），所以用 err 而不是 warn：
   *   ① altNames 里有空串 / 和主名一样 / 字段内重复 —— 前两个是手滑，第三个是复制粘贴没去重。
   *      「又译 X」显示在主名旁边，写成「又译 维希塔香」等于什么都没说。
   *   ② 同一个名字形式挂在两个人物身上 —— 搜索会落到其中任意一个，读者点错人。
   *      译名里"布恩蒂亚"这种姓氏共有是正常的，所以只在**完整形式**相同时才报。
   *
   * ⚠ 这里**查不出**"别名写错了"（《百年孤独》7 个人物全错那类）——
   *   那种错要拿原著 epub 才知道，见
   *   `node scripts/audit-against-text.mjs --all .text/ --names`。
   *   写在这里是为了别让人误以为 validate 能管这件事。 */
  {
    const errs = [];
    const clashes = new Map();
    for (const c of chars) {
      const alt = c.altNames || [];
      if (alt.some((x) => typeof x !== 'string' || !x.trim())) errs.push(`${c.name} 的 altNames 里有空值`);
      if (alt.includes(c.name)) errs.push(`${c.name} 的 altNames 里出现了自己的主名（等于「又译」自己）`);
      const inner = alt.filter((x) => typeof x === 'string').filter((x, i, a) => a.indexOf(x) !== i);
      if (inner.length) errs.push(`${c.name} 的 altNames 内部重复：${[...new Set(inner)].join('、')}`);
      for (const f of new Set([c.name, ...(c.aliases || []), ...alt])) {
        /* ⚠ 两处过滤都是踩过才知道的：
         *   ① **按人去重**（new Set）。第一版没去重，于是同一个人「既写进 aliases 又写进
         *      altNames」的正常情况被判成"两个人撞名"，报出 11 条里 9 条假警报。
         *   ② **长度 ≥3**。「明公」「丞相」「魏王」这类两字称号挂在多个人物上是正常的
         *      （《三国演义》一下报 23 条），真正要抓的是**完整姓名**撞车。 */
        if (typeof f !== 'string' || f.length < 3) continue;
        if (!clashes.has(f)) clashes.set(f, []);
        clashes.get(f).push(c.name);
      }
    }
    for (const m of errs) err(m);
    const dupForms = [...clashes.entries()].filter(([, who]) => who.length > 1);
    if (dupForms.length) {
      const show = dupForms.slice(0, 5).map(([f, who]) => `${f}（${[...new Set(who)].join(' / ')}）`).join('；');
      warn(`${dupForms.length} 个名字形式挂在多个人物上：${show}${dupForms.length > 5 ? ' …' : ''}——搜到它会落到其中任意一个，读者可能点错人`);
    }
  }

  // ---------- 亲子方向（成环 = 方向写反了）----------
  {
    const PARENT_CHILD = /^(亲生)?(父|母)(子|女)$|^养(父|母)(子|女)$/;
    const adj = new Map();
    for (const r of rels) {
      if (!PARENT_CHILD.test(String(r.type || '').replace(/[（(].*$/, '').trim())) continue;
      if (!adj.has(r.from)) adj.set(r.from, []);
      adj.get(r.from).push(r.to);
    }
    const color = new Map(); const cycles = [];
    const dfs = (u, stack) => {
      color.set(u, 1); stack.push(u);
      for (const v of adj.get(u) || []) {
        if (color.get(v) === 1) { const i = stack.indexOf(v); cycles.push(stack.slice(i).concat(v).map((x) => (chars.find((c) => c.id === x) || {}).name || x).join(' → ')); }
        else if (!color.get(v)) dfs(v, stack);
      }
      stack.pop(); color.set(u, 2);
    };
    for (const k of adj.keys()) if (!color.get(k)) dfs(k, []);
    for (const cy of [...new Set(cycles)].slice(0, 5)) warn(`亲子关系成环（多半是方向写反了）：${cy}——跑 node scripts/fix-parent-cycles.mjs`);
  }

  const phases = new Set((book.phases || []).map((p) => p.id));
  if (!phases.size) err('phases 为空');
  const events = book.events || [];
  if (!events.length) err('events 为空');
  const evIds = new Set();
  for (const e of events) {
    const where = `事件 ${e.id || '(无 id)'}`;
    req(e, 'id', where); req(e, 'name', where); req(e, 'summary', where); req(e, 'impact', where);    if (evIds.has(e.id)) err(`事件 id 重复：${e.id}`);
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
  // 时间区间（时间旅行）
  const periodRels = rels.filter((r) => typeof r.fromCh === 'number' || typeof r.toCh === 'number');
  if (periodRels.length) {
    const closed = periodRels.filter((r) => typeof r.toCh === 'number').length;
    console.log(`  ℹ 时间区间 ${periodRels.length} 条（其中 ${closed} 条有结束章）——时间旅行会按章只画当时那一段`);
  }

  // ---------- 文案规范检查（v0.3 起：防「主语跳来跳去 / 称谓不明 / 提到的人不在 chars 里」） ----------
  const KIN_WORD = /(哥哥|弟弟|姐姐|妹妹|父亲|母亲|儿子|女儿|丈夫|妻子|叔叔|姑姑|侄子|侄女|祖父|祖母|外公|外婆|曾祖|孙子|孙女)/;
  /* ---------- v0.129：别名里挂在 2+ 人身上的那些，不参与"文案提到谁"的匹配 ----------
   *
   * 为什么要改判据（这是改**工具**不是改数据，理由是判据本身错了）：
   *
   * 这条检查问的是「文案里提到的人，是不是漏进 `chars` 了」。
   * 要回答这个问题，靠的必须是**能指认某个人**的名字形式。
   *
   * 而「太后」「丞相」「都督」「魏王」「大将军」「陈留王」这类**不是人名** ——
   * 它们是官职/朝代号，原文里同一回里可以指好几个人，甚至指事件主角以外的人：
   *   · e-44-2「封**瑜**为大都督」  → 都督是**周瑜**，但那条告警说的是「司马懿」
   *   · e-120-4「命**杜预**为大都督」→ 都督是杜预，告警说的是「司马懿」和「周瑜」
   *   · e-79-6「禅位于魏王**曹丕**」→ 魏王是曹丕，告警说的是「曹操」
   *   · e-107-4「**魏主曹芳**封…」   → 魏主是曹芳，同一回里报出 曹丕/曹睿/曹髦/曹奂 四条
   *
   * ⇒ 三国书 43 条「文案提到 X 但 chars 未包含」**全部**是这类误报，
   *   逐条核过，一条真漏都没有。
   *
   * ## 判据怎么定（自维护，不手维护官职表）
   *
   * ★ **一个别名如果挂在 2 个以上人物身上，它就不可能是"指认某个人"的名字形式** ——
   *   不管它是官职（丞相/都督）、朝号（魏王/陈留王）、并称（二夫人）、
   *   还是两个人本来就同名的字（奉孝=郭嘉/刘理、公明=徐晃/管辂）。
   *   用它去判断"文案提到了谁"必然出错。
   *
   * ⇒ 所以直接按"这个别名挂在几个人身上"来筛，**不维护官职词表**（那会烂掉）。
   *
   * ## 但**本名**即使重名也保留在匹配里
   *
   * 「王颀」有两个（v0.121 定性为原文里就同名）、「吴氏」也有两个。
   * 这时文案提到「王颀」，**两个都该在 chars 里**（或都不该），
   * 报出来是有意义的 ⇒ 本名不参与这个筛选。
   */
  const aliasOwners = new Map();
  for (const c of chars) {
    for (const a of c.aliases || []) {
      if (!a) continue;
      if (!aliasOwners.has(a)) aliasOwners.set(a, new Set());
      aliasOwners.get(a).add(c.id);
    }
  }
  const sharedAliases = new Set([...aliasOwners].filter(([, who]) => who.size > 1).map(([a]) => a));
  const nameIndex = chars.map((c) => ({
    id: c.id,
    // 本名恒保留；别名只留**独享**的
    n: [c.name, ...(c.aliases || [])].filter((x) => x && !sharedAliases.has(x)),
  }));
  const hasName = (text) => nameIndex.some((x) => x.n.some((nn) => text.includes(nn)));
  const sentences = (s) => String(s || '').split(/[。；！？]/).map((x) => x.trim()).filter(Boolean);
  const firstSentence = (s) => sentences(s)[0] || '';
  /* v0.129：共用称谓命中记账（这些不报"漏人"，但要看得见） */
  const skippedShared = [];

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
    /* 用了共用称谓的，**不报但要记账** —— 静默跳过会让"改好了"和"没检查"看起来一样。
     * 顺手把原文那句记下来，好让最后那条提示能举**本书真实**的例子，而不是写死某一本的。 */
    for (const a of sharedAliases) {
      if (mentions(a)) skippedShared.push({ where, form: a, text });
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
  /* v0.129：把"跳过了什么"显式打出来 —— 静默跳过会让"改好了"和"没检查"长得一样 */
  if (sharedAliases.size) {
    const byForm = new Map();
    for (const s of skippedShared) byForm.set(s.form, (byForm.get(s.form) || 0) + 1);
    const top = [...byForm].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([f, n]) => `${f}×${n}`).join('、');
    console.log(`  ℹ 共用称谓 ${sharedAliases.size} 个（挂在 2+ 人身上，不是"指认某个人"的名字形式）`
      + `，已跳过人物匹配：${[...sharedAliases].slice(0, 10).join('、')}${sharedAliases.size > 10 ? ' …' : ''}`);
    console.log(`    本书文案里实际命中 ${skippedShared.length} 处（${top || '无'}）`);
    /* 举**本书真实**的一例（不写死某一本 —— 否则换一本书这句话就变成假话） */
    const one = skippedShared.find((s) => byForm.get(s.form) === Math.max(...byForm.values()));
    if (one) {
      const at = one.text.indexOf(one.form);
      const around = one.text.slice(Math.max(0, at - 8), at + one.form.length + 8);
      const owners = [...aliasOwners.get(one.form)]
        .map((id) => (chars.find((c) => c.id === id) || {}).name).join('、');
      console.log(`    ⚠ 这些**不能**用来判断"漏没漏人"：${one.where}「…${around}…」里的「${one.form}」`
        + `同时挂在 ${owners} 身上，光看它指不出是谁。`);
    }
  }
}

const args = process.argv.slice(2);
if (!args.length || args[0] === '--all') {
  // 只校验 data/books.json 里登记的那些整本数据。
  // v85 起 data/ 里多了 <slug>.graph.json / <slug>.text.json 两份**生成物**
  // （由 scripts/make-slim-packs.mjs 从整本拆出来），它们本来就缺 text/summary 这类字段，
  // 拿它们当整本校验会报一堆假错误。以 books.json 为准，不扫目录。
  const dir = path.join(process.cwd(), 'data');
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'books.json'), 'utf8'));
  const files = (idx.books || []).map((b) => path.join(dir, `${b.slug}.json`)).filter((f) => fs.existsSync(f));
  files.forEach(validate);
} else {
  args.filter((a) => !a.startsWith('--')).forEach((a) => validate(a));
}
console.log('');
process.exit(errors ? 1 : 0);
