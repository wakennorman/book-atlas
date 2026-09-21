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
    fit: { s: 1, cx: 0, cy: 0 }, // 最近一次 fitPositions 的变换（供代际参考线换算）
    bbox: null,            // 节点包围盒（缩放后、居中于 0）——图注按它定位
    freezeTimer: null,
    progress: null,        // 剧透保护：null=全部解锁；数字=已读到第几章，之后的锁定
    nodeDrag: false,       // 是否允许拖动单个节点（默认关，避免与画布平移打架）
    groupMode: 'generation', // 'generation'（有代际）| 'faction'（无代际，按阵营分组）
    bandLabels: new Map(),   // 分组键 -> 图注文字（第 N 代 / 阵营名）
    places: new Map(),       // placeId -> place
    placeFilter: null,       // 当前地点筛选
    showMentioned: false,    // 是否显示「仅被提及」的人物（默认折叠）
    showMinor: false,        // 是否显示 tier=minor 的次要人物（大书默认折叠）
    showDerived: true,       // 是否显示"族谱补全"推导出来的祖孙/叔侄等关系（默认显示）
    sizeFilter: 'all',       // all | mid | main（按关系数只显示主要人物；大书用）
    focus: null,             // { id, depth } 只看某人 N 跳以内（无限画布的"放大镜"）
    focusCache: null,        // 聚焦集合缓存
    rank: null,              // id -> 关系数排名（sizeFilter 用）
    zoom: 1,                 // 当前缩放（标签按缩放分级显示）
    labelTimer: null,
  };

  /* ---------------- 工具 ---------------- */
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // 亲属关系（kin）徽章：血缘 / 婚姻 / 姻亲 / 收养 / 抚养 / 继亲 / 结义
  const KIN_LABEL = { blood: '血缘', marriage: '婚姻', inlaw: '姻亲', adoptive: '收养', foster: '抚养', step: '继亲', sworn: '结义' };
  const KIN_HINT = {
    blood: '亲生血缘', marriage: '夫妻（婚姻）', inlaw: '姻亲（配偶方亲属）',
    adoptive: '正式收养', foster: '非正式（被谁带大、寄养）', step: '继亲（继父母/继子女）', sworn: '结义／干亲／教父'
  };
  const kinBadge = (rel) => {
    const k = rel && rel.kin;
    return k && KIN_LABEL[k] ? ` <span class="kin-badge k-${esc(k)}" title="${KIN_LABEL[k]}：${KIN_HINT[k] || ''}">${KIN_LABEL[k]}</span>` : '';
  };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const genText = (g) => (g === 0 ? '前史' : `第 ${g} 代`);
  const charName = (id) => state.byId.get(id)?.name || id;

  /* ---------------- 分组（有代际按代，无代际按阵营） ---------------- */
  const factionNameOf = (c) => (state.book?.factions.find((f) => f.key === c.faction) || {}).name || '其他';
  const groupKeyOf = (c) => (state.groupMode === 'generation' ? `g${c.generation}` : `f${c.faction || 'other'}`);
  const groupLabelOf = (c) => (state.groupMode === 'generation' ? genText(c.generation) : factionNameOf(c));
  const genPrefix = (c) => (state.groupMode === 'generation' ? esc(genText(c.generation)) + ' · ' : '');
  const isMentioned = (c) => c && c.tier === 'mentioned';
  const isMinor = (c) => c && c.tier === 'minor';
  const isDerived = (r) => !!(r && r.derived);                 // 由亲子关系推导出来的族谱边（原文没有直接互动）
  const relVisible = (r) => !isDerived(r) || state.showDerived;
  // 折叠：mentioned（没出场）/ minor（只跟一两个人有关系，大书里默认收起）——被高亮/搜索命中时照样显示
  const isCharHidden = (c) => {
    if (!c) return false;
    if (state.hlNodes.has(c.id)) return false;
    if (isMentioned(c)) return !state.showMentioned;
    if (isMinor(c)) return !state.showMinor;
    return false;
  };
  const placeOf = (id) => state.places.get(id) || null;
  const placeName = (id) => (placeOf(id) || {}).name || '';
  // 地点范围：该地点的事件涉及的人物 + 该地点发生的关系事件的两端
  const placeNodeScope = () => {
    if (!state.placeFilter) return null;
    const nodes = new Set();
    for (const e of state.book.events) if (e.place === state.placeFilter && !eventLocked(e)) for (const cid of e.chars || []) if (state.byId.has(cid)) nodes.add(cid);
    for (const r of state.book.relations) for (const ev of r.events || []) if (ev.place === state.placeFilter) { nodes.add(r.from); nodes.add(r.to); }
    return nodes;
  };
  const placeRelSet = (r) => (r.events || []).some((ev) => ev.place === state.placeFilter);

  /* ---------------- 剧透保护（按章节进度锁定） ---------------- */
  const chOf = (s) => { const m = String(s || '').match(/(\d+)/); return m ? Number(m[1]) : null; };
  const charCh = (c) => (typeof c?.firstCh === 'number' ? c.firstCh : (chOf(c?.chapter) || 0));
  const relCh = (r) => {
    const list = (r.events || []).map((e) => chOf(e.chapter)).filter((n) => n !== null);
    if (list.length) return Math.min(...list);
    return Math.min(charCh(state.byId.get(r.from)), charCh(state.byId.get(r.to)));
  };
  const lockedCh = (ch) => state.progress !== null && ch > state.progress;
  const charLocked = (c) => !!c && lockedCh(charCh(c));
  const relLocked = (r) => lockedCh(relCh(r));
  const eventLocked = (e) => lockedCh(typeof e.ch === 'number' ? e.ch : 0);
  const eventChOf = (ev) => chOf(ev?.chapter) ?? 0;
  const visibleRelEvents = (r) => (r.events || []).filter((ev) => state.progress === null || eventChOf(ev) <= state.progress);
  const relHiddenEventCount = (r) => (r.events || []).length - visibleRelEvents(r).length;
  // 人物的「最后出场章」＝本人出场章、相关事件章、相关关系事件章的最大值（用来决定结局能不能显示）
  const charLastCh = (c) => {
    if (!c || !state.book) return 0;
    let last = charCh(c);
    for (const e of state.book.events) if ((e.chars || []).includes(c.id)) last = Math.max(last, e.ch || 0);
    for (const r of state.book.relations) {
      if (r.from !== c.id && r.to !== c.id) continue;
      for (const ev of r.events || []) last = Math.max(last, eventChOf(ev));
    }
    return last;
  };
  const fateLocked = (c) => state.progress !== null && charLastCh(c) > state.progress;
  const maxChapter = () => state.book?.meta?.chapters || Math.max(
    0,
    ...state.book.characters.map(charCh),
    ...state.book.events.map((e) => e.ch || 0)
  );
  const orderPair = (a, b) => {
    const pa = state.pos.get(a), pb = state.pos.get(b);
    if (pa && pb) {
      const horizontal = Math.abs(pb.x - pa.x) >= Math.abs(pb.y - pa.y);
      const first = horizontal ? (pa.x <= pb.x ? a : b) : (pa.y <= pb.y ? a : b);
      return [first, first === a ? b : a];
    }
    return [a, b];
  };

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

    const params = new URLSearchParams(location.search);
    const wanted0 = params.get('book');
    const wantLocal = params.get('local') === '1';

    // 浏览器本地草稿（编辑器保存的）也放进书目列表
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('ba-draft-')) continue;
      try {
        const draft = JSON.parse(localStorage.getItem(key));
        const slug = draft?.meta?.slug || key.replace('ba-draft-', '');
        const entry = { slug, title: `${draft?.meta?.title || slug}（本地草稿）`, local: true };
        const idx = state.books.findIndex((b) => b.slug === slug);
        if (idx >= 0) {
          if (wantLocal && slug === wanted0) state.books[idx] = entry;   // 预览本地草稿时覆盖正式版
          continue;
        }
        state.books.push(entry);
      } catch (e) { /* 忽略坏草稿 */ }
    }

    const sel = $('#book-select');
    sel.innerHTML = state.books.map((b) => `<option value="${esc(b.slug)}">${esc(b.title)}</option>`).join('');
    sel.addEventListener('change', () => loadBook(sel.value));

    const wanted = params.get('book');
    const slug = state.books.some((b) => b.slug === wanted) ? wanted : state.books[0].slug;
    sel.value = slug;
    await loadBook(slug);
  }

  async function loadBook(slug) {
    const meta = state.books.find((b) => b.slug === slug);
    let book;
    if (meta && meta.local) {
      book = JSON.parse(localStorage.getItem('ba-draft-' + slug));
    } else {
      const res = await fetch(meta.file, { cache: 'no-cache' });
      book = await res.json();
    }
    state.book = book;
    state.byId = new Map(book.characters.map((c) => [c.id, c]));
    state.adj = new Map(book.characters.map((c) => [c.id, []]));
    for (const r of book.relations) {
      if (!state.byId.has(r.from) || !state.byId.has(r.to)) continue;
      state.adj.get(r.from).push({ to: r.to, rel: r });
      state.adj.get(r.to).push({ to: r.from, rel: r });
    }
    const savedView = localStorage.getItem('ba-view');
    state.view = ['force', 'gen-h', 'gen-v'].includes(savedView) ? savedView : 'gen-v';
    state.bands = new Map();
    const gens = new Set(book.characters.map((c) => c.generation));
    state.groupMode = (book.meta && book.meta.groupMode) || (gens.size > 1 ? 'generation' : 'faction');
    state.bandLabels = new Map();
    state.places = new Map((book.places || []).map((p) => [p.id, p]));
    state.placeFilter = null;
    state.rank = null;
    state.focus = null;
    state.focusCache = null;
    state.zoom = 1;
    try { state.sizeFilter = localStorage.getItem('ba-size-filter') || 'all'; } catch (e) { state.sizeFilter = 'all'; }
    const sizeSel0 = document.getElementById('size-filter');
    if (sizeSel0) sizeSel0.value = state.sizeFilter;
    renderFocusBar();
    try { state.showMentioned = localStorage.getItem('ba-mentioned') === '1'; } catch (e) { state.showMentioned = false; }
    try { state.showMinor = localStorage.getItem('ba-minor') === '1'; } catch (e) { state.showMinor = false; }
    try { state.showDerived = localStorage.getItem('ba-derived') !== '0'; } catch (e) { state.showDerived = true; }
    const savedSpoiler = localStorage.getItem('ba-spoiler-' + book.meta.slug);
    state.progress = null;
    if (savedSpoiler) {
      try { const s = JSON.parse(savedSpoiler); state.progress = s.on ? s.ch : null; } catch (e) { state.progress = null; }
    }
    clearHighlight(false);
    history.replaceState(null, '', `?book=${encodeURIComponent(slug)}`);
    renderHeader();
    renderLegend();
    renderDatalist();
    renderPathSelects();
    renderTimeline();
    renderPlaceSelect();
    renderPanelWelcome();
    initChart();
    syncSpoilerButton();
    if (!savedSpoiler) setTimeout(() => openSpoilerModal(), 400);
  }

  /* ---------------- 头部 / 图例 / 表单 ---------------- */
  function renderHeader() {
    const b = state.book, m = b.meta || {};
    $('#book-meta').textContent = `《${m.title || b.meta?.slug || '未命名'}》${m.author ? ' · ' + m.author : ''} · ${b.characters.length} 人 / ${b.relations.length} 段关系 / ${b.events.length} 个事件`;
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
    $('#char-list').innerHTML = state.book.characters
      .filter((c) => !charLocked(c) && !isCharHidden(c))
      .map((c) => `<option value="${esc(c.name)}">${esc(c.title)}</option>`).join('');
  }

  function renderPathSelects() {
    const opts = state.book.characters.filter((c) => !charLocked(c) && !isCharHidden(c))
      .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
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

  /* —— 人数过滤（书太大时先只看主要人物） —— */
  function degreeRanking() {
    if (!state.rank) {
      state.rank = new Map();
      const sorted = [...state.byId.keys()].sort((a, b) => nodeDegree(b) - nodeDegree(a));
      sorted.forEach((id, i) => state.rank.set(id, i + 1));
    }
    return state.rank;
  }
  function sizeLimit() {
    return state.sizeFilter === 'main' ? 60 : state.sizeFilter === 'mid' ? 200 : Infinity;
  }
  function passSizeFilter(id) {
    const lim = sizeLimit();
    if (lim === Infinity) return true;
    if (state.focus && state.focus.id === id) return true;              // 聚焦的人永远显示
    return (degreeRanking().get(id) || 9999) <= lim;
  }

  /* —— 聚焦：只看某人 N 跳以内 —— */
  function focusSet() {
    if (!state.focus) return null;
    const key = `${state.focus.id}|${state.focus.depth}`;
    if (state.focusCache && state.focusCache.key === key) return state.focusCache.set;
    const set = new Set([state.focus.id]);
    let frontier = [state.focus.id];
    for (let d = 0; d < state.focus.depth; d++) {
      const next = [];
      for (const id of frontier) {
        for (const { to, rel } of state.adj.get(id) || []) {
          if (relLocked(rel)) continue;
          if (set.has(to)) continue;
          set.add(to);
          next.push(to);
        }
      }
      frontier = next;
    }
    state.focusCache = { key, set };
    return set;
  }
  const passFocus = (id) => {
    const set = focusSet();
    return !set || set.has(id);
  };

  function buildOption() {
    const b = state.book;
    const ink = cssVar('--ink') || '#232a35';
    const muted = cssVar('--muted') || '#6c7482';
    const panel = cssVar('--panel') || '#fff';
    const line = cssVar('--line') || '#e5dfd3';
    const anyDim = state.hlNodes.size > 0 || state.hlEdges.size > 0;

    const data = b.characters.filter((c) => !isCharHidden(c) && passSizeFilter(c.id) && passFocus(c.id)).map((c) => {
      const dim = anyDim && !state.hlNodes.has(c.id);
      const locked = charLocked(c);
      const mentioned = isMentioned(c);
      const pos = state.pos.get(c.id);
      return {
        id: c.id, name: locked ? '🔒' : c.name, value: c.title,
        category: categoryOf(c),
        symbol: c.gender === 'f' ? 'roundRect' : 'circle',
        symbolSize: (mentioned ? 12 : symbolSize(c.id)) * (state.hlNodes.has(c.id) && anyDim ? 1.15 : 1),
        x: pos ? pos.x : undefined, y: pos ? pos.y : undefined,
        itemStyle: mentioned
          ? { color: 'transparent', borderColor: '#8b94a7', borderWidth: 1.5, borderType: 'dashed', opacity: dim ? 0.2 : 0.85 }
          : {
              opacity: dim ? 0.16 : (locked ? 0.4 : 1),
              color: locked ? '#9aa3b0' : ((b.factions.find((f) => f.key === c.faction) || {}).color || '#8b94a7'),
              borderColor: panel,
              borderWidth: 1,
            },
        label: {
          color: mentioned ? muted : (dim ? muted : ink),
          opacity: dim ? 0.35 : 1,
          textBorderColor: panel,
          textBorderWidth: 3,
          show: mentioned ? !anyDim || state.hlNodes.has(c.id) : (locked ? false : (state.allLabels || (state.labels ? state.labels.has(c.id) : nodeDegree(c.id) >= 4))),
        },
      };
    });

    // 代际视图：把「前史 / 第1代 …」做成图里的虚拟节点，跟随缩放与平移；
    // 位置固定在节点包围盒之外（横向在顶部 gutter、纵向在左侧 gutter）——聚焦模式下不画
    if (state.view !== 'force' && state.bands.size && !state.focus) {
      const isH = state.view === 'gen-h';
      let bb = state.bbox;
      if (!bb && state.pos.size) {   // 兜底：没有包围盒时，就用当前节点坐标现算一个
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of state.pos.values()) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        bb = { minX, maxX, minY, maxY };
      }
      if (!bb) {
        const r = document.getElementById('graph').getBoundingClientRect();
        bb = { minX: -((r.width || 900) / 2), minY: -((r.height || 600) / 2) };
      }
      for (const [g, band] of state.bands) {
        data.push({
          id: `__gen_${g}`,
          name: state.bandLabels.get(g) || String(g),
          symbol: 'circle',
          symbolSize: 3,
          x: isH ? band : bb.minX - 30,
          y: isH ? bb.minY - 26 : band,
          label: {
            show: true, color: muted, fontSize: 11.5, fontWeight: 'bold',
            position: isH ? 'top' : 'left', distance: 4,
          },
          itemStyle: { color: 'transparent' },
          labelLayout: { hideOverlap: false },
          emphasis: { disabled: true },
          tooltip: { show: false },
          silent: true,
        });
      }
    }

    const links = b.relations
      .filter((r) => state.byId.has(r.from) && state.byId.has(r.to) && !relLocked(r))
      .filter((r) => !isCharHidden(state.byId.get(r.from)) && !isCharHidden(state.byId.get(r.to)))
      .filter((r) => passSizeFilter(r.from) && passSizeFilter(r.to) && passFocus(r.from) && passFocus(r.to))
      .filter(relVisible)
      .map((r) => {
        const hiddenTier = isMentioned(state.byId.get(r.from)) || isMentioned(state.byId.get(r.to));
        const derived = isDerived(r);
        const key = edgeKey(r.from, r.to);
      const dim = anyDim && !state.hlEdges.has(key);
      return {
        source: r.from, target: r.to, value: r.type,
        lineStyle: {
          width: state.hlEdges.has(key) && anyDim ? 3 : 1.2,
          opacity: dim ? 0.07 : (derived ? 0.32 : (hiddenTier ? 0.3 : 0.5)),
          type: hiddenTier || derived ? 'dashed' : (r.style === 'dashed' ? 'dashed' : r.style === 'dotted' ? 'dotted' : 'solid'),
          curveness: 0.08,
        },
      };
    });

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item', confine: true,
        backgroundColor: panel, borderColor: line, borderWidth: 1,
        textStyle: { color: ink, fontSize: 12.5 },
        extraCssText: 'max-width:340px;white-space:normal;line-height:1.55;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12)',
        formatter: (p) => {
          if (p.dataType === 'edge') {
            const rel = findRel(p.data.source, p.data.target);
            if (!rel) return '';
            const [first, second] = orderPair(rel.from, rel.to);
            const vis = visibleRelEvents(rel);
            const hidden = (rel.events || []).length - vis.length;
            const evs = vis.map((e) => `· ${esc(e.text)}${e.chapter ? `<span style="color:${muted}">（${esc(e.chapter)}）</span>` : ''}`).join('<br>');
            return `<b>${esc(charName(first))} — ${esc(rel.type)} — ${esc(charName(second))}</b>${kinBadge(rel)}${isDerived(rel) ? ' <span class="badge">推导</span>' : ''}<br>${evs}` +
              (hidden ? `<br><span style="color:${muted}">🔒 还有 ${hidden} 条事件在你读到的进度之后</span>` : '');
          }
          const c = state.byId.get(p.data.id);
          if (!c) return '';
          if (charLocked(c)) {
            return `🔒 <b>剧透保护中</b><br><span style="color:${muted}">这个人物在第 ${charCh(c)} 章才出场；你现在读到第 ${state.progress} 章。读完再来看。</span>`;
          }
          return `<b>${esc(c.name)}</b>${c.aliases && c.aliases.length ? `（${esc(c.aliases.join('，'))}）` : ''}<br>` +
            `<span style="color:${muted}">${genPrefix(c)}${esc(c.title)}</span><br>${esc(c.desc)}<br>` +
            `<span style="color:${muted}">结局：${fateLocked(c) ? '🔒 在你读到的进度之后' : esc(c.fate)}</span>` +
            (isMentioned(c) ? `<br><span style="color:${muted}">（仅被提及 · 未出场；第 ${charCh(c)} 章）</span>` : '');
        },
      },
      series: [{
        type: 'graph',
        layout: (state.frozen && !state.focus) ? 'none' : 'force',
        roam: true, draggable: state.nodeDrag,
        categories: b.factions.map((f) => ({ name: f.name, itemStyle: { color: f.color } })),
        force: { repulsion: 900, gravity: 0.04, edgeLength: [80, 190], layoutAnimation: true, friction: 0.6, initLayout: 'circular' },
        data, links,
        label: {
          show: true,
          position: state.view === 'force' ? 'right' : 'bottom',
          distance: 4, fontSize: 10.5, color: ink, formatter: '{b}',
        },
        labelLayout: { hideOverlap: false },
        lineStyle: { color: 'source' },
        scaleLimit: { min: 0.02, max: 40 },   // 无限画布：从"看全貌"一路放大到"看清单个人"
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
    const W = rect.width || 800, H = rect.height || 500;
    // 边距＝图注专用通道（gutter）：横向留顶部、纵向留左侧
    const padX = state.view === 'gen-v' ? 150 : 90;
    const padY = state.view === 'gen-h' ? 110 : 70;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of state.pos.values()) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    // 无限画布：允许缩到很小（先看全貌），也允许放得很大（看清单个人）
    const s = Math.max(0.02, Math.min((W - 2 * padX) / w, (H - 2 * padY) / h, 1.4));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    state.fitLast = s;                       // 最近一次的缩放（"看清 1:1" 按钮要用它换算）
    const prev = state.fit || { s: 1, cx: 0, cy: 0 };
    state.fit = {
      s: prev.s * s,
      cx: prev.cx + cx / (prev.s || 1),
      cy: prev.cy + cy / (prev.s || 1),
    };
    for (const [id, p] of state.pos) state.pos.set(id, { x: (p.x - cx) * s, y: (p.y - cy) * s });
    // 节点包围盒（已缩放、居中于 0）——图注按它定位，保证在节点区之外
    state.bbox = { minX: -(w * s) / 2, maxX: (w * s) / 2, minY: -(h * s) / 2, maxY: (h * s) / 2 };
    // 代际参考线同步缩放，保证「前史 / 第 N 代」始终对着对应那一列/行
    if (state.view === 'gen-h') {
      for (const [g, v] of state.bands) state.bands.set(g, (v - cx) * s);
    } else if (state.view === 'gen-v') {
      for (const [g, v] of state.bands) state.bands.set(g, (v - cy) * s);
    }
  }

  function computeLabels(zoom = state.zoom || 1) {
    if (state.allLabels || !state.pos.size) { state.labels = null; return; }
    // 放大后能看清更多名字：屏幕上的节点越大，越多标签有资格显示（像地图分级）
    const minScreenSize = 15;
    const cands = state.book.characters
      .filter((c) => state.pos.has(c.id) && passSizeFilter(c.id) && passFocus(c.id))
      .filter((c) => isMentioned(c) ? state.hlNodes.has(c.id) : symbolSize(c.id) * zoom >= minScreenSize)
      .map((c) => {
        const size = symbolSize(c.id) * zoom;
        // 标签框只按"文字宽度 + 节点半个身子"算——节点直径不能整个算进去，否则放大后盒子巨大、互相压掉
        const chip = Math.min(size, 64);
        const w = c.name.length * 11.5 + chip + 6, h = Math.max(chip, 18);
        const p = state.pos.get(c.id);
        const sx = p.x * zoom + chip / 2;
        return { id: c.id, deg: nodeDegree(c.id), bx: sx - w / 2, by: p.y * zoom - h / 2, w, h };
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

  function freezeNow() {    if (state.frozen || !state.chart) return;
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

  function applyViewHeight() {
    const el = document.getElementById('graph');
    if (!el || !state.book) return;
    // 现在布局是世界坐标 + 自动适配缩放，容器只要给一个舒服的高度就够了：
    // 千万不能再按人数把容器撑到上万像素（那样画布中心会被推到屏幕外，看起来就是"点了没反应"）
    const counts = new Map();
    for (const c of state.book.characters) counts.set(groupKeyOf(c), (counts.get(groupKeyOf(c)) || 0) + 1);
    const groupCount = counts.size || 1;
    const base = state.view === 'gen-v' ? (groupCount <= 6 ? 640 : 720) : 700;
    el.style.height = base + 'px';
  }

  function buildGenerationPositions(view) {
    const rect = document.getElementById('graph').getBoundingClientRect();
    const W = rect.width || 900, H = rect.height || 600;
    const factionOrder = new Map(state.book.factions.map((f, i) => [f.key, i]));
    const groups = [...new Set(state.book.characters.map(groupKeyOf))];
    groups.sort((a, b) => {
      if (state.groupMode === 'generation') return Number(a.slice(1)) - Number(b.slice(1));
      return (factionOrder.get(a.slice(1)) ?? 99) - (factionOrder.get(b.slice(1)) ?? 99);
    });
    const byGen = new Map(groups.map((g) => [g, []]));
    for (const c of state.book.characters) byGen.get(groupKeyOf(c)).push(c);
    for (const list of byGen.values()) {
      list.sort((a, b) => (
        (state.groupMode === 'generation'
          ? (factionOrder.get(a.faction) ?? 99) - (factionOrder.get(b.faction) ?? 99)
          : a.generation - b.generation)
        || (nodeDegree(b.id) - nodeDegree(a.id))
        || a.name.localeCompare(b.name)));
    }
    state.pos = new Map();
    state.bands = new Map();
    state.bandLabels = new Map();
    const mainPad = 110, crossPad = 78;
    // 世界坐标不跟着视口走：一行（组）里有多少人，就铺多长——放大后自然不重叠（无限画布）
    const maxCount = Math.max(1, ...groups.map((g) => byGen.get(g).length));
    const maxSymbol = Math.min(40, 15 + Math.max(...[...state.byId.keys()].map(nodeDegree)) * 2.2);
    const stepCross = Math.max(34, maxSymbol + 10);
    const stepMain = Math.max(200, 240);
    const viewMain = (view === 'gen-h' ? W : H) - mainPad * 2;
    const viewCross = (view === 'gen-h' ? H : W) - crossPad * 2;
    const mainLen = Math.max(viewMain, (groups.length - 1) * stepMain);
    const crossLen = Math.max(viewCross, (maxCount - 1) * stepCross);
    groups.forEach((g, gi) => {
      const center = groups.length === 1 ? 0 : -mainLen / 2 + (mainLen * gi) / (groups.length - 1);
      state.bands.set(g, center);
      const sample = byGen.get(g)[0];
      state.bandLabels.set(g, sample ? groupLabelOf(sample) : String(g));
      const list = byGen.get(g);
      const step = list.length > 1 ? crossLen / (list.length - 1) : 0;
      list.forEach((c, ci) => {
        const off = list.length === 1 ? 0 : -crossLen / 2 + ci * step;
        state.pos.set(c.id, view === 'gen-h' ? { x: center, y: off } : { x: off, y: center });
      });
    });
  }

  function syncViewButtons() {
    const isGen = state.groupMode === 'generation';
    const bh = document.querySelector('.seg[data-view="gen-h"]');
    const bv = document.querySelector('.seg[data-view="gen-v"]');
    if (bh) { bh.textContent = isGen ? '代际·横' : '分组·横'; bh.title = isGen ? '按代际分列，从左到右' : '按阵营分组分列，从左到右'; }
    if (bv) { bv.textContent = isGen ? '代际·纵' : '分组·纵'; bv.title = isGen ? '按代际分行，从上到下' : '按阵营分组分行，从上到下'; }
    document.querySelectorAll('.seg').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === state.view));
  }

  function setView(view) {
    state.view = view;
    state.zoom = 1;
    try { localStorage.setItem('ba-view', view); } catch (e) { /* 隐私模式忽略 */ }
    syncViewButtons();
    applyViewHeight();
    updateCountHint();
    if (!state.chart) return;
    clearTimeout(state.freezeTimer);
    if (view === 'force') {
      state.frozen = false;
      // 人特别多时，保留当前布局坐标当力导向的起点（否则从圆形随机起步，几百个节点要算很久）
      const many = state.byId.size > 400;
      if (!many) state.pos = new Map();
      state.bands = new Map();
      state.fit = { s: 1, cx: 0, cy: 0 };
      state.labels = null;
      state.zoom = 1;
      state.chart.clear();
      state.chart.setOption(buildOption(), { notMerge: true });
      state.freezeTimer = setTimeout(() => freezeNow(), many ? 12000 : 6000);
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

  function resetRoam() {
    if (!state.chart) return;
    // clear + setOption 会把缩放/平移复位，但保留当前布局坐标
    state.chart.clear();
    state.chart.setOption(buildOption(), { notMerge: true });
    state.zoom = 1;
  }

  /* ---------------- 聚焦 / 人数过滤（无限画布的两个"放大镜"） ---------------- */
  function updateCountHint() {
    const el = document.getElementById('count-hint');
    if (!el || !state.book) return;
    const total = state.book.characters.length;
    const shown = state.book.characters.filter((c) => !isCharHidden(c) && passSizeFilter(c.id) && passFocus(c.id)).length;
    el.textContent = shown >= total ? `${total} 人` : `显示 ${shown} / ${total} 人`;
  }
  function renderFocusBar() {
    const bar = document.getElementById('focus-bar');
    if (!bar) return;
    if (!state.focus) { bar.hidden = true; return; }
    const c = state.byId.get(state.focus.id) || { name: state.focus.id };
    const n = (focusSet() || new Set()).size;
    bar.hidden = false;
    bar.innerHTML = `🎯 聚焦「${esc(c.name)}」· ${state.focus.depth} 跳以内 · ${n} 人
      <button class="ghost tiny" type="button" data-focus-nav="dec">− 跳</button>
      <button class="ghost tiny" type="button" data-focus-nav="inc">＋ 跳</button>
      <button class="ghost tiny" type="button" data-focus-exit="1">看全部</button>`;
  }

  function applyFocus(id, depth) {
    state.focus = id ? { id, depth: Math.max(1, Math.min(3, depth || 1)) } : null;
    state.focusCache = null;
    clearHighlight(false);
    state.frozen = false;                       // 聚焦时用 force 布局（子图小，排得开）
    state.fit = { s: 1, cx: 0, cy: 0 };
    if (state.chart) {
      clearTimeout(state.freezeTimer);
      state.chart.clear();
      state.chart.setOption(buildOption(), { notMerge: true });
      state.zoom = 1;
      if (state.focus) state.freezeTimer = setTimeout(() => freezeNow(), 2500);
    }
    renderFocusBar();
    updateCountHint();
    if (state.focus) {
      const c = state.byId.get(state.focus.id);
      if (c) renderCharacterPanel(c);
    }
  }

  function applySizeFilter(v) {
    state.sizeFilter = v || 'all';
    try { localStorage.setItem('ba-size-filter', state.sizeFilter); } catch (e) { /* 忽略 */ }
    const sel = document.getElementById('size-filter');
    if (sel && sel.value !== state.sizeFilter) sel.value = state.sizeFilter;
    if (state.chart) {
      if (state.frozen && !state.focus) {
        buildGenerationPositions(state.view);
        relaxPositions(80);
        fitPositions();
        computeLabels(state.zoom);
      }
      state.chart.clear();
      state.chart.setOption(buildOption(), { notMerge: true });
    }
    updateCountHint();
  }

  function initChart() {
    const el = $('#graph');
    if (state.chart) { state.chart.dispose(); }
    clearTimeout(state.freezeTimer);
    state.chart = echarts.init(el, null, { renderer: 'canvas' });
    state.frozen = false;
    state.pos = new Map();
    state.bands = new Map();
    state.fit = { s: 1, cx: 0, cy: 0 };
    setView(state.view);   // 按当前视图初始化（默认＝代际·纵，可在布局里切换，选择会被记住）

    state.chart.on('click', (p) => {
      if (p.dataType === 'node' && String(p.data.id || '').startsWith('__gen_')) return;
      if (p.dataType === 'edge') {
        const rel = findRel(p.data.source, p.data.target);
        if (rel) selectRelation(rel);
      } else if (p.dataType === 'node') {
        selectCharacter(p.data.id);
      }
    });
    state.chart.getZr().on('click', (e) => { if (!e.target) clearHighlight(); });
    // 双击空白处＝复位视图（缩放/平移乱掉时最快恢复）
    state.chart.getZr().on('dblclick', (e) => { if (!e.target) resetRoam(); });
    // 拖动节点后同步坐标，避免下次重绘把它拉回去
    state.chart.on('dragend', () => {
      const d = state.chart.getModel().getSeriesByIndex(0).getData();
      for (let i = 0; i < d.count(); i++) {
        const id = d.getId(i);
        if (!id || String(id).startsWith('__gen_')) continue;
        const l = d.getItemLayout(i);
        if (l) state.pos.set(id, { x: l[0] ?? l.x, y: l[1] ?? l.y });
      }
    });

    // 缩放联动标签：放大后露出更多名字（节流 200ms）
    state.chart.on('graphroam', (p) => {
      if (typeof p.zoom === 'number' && p.zoom > 0) state.zoom = p.zoom;
      clearTimeout(state.labelTimer);
      state.labelTimer = setTimeout(() => {
        if (state.allLabels || !state.chart) return;
        const before = state.labels ? state.labels.size : -1;
        computeLabels(state.zoom);
        if (state.labels && state.labels.size !== before) state.chart.setOption(buildOption());
      }, 200);
    });

    const onResize = () => {
      if (!state.chart) return;
      applyViewHeight();
      state.chart.resize();
      if (state.frozen) {
        if (state.view === 'force') {
          fitPositions();
        } else {
          buildGenerationPositions(state.view);
          fitPositions();          // 关键：重建位置后必须重算包围盒，图注才不会压到节点
        }
        computeLabels();
        resetRoam();
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

  function renderLockedPanel(kind, item) {
    const ch = kind === 'character' ? charCh(item) : (item.ch || 0);
    panel().innerHTML = `
      <div class="card-title">🔒 剧透保护中</div>
      <p class="card-desc">这一部分对应第 ${ch} 章；你现在读到第 ${state.progress} 章，所以先锁起来。</p>
      <p class="hint">读完再回来，或者到右上角「剧透保护」里改进度。</p>
      <p style="margin-top:10px"><button class="primary" type="button" id="panel-open-spoiler">调整进度</button></p>`;
    const btn = document.getElementById('panel-open-spoiler');
    if (btn) btn.addEventListener('click', () => openSpoilerModal());
  }

  function selectCharacter(id) {
    const c = state.byId.get(id);
    if (!c) return;
    if (charLocked(c)) { renderLockedPanel('character', c); return; }
    // 地点筛选开启时：只在该地点范围内展开关系；点到范围外的人则自动取消筛选
    if (state.placeFilter) {
      const scope = placeNodeScope() || new Set();
      if (!scope.has(id)) {
        applyPlaceFilter(null);
      } else {
        const nodes = new Set([id]);
        const edges = new Set();
        for (const r of state.book.relations) {
          if (!placeRelSet(r)) continue;
          const other = r.from === id ? r.to : (r.to === id ? r.from : null);
          if (!other || !scope.has(other)) continue;
          nodes.add(other);
          edges.add(edgeKey(id, other));
        }
        setHighlight(nodes, edges, id, null);
        renderCharacterPanel(c);
        return;
      }
    }
    const nodes = new Set([id]);
    const edges = new Set();
    for (const e of state.adj.get(id)) { nodes.add(e.to); edges.add(edgeKey(id, e.to)); }
    state.panelKind = 'char';
    state.panelId = id;
    state.activeRel = null;
    setHighlight(nodes, edges, id, null);
    renderCharacterPanel(c);
  }

  function selectRelation(rel) {
    const nodes = new Set([rel.from, rel.to]);
    const edges = new Set([edgeKey(rel.from, rel.to)]);
    state.panelKind = 'rel';
    state.activeRel = rel;
    setHighlight(nodes, edges, null, null);
    renderRelationPanel(rel);
  }

  // 折叠/过滤开关变了以后，右侧面板要跟着重画（否则内容还是旧的）
  function refreshPanel() {
    if (state.panelKind === 'rel' && state.activeRel) { renderRelationPanel(state.activeRel); return; }
    if (state.panelKind === 'char' && state.panelId) { const c = state.byId.get(state.panelId); if (c) renderCharacterPanel(c); }
  }

  function selectEvent(id) {
    const ev = state.book.events.find((e) => e.id === id);
    if (!ev) return;
    if (eventLocked(ev)) { renderLockedPanel('event', ev); return; }
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
      <p class="hint">点节点看人物档案 · 点连线看关系与「定义关系的小事件」<br>
      空白处拖动＝平移画布，滚轮＝缩放，<b>双击空白＝复位视图</b>；要拖单个节点请打开上方「拖动节点」。<br>
      底部「两人关系」会算出最短关系链，并列出每一跳的依据事件。</p>`;
  }

  function charLink(id) { return `<button class="linkbtn" data-goto="${esc(id)}">${esc(charName(id))}</button>`; }
  function bindGoto(root) {
    root.querySelectorAll('[data-goto]').forEach((el) => el.addEventListener('click', () => selectCharacter(el.dataset.goto)));
    root.querySelectorAll('[data-event]').forEach((el) => el.addEventListener('click', () => selectEvent(el.dataset.event)));
    root.querySelectorAll('[data-place-filter]').forEach((el) => el.addEventListener('click', () => applyPlaceFilter(el.dataset.placeFilter || null)));
    root.querySelectorAll('[data-focus-rel]').forEach((el) => el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const [a, b] = String(el.dataset.focusRel).split('|');
      const rel = findRel(a, b);
      if (rel) selectRelation(rel);
    }));
  }

  /* ---------------- 地点筛选 ---------------- */
  function renderPlaceSelect() {
    const sel = document.getElementById('place-filter');
    if (!sel) return;
    const places = [...(state.book.places || [])].sort((a, b) => (a.firstCh ?? 0) - (b.firstCh ?? 0));
    sel.innerHTML = '<option value="">📍 全部地点</option>' + places
      .filter((p) => state.progress === null || (p.firstCh ?? 0) <= state.progress)
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    if (state.placeFilter && ![...sel.options].some((o) => o.value === state.placeFilter)) state.placeFilter = null;
    sel.value = state.placeFilter || '';
  }

  function renderPlacePanel(id, evs) {
    const p = placeOf(id);
    if (!p) return;
    panel().innerHTML = `
      <div class="card-title">📍 ${esc(p.name)}</div>
      <div class="card-sub">${esc(p.type || '地点')} · 首次出现：第 ${p.firstCh ?? '?'} 章</div>
      <p class="card-desc">${esc(p.desc || '')}</p>
      <h3 style="margin-top:12px;font-size:14px">在这里发生的事（${evs.length}）</h3>
      <ul class="rel-list">${evs.length ? evs.map((e) => `<li class="rel">
        <div class="rel-head">${esc(e.name)} <span class="type">第 ${e.ch ?? '?'} 章</span></div>
        <div class="rel-event">· ${esc(e.summary)}</div>
      </li>`).join('') : '<li class="hint">暂无（或都在你读到的进度之后）</li>'}</ul>
      <p style="margin-top:10px"><button class="ghost tiny" type="button" data-place-filter="">显示全部地点</button></p>`;
    bindGoto(panel());
  }

  function applyPlaceFilter(id) {
    state.placeFilter = id || null;
    const sel = document.getElementById('place-filter');
    if (sel) sel.value = state.placeFilter || '';
    renderTimeline();
    if (!state.placeFilter) { clearHighlight(); return; }
    const nodes = placeNodeScope() || new Set();
    const edges = new Set();
    for (const r of state.book.relations) {
      if (!placeRelSet(r)) continue;
      if (nodes.has(r.from) && nodes.has(r.to)) edges.add(edgeKey(r.from, r.to));
    }
    setHighlight(nodes, edges, null, null);
    renderPlacePanel(state.placeFilter, state.book.events.filter((e) => e.place === state.placeFilter && !eventLocked(e)));
  }

  function renderCharacterPanel(c) {
    const faction = state.book.factions.find((f) => f.key === c.faction);    const allRels = state.book.relations.filter((r) => (r.from === c.id || r.to === c.id) && relVisible(r));
    const rels = allRels.filter((r) => !relLocked(r)).sort((a, b) => (a.type > b.type ? 1 : -1));
    const lockedCount = allRels.length - rels.length;
    const relHtml = rels.map((r) => {
      const other = r.from === c.id ? r.to : r.from;
      const vis = visibleRelEvents(r);
      const hidden = (r.events || []).length - vis.length;
      const evs = vis.map((e) =>
        `<div class="rel-event">· ${e.place ? `<span class="chapter">📍${esc(placeName(e.place))}</span> ` : ''}${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
      return `<li class="rel">
        <div class="rel-head">${charLink(other)} <span class="type">— ${esc(r.type)} —</span>${kinBadge(r)}${isDerived(r) ? ' <span class="badge">推导</span>' : ''}
          <button class="ghost tiny" type="button" data-focus-rel="${esc(r.from)}|${esc(r.to)}" title="在图上只高亮这一条关系">定位这条线</button>
        </div>
        ${evs}${hidden ? `<div class="rel-event">🔒 还有 ${hidden} 条事件在你读到的进度之后</div>` : ''}
      </li>`;
    }).join('');

    panel().innerHTML = `
      <div class="card-title">${esc(c.name)}</div>
      <div class="card-sub">${genPrefix(c)}${esc(c.title)}</div>
      ${c.note ? `<div class="note">⚠️ ${esc(c.note)}</div>` : ''}
      <div class="badges">
        ${faction ? `<span class="badge faction" style="background:${esc(faction.color)}">${esc(faction.name)}</span>` : ''}
        <span class="badge">${c.gender === 'f' ? '♀ 女' : '♂ 男'}</span>
        ${isMentioned(c) ? '<span class="badge">仅被提及</span>' : ''}
        ${(c.aliases || []).map((a) => `<span class="badge">别名：${esc(a)}</span>`).join('')}
        <span class="badge">关系 ${allRels.length} 条</span>
      </div>
      <p class="card-desc">${esc(c.desc)}</p>
      <p class="card-fate"><b>结局：</b>${fateLocked(c) ? '🔒 在你读到的进度之后（读完再来看）' : esc(c.fate)}</p>
      <p class="hint" style="margin-top:8px">人太多看不清？只看这个人的关系网：
        <button class="ghost tiny" type="button" data-focus-node="${esc(c.id)}" data-focus-depth="1">🎯 1 跳</button>
        <button class="ghost tiny" type="button" data-focus-node="${esc(c.id)}" data-focus-depth="2">🎯 2 跳</button>
        ${state.focus ? '<button class="ghost tiny" type="button" data-focus-exit="1">退出聚焦</button>' : ''}
      </p>
      <h3 style="margin-top:12px;font-size:14px">与谁有关 · 凭什么事件</h3>
      ${state.placeFilter ? `<p class="hint">📍 正在按地点「${esc(placeName(state.placeFilter))}」筛选：图上只高亮该范围内的人与关系。
        <button class="ghost tiny" type="button" data-place-filter="">看全部</button></p>` : ''}
      ${lockedCount ? `<p class="hint">🔒 还有 ${lockedCount} 条关系在你读到的进度之后</p>` : ''}
      <ul class="rel-list">${relHtml || '<li class="hint">暂无记录</li>'}</ul>`;
    bindGoto(panel());
  }

  function renderRelationPanel(r) {
    const [first, second] = orderPair(r.from, r.to);
    const evs = (r.events || []).map((e) =>
      `<div class="rel-event">· ${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
    panel().innerHTML = `
      <div class="card-title">${charLink(first)} <span style="color:var(--muted);font-weight:400">— ${esc(r.type)} —</span>${kinBadge(r)}${isDerived(r) ? ' <span class="badge">推导</span>' : ''} ${charLink(second)}</div>
      <p class="card-sub">${isDerived(r) ? '这是<b>推导出来的亲属关系</b>（原文没有直接互动，由亲子关系推出来）' : '定义这段关系的事件'}${r.kin ? `（${KIN_LABEL[r.kin]}：${KIN_HINT[r.kin] || ''}）` : ''}</p>
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
      <p style="margin-top:10px">${ev.place ? `<button class="ghost tiny" type="button" data-place-filter="${esc(ev.place)}">📍 ${esc(placeName(ev.place))}</button>` : ''}
      <b>涉及：</b>${chain}</p>`;
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
        if (!relVisible(e.rel)) continue;
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
      const vis = visibleRelEvents(s.rel);
      const hidden = (s.rel.events || []).length - vis.length;
      const evs = vis.map((e) =>
        `<div class="rel-event">· ${e.place ? `<span class="chapter">📍${esc(placeName(e.place))}</span> ` : ''}${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
      return `<li class="rel">
        <div class="rel-head"><span class="idx">${i + 1}</span> ${charLink(s.from)} <span class="type">— ${esc(s.rel.type)} —</span>${kinBadge(s.rel)} ${charLink(s.to)}</div>
        ${evs}${hidden ? `<div class="rel-event">🔒 还有 ${hidden} 条事件在你读到的进度之后</div>` : ''}
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
      const evs = state.book.events
        .filter((e) => e.phase === p.id)
        .filter((e) => !state.placeFilter || e.place === state.placeFilter)
        .sort((a, b) => a.order - b.order);
      if (!evs.length) return '';
      return `<div class="phase">
        <div class="phase-title">${esc(p.name)}</div>
        ${evs.map((e) => eventLocked(e)
          ? `<button type="button" class="event-chip locked" disabled title="剧透保护：第 ${e.ch} 章的事件">
               <span class="ev-name">🔒 第 ${e.ch} 章的事件</span>
               <span class="ev-sum">剧透保护中 · 读到再解锁</span>
             </button>`
          : `<button type="button" class="event-chip" data-event="${esc(e.id)}">
               <span class="ev-name">${esc(e.name)}${e.place ? ` <span class="chapter">📍${esc(placeName(e.place))}</span>` : ''}</span>
               <span class="ev-sum">${esc(e.summary)}</span>
             </button>`).join('')}
      </div>`;
    }).join('');
    el.querySelectorAll('.event-chip').forEach((btn) => btn.addEventListener('click', () => selectEvent(btn.dataset.event)));
  }

  /* ---------------- 剧透保护 UI ---------------- */
  function syncSpoilerButton() {
    const btn = document.getElementById('spoiler-btn');
    if (!btn) return;
    btn.textContent = state.progress === null ? '🔓 剧透保护：关' : `🔒 剧透保护：读到第 ${state.progress} 章`;
  }

  function openSpoilerModal() {
    const modal = document.getElementById('spoiler-modal');
    if (!modal || !state.book) return;
    const sel = document.getElementById('spoiler-ch');
    const total = maxChapter() || 20;
    sel.innerHTML = Array.from({ length: total }, (_, i) => `<option value="${i + 1}">第 ${i + 1} 章</option>`).join('');
    if (state.progress) sel.value = String(state.progress);
    modal.hidden = false;
  }

  function closeSpoilerModal() {
    const modal = document.getElementById('spoiler-modal');
    if (modal) modal.hidden = true;
  }

  function applySpoiler(on, ch) {
    closeSpoilerModal();
    state.progress = on ? ch : null;
    const slug = state.book?.meta?.slug || 'book';
    try {
      localStorage.setItem('ba-spoiler-' + slug, JSON.stringify(on ? { on: true, ch } : { on: false }));
    } catch (e) { /* 隐私模式忽略 */ }
    try {
      clearHighlight(false);
      renderDatalist();
      renderPathSelects();
      renderTimeline();
      renderPlaceSelect();
      renderPanelWelcome();
      initChart();
    } catch (e) {
      console.warn('applySpoiler:', e);
    }
    syncSpoilerButton();
  }

  /* ---------------- 搜索 / 主题 / 事件绑定 ---------------- */
  function bindUI() {
    const search = $('#search-input');
    const doSearch = () => {
      const q = search.value.trim();
      if (!q) return;
      const match = (x) => x.name === q || (x.aliases || []).includes(q) || x.name.includes(q) || (x.aliases || []).some((a) => a.includes(q));
      const c = state.book.characters.find((x) => !charLocked(x) && !isCharHidden(x) && match(x));
      if (c) { selectCharacter(c.id); return; }
      const hiddenHit = state.book.characters.find((x) => isCharHidden(x) && match(x));
      if (hiddenHit) {                                  // 被折叠的人：自动展开层级再定位（搜索永远找得到）
        if (isMinor(hiddenHit)) { state.showMinor = true; try { localStorage.setItem('ba-minor', '1'); } catch (e) { /* 忽略 */ } }
        if (isMentioned(hiddenHit)) { state.showMentioned = true; try { localStorage.setItem('ba-mentioned', '1'); } catch (e) { /* 忽略 */ } }
        const minorBtn2 = document.getElementById('minor-btn');
        if (minorBtn2) minorBtn2.textContent = state.showMinor ? '次要人物：显示' : '次要人物：隐藏';
        const mentionBtn2 = document.getElementById('mentioned-btn');
        if (mentionBtn2) mentionBtn2.textContent = state.showMentioned ? '提及人物：显示' : '提及人物：隐藏';
        renderDatalist();
        renderPathSelects();
        updateCountHint();
        if (state.chart) state.chart.setOption(buildOption());
        selectCharacter(hiddenHit.id);
        return;
      }
      const lockedHit = state.book.characters.find((x) => charLocked(x) && match(x));
      $('#path-hint').textContent = lockedHit ? `「${q}」还没到你读到的进度（剧透保护中）` : `没找到「${q}」`;
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

    const placeSel = document.getElementById('place-filter');
    if (placeSel) placeSel.addEventListener('change', () => applyPlaceFilter(placeSel.value || null));

    // 人数过滤（大书：只看主要人物）
    const sizeSel = document.getElementById('size-filter');
    if (sizeSel) {
      sizeSel.value = state.sizeFilter;
      sizeSel.addEventListener('change', () => applySizeFilter(sizeSel.value));
    }

    // 聚焦条 / 聚焦按钮（事件委托，面板和聚焦条都能点）
    document.addEventListener('click', (ev) => {
      const go = ev.target.closest('[data-focus-node]');
      if (go) { applyFocus(go.dataset.focusNode, Number(go.dataset.focusDepth || 1)); return; }
      const nav = ev.target.closest('[data-focus-nav]');
      if (nav && state.focus) { applyFocus(state.focus.id, state.focus.depth + (nav.dataset.focusNav === 'inc' ? 1 : -1)); return; }
      if (ev.target.closest('[data-focus-exit]')) applyFocus(null, 1);
    });

    const mentionBtn = document.getElementById('mentioned-btn');
    const syncMentionBtn = () => { if (mentionBtn) mentionBtn.textContent = state.showMentioned ? '提及人物：显示' : '提及人物：隐藏'; };
    if (mentionBtn) mentionBtn.addEventListener('click', () => {
      state.showMentioned = !state.showMentioned;
      try { localStorage.setItem('ba-mentioned', state.showMentioned ? '1' : '0'); } catch (e) { /* 忽略 */ }
      syncMentionBtn();
      renderDatalist();
      renderPathSelects();
      if (state.chart) { freezeNow(); state.chart.setOption(buildOption()); }
      updateCountHint();
    });
    syncMentionBtn();

    // 次要人物折叠（大书默认收起）
    const minorBtn = document.getElementById('minor-btn');
    const syncMinorBtn = () => { if (minorBtn) minorBtn.textContent = state.showMinor ? '次要人物：显示' : '次要人物：隐藏'; };
    if (minorBtn) minorBtn.addEventListener('click', () => {
      state.showMinor = !state.showMinor;
      try { localStorage.setItem('ba-minor', state.showMinor ? '1' : '0'); } catch (e) { /* 忽略 */ }
      syncMinorBtn();
      renderDatalist();
      renderPathSelects();
      if (state.chart) { freezeNow(); state.chart.setOption(buildOption()); }
      refreshPanel();
      updateCountHint();
    });
    syncMinorBtn();

    // 族谱补全（推导出来的祖孙/叔侄连线）
    const derivedBtn = document.getElementById('derived-btn');
    const syncDerivedBtn = () => { if (derivedBtn) derivedBtn.textContent = state.showDerived ? '族谱补全：显示' : '族谱补全：隐藏'; };
    if (derivedBtn) derivedBtn.addEventListener('click', () => {
      state.showDerived = !state.showDerived;
      try { localStorage.setItem('ba-derived', state.showDerived ? '1' : '0'); } catch (e) { /* 忽略 */ }
      syncDerivedBtn();
      if (state.chart) { freezeNow(); state.chart.setOption(buildOption()); }
      refreshPanel();
      updateCountHint();
    });
    syncDerivedBtn();

    document.querySelectorAll('.seg').forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    });
    $('#reset-btn').addEventListener('click', () => setView(state.view));
    $('#view-reset-btn').addEventListener('click', resetRoam);
    const zoomOne = document.getElementById('zoom-one-btn');
    if (zoomOne) zoomOne.addEventListener('click', () => {
      // 世界坐标是 1:1 的：最近一次 fit 的缩放是 state.fitLast，跳到 1/它 就是"节点原始大小"
      if (!state.chart) return;
      const target = Math.min(40, 1 / (Math.abs(state.fitLast) || 1));
      const rel = target / (state.zoom || 1);
      state.chart.dispatchAction({ type: 'graphRoam', zoom: target });   // graphRoam 的 zoom 是"目标绝对倍率"
      state.zoom = target;
      clearTimeout(state.labelTimer);
      state.labelTimer = setTimeout(() => { computeLabels(state.zoom); if (state.chart) state.chart.setOption(buildOption()); }, 250);
    });
    const dragBtn = $('#drag-btn');
    dragBtn.addEventListener('click', () => {
      state.nodeDrag = !state.nodeDrag;
      dragBtn.textContent = state.nodeDrag ? '拖动节点：开' : '拖动节点：关';
      resetRoam();
    });

    // 剧透弹窗：用事件委托 + Esc，确保任何情况下都关得掉
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('#spoiler-off') || ev.target.closest('#spoiler-close')) { applySpoiler(false); return; }
      if (ev.target.closest('#spoiler-on')) {
        const ch = Number(document.getElementById('spoiler-ch')?.value) || 1;
        applySpoiler(true, ch);
        return;
      }
      if (ev.target.closest('#spoiler-btn')) openSpoilerModal();
    });
    document.addEventListener('keydown', (ev) => {
      const modal = document.getElementById('spoiler-modal');
      if (ev.key === 'Escape' && modal && !modal.hidden) applySpoiler(false);
    });

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

  // 调试/自动化用的只读入口（控制台里可以查状态、也能脚本化聚焦与过滤）
  window.__ba = {
    state,
    chart: () => state.chart,
    applyFocus: (id, depth) => applyFocus(id, depth),
    applySizeFilter: (v) => applySizeFilter(v),
    computeLabels: (z) => computeLabels(z),
    nodeCount: () => (state.chart ? state.chart.getOption().series[0].data.filter((d) => !String(d.id).startsWith('__gen_')).length : 0),
    labelCount: () => (state.chart ? state.chart.getOption().series[0].data.filter((d) => d.label && d.label.show).length : 0),
  };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
