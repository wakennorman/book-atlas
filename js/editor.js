/* 书脉 BookAtlas · 本地编辑器
 * 纯本地：草稿存 localStorage（键 ba-draft-<slug>），可导出 JSON 放进 data/ 使用。
 */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 7)}`;
  const slugify = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '') || 'book';
  const setPath = (obj, path, val) => {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (cur[k] === undefined || cur[k] === null) cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      cur = cur[k];
    }
    cur[keys[keys.length - 1]] = val;
  };

  const ed = { book: null, section: 'meta', form: null, editing: null, sourceLocal: false, sourceFile: '', timer: null };

  /* ---------------- 数据源 ---------------- */
  async function boot() {
    const sel = $('#ed-source');
    let books = [];
    try {
      books = (await (await fetch('data/books.json', { cache: 'no-cache' })).json()).books || [];
    } catch (e) { /* 允许纯本地使用 */ }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('ba-draft-')) continue;
      try {
        const d = JSON.parse(localStorage.getItem(k));
        const slug = d?.meta?.slug || k.replace('ba-draft-', '');
        if (!books.some((b) => b.slug === slug)) books.push({ slug, title: `${d?.meta?.title || slug}（本地草稿）`, local: true });
      } catch (e) { /* 忽略坏草稿 */ }
    }
    sel.innerHTML = books.length
      ? books.map((b) => `<option value="${esc(b.slug)}" data-local="${b.local ? 1 : 0}" data-file="${esc(b.file || '')}">${esc(b.title)}</option>`).join('')
      : '<option value="">（没有可载入的书）</option>';
    bind();
    if (books.length) await loadSource();
    else newBlank();
  }

  function setStatus(msg) { $('#ed-status').textContent = msg; }
  function toast(msg) { setStatus(msg); }

  async function loadSource() {
    const opt = $('#ed-source').selectedOptions[0];
    if (!opt || !opt.value) { newBlank(); return; }
    const slug = opt.value;
    ed.sourceLocal = opt.dataset.local === '1';
    ed.sourceFile = opt.dataset.file || '';
    if (ed.sourceLocal) loadDraft(slug);
    else {
      try {
        const book = await (await fetch(ed.sourceFile, { cache: 'no-cache' })).json();
        adopt(book, false);
      } catch (e) { toast('载入失败：' + e.message); }
    }
  }

  function loadDraft(slug) {
    try {
      const book = JSON.parse(localStorage.getItem('ba-draft-' + slug));
      if (book) adopt(book, true);
    } catch (e) { toast('草稿读取失败：' + e.message); }
  }

  function adopt(book, isLocal) {
    ed.book = normalize(book);
    ed.sourceLocal = isLocal;
    toast(`已载入《${ed.book.meta.title || '未命名'}》：${ed.book.characters.length} 人 / ${ed.book.relations.length} 关系 / ${ed.book.events.length} 事件`);
    renderAll();
  }

  function normalize(book) {
    const b = book || {};
    b.meta = { slug: '', title: '未命名', author: '', translator: '', chapters: 20, prophecy: '', note: '', license: 'CC BY-SA 4.0', updated: '', sources: [], ...(b.meta || {}) };
    b.factions = Array.isArray(b.factions) ? b.factions : [];
    b.characters = Array.isArray(b.characters) ? b.characters : [];
    b.relations = Array.isArray(b.relations) ? b.relations : [];
    b.phases = Array.isArray(b.phases) ? b.phases : [];
    b.events = Array.isArray(b.events) ? b.events : [];
    return b;
  }

  function newBlank() {
    ed.book = normalize({
      meta: { slug: uid('book'), title: '我的新书', author: '', chapters: 20 },
      factions: [
        { key: 'family', name: '家族', color: '#c99a3f' },
        { key: 'other', name: '其他', color: '#9a6fb0' }
      ],
      characters: [], relations: [], phases: [{ id: 'p1', name: '第一幕', order: 1 }], events: []
    });
    ed.sourceLocal = true;
    toast('已新建空白书（记得「保存到本地」）');
    renderAll();
  }

  function saveDraft() {
    if (!ed.book) return;
    const slug = ed.book.meta.slug = ed.book.meta.slug || slugify(ed.book.meta.title);
    ed.book.meta.updated = new Date().toISOString().slice(0, 10);
    try {
      localStorage.setItem('ba-draft-' + slug, JSON.stringify(ed.book, null, 2));
      ed.sourceLocal = true;
      setStatus(`已保存到本地：ba-draft-${slug}（共 ${ed.book.characters.length} 人 / ${ed.book.relations.length} 关系 / ${ed.book.events.length} 事件）`);
    } catch (e) { setStatus('保存失败：' + e.message); }
  }

  function autoSave() {
    clearTimeout(ed.timer);
    ed.timer = setTimeout(saveDraft, 800);
  }

  function exportJson() {
    const slug = ed.book.meta.slug || slugify(ed.book.meta.title);
    const blob = new Blob([JSON.stringify(ed.book, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`已导出 ${slug}.json —— 把它放进 data/ 并在 data/books.json 登记即可发布`);
  }

  /* ---------------- 校验 ---------------- */
  function validate() {
    const b = ed.book, issues = [];
    const ids = new Set();
    const dup = new Set();
    for (const c of b.characters) {
      if (!c.id) issues.push(`人物「${c.name || '?'}」缺少 id`);
      else if (ids.has(c.id)) dup.add(c.id);
      ids.add(c.id);
      if (!['m', 'f'].includes(c.gender)) issues.push(`人物「${c.name}」缺少性别（men/women 形状要用）`);
      if (typeof c.firstCh !== 'number') issues.push(`人物「${c.name}」缺少首次出场章 firstCh（剧透保护要用）`);
    }
    for (const id of dup) issues.push(`人物 id 重复：${id}`);
    const factionKeys = new Set(b.factions.map((f) => f.key));
    for (const c of b.characters) if (c.faction && !factionKeys.has(c.faction)) issues.push(`人物「${c.name}」的阵营「${c.faction}」未定义`);
    const phaseIds = new Set(b.phases.map((p) => p.id));
    for (const e of b.events) {
      if (typeof e.ch !== 'number') issues.push(`事件「${e.name}」缺少发生章 ch`);
      if (e.phase && !phaseIds.has(e.phase)) issues.push(`事件「${e.name}」的阶段「${e.phase}」未定义`);
      for (const cid of e.chars || []) if (!ids.has(cid)) issues.push(`事件「${e.name}」引用了不存在的人物 ${cid}`);
    }
    for (const r of b.relations) {
      if (!ids.has(r.from) || !ids.has(r.to)) issues.push(`关系 ${r.from}→${r.to} 里有人物不存在`);
      if (!Array.isArray(r.events) || !r.events.length) issues.push(`关系 ${r.from}→${r.to} 没有小事件`);
      for (const ev of r.events || []) if (ev.chapter && !/(\d+)/.test(ev.chapter)) issues.push(`关系 ${r.from}→${r.to} 的章节「${ev.chapter}」没有数字`);
    }
    return issues;
  }

  /* ---------------- 渲染 ---------------- */
  function renderAll() {
    document.querySelectorAll('#ed-nav .seg').forEach((el) => el.classList.toggle('active', el.dataset.sec === ed.section));
    renderBody();
  }

  function renderBody() {
    const f = { meta: formMeta, factions: listFactions, characters: listCharacters, relations: listRelations, phases: listPhases, events: listEvents, ai: formAi, batch: formBatch };
    $('#ed-body').innerHTML = (f[ed.section] || formMeta)();
  }

  function head(title, hint, actions) {
    return `<div class="ed-head"><div><h2>${esc(title)}</h2><p class="hint">${hint}</p></div><div class="ed-actions">${actions}</div></div>`;
  }

  /* —— 基本信息 —— */
  function formMeta() {
    const m = ed.book.meta;
    return `${head('基本信息', '书名、作者、总章数（剧透保护要用）等', `
      <button class="primary" type="button" data-act="meta-save">保存</button>
      <button class="ghost" type="button" data-tool="validate">本地校验</button>
      <button class="ghost" type="button" data-tool="cmd">复制校验命令</button>`)}
      <form data-form="meta" class="ed-form" style="border-top:none;padding-top:0">
        <div class="ed-grid">
          <label>书名<input data-field="title" value="${esc(m.title)}"></label>
          <label>slug（文件名/标识）<input data-field="slug" value="${esc(m.slug)}"></label>
          <label>作者<input data-field="author" value="${esc(m.author)}"></label>
          <label>译本/译者<input data-field="translator" value="${esc(m.translator)}"></label>
          <label>总章数<input type="number" min="0" data-field="chapters" value="${esc(m.chapters ?? 0)}"></label>
          <label>license<input data-field="license" value="${esc(m.license)}"></label>
          <label class="wide">题记/预言<input data-field="prophecy" value="${esc(m.prophecy)}"></label>
          <label class="wide">说明<textarea data-field="note">${esc(m.note)}</textarea></label>
        </div>
      </form>
      <div id="ed-validate"></div>`;
  }

  /* —— 阵营 —— */
  function listFactions() {
    const rows = ed.book.factions.map((f, i) => `
      <tr>
        <td>${esc(f.key)}</td><td>${esc(f.name)}</td>
        <td><span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${esc(f.color)}"></span> ${esc(f.color)}</td>
        <td class="ops"><button class="ghost tiny" data-act="edit" data-sec="factions" data-idx="${i}">编辑</button>
        <button class="ghost tiny" data-act="del" data-sec="factions" data-idx="${i}">删除</button></td>
      </tr>`).join('');
    return `${head('阵营', '颜色用在这里；人物/关系都按阵营着色', '<button class="primary" type="button" data-act="add" data-sec="factions">＋ 新增阵营</button>')}
      <table class="ed-table"><thead><tr><th>key</th><th>名称</th><th>颜色</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="hint">还没有阵营</td></tr>'}</tbody></table>
      ${ed.editing && ed.editing.sec === 'factions' ? formFaction() : ''}`;
  }
  function formFaction() {
    const f = ed.form, isNew = ed.editing.idx === null;
    return `<form data-form="factions" class="ed-form">
      <div class="ed-grid">
        <label>key（英文）<input data-field="key" value="${esc(f.key)}"></label>
        <label>名称<input data-field="name" value="${esc(f.name)}"></label>
        <label>颜色<input type="color" data-field="color" value="${esc(f.color || '#888888')}"></label>
      </div>
      <div class="ed-form-actions"><button class="primary" type="submit">${isNew ? '添加' : '保存'}</button><button class="ghost" type="button" data-act="cancel">取消</button></div>
    </form>`;
  }

  /* —— 人物 —— */
  function listCharacters() {
    const gen = {};
    const rows = ed.book.characters.map((c, i) => `
      <tr>
        <td>${esc(c.name)}</td><td>${esc(c.id)}</td><td>${c.generation}</td>
        <td>${c.gender === 'f' ? '女' : '男'}</td><td>${esc(c.faction || '')}</td><td>${c.firstCh ?? ''}</td>
        <td class="ops"><button class="ghost tiny" data-act="edit" data-sec="characters" data-idx="${i}">编辑</button>
        <button class="ghost tiny" data-act="del" data-sec="characters" data-idx="${i}">删除</button></td>
      </tr>`).join('');
    return `${head('人物', '形状＝性别（男圆/女圆角方），大小＝关系条数；firstCh 用于剧透保护', '<button class="primary" type="button" data-act="add" data-sec="characters">＋ 新增人物</button>')}
      <table class="ed-table"><thead><tr><th>名称</th><th>id</th><th>代际</th><th>性别</th><th>阵营</th><th>出场章</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="hint">还没有人物</td></tr>'}</tbody></table>
      ${ed.editing && ed.editing.sec === 'characters' ? formCharacter() : ''}`;
  }
  function formCharacter() {
    const c = ed.form, isNew = ed.editing.idx === null;
    const facs = ed.book.factions.map((f) => `<option value="${esc(f.key)}" ${f.key === c.faction ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    return `<form data-form="characters" class="ed-form">
      <div class="ed-grid">
        <label>名称<input data-field="name" value="${esc(c.name)}"></label>
        <label>id（拼音；留空自动生成）<input data-field="id" value="${esc(c.id || '')}"></label>
        <label>代际<input type="number" data-field="generation" value="${esc(c.generation ?? 1)}"></label>
        <label>性别<select data-field="gender"><option value="m" ${c.gender !== 'f' ? 'selected' : ''}>男</option><option value="f" ${c.gender === 'f' ? 'selected' : ''}>女</option></select></label>
        <label>首次出场章<input type="number" min="0" data-field="firstCh" value="${esc(c.firstCh ?? 1)}"></label>
        <label>阵营<select data-field="faction"><option value="">（无）</option>${facs}</select></label>
        <label>身份/头衔<input data-field="title" value="${esc(c.title || '')}"></label>
        <label class="wide">别名（逗号分隔）<input data-field="aliases" value="${esc((c.aliases || []).join('，'))}"></label>
        <label class="wide">一句话描述<textarea data-field="desc">${esc(c.desc || '')}</textarea></label>
        <label class="wide">结局<textarea data-field="fate">${esc(c.fate || '')}</textarea></label>
        <label class="wide">易混提示 note<textarea data-field="note">${esc(c.note || '')}</textarea></label>
      </div>
      <div class="ed-form-actions"><button class="primary" type="submit">${isNew ? '添加' : '保存'}</button><button class="ghost" type="button" data-act="cancel">取消</button></div>
    </form>`;
  }

  /* —— 关系 —— */
  function relName(id) { return (ed.book.characters.find((c) => c.id === id) || {}).name || id; }
  function listRelations() {
    const rows = ed.book.relations.map((r, i) => `
      <tr>
        <td>${esc(relName(r.from))} —<b>${esc(r.type)}</b>— ${esc(relName(r.to))}</td>
        <td>${esc(r.style || '')}</td>
        <td>${(r.events || []).length}</td>
        <td class="ops"><button class="ghost tiny" data-act="edit" data-sec="relations" data-idx="${i}">编辑</button>
        <button class="ghost tiny" data-act="del" data-sec="relations" data-idx="${i}">删除</button></td>
      </tr>`).join('');
    return `${head('关系', '每条关系都要有「定义关系的小事件」；章节号供剧透保护', '<button class="primary" type="button" data-act="add" data-sec="relations">＋ 新增关系</button>')}
      <table class="ed-table"><thead><tr><th>关系</th><th>线型</th><th>小事件</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="hint">还没有关系</td></tr>'}</tbody></table>
      ${ed.editing && ed.editing.sec === 'relations' ? formRelation() : ''}`;
  }
  function charOptions(sel) {
    return ed.book.characters.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  }
  function formRelation() {
    const r = ed.form, isNew = ed.editing.idx === null;
    const evs = (r.events || []).map((ev, i) => `
      <div class="ed-sub-row">
        <input data-field="events.${i}.text" value="${esc(ev.text || '')}" placeholder="看着不起眼、却定义这段关系的小事件">
        <input class="ch" data-field="events.${i}.chapter" value="${esc(ev.chapter || '')}" placeholder="第X章">
        <button type="button" class="ghost tiny" data-act="rel-del-event" data-idx="${i}">删</button>
      </div>`).join('');
    return `<form data-form="relations" class="ed-form">
      <div class="ed-grid">
        <label>人物 A<select data-field="from">${charOptions(r.from)}</select></label>
        <label>人物 B<select data-field="to">${charOptions(r.to)}</select></label>
        <label>关系名<input data-field="type" value="${esc(r.type)}" placeholder="兄弟 / 情人 / 仇敌…"></label>
        <label>线型<select data-field="style">
          <option value="solid" ${r.style === 'solid' ? 'selected' : ''}>实线（亲缘/同盟）</option>
          <option value="dashed" ${r.style === 'dashed' ? 'selected' : ''}>虚线（对立/伤害）</option>
          <option value="dotted" ${r.style === 'dotted' ? 'selected' : ''}>点线（情人/过去/间接）</option>
        </select></label>
      </div>
      <div class="ed-sub">
        <div class="ed-sub-head">定义关系的小事件 <button type="button" class="ghost tiny" data-act="rel-add-event">＋ 加一条</button></div>
        ${evs || '<p class="hint">至少加一条（写完读起来才知道这两人的关系是怎么来的）</p>'}
      </div>
      <div class="ed-form-actions"><button class="primary" type="submit">${isNew ? '添加' : '保存'}</button><button class="ghost" type="button" data-act="cancel">取消</button></div>
    </form>`;
  }

  /* —— 阶段 —— */
  function listPhases() {
    const rows = ed.book.phases.map((p, i) => `
      <tr><td>${esc(p.id)}</td><td>${esc(p.name)}</td><td>${p.order}</td>
      <td class="ops"><button class="ghost tiny" data-act="edit" data-sec="phases" data-idx="${i}">编辑</button>
      <button class="ghost tiny" data-act="del" data-sec="phases" data-idx="${i}">删除</button></td></tr>`).join('');
    return `${head('阶段', '事件轴按阶段分组（没有年份的书用阶段＋顺序，不要编年份）', '<button class="primary" type="button" data-act="add" data-sec="phases">＋ 新增阶段</button>')}
      <table class="ed-table"><thead><tr><th>id</th><th>名称</th><th>顺序</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="hint">还没有阶段</td></tr>'}</tbody></table>
      ${ed.editing && ed.editing.sec === 'phases' ? formPhase() : ''}`;
  }
  function formPhase() {
    const p = ed.form, isNew = ed.editing.idx === null;
    return `<form data-form="phases" class="ed-form">
      <div class="ed-grid">
        <label>id<input data-field="id" value="${esc(p.id || '')}"></label>
        <label>名称<input data-field="name" value="${esc(p.name)}"></label>
        <label>顺序<input type="number" data-field="order" value="${esc(p.order ?? 1)}"></label>
      </div>
      <div class="ed-form-actions"><button class="primary" type="submit">${isNew ? '添加' : '保存'}</button><button class="ghost" type="button" data-act="cancel">取消</button></div>
    </form>`;
  }

  /* —— 事件 —— */
  function listEvents() {
    const rows = ed.book.events.map((e, i) => {
      const ph = (ed.book.phases.find((p) => p.id === e.phase) || {}).name || '';
      return `<tr>
        <td>${esc(ph)} · ${e.order}</td><td>${esc(e.name)}</td><td>${e.ch ?? ''}</td><td>${(e.chars || []).length}</td>
        <td class="ops"><button class="ghost tiny" data-act="edit" data-sec="events" data-idx="${i}">编辑</button>
        <button class="ghost tiny" data-act="del" data-sec="events" data-idx="${i}">删除</button></td></tr>`;
    }).join('');
    return `${head('事件', '重大事件轴上的卡片；ch＝发生章（剧透保护），chars＝涉及人物', '<button class="primary" type="button" data-act="add" data-sec="events">＋ 新增事件</button>')}
      <table class="ed-table"><thead><tr><th>阶段·顺序</th><th>名称</th><th>章</th><th>涉及</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="hint">还没有事件</td></tr>'}</tbody></table>
      ${ed.editing && ed.editing.sec === 'events' ? formEvent() : ''}`;
  }
  function formEvent() {
    const e = ed.form, isNew = ed.editing.idx === null;
    const phases = ed.book.phases.map((p) => `<option value="${esc(p.id)}" ${p.id === e.phase ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const chars = ed.book.characters.map((c) => `<label class="ed-chk"><input type="checkbox" data-multi="chars" value="${esc(c.id)}" ${(e.chars || []).includes(c.id) ? 'checked' : ''}>${esc(c.name)}</label>`).join('');
    return `<form data-form="events" class="ed-form">
      <div class="ed-grid">
        <label>事件名<input data-field="name" value="${esc(e.name)}"></label>
        <label>阶段<select data-field="phase">${phases}</select></label>
        <label>顺序<input type="number" data-field="order" value="${esc(e.order ?? 1)}"></label>
        <label>发生章 ch<input type="number" min="0" data-field="ch" value="${esc(e.ch ?? 1)}"></label>
        <label class="wide">概述 summary<textarea data-field="summary">${esc(e.summary || '')}</textarea></label>
        <label class="wide">影响 impact<textarea data-field="impact">${esc(e.impact || '')}</textarea></label>
        <label class="wide">引文 quote（可空）<input data-field="quote" value="${esc(e.quote || '')}"></label>
        <div class="wide"><div class="hint" style="margin-bottom:4px">涉及人物</div><div class="ed-chars">${chars || '<span class="hint">先去「人物」里加人</span>'}</div></div>
      </div>
      <div class="ed-form-actions"><button class="primary" type="submit">${isNew ? '添加' : '保存'}</button><button class="ghost" type="button" data-act="cancel">取消</button></div>
    </form>`;
  }

  /* —— AI 草稿（浏览器直连 OpenAI 兼容端点；Key 只存本机） —— */
  const AI_SCHEMA = `{
  "meta": { "title": "", "author": "", "chapters": 20, "note": "" },
  "factions": [{ "key": "", "name": "", "color": "#hex" }],
  "characters": [{ "id": "拼音-kebab", "name": "", "aliases": [], "generation": 1, "gender": "m|f", "firstCh": 1, "faction": "", "title": "", "desc": "", "fate": "", "note": "" }],
  "relations": [{ "from": "id", "to": "id", "type": "", "style": "solid|dashed|dotted", "events": [{ "text": "", "chapter": "第X章" }] }],
  "phases": [{ "id": "p1", "name": "", "order": 1 }],
  "events": [{ "id": "e1", "phase": "p1", "order": 1, "ch": 1, "name": "", "chars": ["id"], "summary": "", "impact": "", "quote": "" }]
}`;

  function formAi() {
    const key = localStorage.getItem('ba-ai-key') || '';
    const base = localStorage.getItem('ba-ai-base') || 'https://api.deepseek.com/v1';
    const model = localStorage.getItem('ba-ai-model') || 'deepseek-chat';
    return `${head('AI 草稿', '粘贴原文 → AI 按 schema 出草稿 → 人工校对后才算数（Key 只存在这台浏览器里）',
      '<button class="primary" type="button" data-tool="ai-generate">生成草稿</button>')}
      <div class="ed-grid">
        <label>API 地址（OpenAI 兼容）<input id="ai-base" value="${esc(base)}"></label>
        <label>API Key<input id="ai-key" type="password" value="${esc(key)}" placeholder="sk-...（只存 localStorage）"></label>
        <label>模型<input id="ai-model" value="${esc(model)}"></label>
      </div>
      <label class="wide" style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--muted);margin-top:10px">原文节选（建议粘贴要整理的那几章；不粘也能生成，但错误会明显更多）
        <textarea id="ai-text" style="min-height:150px" placeholder="把电子书里的一章或几章粘贴到这里…"></textarea></label>
      <div id="ai-out" class="ed-msg"></div>`;
  }

  async function generateDraft() {
    const base = (($('#ai-base') || {}).value || '').trim().replace(/\/$/, '');
    const key = (($('#ai-key') || {}).value || '').trim();
    const model = (($('#ai-model') || {}).value || '').trim() || 'deepseek-chat';
    const text = (($('#ai-text') || {}).value || '').trim();
    const out = $('#ai-out');
    if (!out) return;
    if (!key) { out.className = 'ed-msg bad'; out.textContent = '请先填 API Key（只存在本机浏览器，不会上传别处）'; return; }
    try {
      localStorage.setItem('ba-ai-key', key);
      localStorage.setItem('ba-ai-base', base);
      localStorage.setItem('ba-ai-model', model);
    } catch (e) { /* 忽略 */ }
    out.className = 'ed-msg';
    out.textContent = '正在生成…（长文本可能要 1–2 分钟，请勿关闭页面）';
    const system = '你是文学作品的资料整理员，为「人物关系 + 事件时间轴」应用生成数据草稿。硬性要求：严格输出 JSON（不要 markdown 围栏、不要解释）；人物 25–45 个；关系 40–75 条且每条至少 1 个「定义关系的小事件」并尽量给章节；事件 18–30 个并按 5–8 个阶段分组；没有明确年份就禁止编造年份，用 phase+order 排序；style 约定 solid=亲缘/同盟、dashed=对立/伤害、dotted=情人/过去/间接；易混同名人物在 note 里写消歧提示；全部字段中文，id 用拼音 kebab-case。';
    const user = `请为《${ed.book.meta.title || '未命名'}》生成数据草稿。\n\nJSON schema（必须完全遵循）：\n${AI_SCHEMA}\n` +
      (text ? `\n以下是原文节选，请优先从中抽取：\n<<<原文开始>>>\n${text.slice(0, 100000)}\n<<<原文结束>>>\n`
            : '\n注意：没有提供原文，请仅依据广泛公认的公开资料；不确定的细节宁可省略或写进 note。\n');
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, temperature: 0.4, max_tokens: 8192, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (!res.ok) throw new Error(`API ${res.status}：${(await res.text().catch(() => '')).slice(0, 200)}`);
      const json = await res.json();
      const raw = json.choices?.[0]?.message?.content || '';
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('返回里没有找到 JSON：' + raw.slice(0, 120));
      ed.aiDraft = JSON.parse(m[0]);
      const n = { c: (ed.aiDraft.characters || []).length, r: (ed.aiDraft.relations || []).length, e: (ed.aiDraft.events || []).length };
      out.className = 'ed-msg ok';
      out.innerHTML = `✓ 生成完成：${n.c} 人 / ${n.r} 关系 / ${n.e} 事件
        <div style="margin-top:8px"><button class="primary" type="button" data-tool="ai-apply">覆盖当前书</button>
        <button class="ghost" type="button" data-tool="ai-merge">合并进来（去重）</button>
        <button class="ghost" type="button" data-tool="ai-view">查看 JSON</button></div>
        <p class="hint" style="margin-top:6px">提醒：AI 只是打字员，务必逐条校对（尤其同名人物与关系方向）。</p>`;
    } catch (e) {
      out.className = 'ed-msg bad';
      out.textContent = '生成失败：' + e.message;
    }
  }

  function applyAi(merge) {
    if (!ed.aiDraft) return;
    if (!merge) {
      adopt(ed.aiDraft, true);
    } else {
      const st = mergeDraft(ed.aiDraft);
      adopt(ed.book, true);
      toast(`已合并：+${st.cAdd} 人 / +${st.rAdd} 关系 / +${st.eAdd} 事件 / +${st.evAdd} 条小事件`);
    }
    saveDraft();
    toast('已应用 AI 草稿（记得逐条校对）');
  }

  /* —— 整本生成：上传/粘贴 → 分章 → 逐章生成 → 合并去重 —— */
  function aiConfig() {
    const read = (id, key, dft) => {
      const el = document.getElementById(id);
      const v = (el && 'value' in el ? el.value : localStorage.getItem(key)) || dft || '';
      return String(v).trim();
    };
    return {
      base: read('ai-base', 'ba-ai-base', 'https://api.deepseek.com/v1').replace(/\/$/, ''),
      key: read('ai-key', 'ba-ai-key'),
      model: read('ai-model', 'ba-ai-model', 'deepseek-chat'),
    };
  }

  function saveAiConfig(cfg) {
    try {
      localStorage.setItem('ba-ai-base', cfg.base);
      localStorage.setItem('ba-ai-key', cfg.key);
      localStorage.setItem('ba-ai-model', cfg.model);
    } catch (e) { /* 忽略 */ }
  }

  async function callLLM(system, user) {
    const cfg = aiConfig();
    if (!cfg.key) throw new Error('请先填 API Key（只存在本机浏览器）');
    saveAiConfig(cfg);
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, temperature: 0.4, max_tokens: 8192, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`API ${res.status}：${(await res.text().catch(() => '')).slice(0, 200)}`);
    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content || '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('返回里没有找到 JSON：' + raw.slice(0, 120));
    return JSON.parse(m[0]);
  }

  function splitChapters(text) {
    const t = String(text || '').replace(/\r\n?/g, '\n');
    const re = /^[ \t　]*第[ \t　]*[一二三四五六七八九十百千零〇两\d]+[ \t　]*[章回节卷][^\n]{0,40}$/gm;
    const marks = [...t.matchAll(re)].map((m) => ({ idx: m.index, title: m[0].trim() }));
    if (marks.length < 2) return t.trim() ? [{ title: '全文（未识别到章节，按一整段处理）', text: t.trim() }] : [];
    const out = [];
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].idx;
      const end = i + 1 < marks.length ? marks[i + 1].idx : t.length;
      out.push({ title: marks[i].title.slice(0, 40), text: t.slice(start, end).trim() });
    }
    return out;
  }

  function formBatch() {
    const cfgKey = localStorage.getItem('ba-ai-key') || '';
    const cfgBase = localStorage.getItem('ba-ai-base') || 'https://api.deepseek.com/v1';
    const cfgModel = localStorage.getItem('ba-ai-model') || 'deepseek-chat';
    const chapters = ed.chapters || [];
    const results = ed.genResults || [];
    const list = chapters.map((c, i) => {
      const r = results[i];
      const flag = r ? (r.error ? ' ✗' : ` ✓ ${(r.characters || []).length}人/${(r.relations || []).length}关系`) : '';
      return `<label class="ed-chk"><input type="checkbox" data-ch="${i}" ${ed.genSkip && ed.genSkip.has(i) ? '' : 'checked'}> ${esc(c.title)} <span class="hint">(${c.text.length} 字${flag})</span></label>`;
    }).join('');
    return `${head('整本生成', '上传/粘贴整本 → ① 分章 → ② 逐章生成（人物 id 沿用名单，保证能合并）→ ③ 合并去重 → 人工校对',
      '<button class="primary" type="button" data-tool="batch-split">① 分章</button>' +
      '<button class="primary" type="button" data-tool="batch-run">② 逐章生成</button>' +
      '<button class="ghost" type="button" data-tool="batch-stop">停止</button>' +
      '<button class="primary" type="button" data-tool="batch-merge">③ 合并去重</button>' +
      '<button class="ghost" type="button" data-tool="batch-view">查看结果 JSON</button>')}
      <div class="ed-grid">
        <label>API 地址<input id="ai-base" value="${esc(cfgBase)}"></label>
        <label>API Key<input id="ai-key" type="password" value="${esc(cfgKey)}" placeholder="sk-...（只存 localStorage）"></label>
        <label>模型<input id="ai-model" value="${esc(cfgModel)}"></label>
      </div>
      <div class="ed-sub">
        <div class="ed-sub-head">整本原文
          <label class="ghost tiny" style="cursor:pointer">上传 txt<input type="file" id="batch-file" accept=".txt,text/plain" hidden></label>
          <button class="ghost tiny" type="button" data-tool="batch-clear">清空</button>
        </div>
        <textarea id="batch-text" style="min-height:150px" placeholder="把整本 txt 粘贴到这里（或上传 .txt 文件）…">${ed.batchText ? esc(ed.batchText) : ''}</textarea>
      </div>
      ${chapters.length ? `<div class="ed-sub">
        <div class="ed-sub-head">已分章 ${chapters.length} 章
          <button class="ghost tiny" type="button" data-tool="batch-all">全选</button>
          <button class="ghost tiny" type="button" data-tool="batch-none">全不选</button>
        </div>
        <div class="ed-chars" id="batch-list">${list}</div>
      </div>` : ''}
      <div id="batch-out" class="ed-msg"></div>`;
  }

  function batchLog(text, cls) {
    const out = document.getElementById('batch-out');
    if (!out) return;
    out.className = 'ed-msg ' + (cls || '');
    out.innerHTML = `<div>${text}</div>` + (out.innerHTML || '');
  }

  function batchSplit() {
    const box = document.getElementById('batch-text');
    ed.batchText = box ? box.value : (ed.batchText || '');
    ed.chapters = splitChapters(ed.batchText);
    ed.genResults = [];
    renderBody();
    batchLog(ed.chapters.length
      ? `已分章：${ed.chapters.length} 章。勾选要生成的部分，然后点「② 逐章生成」。`
      : '没有内容可分章，请先粘贴或上传 txt。', ed.chapters.length ? 'ok' : 'bad');
  }

  function batchRoster() {
    const names = new Map();
    for (const c of ed.book.characters) names.set(c.id, c.name);
    for (const r of ed.genResults || []) for (const c of (r && r.characters) || []) if (!names.has(c.id)) names.set(c.id, c.name);
    return [...names.entries()].slice(0, 300).map(([id, name]) => `${id}: ${name}`).join('；');
  }

  async function batchRun() {
    const chapters = ed.chapters || [];
    if (!chapters.length) { batchLog('请先点「① 分章」', 'bad'); return; }
    const picks = [...document.querySelectorAll('#batch-list input[data-ch]')]
      .filter((c) => c.checked).map((c) => Number(c.dataset.ch));
    if (!picks.length) { batchLog('请至少勾选一章', 'bad'); return; }
    const cfg = aiConfig();
    if (!cfg.key) { batchLog('请先填 API Key', 'bad'); return; }
    saveAiConfig(cfg);
    ed.genResults = ed.genResults || [];
    ed.generating = true;
    batchLog(`开始：共 ${picks.length} 章（每章约 1–2 分钟，可随时点「停止」）`, '');
    let ok = 0;
    for (let n = 0; n < picks.length; n++) {
      if (!ed.generating) break;
      const idx = picks[n];
      const ch = chapters[idx];
      batchLog(`⏳ ${n + 1}/${picks.length} 正在生成：${esc(ch.title)}…`, '');
      try {
        const draft = await callLLM(batchSystem(), batchUser(ch, idx));
        ed.genResults[idx] = draft;
        ok++;
        batchLog(`✓ ${n + 1}/${picks.length} ${esc(ch.title)}：${(draft.characters || []).length} 人 / ${(draft.relations || []).length} 关系 / ${(draft.events || []).length} 事件`, 'ok');
      } catch (e) {
        ed.genResults[idx] = { error: String(e.message) };
        batchLog(`✗ ${esc(ch.title)}：${esc(String(e.message))}`, 'bad');
      }
    }
    ed.generating = false;
    batchLog(`本轮结束：成功 ${ok} / ${picks.length} 章。点「③ 合并去重」把它们并进当前书。`, ok ? 'ok' : 'bad');
  }

  function batchSystem() {
    return '你是文学作品的资料整理员，正在**逐章**整理一本书，供「人物关系 + 事件时间轴」应用使用。硬性要求：' +
      '严格输出 JSON（不要 markdown 围栏、不要解释）；**只从给定章节抽取**，不要引入本章没出现的内容；' +
      '人物 id 必须沿用「已有名单」里对应的 id，若是名单外的新人物才新起 id（拼音 kebab-case）；' +
      'relations 每条至少 1 个「定义关系的小事件」，chapter 写「第N章」；' +
      'events 的 ch 写这一章的章号，phase 可省略（我会自动补）；phases 只在第 1 章输出；' +
      'style 约定 solid=亲缘/同盟、dashed=对立/伤害、dotted=情人/过去/间接；易混同名人物在 note 里写消歧提示；全部字段中文。';
  }

  function batchUser(ch, idx) {
    const n = idx + 1;
    const body = ch.text.length > 40000 ? ch.text.slice(0, 40000) + '\n…（本章过长，已截断）' : ch.text;
    const roster = batchRoster();
    return `书名《${ed.book.meta.title || '未命名'}》，共 ${(ed.chapters || []).length} 章。现在是第 ${n} 章：${ch.title}。\n\n` +
      (roster ? `已有名单（同一个人必须沿用这些 id）：\n${roster}\n\n` : '') +
      `JSON schema：\n${AI_SCHEMA}\n\n` +
      `请只从本章抽取，输出 JSON。events[].ch = ${n}；relations[].events[].chapter 写「第${n}章」。\n\n` +
      `<<<本章原文开始>>>\n${body}\n<<<本章原文结束>>>`;
  }

  function mergeDraft(draft) {
    const b = ed.book;
    const st = { cAdd: 0, rAdd: 0, eAdd: 0, evAdd: 0 };
    const byId = new Map(b.characters.map((c) => [c.id, c]));
    const byName = new Map(b.characters.map((c) => [c.name, c]));
    const mergeInto = (t, c) => {
      t.aliases = [...new Set([...(t.aliases || []), ...(c.aliases || [])])];
      if (!t.desc && c.desc) t.desc = c.desc;
      if (!t.fate && c.fate) t.fate = c.fate;
      if (!t.title && c.title) t.title = c.title;
      if (!t.faction && c.faction) t.faction = c.faction;
      if (!t.note && c.note) t.note = c.note;
      if (!t.gender && c.gender) t.gender = c.gender;
      if (!t.firstCh && c.firstCh) t.firstCh = c.firstCh;
    };
    for (const c of draft.characters || []) {
      const id = String(c.id || '').trim() || uid('c');
      if (byId.has(id)) { mergeInto(byId.get(id), c); continue; }
      if (c.name && byName.has(c.name)) { mergeInto(byName.get(c.name), c); continue; }
      const item = { ...c, id };
      b.characters.push(item);
      byId.set(id, item);
      if (item.name) byName.set(item.name, item);
      st.cAdd++;
    }
    for (const f of draft.factions || []) if (f.key && !b.factions.some((x) => x.key === f.key)) { b.factions.push(f); }
    for (const p of draft.phases || []) if (p.id && !b.phases.some((x) => x.id === p.id)) b.phases.push(p);
    const fallbackPhase = (b.phases[0] || { id: 'p1' }).id;
    const relKey = (r) => `${r.from}|${r.to}|${(r.type || '').trim()}`;
    const relMap = new Map(b.relations.map((r) => [relKey(r), r]));
    for (const r of draft.relations || []) {
      const k = relKey(r);
      if (relMap.has(k)) {
        const t = relMap.get(k);
        const seen = new Set((t.events || []).map((e) => e.text));
        for (const e of r.events || []) if (e.text && !seen.has(e.text)) { t.events.push(e); st.evAdd++; }
      } else {
        const item = { ...r, events: [...(r.events || [])] };
        b.relations.push(item);
        relMap.set(k, item);
        st.rAdd++;
      }
    }
    const evIds = new Set(b.events.map((e) => e.id));
    for (const e of draft.events || []) {
      const ev = { ...e, id: e.id || uid('e'), ch: e.ch ?? 0 };
      if (!b.phases.some((p) => p.id === ev.phase)) ev.phase = fallbackPhase;
      if (evIds.has(ev.id)) continue;
      b.events.push(ev);
      evIds.add(ev.id);
      st.eAdd++;
    }
    return st;
  }

  function batchMerge() {
    const results = (ed.genResults || []).filter((r) => r && !r.error);
    if (!results.length) { batchLog('还没有可合并的结果，先跑「② 逐章生成」', 'bad'); return; }
    const total = { cAdd: 0, rAdd: 0, eAdd: 0, evAdd: 0 };
    for (const d of results) {
      const st = mergeDraft(d);
      total.cAdd += st.cAdd; total.rAdd += st.rAdd; total.eAdd += st.eAdd; total.evAdd += st.evAdd;
    }
    adopt(ed.book, true);
    saveDraft();
    batchLog(`✓ 合并完成：+${total.cAdd} 人 / +${total.rAdd} 关系 / +${total.eAdd} 事件 / +${total.evAdd} 条小事件（并按 id 或姓名合并了重复人物）。记得逐条校对。`, 'ok');
  }

  /* ---------------- 交互 ---------------- */
  function bind() {
    $('#ed-nav').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-sec]');
      if (!btn) return;
      ed.section = btn.dataset.sec;
      ed.editing = null;
      renderAll();
    });
    $('#ed-load').addEventListener('click', loadSource);
    $('#ed-new').addEventListener('click', () => { if (confirm('新建空白书？当前未保存的改动会丢。')) newBlank(); });
    $('#ed-save').addEventListener('click', saveDraft);
    $('#ed-export').addEventListener('click', exportJson);
    $('#ed-preview').addEventListener('click', () => {
      saveDraft();
      const slug = ed.book.meta.slug || slugify(ed.book.meta.title);
      window.open(`index.html?book=${encodeURIComponent(slug)}&local=1`, '_blank');
    });
    $('#ed-import').addEventListener('change', (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { adopt(JSON.parse(reader.result), true); saveDraft(); }
        catch (err) { alert('JSON 解析失败：' + err.message); }
      };
      reader.readAsText(file, 'utf-8');
    });

    const body = $('#ed-body');

    body.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const { act, sec, idx } = btn.dataset;
      const list = () => ed.book[sec];

      if (act === 'add') { ed.form = templateFor(sec); ed.editing = { sec, idx: null }; renderBody(); return; }
      if (act === 'edit') { ed.form = JSON.parse(JSON.stringify(list()[idx])); ed.editing = { sec, idx: Number(idx) }; renderBody(); return; }
      if (act === 'del') {
        if (confirm(`删除这条${({ characters: '人物', relations: '关系', events: '事件', phases: '阶段', factions: '阵营' })[sec]}？`)) {
          list().splice(Number(idx), 1); saveDraft(); renderBody();
        }
        return;
      }
      if (act === 'cancel') { ed.editing = null; renderBody(); return; }
      if (act === 'meta-save') { saveDraft(); renderBody(); return; }
      if (act === 'rel-add-event') {
        ed.form.events = ed.form.events || [];
        ed.form.events.push({ text: '', chapter: '' });
        renderBody();
        return;
      }
      if (act === 'rel-del-event') {
        ed.form.events.splice(Number(idx), 1);
        renderBody();
        return;
      }
    });

    body.addEventListener('input', (ev) => {
      const id = ev.target.id;
      if (id === 'ai-base' || id === 'ai-key' || id === 'ai-model') {
        try { localStorage.setItem('ba-' + id, ev.target.value); } catch (e) { /* 忽略 */ }
        return;
      }
      if (id === 'batch-text') { ed.batchText = ev.target.value; return; }
      const el = ev.target.closest('[data-field]');
      if (!el || !ed.form) return;
      setPath(ed.form, el.dataset.field, el.value);
    });

    // 下拉/勾选类输入也顺手存一下 API 配置（防止只 change 不 input 的浏览器）
    body.addEventListener('change', (ev) => {
      const id = ev.target.id;
      if (id === 'ai-base' || id === 'ai-key' || id === 'ai-model') {
        try { localStorage.setItem('ba-' + id, ev.target.value); } catch (e) { /* 忽略 */ }
      }
    });

    // 整本 txt 上传
    document.addEventListener('change', (ev) => {
      if (ev.target.id !== 'batch-file') return;
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        ed.batchText = String(reader.result || '');
        ed.chapters = [];
        ed.genResults = [];
        renderBody();
        batchLog(`已读入 ${esc(file.name)}（${ed.batchText.length} 字），点「① 分章」`, 'ok');
      };
      reader.readAsText(file, 'utf-8');
    });

    body.addEventListener('change', (ev) => {
      const el = ev.target.closest('[data-field]');
      if (el && ed.form) setPath(ed.form, el.dataset.field, el.value);
      const multi = ev.target.closest('[data-multi]');
      if (multi && ed.form) {
        const key = multi.dataset.multi;
        const arr = new Set(ed.form[key] || []);
        if (multi.checked) arr.add(multi.value); else arr.delete(multi.value);
        ed.form[key] = [...arr];
      }
    });

    body.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target.closest('[data-form]');
      if (!form || !ed.form) return;
      const sec = form.dataset.form;
      if (sec === 'meta') {
        ed.book.meta = { ...ed.book.meta, ...ed.form };
        saveDraft(); renderBody(); return;
      }
      const item = buildItem(sec);
      if (!item) return;
      const idx = ed.editing.idx;
      if (idx === null) ed.book[sec].push(item); else ed.book[sec][idx] = item;
      ed.editing = null;
      saveDraft();
      renderBody();
    });
  }

  function templateFor(sec) {
    if (sec === 'characters') return { id: '', name: '', aliases: [], generation: 1, gender: 'm', firstCh: 1, faction: (ed.book.factions[0] || {}).key || '', title: '', desc: '', fate: '', note: '' };
    if (sec === 'relations') return { from: (ed.book.characters[0] || {}).id || '', to: (ed.book.characters[1] || ed.book.characters[0] || {}).id || '', type: '', style: 'solid', events: [{ text: '', chapter: '' }] };
    if (sec === 'events') return { id: uid('e'), name: '', phase: (ed.book.phases[0] || {}).id || '', order: (ed.book.events.length + 1), ch: 1, chars: [], summary: '', impact: '', quote: '' };
    if (sec === 'phases') return { id: uid('p'), name: '', order: ed.book.phases.length + 1 };
    if (sec === 'factions') return { key: '', name: '', color: '#8b94a7' };
    return {};
  }

  function buildItem(sec) {
    const f = ed.form;
    if (sec === 'characters') {
      const item = {
        ...f,
        id: (f.id || '').trim() || uid('c'),
        aliases: typeof f.aliases === 'string' ? f.aliases.split(/[，,、]/).map((s) => s.trim()).filter(Boolean) : (f.aliases || []),
        generation: Number(f.generation) || 0,
        firstCh: Number(f.firstCh) || 0,
        gender: f.gender === 'f' ? 'f' : 'm'
      };
      if (!item.name) { alert('名称不能为空'); return null; }
      return item;
    }
    if (sec === 'relations') {
      const events = (f.events || []).filter((e) => (e.text || '').trim());
      if (!f.from || !f.to) { alert('请选择两个人物'); return null; }
      if (!f.type) { alert('关系名不能为空'); return null; }
      if (!events.length) { alert('至少写一条小事件'); return null; }
      return { from: f.from, to: f.to, type: f.type, style: f.style || 'solid', events };
    }
    if (sec === 'events') {
      if (!f.name) { alert('事件名不能为空'); return null; }
      return { ...f, order: Number(f.order) || 1, ch: Number(f.ch) || 0, chars: f.chars || [] };
    }
    if (sec === 'phases') {
      if (!f.name) { alert('阶段名不能为空'); return null; }
      return { id: f.id || uid('p'), name: f.name, order: Number(f.order) || 1 };
    }
    if (sec === 'factions') {
      if (!f.key || !f.name) { alert('key 和名称都要填'); return null; }
      return { key: f.key, name: f.name, color: f.color || '#8b94a7' };
    }
    return null;
  }

  /* ---------------- 工具按钮（校验/命令） ---------------- */
  function bindTools() {
    // 校验与命令按钮放在基本信息页里由 renderBody 输出，这里用委托兜底
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-tool]');
      if (!btn) return;
      if (btn.dataset.tool === 'validate') {
        const issues = validate();
        const el = document.getElementById('ed-validate');
        if (el) el.innerHTML = issues.length
          ? `<p class="ed-msg bad">发现 ${issues.length} 个问题：</p><ul class="ed-issues">${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
          : '<p class="ed-msg ok">✓ 本地检查通过（还可以用 scripts/validate.mjs 再跑一遍）</p>';
      }
      if (btn.dataset.tool === 'cmd') {
        const slug = ed.book.meta.slug || slugify(ed.book.meta.title);
        const cmd = `node scripts/validate.mjs data/${slug}.json`;
        navigator.clipboard?.writeText(cmd).then(() => toast('已复制：' + cmd)).catch(() => toast(cmd));
      }
      if (btn.dataset.tool === 'ai-generate') generateDraft();
      if (btn.dataset.tool === 'ai-apply') applyAi(false);
      if (btn.dataset.tool === 'ai-merge') applyAi(true);
      if (btn.dataset.tool === 'batch-split') batchSplit();
      if (btn.dataset.tool === 'batch-run') batchRun();
      if (btn.dataset.tool === 'batch-stop') { ed.generating = false; batchLog('已请求停止：当前这一章跑完就停。', ''); }
      if (btn.dataset.tool === 'batch-merge') batchMerge();
      if (btn.dataset.tool === 'batch-clear') { ed.batchText = ''; ed.chapters = []; ed.genResults = []; renderBody(); }
      if (btn.dataset.tool === 'batch-all') document.querySelectorAll('#batch-list input[data-ch]').forEach((c) => { c.checked = true; });
      if (btn.dataset.tool === 'batch-none') document.querySelectorAll('#batch-list input[data-ch]').forEach((c) => { c.checked = false; });
      if (btn.dataset.tool === 'batch-view') {
        const out = document.getElementById('batch-out');
        const box = document.createElement('textarea');
        box.value = JSON.stringify((ed.genResults || []).map((r, i) => ({ chapter: (ed.chapters || [])[i] && ed.chapters[i].title, result: r })), null, 2).slice(0, 200000);
        box.style.width = '100%'; box.style.minHeight = '200px'; box.style.marginTop = '8px';
        out.appendChild(box);
      }
      if (btn.dataset.tool === 'ai-view') {
        const box = document.createElement('textarea');
        box.value = JSON.stringify(ed.aiDraft, null, 2);
        box.style.width = '100%'; box.style.minHeight = '220px'; box.style.marginTop = '8px';
        document.getElementById('ai-out').appendChild(box);
      }
    });
  }

  bindTools();
  boot();
})();
