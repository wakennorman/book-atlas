/* 书脉 BookAtlas · 前端逻辑
 * 数据与渲染分离：每本书一个 JSON，见 data/ 目录。
 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const state = {
    books: [],
    book: null,
    byId: new Map(),
    adj: new Map(),        // id -> [{ to, rel }]
    chart: null,
    frozen: false,         // 力导向布局是否已冻结（冻结后按 x/y 渲染，便于稳定高亮）
    pos: new Map(),        // id -> { x, y }
    hlNodes: new Set(),    // 当前高亮的节点
    hlEdges: new Set(),    // 当前高亮的边（key = `a|b` 无序）
    activeChar: null,
    activeEvent: null,
    activeFaction: null,
    allLabels: false,
    view: 'force',         // force | gen-h | gen-v
    bands: new Map(),      // 代际视图：generation -> 主坐标
    freezeTimer: null,
  };

  /* ---------------- 工具 ---------------- */
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const genText = (g) => (g === 0 ? '前史' : `第 ${g} 代`);
  const charName = (id) => state.byId.get(id)?.name || id;

  /* ---------------- 数据加载 ---------------- */
  async function boot() {
    try {
      const res = await fetch('data/books.json', { cache: 'no-cache' });
      state.books = (await res.json()).books || [];
    } catch (e) {
      $('#book-meta').textContent = '数据加载失败：请用本地服务器打开（见 README）';
      return;
    }
    if (!state.books.length) { $('#book-meta').textContent = '还没有书目数据'; return; }

    const sel = $('#book-select');
    sel.innerHTML = state.books.map((b) => `<option value="${esc(b.slug)}">${esc(b.title)}</option>`).join('');
    sel.addEventListener('change', () => loadBook(sel.value));

    const params = new URLSearchParams(location.search);
    const wanted = params.get('book');
    const slug = state.books.some((b) => b.slug === wanted) ? wanted : state.books[0].slug;
    sel.value = slug;
    await loadBook(slug);
  }

  async function loadBook(slug) {
    const meta = state.books.find((b) => b.slug === slug);
    const res = await fetch(meta.file, { cache: 'no-cache' });
    const book = await res.json();
    state.book = book;
    state.byId = new Map(book.characters.map((c) => [c.id, c]));
    state.adj = new Map(book.characters.map((c) => [c.id, []]));
    for (const r of book.relations) {
      if (!state.byId.has(r.from) || !state.byId.has(r.to)) continue;
      state.adj.get(r.from).push({ to: r.to, rel: r });
      state.adj.get(r.to).push({ to: r.from, rel: r });
    }
    state.view = 'force';
    state.bands = new Map();
    clearHighlight(false);
    history.replaceState(null, '', `?book=${encodeURIComponent(slug)}`);
    renderHeader();
    renderLegend();
    renderDatalist();
    renderPathSelects();
    renderTimeline();
    renderPanelWelcome();
    initChart();
  }

  /* ---------------- 头部 / 图例 / 表单 ---------------- */
  function renderHeader() {
    const b = state.book, m = b.meta;
    $('#book-meta').textContent = `《${m.title}》· ${m.author} · ${b.characters.length} 人 / ${b.relations.length} 段关系 / ${b.events.length} 个事件`;
    $('#footer-note').textContent = `${m.note || ''} ${m.prophecy ? '「' + m.prophecy + '」' : ''}`.trim();
  }

  function renderLegend() {
    const el = $('#legend');
    el.innerHTML = state.book.factions.map((f) =>
      `<button type="button" class="legend-item" data-faction="${esc(f.key)}"><span class="dot" style="background:${esc(f.color)}"></span>${esc(f.name)}</button>`
    ).join('');
    el.querySelectorAll('.legend-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.faction;
        if (state.activeFaction === key) { clearHighlight(); return; }
        state.activeFaction = key;
        const nodes = new Set(state.book.characters.filter((c) => c.faction === key).map((c) => c.id));
        const edges = new Set();
        for (const r of state.book.relations) if (nodes.has(r.from) || nodes.has(r.to)) edges.add(edgeKey(r.from, r.to));
        setHighlight(nodes, edges, null, null);
      });
    });
  }

  function renderDatalist() {
    $('#char-list').innerHTML = state.book.characters.map((c) =>
      `<option value="${esc(c.name)}">${esc(c.title)}</option>`).join('');
  }

  function renderPathSelects() {
    const opts = state.book.characters.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const a = $('#path-a'), b = $('#path-b');
    a.innerHTML = `<option value="">人物 A</option>${opts}`;
    b.innerHTML = `<option value="">人物 B</option>${opts}`;
    // 默认给一个与主线有关的提示（第一对主要人物由数据决定，这里保持空）
  }

  /* ---------------- 图表 ---------------- */
  function nodeDegree(id) { return state.adj.get(id)?.length || 0; }
  function symbolSize(id) { return Math.min(15 + nodeDegree(id) * 2.2, 40); }
  function categoryOf(c) {
    const idx = state.book.factions.findIndex((f) => f.key === c.faction);
    return idx >= 0 ? idx : 0;
  }

  function buildOption() {
    const b = state.book;
    const ink = cssVar('--ink') || '#232a35';
    const muted = cssVar('--muted') || '#6c7482';
    const panel = cssVar('--panel') || '#fff';
    const line = cssVar('--line') || '#e5dfd3';
    const anyDim = state.hlNodes.size > 0 || state.hlEdges.size > 0;

    const data = b.characters.map((c) => {
      const dim = anyDim && !state.hlNodes.has(c.id);
      const pos = state.pos.get(c.id);
      return {
        id: c.id, name: c.name, value: c.title,
        category: categoryOf(c),
        symbolSize: symbolSize(c.id) * (state.hlNodes.has(c.id) && anyDim ? 1.15 : 1),
        x: pos ? pos.x : undefined, y: pos ? pos.y : undefined,
        itemStyle: { opacity: dim ? 0.16 : 1 },
        label: {
          color: dim ? muted : ink,
          opacity: dim ? 0.35 : 1,
          textBorderColor: panel,
          textBorderWidth: 3,
          show: state.allLabels || (state.labels ? state.labels.has(c.id) : nodeDegree(c.id) >= 4),
        },
      };
    });

    const links = b.relations.filter((r) => state.byId.has(r.from) && state.byId.has(r.to)).map((r) => {
      const key = edgeKey(r.from, r.to);
      const dim = anyDim && !state.hlEdges.has(key);
      return {
        source: r.from, target: r.to, value: r.type,
        lineStyle: {
          width: state.hlEdges.has(key) && anyDim ? 3 : 1.2,
          opacity: dim ? 0.07 : 0.5,
          type: r.style === 'dashed' ? 'dashed' : r.style === 'dotted' ? 'dotted' : 'solid',
          curveness: 0.08,
        },
      };
    });

    return {
      backgroundColor: 'transparent',
      graphic: buildGuides(),
      tooltip: {
        trigger: 'item', confine: true,
        backgroundColor: panel, borderColor: line, borderWidth: 1,
        textStyle: { color: ink, fontSize: 12.5 },
        extraCssText: 'max-width:340px;white-space:normal;line-height:1.55;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12)',
        formatter: (p) => {
          if (p.dataType === 'edge') {
            const rel = findRel(p.data.source, p.data.target);
            if (!rel) return '';
            const evs = (rel.events || []).map((e) => `· ${esc(e.text)}${e.chapter ? `<span style="color:${muted}">（${esc(e.chapter)}）</span>` : ''}`).join('<br>');
            return `<b>${esc(charName(rel.from))} — ${esc(rel.type)} — ${esc(charName(rel.to))}</b><br>${evs}`;
          }
          const c = state.byId.get(p.data.id);
          if (!c) return '';
          return `<b>${esc(c.name)}</b>${c.aliases && c.aliases.length ? `（${esc(c.aliases.join('，'))}）` : ''}<br>` +
            `<span style="color:${muted}">${esc(genText(c.generation))} · ${esc(c.title)}</span><br>${esc(c.desc)}<br>` +
            `<span style="color:${muted}">结局：${esc(c.fate)}</span>`;
        },
      },
      series: [{
        type: 'graph',
        layout: state.frozen ? 'none' : 'force',
        roam: true, draggable: true,
        categories: b.factions.map((f) => ({ name: f.name, itemStyle: { color: f.color } })),
        force: { repulsion: 900, gravity: 0.04, edgeLength: [80, 190], layoutAnimation: true, friction: 0.6, initLayout: 'circular' },
        data, links,
        label: {
          show: true,
          position: state.view === 'force' ? 'right' : 'bottom',
          distance: 4, fontSize: 10.5, color: ink, formatter: '{b}',
        },
        labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
        lineStyle: { color: 'source' },
        scaleLimit: { min: 0.4, max: 3 },
        emphasis: {
          focus: 'adjacency',
          label: { show: true, fontWeight: 'bold' },
          lineStyle: { width: 3, opacity: 0.9 },
        },
        blur: {
          itemStyle: { opacity: 0.15 },
          label: { opacity: 0.25 },
          lineStyle: { opacity: 0.08 },
        },
        selectedMode: 'single',
      }],
    };
  }

  function relaxPositions(iterations = 140) {
    if (state.pos.size < 2) return;
    const ids = [...state.pos.keys()];
    const pad = 12;
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = state.pos.get(ids[i]), b = state.pos.get(ids[j]);
          let dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const min = (symbolSize(ids[i]) + symbolSize(ids[j])) / 2 + pad;
          if (d < min) {
            const k = (min - d) / d / 2;
            dx *= k; dy *= k;
            state.pos.set(ids[i], { x: a.x - dx, y: a.y - dy });
            state.pos.set(ids[j], { x: b.x + dx, y: b.y + dy });
          }
        }
      }
    }
  }

  function fitPositions() {
    if (!state.pos.size || !state.chart) return;
    const rect = document.getElementById('graph').getBoundingClientRect();
    const W = rect.width || 800, H = rect.height || 500, padX = 108, padY = 64;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of state.pos.values()) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    const s = Math.max(0.3, Math.min((W - 2 * padX) / w, (H - 2 * padY) / h, 1.4));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    for (const [id, p] of state.pos) state.pos.set(id, { x: (p.x - cx) * s, y: (p.y - cy) * s });
  }

  function computeLabels() {
    if (state.allLabels || !state.pos.size) { state.labels = null; return; }
    const rect = document.getElementById('graph').getBoundingClientRect();
    const cx = (rect.width || 800) / 2, cy = (rect.height || 500) / 2;
    const cands = state.book.characters
      .filter((c) => state.pos.has(c.id))
      .map((c) => {
        const size = symbolSize(c.id);
        const w = c.name.length * 11.5 + size + 6, h = Math.max(size, 18);
        const p = state.pos.get(c.id);
        const sx = cx + p.x + size / 2;
        return { id: c.id, deg: nodeDegree(c.id), bx: sx - w / 2, by: cy + p.y - h / 2, w, h };
      })
      .sort((a, b) => b.deg - a.deg);
    const placed = [];
    const keep = new Set();
    for (const n of cands) {
      const hit = placed.some((o) => !(n.bx > o.bx + o.w || n.bx + n.w < o.bx || n.by > o.by + o.h || n.by + n.h < o.by));
      if (!hit) { placed.push(n); keep.add(n.id); }
    }
    state.labels = keep;
  }

  function freezeNow() {
    if (state.frozen || !state.chart) return;
    const d = state.chart.getModel().getSeriesByIndex(0).getData();
    for (let i = 0; i < d.count(); i++) {
      const id = d.getId(i);
      const layout = d.getItemLayout(i);
      if (id && layout) state.pos.set(id, { x: layout[0] ?? layout.x, y: layout[1] ?? layout.y });
    }
    state.frozen = true;
    relaxPositions();
    fitPositions();
    computeLabels();
    state.chart.setOption(buildOption());
  }

  function buildGuides() {
    if (state.view === 'force' || !state.book || !state.bands.size) return [];
    const rect = document.getElementById('graph').getBoundingClientRect();
    const W = rect.width || 900, H = rect.height || 600;
    const muted = cssVar('--muted') || '#6c7482';
    const items = [];
    for (const [g, p] of state.bands) {
      if (state.view === 'gen-h') {
        items.push({
          type: 'text', left: Math.round(W / 2 + p) - 22, top: 8, silent: true,
          style: { text: genText(g), fill: muted, font: '11px sans-serif' },
        });
      } else {
        items.push({
          type: 'text', left: 10, top: Math.round(H / 2 + p) - 7, silent: true,
          style: { text: genText(g), fill: muted, font: '11px sans-serif' },
        });
      }
    }
    return items;
  }

  function applyViewHeight() {
    const el = document.getElementById('graph');
    if (!el || !state.book) return;
    if (state.view === 'gen-v') {
      const bands = new Set(state.book.characters.map((c) => c.generation)).size || 8;
      el.style.height = Math.max(720, bands * 96) + 'px';
    } else {
      el.style.height = '';
    }
  }

  function buildGenerationPositions(view) {
    const rect = document.getElementById('graph').getBoundingClientRect();
    const W = rect.width || 900, H = rect.height || 600;
    const gens = [...new Set(state.book.characters.map((c) => c.generation))].sort((a, b) => a - b);
    const factionOrder = new Map(state.book.factions.map((f, i) => [f.key, i]));
    const byGen = new Map(gens.map((g) => [g, []]));
    for (const c of state.book.characters) byGen.get(c.generation).push(c);
    for (const list of byGen.values()) {
      list.sort((a, b) =>
        (factionOrder.get(a.faction) - factionOrder.get(b.faction)) ||
        (nodeDegree(b.id) - nodeDegree(a.id)) ||
        a.name.localeCompare(b.name));
    }
    state.pos = new Map();
    state.bands = new Map();
    const mainPad = 110, crossPad = 78;
    const mainLen = (view === 'gen-h' ? W : H) - mainPad * 2;
    const crossLen = (view === 'gen-h' ? H : W) - crossPad * 2;
    gens.forEach((g, gi) => {
      const center = gens.length === 1 ? 0 : -mainLen / 2 + (mainLen * gi) / (gens.length - 1);
      state.bands.set(g, center);
      const list = byGen.get(g);
      const step = list.length > 1 ? crossLen / (list.length - 1) : 0;
      list.forEach((c, ci) => {
        const off = list.length === 1 ? 0 : -crossLen / 2 + ci * step;
        state.pos.set(c.id, view === 'gen-h' ? { x: center, y: off } : { x: off, y: center });
      });
    });
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll('.seg').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
    applyViewHeight();
    if (!state.chart) return;
    clearTimeout(state.freezeTimer);
    if (view === 'force') {
      state.frozen = false;
      state.pos = new Map();
      state.bands = new Map();
      state.labels = null;
      state.chart.clear();
      state.chart.setOption(buildOption(), { notMerge: true });
      state.freezeTimer = setTimeout(() => freezeNow(), 6000);
    } else {
      state.frozen = true;
      buildGenerationPositions(view);
      relaxPositions(60);
      fitPositions();
      computeLabels();
      state.chart.clear();
      state.chart.setOption(buildOption(), { notMerge: true });
    }
  }

  function initChart() {
    const el = $('#graph');
    if (state.chart) { state.chart.dispose(); }
    clearTimeout(state.freezeTimer);
    state.chart = echarts.init(el, null, { renderer: 'canvas' });
    state.frozen = false;
    state.pos = new Map();
    state.bands = new Map();
    state.chart.setOption(buildOption());
    // 力导向跑一会儿后自动冻结并适配画布
    state.freezeTimer = setTimeout(() => freezeNow(), 6000);

    state.chart.on('click', (p) => {
      if (p.dataType === 'edge') {
        const rel = findRel(p.data.source, p.data.target);
        if (rel) selectRelation(rel);
      } else if (p.dataType === 'node') {
        selectCharacter(p.data.id);
      }
    });
    state.chart.getZr().on('click', (e) => { if (!e.target) clearHighlight(); });

    const onResize = () => {
      if (!state.chart) return;
      applyViewHeight();
      state.chart.resize();
      if (state.frozen) {
        if (state.view === 'force') fitPositions(); else buildGenerationPositions(state.view);
        computeLabels();
        state.chart.setOption(buildOption());
      }
    };
    new ResizeObserver(onResize).observe(el);
    window.addEventListener('resize', onResize);
  }

  function findRel(a, b) {
    return state.book.relations.find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
  }

  /* ---------------- 高亮 ---------------- */
  function setHighlight(nodes, edges, activeCharId, eventId) {
    state.hlNodes = nodes || new Set();
    state.hlEdges = edges || new Set();
    state.activeChar = activeCharId || null;
    state.activeEvent = eventId || null;
    if (state.activeChar) state.activeFaction = null;
    document.querySelectorAll('.legend-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.faction === state.activeFaction);
      el.classList.toggle('dim', !!state.activeFaction && el.dataset.faction !== state.activeFaction);
    });
    document.querySelectorAll('.event-chip').forEach((el) => el.classList.toggle('active', el.dataset.event === state.activeEvent));
    freezeNow();
    if (state.chart) state.chart.setOption(buildOption());
  }

  function clearHighlight(updateVisual = true) {
    state.hlNodes = new Set();
    state.hlEdges = new Set();
    state.activeChar = null;
    state.activeEvent = null;
    state.activeFaction = null;
    document.querySelectorAll('.legend-item').forEach((el) => el.classList.remove('active', 'dim'));
    document.querySelectorAll('.event-chip').forEach((el) => el.classList.remove('active'));
    if (updateVisual && state.chart) state.chart.setOption(buildOption());
  }

  function selectCharacter(id) {
    const c = state.byId.get(id);
    if (!c) return;
    const nodes = new Set([id]);
    const edges = new Set();
    for (const e of state.adj.get(id)) { nodes.add(e.to); edges.add(edgeKey(id, e.to)); }
    setHighlight(nodes, edges, id, null);
    renderCharacterPanel(c);
  }

  function selectRelation(rel) {
    const nodes = new Set([rel.from, rel.to]);
    const edges = new Set([edgeKey(rel.from, rel.to)]);
    setHighlight(nodes, edges, null, null);
    renderRelationPanel(rel);
  }

  function selectEvent(id) {
    const ev = state.book.events.find((e) => e.id === id);
    if (!ev) return;
    const nodes = new Set(ev.chars || []);
    const edges = new Set();
    for (const r of state.book.relations) if (nodes.has(r.from) && nodes.has(r.to)) edges.add(edgeKey(r.from, r.to));
    setHighlight(nodes, edges, null, id);
    renderEventPanel(ev);
  }

  /* ---------------- 面板 ---------------- */
  const panel = () => $('#panel');

  function renderPanelWelcome() {
    panel().innerHTML = `
      <p class="hint">点节点看人物档案 · 点连线看关系与「定义关系的小事件」 · 拖拽可移动节点<br>
      底部「两人关系」会算出最短关系链，并列出每一跳的依据事件。</p>`;
  }

  function charLink(id) { return `<button class="linkbtn" data-goto="${esc(id)}">${esc(charName(id))}</button>`; }
  function bindGoto(root) {
    root.querySelectorAll('[data-goto]').forEach((el) => el.addEventListener('click', () => selectCharacter(el.dataset.goto)));
    root.querySelectorAll('[data-event]').forEach((el) => el.addEventListener('click', () => selectEvent(el.dataset.event)));
  }

  function renderCharacterPanel(c) {
    const faction = state.book.factions.find((f) => f.key === c.faction);
    const rels = state.book.relations
      .filter((r) => r.from === c.id || r.to === c.id)
      .sort((a, b) => (a.type > b.type ? 1 : -1));
    const relHtml = rels.map((r) => {
      const other = r.from === c.id ? r.to : r.from;
      const evs = (r.events || []).map((e) =>
        `<div class="rel-event">· ${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
      return `<li class="rel">
        <div class="rel-head">${charLink(other)} <span class="type">— ${esc(r.type)} —</span> ${c.id === r.from ? '（对方）' : ''}</div>
        ${evs}
      </li>`;
    }).join('');

    panel().innerHTML = `
      <div class="card-title">${esc(c.name)}</div>
      <div class="card-sub">${esc(genText(c.generation))} · ${esc(c.title)}</div>
      ${c.note ? `<div class="note">⚠️ ${esc(c.note)}</div>` : ''}
      <div class="badges">
        ${faction ? `<span class="badge faction" style="background:${esc(faction.color)}">${esc(faction.name)}</span>` : ''}
        ${(c.aliases || []).map((a) => `<span class="badge">别名：${esc(a)}</span>`).join('')}
        <span class="badge">关系 ${rels.length} 条</span>
      </div>
      <p class="card-desc">${esc(c.desc)}</p>
      <p class="card-fate"><b>结局：</b>${esc(c.fate)}</p>
      <h3 style="margin-top:12px;font-size:14px">与谁有关 · 凭什么事件</h3>
      <ul class="rel-list">${relHtml || '<li class="hint">暂无记录</li>'}</ul>`;
    bindGoto(panel());
  }

  function renderRelationPanel(r) {
    const evs = (r.events || []).map((e) =>
      `<div class="rel-event">· ${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
    panel().innerHTML = `
      <div class="card-title">${charLink(r.from)} <span style="color:var(--muted);font-weight:400">— ${esc(r.type)} —</span> ${charLink(r.to)}</div>
      <p class="card-sub">定义这段关系的事件</p>
      ${evs || '<p class="hint">暂无记录</p>'}
      <p class="hint" style="margin-top:10px">提示：在图上点另一个节点可以顺着关系链继续走。</p>`;
    bindGoto(panel());
  }

  function renderEventPanel(ev) {
    const chain = (ev.chars || []).map(charLink).join('、');
    panel().innerHTML = `
      <div class="card-title">${esc(ev.name)}</div>
      <p class="card-sub">阶段：${esc((state.book.phases.find((p) => p.id === ev.phase) || {}).name || '')}</p>
      <p class="card-desc">${esc(ev.summary)}</p>
      <p class="card-fate"><b>影响：</b>${esc(ev.impact)}</p>
      ${ev.quote ? `<div class="quote">「${esc(ev.quote)}」</div>` : ''}
      <p style="margin-top:10px"><b>涉及：</b>${chain}</p>`;
    bindGoto(panel());
  }

  /* ---------------- 两人关系（BFS） ---------------- */
  function bfs(fromId, toId) {
    if (fromId === toId) return [];
    const prev = new Map([[fromId, null]]);
    const queue = [fromId];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === toId) break;
      for (const e of state.adj.get(cur) || []) {
        if (!prev.has(e.to)) { prev.set(e.to, { from: cur, rel: e.rel }); queue.push(e.to); }
      }
    }
    if (!prev.has(toId)) return null;
    const steps = [];
    let cur = toId;
    while (prev.get(cur)) { const p = prev.get(cur); steps.unshift({ from: p.from, to: cur, rel: p.rel }); cur = p.from; }
    return steps;
  }

  function runPath() {
    const a = $('#path-a').value, b = $('#path-b').value;
    const hint = $('#path-hint');
    if (!a || !b) { hint.textContent = '请选择两个人'; return; }
    const steps = bfs(a, b);
    if (!steps) { hint.textContent = '在图里找不到通路'; return; }
    hint.textContent = `最短 ${steps.length} 跳`;
    const nodes = new Set([a, ...steps.map((s) => s.to)]);
    const edges = new Set(steps.map((s) => edgeKey(s.from, s.to)));
    setHighlight(nodes, edges, null, null);

    const html = steps.map((s, i) => {
      const evs = (s.rel.events || []).map((e) =>
        `<div class="rel-event">· ${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
      return `<li class="rel">
        <div class="rel-head"><span class="idx">${i + 1}</span> ${charLink(s.from)} <span class="type">— ${esc(s.rel.type)} —</span> ${charLink(s.to)}</div>
        ${evs}
      </li>`;
    }).join('');
    panel().innerHTML = `
      <div class="card-title">关系链：${esc(charName(a))} → ${esc(charName(b))}</div>
      <p class="card-sub">共 ${steps.length} 跳 · 每一跳的「关系」与依据事件</p>
      <ul class="path-steps">${html || '<li class="hint">同一个人</li>'}</ul>`;
    bindGoto(panel());
  }

  /* ---------------- 事件轴 ---------------- */
  function renderTimeline() {
    const el = $('#timeline');
    const phases = [...state.book.phases].sort((a, b) => a.order - b.order);
    el.innerHTML = phases.map((p) => {
      const evs = state.book.events.filter((e) => e.phase === p.id).sort((a, b) => a.order - b.order);
      if (!evs.length) return '';
      return `<div class="phase">
        <div class="phase-title">${esc(p.name)}</div>
        ${evs.map((e) => `
          <button type="button" class="event-chip" data-event="${esc(e.id)}">
            <span class="ev-name">${esc(e.name)}</span>
            <span class="ev-sum">${esc(e.summary)}</span>
          </button>`).join('')}
      </div>`;
    }).join('');
    el.querySelectorAll('.event-chip').forEach((btn) => btn.addEventListener('click', () => selectEvent(btn.dataset.event)));
  }

  /* ---------------- 搜索 / 主题 / 事件绑定 ---------------- */
  function bindUI() {
    const search = $('#search-input');
    const doSearch = () => {
      const q = search.value.trim();
      if (!q) return;
      const c = state.book.characters.find((x) => x.name === q)
        || state.book.characters.find((x) => (x.aliases || []).includes(q))
        || state.book.characters.find((x) => x.name.includes(q) || (x.aliases || []).some((a) => a.includes(q)));
      if (c) selectCharacter(c.id); else $('#path-hint').textContent = `没找到「${q}」`;
    };
    search.addEventListener('change', doSearch);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    $('#search-clear').addEventListener('click', () => { search.value = ''; clearHighlight(); });

    const labelBtn = $('#label-btn');
    labelBtn.addEventListener('click', () => {
      state.allLabels = !state.allLabels;
      labelBtn.textContent = state.allLabels ? '标签：全部' : '标签：主要';
      if (!state.allLabels) computeLabels();
      if (state.chart) state.chart.setOption(buildOption());
    });

    document.querySelectorAll('.seg').forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    });
    $('#reset-btn').addEventListener('click', () => setView(state.view));

    $('#path-go').addEventListener('click', runPath);
    $('#path-clear').addEventListener('click', () => {
      $('#path-a').value = ''; $('#path-b').value = '';
      $('#path-hint').textContent = '';
      clearHighlight();
    });

    const themeBtn = $('#theme-btn');
    const setTheme = (dark) => {
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      themeBtn.textContent = dark ? '☀️ 日间' : '🌙 夜间';
      localStorage.setItem('ba-theme', dark ? 'dark' : 'light');
      if (state.chart) state.chart.setOption(buildOption());
    };
    themeBtn.addEventListener('click', () => setTheme(document.documentElement.dataset.theme !== 'dark'));
    setTheme(localStorage.getItem('ba-theme') === 'dark');
  }

  /* ---------------- 启动 ---------------- */
  bindUI();
  boot();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
