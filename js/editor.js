/* 书脉 BookAtlas · 本地编辑器
 * 纯本地：草稿存 localStorage（键 ba-draft-<slug>），可导出 JSON 放进 data/ 使用。
 */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 7)}`;
  const slugify = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '') || 'book';
  const toList = (v) => (typeof v === 'string' ? v.split(/[，,、]/).map((s) => s.trim()).filter(Boolean) : (Array.isArray(v) ? v.filter(Boolean) : []));
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

  const ed = { book: null, section: 'meta', form: null, editing: null, sourceLocal: false, sourceFile: '', timer: null, history: [], hIndex: -1, histLimit: 60 };

  /* ---------------- 内嵌实时预览 ---------------- */
  const previewOn = () => document.body.classList.contains('ed-preview-on');
  let previewTimer = null;

  function previewUrl() {
    const slug = (ed.book && ed.book.meta && ed.book.meta.slug) || slugify((ed.book && ed.book.meta && ed.book.meta.title) || '');
    return `index.html?book=${encodeURIComponent(slug)}&local=1`;
  }

  function refreshPreview(delay = 350) {
    if (!previewOn()) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const fr = document.getElementById('ed-preview-frame');
      if (fr) fr.src = `${previewUrl()}&t=${Date.now()}`;
    }, delay);
  }

  function togglePreview(force) {
    const on = typeof force === 'boolean' ? force : !previewOn();
    document.body.classList.toggle('ed-preview-on', on);
    const btn = document.getElementById('ed-preview');
    if (btn) { btn.classList.toggle('primary', on); btn.textContent = on ? '预览：开' : '预览'; }
    try { localStorage.setItem('ba-ed-preview', on ? '1' : '0'); } catch (e) { /* 忽略 */ }
    if (on) refreshPreview(0);
  }

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
    if (localStorage.getItem('ba-ed-preview') === '1') togglePreview(true);
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
    const prevSlug = ed.book && ed.book.meta && ed.book.meta.slug;
    ed.book = normalize(book);
    const sameBook = prevSlug && prevSlug === ed.book.meta.slug;
    if (!sameBook) { ed.history = []; ed.hIndex = -1; }
    ed.sourceLocal = isLocal;
    snapshotBook(`载入《${ed.book.meta.title || '未命名'}》`);
    toast(`已载入《${ed.book.meta.title || '未命名'}》：${ed.book.characters.length} 人 / ${ed.book.relations.length} 关系 / ${ed.book.events.length} 事件${ed.book.places.length ? ` / ${ed.book.places.length} 地点` : ''}`);
    renderAll();
  }

  /* ---------------- 撤销 / 重做 ---------------- */
  function snapshotBook(label) {
    if (!ed.book) return;
    const json = JSON.stringify(ed.book);
    if (ed.history[ed.hIndex] && ed.history[ed.hIndex].json === json) return;
    ed.history = ed.history.slice(0, ed.hIndex + 1);
    ed.history.push({ label, json });
    if (ed.history.length > ed.histLimit) ed.history.shift();
    ed.hIndex = ed.history.length - 1;
    syncHistButtons();
  }

  function restoreHistory(index) {
    const h = ed.history[index];
    if (!h) return;
    ed.hIndex = index;
    ed.book = normalize(JSON.parse(h.json));
    ed.editing = null;
    renderAll();
    saveDraft();
    refreshPreview();
    setStatus(`↩︎ 回到：${h.label}`);
    syncHistButtons();
  }

  function undo() {
    if (ed.hIndex > 0) restoreHistory(ed.hIndex - 1);
    else setStatus('已经是最早的一步了');
  }

  function redo() {
    if (ed.hIndex < ed.history.length - 1) restoreHistory(ed.hIndex + 1);
    else setStatus('已经是最新的一步了');
  }

  function syncHistButtons() {
    const u = document.getElementById('ed-undo');
    const r = document.getElementById('ed-redo');
    if (u) u.disabled = ed.hIndex <= 0;
    if (r) r.disabled = ed.hIndex >= ed.history.length - 1;
  }

  function normalize(book) {
    const b = book || {};
    b.meta = { slug: '', title: '未命名', author: '', translator: '', chapters: 20, prophecy: '', prophecySrc: '', note: '', license: 'CC BY-SA 4.0', updated: '', sources: [], ...(b.meta || {}) };
    b.factions = Array.isArray(b.factions) ? b.factions : [];
    b.characters = Array.isArray(b.characters) ? b.characters : [];
    b.relations = Array.isArray(b.relations) ? b.relations : [];
    b.places = Array.isArray(b.places) ? b.places : [];
    b.phases = Array.isArray(b.phases) ? b.phases : [];
    b.events = Array.isArray(b.events) ? b.events : [];
    return b;
  }

  function newBlank() {
    ed.book = normalize({
      meta: { slug: uid('book'), title: '我的新书', author: '', chapters: 20, schemaVersion: 2 },
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
      setStatus(`已保存到本地：ba-draft-${slug}（共 ${ed.book.characters.length} 人 / ${ed.book.relations.length} 关系 / ${ed.book.events.length} 事件${ed.book.places.length ? ` / ${ed.book.places.length} 地点` : ''}）`);
    } catch (e) { setStatus('保存失败：' + e.message); }
  }

  function autoSave() {
    clearTimeout(ed.timer);
    ed.timer = setTimeout(saveDraft, 800);
  }

  async function exportJson() {
    const slug = ed.book.meta.slug || slugify(ed.book.meta.title);
    const json = JSON.stringify(ed.book, null, 2);
    // 起了 tools/local-sink.mjs 的话，直接写进 data/（无头浏览器里下载会落到别处）
    try {
      const res = await fetch(`http://localhost:8766/save?name=${encodeURIComponent(slug)}.json`, { method: 'POST', body: json });
      if (res.ok) { toast(`✓ 已写入 data/${slug}.json（本地接收器）——接着在 data/books.json 里登记一行即可`); return; }
    } catch (e) { /* 没起接收器就走下载 */ }
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`已导出 ${slug}.json —— 把它放进 data/ 并在 data/books.json 登记即可发布`);
  }

  /* ---------------- 校验 ---------------- */
  const KIN_LABEL = { blood: '血缘', marriage: '婚姻', inlaw: '姻亲', adoptive: '收养', foster: '抚养', step: '继亲', sworn: '结义' };
  /* 纯血缘称谓（不许用来写收养/继亲/结义/抚养/姻亲/婚姻）
   * ⚠ 与 `scripts/kin.mjs` 的 `BLOOD_TERM` **逐字对应** —— 由 `test/kin-constants.mjs` 守着。
   *   两边漂过：这里曾少了「姨甥 / 表兄弟 / 表兄妹 / 堂兄弟 / 堂兄妹 / 孪生兄弟 / 孪生姐妹 /
   *   父子关系」8 个 ⇒ 同样一句「堂兄弟 + kin=收养」，scripts 那边报错、编辑器这边不报。 */
  const BLOOD_TERM = /^(父子|父女|母子|母女|兄弟|姐妹|兄妹|姐弟|祖孙|曾祖孙|叔侄|舅甥|姨甥|姑侄|表兄弟|表兄妹|堂兄弟|堂兄妹|孪生兄弟|孪生姐妹|父子关系)/;
  /* 亲子边（父子/母子/父女/母女/亲生子/养父子…）—— 只用于「亲子成环」检测。
   * ⚠ 与 `scripts/kin-terms.mjs` 的 `PARENT_CHILD` **逐字对应**（那是全项目唯一来源，
   *   `isParentChild(r)` 就是「去掉括号说明后 PARENT_CHILD.test(type)」）。
   *   由 `test/parent-child.mjs` 守着。
   *   这里曾用「`kin === 'blood'` 且 type 以 父/母 或 子/女 开头」代替，后果是
   *   **全部收养亲子边被漏掉**（三国 7 条「养父子」、百年孤独 2 条「养母女/养父女」）
   *   ⇒ CLI 能报出来的成环，编辑器面板报不出来。 */
  const PARENT_CHILD = /^(亲生)?(父|母)(子|女)$|^养(父|母)(子|女)$/;
  /** type 去掉括号说明后是不是亲子边。数据约定：from＝父母、to＝子女。 */
  const isParentChildType = (t) => PARENT_CHILD.test(String(t || '').replace(/[（(].*$/, '').trim());
  /* 亲子成环：返回「在环上」的角色 id。**编辑器里唯一的一份** ——
   * 「校验」按钮与「数据体检」面板都调它（免得像 kinIssues 那样两处各抄一份再漂开，见 v0.152）。
   * 判定边用 isParentChildType，与 scripts/validate.mjs 同口径（**含收养边**）。 */
  function parentCycles(book) {
    const parentMap = new Map();
    for (const r of (book.relations || [])) {
      if (!isParentChildType(r.type)) continue;
      if (!parentMap.has(r.to)) parentMap.set(r.to, []);
      parentMap.get(r.to).push(r.from);   // 数据约定：from＝父母、to＝子女
    }
    const seen = new Set(), stack = new Set();
    const walk = (id) => {
      if (stack.has(id)) return true;
      if (seen.has(id)) return false;
      seen.add(id); stack.add(id);
      for (const p of parentMap.get(id) || []) if (walk(p)) { stack.delete(id); return true; }
      stack.delete(id);
      return false;
    };
    return [...parentMap.keys()].filter((id) => walk(id));
  }
  /** 把成环的角色 id 列表渲染成「甲、乙」形式（找不到就退回 id）。 */
  const cycleNames = (ids, book) => ids.slice(0, 6)
    .map((id) => ((book.characters || []).find((c) => c.id === id) || {}).name || id).join('、');
  /* ⚠ 这份正则必须与 `scripts/kin.mjs` 的 `guessKin` **逐字对应**（同一套正则、同一判定顺序）。
   *
   *   `scripts/kin.mjs` 是 kin 规范的**唯一来源**（被 `validate.mjs` / `annotate-kin.mjs` /
   *   `wholebook.mjs` import）；编辑器这边是**手抄的第二份** —— 因为 editor.js 是浏览器模块，
   *   import 不了 `scripts/`（那会要求把 scripts/ 也进 SW 预缓存）。
   *
   *   手抄必漂：v0.145 之前这里少了 `晚爹`、`NOT_KIN` 少了 12 个词、`BLOOD` 少了 9 个词，
   *   于是同一句关系名在编辑器里被猜成 A、在 validate/整本生成里被猜成 B。
   *   最典型的是「同门师兄弟」：`kin.mjs` 把「同门」列进"不是家人"⇒ 留空，
   *   而这边漏了那个词 ⇒ 判成 blood，编辑器还会把它**自动写进 `kin` 字段**。
   *   ⇒ `test/editor.mjs` 有一条对拍：真实数据里每个 `relations[].type` + 一批边界词，
   *     两份实现必须给出同一个结果。改这里请同步改 `scripts/kin.mjs`。 */
  function guessKin(type) {
    const t = String(type || '');
    if (!t) return '';
    // 先看明确的几类（它们比"父/母/兄/弟"这类字更具体）
    if (/义[父母子女儿兄姐弟妹叔伯侄甥姑姨舅祖同]|情同|干[亲爹娘兄弟姐弟儿女]|结义|结拜|拜把|把兄弟|教[父母]|教子|教女|盟兄弟/.test(t)) return 'sworn';
    if (/收养|抱养|过继|^养[^大育]/.test(t)) return 'adoptive';
    if (/继[父母子女儿]|后妈|后爹|晚娘|晚爹|填房/.test(t)) return 'step';
    if (/岳[父母]|公公|婆婆|婆媳|孙媳|儿媳|儿媳妇|女婿|姑爷|嫂|姐夫|妹夫|弟媳|妯娌|连襟|亲家|内[兄弟]|舅子|妻[舅弟兄姐妹]|国舅|姻亲/.test(t)) return 'inlaw';
    if (/抚养|带大|养大|养育|寄养|乳母|奶妈/.test(t)) return 'foster';
    if (!/未婚/.test(t) && /夫妻|配偶|丈夫|妻子|妾|姨太太/.test(t)) return 'marriage';
    // 明确「不是家人」的词，先挡掉，避免"保姆"撞上"母"、"房东"撞上"父"
    if (/保姆|帮佣|佣人|房东|房客|租客|雇主|信使|使者|囚徒|囚犯|同学|同窗|同舍|同门|同砚|同僚|座师|门生|朋友|挚友|战友|同乡|医生|病人|酒鬼|神父|牧师|校长|老师|学生|上司|下属|对手|政敌|情敌|仇敌|熟人|忘年交|邻居|日常|试探|陷害|决斗|亡灵|幽灵|交情|相遇|意外|犯罪|罪人|同事/.test(t)) return '';
    if (/[父母]亲|父|母|儿子|女儿|子|女|兄|弟|姐|妹|孙|外公|外婆|祖父|祖母|叔|伯|姑|姨|舅|甥|侄|堂兄弟|堂姐妹|堂兄妹|堂姐弟|堂亲|表兄弟|表姐妹|表兄妹|表姐弟|表亲|孪生|双胞胎|家人|本家|长辈|后辈|血脉/.test(t)) return 'blood';
    // 与 kin.mjs 同步：恋爱类（未婚/恋人/情人…）明确**不是亲属**。
    // 它排在 blood 之后，所以目前与末尾 `return ''` 等价（no-op）——
    // 抄它只是为了「两份逐字对应」这件事本身成立，免得哪天 kin.mjs 把它挪到 blood 之前。
    if (/未婚|恋人|情人|相好|单相思|拒婚|婚约|私情/.test(t)) return '';
    return '';
  }

  /* 「kin ⇄ type 自洽」的**唯一**判定 —— `validate()`（导出前校验）与 `healthCheck()`
   * （「数据体检」面板）都必须走这里，不许各自再抄一份。
   *
   * ⚠ 为什么非要抽出来：这两处原先各抄了一份，且**已经漂了** ——
   *   `validate()` 在 v0.147 收紧了（`kin !== 'blood'` + 21 个血缘称谓词），
   *   `healthCheck()` 还停在旧规则（只管 收养/继亲/结义/抚养 4 类 + 13 个词）。
   *   于是「堂兄弟 + kin=收养」在导出校验里报错、在数据体检面板里**一声不吭** ——
   *   同一份数据两个答案，用户只在点「校验」时才看得到。（v0.147 修掉的两条
   *   「舅甥 + kin=inlaw」正是踩在这条缝里：CLI 报、面板不报。）
   *
   * 返回 `[{ code, msg }]`。`code` 是命中的**分支名**，供测试钉住"是哪条规则命中"
   * （钉结构不钉文案，改措辞不该让测试红）：
   *   bad-kin       kin 值不合法（只能是 KIN_LABEL 的 7 个键之一）
   *   missing       没标 kin，但 type 看着像亲属
   *   blood-term    标了非 blood，type 却是纯血缘称谓（父子/兄弟/舅甥…）
   *   blood-unclear 标了 blood，type 却看不出是血缘
   *   mismatch      type 猜出来的类别 ≠ 标上去的 kin
   * ⚠ 与 `scripts/kin.mjs` 的 `checkKin` **分支顺序与判定条件逐条对应**，
   *   由 `test/editor.mjs` 用真实数据全量对拍（两边命中条数必须相等）。
   *   改这里请同步改 `scripts/kin.mjs`。 */
  function kinIssues(type, kin) {
    const out = [];
    const t = String(type || '');
    const raw = String(kin == null ? '' : kin).trim();
    // 与 checkKin 同口径：LLM 常把"没有"写成「无 / none / -」，这些等于留空，不是非法值
    const k = /^(空|无|none|null|-|否)$/i.test(raw) ? '' : raw;
    const guessed = guessKin(t);
    if (k && !KIN_LABEL[k]) {
      return [{ code: 'bad-kin', msg: `亲属类型「${k}」不合法（应为 ${Object.keys(KIN_LABEL).join(' / ')} 之一）` }];
    }
    if (!k) {
      if (guessed) out.push({ code: 'missing', msg: `关系名「${t}」像是${KIN_LABEL[guessed]}关系，建议补上「亲属类型」` });
      return out;
    }
    /* 纯血缘称谓（父子/母子/兄弟/舅甥…，见 BLOOD_TERM）**只能配 blood** ——
     *   配 收养/继亲/结义/抚养/姻亲/婚姻 都自相矛盾。
     *   v0.147 起把「姻亲 / 婚姻」也纳入（原先只管 收养/继亲/结义/抚养 4 类）。 */
    if (k !== 'blood' && BLOOD_TERM.test(t)) {
      out.push({ code: 'blood-term', msg: `标了「${KIN_LABEL[k]}」，关系名却写成血缘称谓「${t}」——是血缘才用 blood；收养/继亲/结义/抚养/姻亲/婚姻要说清是哪一种` });
    }
    if (k === 'blood' && !guessed) out.push({ code: 'blood-unclear', msg: `标了 kin=blood，但关系名「${t}」看不出是血缘称谓` });
    if (guessed && guessed !== k) out.push({ code: 'mismatch', msg: `关系名「${t}」看着像${KIN_LABEL[guessed]}，但亲属类型标的是${KIN_LABEL[k]}——对一下哪个对` });
    return out;
  }

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
    const placeIds = new Set();
    const dupPlaces = new Set();
    for (const p of b.places) {
      if (!p.id) issues.push(`地点「${p.name || '?'}」缺少 id`);
      else if (placeIds.has(p.id)) dupPlaces.add(p.id);
      placeIds.add(p.id);
      if (!p.name) issues.push(`地点 ${p.id} 缺少名称`);
      if (typeof p.firstCh !== 'number') issues.push(`地点「${p.name}」缺少首次出现章 firstCh（地点筛选要用）`);
    }
    for (const id of dupPlaces) issues.push(`地点 id 重复：${id}`);
    for (const e of b.events) {
      if (typeof e.ch !== 'number') issues.push(`事件「${e.name}」缺少发生章 ch`);
      if (e.phase && !phaseIds.has(e.phase)) issues.push(`事件「${e.name}」的阶段「${e.phase}」未定义`);
      if (e.place && !placeIds.has(e.place)) issues.push(`事件「${e.name}」的地点「${e.place}」没有在 places 里定义`);
      for (const cid of e.chars || []) if (!ids.has(cid)) issues.push(`事件「${e.name}」引用了不存在的人物 ${cid}`);
    }
    for (const r of b.relations) {
      if (!ids.has(r.from) || !ids.has(r.to)) issues.push(`关系 ${r.from}→${r.to} 里有人物不存在`);
      if (!Array.isArray(r.events) || !r.events.length) issues.push(`关系 ${r.from}→${r.to} 没有小事件`);
      for (const ev of r.events || []) {
        if (ev.chapter && !/(\d+)/.test(ev.chapter)) issues.push(`关系 ${r.from}→${r.to} 的章节「${ev.chapter}」没有数字`);
        if (ev.place && !placeIds.has(ev.place)) issues.push(`关系 ${r.from}→${r.to} 的小事件地点「${ev.place}」没有在 places 里定义`);
      }
      /* kin ⇄ type 自洽 —— 与「数据体检」面板**共用同一个判定**（kinIssues）。
       * 原先这里和 healthCheck() 各抄一份，v0.147 只收紧了这里、忘了那边，
       * 于是同一份数据在「校验」里报错、在「体检」里不报。 */
      for (const k of kinIssues(r.type, r.kin)) issues.push(`关系 ${r.from}→${r.to}：${k.msg}`);
      // 时间区间（时间旅行）
      if (typeof r.fromCh === 'number' && typeof r.toCh === 'number' && r.toCh <= r.fromCh) issues.push(`关系 ${r.from}→${r.to} 的 toCh（${r.toCh}）必须大于 fromCh（${r.fromCh}）`);
    }
    /* 亲子成环 —— `scripts/validate.mjs` 一直查这条，而编辑器原先只有「数据体检」查、
     * 「校验」不查 ⇒ 又是"两个入口两个答案"。现在两边共用 parentCycles()。 */
    const cyc = parentCycles(b);
    if (cyc.length) issues.push(`亲子关系成环（方向写反了？）：${cycleNames(cyc, b)} —— 用 scripts/fix-parent-cycles.mjs 修`);
    return issues;
  }

  /* ---------------- 数据体检（结构化：每条都能跳到对应条目） ---------------- */
  /* 音译差异表（与 scripts/audit-search.mjs 同口径） */
  const VARIANT_PAIRS = [
    ['奥雷里亚诺', '奥雷良诺'], ['乌尔苏拉', '乌苏拉'], ['丽贝卡', '雷贝卡'], ['梅尔基亚德斯', '墨尔基阿德斯'],
    ['阿玛兰妲', '阿玛兰塔'], ['阿尔卡蒂奥', '阿卡迪奥'], ['何塞·阿尔卡蒂奥', '霍塞·阿卡迪奥'],
    ['费尔南达', '菲南达'], ['皮拉尔·特内拉', '皮拉·苔列娜'], ['桑塔索菲亚', '圣索菲亚'],
    ['蕾梅黛丝', '雷梅苔丝'], ['阿基拉尔', '阿吉拉尔'], ['史蒂文森', '斯蒂文森'], ['加布里埃尔', '加夫列尔'],
    ['加斯通', '加斯东'], ['莫科特', '摩斯科特'], ['尼格罗曼塔', '尼格罗·曼塔'], ['普鲁邓希奥', '普鲁登西奥'],
    ['拉斯柯尔尼科夫', '拉斯科利尼科夫'], ['玛尔美拉朵夫', '马尔梅拉多夫'], ['索尼雅', '索尼娅'],
    ['杜尼雅', '杜尼娅'], ['卢仁', '卢津'], ['波尔菲利', '波尔费利'], ['斯维德利盖洛夫', '斯维德里加洛夫'],
    ['伊凡诺芙娜', '伊万诺夫娜'], ['阿辽娜', '阿廖娜'], ['拉祖米欣', '拉祖米兴'],
    ['列别贾特尼科夫', '列别佳特尼科夫'], ['普莉赫丽雅', '普尔赫莉娅'], ['阿芙朵嘉', '阿芙多佳'],
  ];
  const baseNameOf = (s) => String(s || '').replace(/[（(].*$/, '').trim();

  function healthCheck() {
    const b = ed.book;
    const out = [];
    const add = (level, msg, sec, idx) => out.push({ level, msg, sec: sec || '', idx: idx === undefined ? null : idx });
    const ids = new Set(), dup = new Set(), deg = new Map();
    for (const r of b.relations) { deg.set(r.from, (deg.get(r.from) || 0) + 1); deg.set(r.to, (deg.get(r.to) || 0) + 1); }

    // 人物
    b.characters.forEach((c, i) => {
      if (!c.id) add('error', `人物「${c.name || '?'}」缺少 id`, 'characters', i);
      else if (ids.has(c.id)) { dup.add(c.id); add('error', `人物 id 重复：${c.id}（「${c.name}」）`, 'characters', i); }
      ids.add(c.id);
      if (!['m', 'f'].includes(c.gender)) add('warn', `人物「${c.name}」缺少性别 gender（男圆/女圆角方要用）`, 'characters', i);
      if (typeof c.firstCh !== 'number' || !c.firstCh) add('warn', `人物「${c.name}」缺少首次出场章 firstCh（剧透保护要用）`, 'characters', i);
      if (!(c.aliases || []).length && (deg.get(c.id) || 0) >= 8) add('info', `「${c.name}」有 ${deg.get(c.id)} 条关系却没有别名——读者按字号 / 俗称 / 别的译名会搜不到`, 'characters', i);
    });
    // 同名（去掉括号补充后同名 → 真重名还是同一人被拆成两条？）
    const byBase = new Map();
    b.characters.forEach((c, i) => {
      const k = baseNameOf(c.name);
      if (!k) return;
      if (!byBase.has(k)) byBase.set(k, []);
      byBase.get(k).push({ c, i });
    });
    for (const [, list] of byBase) if (list.length > 1) {
      add('info', `「${baseNameOf(list[0].c.name)}」有 ${list.length} 条同名记录（真重名？还是同一人被拆成两条？）：${list.map((x) => x.c.name).join(' / ')}`, 'characters', list[0].i);
    }
    // 译名变体
    b.characters.forEach((c, i) => {
      const hay = [c.name, ...(c.aliases || [])].join('|');
      for (const [a, z] of VARIANT_PAIRS) {
        if (hay.includes(a) && !hay.includes(z)) add('info', `「${c.name}」可补另一种译法「${z}」——读者按别的译本会搜这个`, 'characters', i);
        else if (hay.includes(z) && !hay.includes(a)) add('info', `「${c.name}」可补另一种译法「${a}」`, 'characters', i);
      }
    });
    // 阵营
    const factionKeys = new Set(b.factions.map((f) => f.key));
    b.characters.forEach((c, i) => { if (c.faction && !factionKeys.has(c.faction)) add('error', `人物「${c.name}」的阵营「${c.faction}」未定义`, 'characters', i); });
    // 地点
    const placeIds = new Set(), dupPlaces = new Set();
    (b.places || []).forEach((p, i) => {
      if (!p.id) add('error', `地点「${p.name || '?'}」缺少 id`, 'places', i);
      else if (placeIds.has(p.id)) { dupPlaces.add(p.id); add('error', `地点 id 重复：${p.id}`, 'places', i); }
      placeIds.add(p.id);
      if (!p.name) add('warn', `地点 ${p.id} 缺少名称`, 'places', i);
      if (typeof p.firstCh !== 'number' || !p.firstCh) add('warn', `地点「${p.name}」缺少首次出现章 firstCh（地点筛选要用）`, 'places', i);
    });
    // 事件
    const phaseIds = new Set(b.phases.map((p) => p.id));
    b.events.forEach((e, i) => {
      if (typeof e.ch !== 'number' || !e.ch) add('warn', `事件「${e.name}」缺少发生章 ch（剧透保护要用）`, 'events', i);
      if (e.phase && !phaseIds.has(e.phase)) add('error', `事件「${e.name}」的阶段「${e.phase}」未定义`, 'events', i);
      if (e.place && !placeIds.has(e.place)) add('error', `事件「${e.name}」的地点「${e.place}」没有在 places 里定义`, 'events', i);
      for (const cid of e.chars || []) if (!ids.has(cid)) add('error', `事件「${e.name}」引用了不存在的人物 ${cid}`, 'events', i);
    });
    // 关系
    b.relations.forEach((r, i) => {
      const where = `关系 ${r.from}→${r.to}`;
      if (!ids.has(r.from) || !ids.has(r.to)) add('error', `${where} 里有人物不存在`, 'relations', i);
      if (!r.type) add('error', `${where} 缺少关系名 type`, 'relations', i);
      if (!Array.isArray(r.events) || !r.events.length) add('warn', `${where} 没有「定义关系的小事件」`, 'relations', i);
      for (const ev of r.events || []) {
        if (ev.chapter && !/(\d+)/.test(ev.chapter)) add('warn', `${where} 的章节「${ev.chapter}」没有数字（剧透保护要靠它）`, 'relations', i);
        if (ev.place && !placeIds.has(ev.place)) add('error', `${where} 的小事件地点「${ev.place}」没有在 places 里定义`, 'relations', i);
      }
      /* kin ⇄ type 自洽 —— 与「校验」按钮共用同一个判定（kinIssues）。
       * 这里原先抄的是**旧规则**（只管 收养/继亲/结义/抚养 4 类 + 13 个血缘称谓词），
       * 于是「堂兄弟 + kin=收养」在导出校验里报错、在这块面板里不报 —— 同一份数据两个答案。 */
      for (const k of kinIssues(r.type, r.kin)) {
        add(k.code === 'bad-kin' || k.code === 'blood-term' ? 'error' : k.code === 'missing' ? 'info' : 'warn',
          `${where}：${k.msg}`, 'relations', i);
      }
      // 时间区间
      if (r.fromCh !== undefined && (!Number.isInteger(r.fromCh) || r.fromCh < 1)) add('error', `${where} 的 fromCh 必须是 ≥1 的整数`, 'relations', i);
      if (r.toCh !== undefined && (!Number.isInteger(r.toCh) || r.toCh < 1)) add('error', `${where} 的 toCh 必须是 ≥1 的整数`, 'relations', i);
      if (typeof r.fromCh === 'number' && typeof r.toCh === 'number' && r.toCh <= r.fromCh) add('error', `${where} 的 toCh（${r.toCh}）必须大于 fromCh（${r.fromCh}）`, 'relations', i);
      if (typeof r.fromCh === 'number' || typeof r.toCh === 'number') {
        const lo = typeof r.fromCh === 'number' ? r.fromCh : 0;
        const hi = typeof r.toCh === 'number' ? r.toCh - 1 : Infinity;
        for (const ev of r.events || []) {
          const m = String(ev.chapter || '').match(/\d+/);
          if (!m) continue;
          const n = Number(m[0]);
          if (n < lo || n > hi) add('warn', `${where} 的第 ${n} 章事件落在时间区间 [${lo}, ${hi === Infinity ? '∞' : hi}] 之外（时间旅行时看不到）`, 'relations', i);
        }
      }
    });
    // 亲子成环（方向写反 ⇒ 成环）—— 与「校验」按钮共用 parentCycles()，见文件顶部说明。
    const cyc = parentCycles(b);
    if (cyc.length) add('error', `亲子关系成环（方向写反了？）：${cycleNames(cyc, b)} —— 用 scripts/fix-parent-cycles.mjs 修`, 'relations', null);
    return out;
  }

  function healthReportText() {
    const issues = healthCheck();
    const b = ed.book;
    const n = (lv) => issues.filter((i) => i.level === lv).length;
    const lines = [
      `《${b.meta.title || '未命名'}》体检报告 · ${new Date().toLocaleString()}`,
      `${b.characters.length} 人 · ${b.relations.length} 段关系 · ${b.events.length} 个事件 · ${(b.places || []).length} 个地点`,
      `错误 ${n('error')} · 警告 ${n('warn')} · 提示 ${n('info')}`,
    ];
    for (const [lv, label] of [['error', '错误'], ['warn', '警告'], ['info', '提示']]) {
      const list = issues.filter((i) => i.level === lv);
      if (!list.length) continue;
      lines.push('', `【${label}】${list.length} 条`);
      for (const it of list) lines.push(`- ${it.msg}`);
    }
    return lines.join('\n');
  }

  /** 体检里「去改」：切到对应版块并直接打开那一条的编辑表单 */
  function jumpTo(sec, idx) {
    if (!sec || idx === null || idx === undefined || Number.isNaN(Number(idx))) return;
    ed.section = sec;
    ed.editing = null;
    renderAll();
    const btn = document.querySelector(`#ed-body [data-act="edit"][data-sec="${sec}"][data-idx="${idx}"]`);
    if (btn) btn.click();
    const body = document.getElementById('ed-body');
    if (body && body.scrollIntoView) body.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /** 剪贴板兜底（http:// 下 navigator.clipboard 可能不可用） */
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { alert('复制失败，可以手动复制下面这段：\n\n' + text.slice(0, 800)); }
    ta.remove();
  }

  /** 一键补齐译名变体（可撤销） */
  function applyVariantFixes() {
    let fixed = 0;
    for (const c of ed.book.characters) {
      const has = (s) => [c.name, ...(c.aliases || [])].join('|').includes(s);
      for (const [a, z] of VARIANT_PAIRS) {
        if (has(a) && !has(z)) { c.aliases = [...(c.aliases || []), z]; fixed++; }
        else if (has(z) && !has(a)) { c.aliases = [...(c.aliases || []), a]; fixed++; }
      }
    }
    if (fixed) { snapshotBook(`补齐译名变体 ${fixed} 处`); saveDraft(); refreshPreview(); }
    renderBody();
    alert(fixed ? `已补齐 ${fixed} 处译名变体（可撤销）` : '没有需要补的译名变体');
  }

  function formHealth() {    const issues = healthCheck();
    const b = ed.book;
    const errs = issues.filter((i) => i.level === 'error');
    const warns = issues.filter((i) => i.level === 'warn');
    const infos = issues.filter((i) => i.level === 'info');
    const covered = b.characters.filter((c) => (c.aliases || []).length).length;
    const pct = b.characters.length ? Math.round((covered / b.characters.length) * 100) : 0;
    const periods = b.relations.filter((r) => typeof r.fromCh === 'number' || typeof r.toCh === 'number').length;
    const group = (title, list, cls) => (!list.length ? '' : `
      <h3 class="hl-h3">${title}（${list.length}）</h3>
      <ul class="hl-list ${cls}">${list.slice(0, 120).map((it) => `<li>${esc(it.msg)}${it.sec && it.idx !== null ? ` <button class="ghost tiny" type="button" data-act="health-jump" data-sec="${it.sec}" data-idx="${it.idx}">去改</button>` : ''}</li>`).join('')}</ul>
      ${list.length > 120 ? `<p class="hint">…还有 ${list.length - 120} 条（点「复制报告」看全部）</p>` : ''}`);
    return `${head('🩺 数据体检', '发布前跑一遍：结构 / 引用 / 亲属 / 别名 / 时间区间。红色必须修，黄色建议修，蓝色是提示', '<button class="primary" type="button" data-act="health-run">重新体检</button>')}
      <div class="hl-cards">
        <div class="hl-card"><b>${errs.length}</b><span>错误</span></div>
        <div class="hl-card"><b>${warns.length}</b><span>警告</span></div>
        <div class="hl-card"><b>${infos.length}</b><span>提示</span></div>
        <div class="hl-card"><b>${pct}%</b><span>别名覆盖</span></div>
        <div class="hl-card"><b>${periods}</b><span>时间区间</span></div>
      </div>
      <p class="hint">${b.characters.length} 人 · ${b.relations.length} 段关系 · ${b.events.length} 个事件 · ${(b.places || []).length} 个地点${errs.length ? '' : ' · <b>结构检查通过 ✓</b>'}</p>
      <div class="ed-actions" style="margin:10px 0">
        <button class="ghost" type="button" data-act="health-copy">📋 复制报告</button>
        <button class="ghost" type="button" data-act="health-variants">🪄 一键补齐译名变体</button>
      </div>
      ${group('🔴 错误', errs, 'err')}
      ${group('🟡 警告', warns, 'warn')}
      ${group('🔵 提示', infos, 'info')}
      <h3 class="hl-h3">贡献给项目</h3>
      <ol class="hl-steps">
        <li>先把「错误」清零，再点顶栏「<b>导出 JSON</b>」</li>
        <li>命令行再跑一遍：<code>node scripts/validate.mjs data/&lt;slug&gt;.json</code> 与 <code>node scripts/audit-search.mjs --all</code></li>
        <li>把 JSON 放进 <code>data/</code>、在 <code>data/books.json</code> 登记一行，然后提 Issue / PR（写清这本书的来源与校对方式）</li>
      </ol>`;
  }

  /* ---------------- 渲染 ---------------- */
  function renderAll() {
    document.querySelectorAll('#ed-nav .seg').forEach((el) => el.classList.toggle('active', el.dataset.sec === ed.section));
    renderBody();
  }

  function renderBody() {
    const f = { meta: formMeta, factions: listFactions, characters: listCharacters, places: listPlaces, relations: listRelations, phases: listPhases, events: listEvents, ai: formAi, batch: formBatch, health: formHealth };
    $('#ed-body').innerHTML = (f[ed.section] || formMeta)();
  }

  function head(title, hint, actions) {
    return `<div class="ed-head"><div><h2>${esc(title)}</h2><p class="hint">${hint}</p></div><div class="ed-actions">${actions}</div></div>`;
  }

  /* —— 基本信息 —— */
  function formMeta() {
    const m = ed.book.meta;
    const gens = new Set(ed.book.characters.map((c) => Number(c.generation)));
    const facs = new Set(ed.book.characters.map((c) => c.faction).filter(Boolean));
    const declared = m.groupMode || '';
    const mode = declared || (gens.size > 1 ? 'generation' : 'faction');
    const warnTxt = (declared === 'generation' && gens.size < 2)
      ? '<br>⚠️ 声明按代际，但只有 1 种代际——没有代际差异就不要按代际分组（补全 generation，或改为 faction）'
      : (declared === 'faction' && gens.size > 1 ? '<br>ℹ️ 声明按阵营，但数据里有多种代际（想按代际就把「分组方式」改成 generation）' : '');
    return `${head('基本信息', '书名、作者、总章数（剧透保护要用）等', `
      <button class="primary" type="button" data-act="meta-save">保存</button>
      <button class="ghost" type="button" data-tool="validate">本地校验</button>
      <button class="ghost" type="button" data-tool="cmd">复制校验命令</button>`)}
      <div class="note" style="background:var(--panel-2);border-color:var(--line);color:var(--muted)">
        <b>分组诊断</b>：代际 ${gens.size} 种 · 阵营 ${facs.size} 个 · 当前：${mode === 'generation' ? '按代际' : '按阵营'}（${declared ? '显式声明' : '自动判定'}）${warnTxt}<br>
        判定口径：① 有跨代血缘主线？② 有明确的「上一代 → 下一代」跳跃？③ 主要人物是否跨越几代人的阶段出场？——任一为「是」→ 按代际；都为「否」→ 按阵营。
      </div>
      <form data-form="meta" class="ed-form" style="border-top:none;padding-top:0">
        <div class="ed-grid">
          <label>书名<input data-field="title" value="${esc(m.title)}"></label>
          <label>slug（文件名/标识）<input data-field="slug" value="${esc(m.slug)}"></label>
          <label>作者<input data-field="author" value="${esc(m.author)}"></label>
          <label>译本/译者<input data-field="translator" value="${esc(m.translator)}"></label>
          <label>总章数<input type="number" min="0" data-field="chapters" value="${esc(m.chapters ?? 0)}"></label>
          <label>分组方式（对应「代际/分组」视图）<select data-field="groupMode">
            <option value="" ${!m.groupMode ? 'selected' : ''}>自动（有多代就用代际）</option>
            <option value="generation" ${m.groupMode === 'generation' ? 'selected' : ''}>按代际</option>
            <option value="faction" ${m.groupMode === 'faction' ? 'selected' : ''}>按阵营</option>
          </select></label>
          <label>license<input data-field="license" value="${esc(m.license)}"></label>
          <label class="wide">一句话（最能概括这本书）<input data-field="prophecy" value="${esc(m.prophecy)}"></label>
          <label class="wide">一句话出处<input data-field="prophecySrc" value="${esc(m.prophecySrc || '')}"></label>
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
        <label>代际／分组（没有代际差异就一律填 1）<input type="number" data-field="generation" value="${esc(c.generation ?? 1)}"></label>
        <label>性别<select data-field="gender"><option value="m" ${c.gender !== 'f' ? 'selected' : ''}>男</option><option value="f" ${c.gender === 'f' ? 'selected' : ''}>女</option></select></label>
        <label>首次出场章<input type="number" min="0" data-field="firstCh" value="${esc(c.firstCh ?? 1)}"></label>
        <label>阵营<select data-field="faction"><option value="">（无）</option>${facs}</select></label>
        <label>身份/头衔<input data-field="title" value="${esc(c.title || '')}"></label>
        <label class="wide">别名（逗号分隔）<input data-field="aliases" value="${esc((c.aliases || []).join('，'))}"></label>
        <label class="wide">又译 / 异译本名（逗号分隔）<input data-field="altNames" value="${esc((c.altNames || []).join('，'))}"></label>
        <label class="wide">父母 id（逗号分隔，可留空）<input data-field="parents" value="${esc((c.parents || []).join('，'))}"></label>
        <label class="wide">一句话描述<textarea data-field="desc">${esc(c.desc || '')}</textarea></label>
        <label class="wide">结局<textarea data-field="fate">${esc(c.fate || '')}</textarea></label>
        <label class="wide">易混提示 note<textarea data-field="note">${esc(c.note || '')}</textarea></label>
      </div>
      <div class="ed-form-actions"><button class="primary" type="submit">${isNew ? '添加' : '保存'}</button><button class="ghost" type="button" data-act="cancel">取消</button></div>
    </form>`;
  }

  /* —— 地点 —— */
  function placeUseCount(id) {
    let n = 0;
    for (const e of ed.book.events) if (e.place === id) n++;
    for (const r of ed.book.relations) for (const ev of r.events || []) if (ev.place === id) n++;
    return n;
  }
  function placeOptions(sel) {
    const places = [...(ed.book.places || [])].sort((a, b) => (a.firstCh ?? 0) - (b.firstCh ?? 0));
    return '<option value="">（无地点）</option>' + places
      .map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  }
  function listPlaces() {
    const rows = ed.book.places.map((p, i) => `
      <tr>
        <td>${esc(p.name)}</td><td>${esc(p.id)}</td><td>${esc(p.type || '')}</td>
        <td class="num">${p.firstCh ?? ''}</td><td class="num">${placeUseCount(p.id) || '<span class="hint">0</span>'}</td>
        <td class="ops"><button class="ghost tiny" data-act="edit" data-sec="places" data-idx="${i}">编辑</button>
        <button class="ghost tiny" data-act="del" data-sec="places" data-idx="${i}">删除</button></td>
      </tr>`).join('');
    return `${head('地点', '地点不做关系图节点，而是「筛选器 + 面板」：在事件、以及关系里的小事件上选地点；firstCh 管剧透', '<button class="primary" type="button" data-act="add" data-sec="places">＋ 新增地点</button>')}
      <table class="ed-table"><thead><tr><th>名称</th><th>id</th><th>类型</th><th>出现章</th><th>被引用</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="hint">还没有地点（不是每本书都需要：地点本身参与推理时才值得细标）</td></tr>'}</tbody></table>
      ${ed.editing && ed.editing.sec === 'places' ? formPlace() : ''}`;
  }
  function formPlace() {
    const p = ed.form, isNew = ed.editing.idx === null;
    return `<form data-form="places" class="ed-form">
      <div class="ed-grid">
        <label>名称<input data-field="name" value="${esc(p.name)}"></label>
        <label>id（拼音；留空自动生成）<input data-field="id" value="${esc(p.id || '')}"></label>
        <label>类型（城镇 / 宅邸 / 酒馆…）<input data-field="type" value="${esc(p.type || '')}"></label>
        <label>首次出现章<input type="number" min="0" data-field="firstCh" value="${esc(p.firstCh ?? 1)}"></label>
        <label class="wide">别名（逗号分隔）<input data-field="aliases" value="${esc((p.aliases || []).join('，'))}"></label>
        <label class="wide">这里是什么地方<textarea data-field="desc">${esc(p.desc || '')}</textarea></label>
      </div>
      <div class="ed-form-actions"><button class="primary" type="submit">${isNew ? '添加' : '保存'}</button><button class="ghost" type="button" data-act="cancel">取消</button></div>
    </form>`;
  }

  /* —— 关系 —— */
  function relName(id) { return (ed.book.characters.find((c) => c.id === id) || {}).name || id; }
  function listRelations() {
    const rows = ed.book.relations.map((r, i) => {
      const withPlace = (r.events || []).filter((e) => e.place).length;
      const kin = r.kin && KIN_LABEL[r.kin] ? ` <span class="kin-badge k-${esc(r.kin)}">${KIN_LABEL[r.kin]}</span>` : (guessKin(r.type) ? ` <span class="hint">（像是${KIN_LABEL[guessKin(r.type)]}，待补）</span>` : '');
      return `<tr>
        <td>${esc(relName(r.from))} —<b>${esc(r.type)}</b>— ${esc(relName(r.to))}${kin}</td>
        <td>${esc(r.style || '')}</td>
        <td>${(r.events || []).length}${withPlace ? `（${withPlace} 条标了 📍）` : ''}</td>
        <td class="ops"><button class="ghost tiny" data-act="edit" data-sec="relations" data-idx="${i}">编辑</button>
        <button class="ghost tiny" data-act="del" data-sec="relations" data-idx="${i}">删除</button></td>
      </tr>`;
    }).join('');
    return `${head('关系', '每条关系都要有「定义关系的小事件」；章节号供剧透保护，地点供地点筛选（只标有把握的）；是亲属的还要标清 血缘/收养/继亲/姻亲/结义；关系变了（同盟→反目）就拆成两条并填「成立章/结束章」（时间旅行用）', '<button class="primary" type="button" data-act="add" data-sec="relations">＋ 新增关系</button>')}
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
        <select class="pl" data-field="events.${i}.place" title="这条小事件发生在哪">${placeOptions(ev.place)}</select>
        <button type="button" class="ghost tiny" data-act="rel-del-event" data-idx="${i}">删</button>
      </div>`).join('');
    return `<form data-form="relations" class="ed-form">
      <div class="ed-grid">
        <label>人物 A<select data-field="from">${charOptions(r.from)}</select></label>
        <label>人物 B<select data-field="to">${charOptions(r.to)}</select></label>
        <label>关系名<input data-field="type" value="${esc(r.type)}" placeholder="兄弟 / 情人 / 仇敌…"></label>
        <label>亲属类型<select data-field="kin">
          <option value="">（不是亲属 / 未判定）</option>
          ${Object.entries(KIN_LABEL).map(([k, v]) => `<option value="${k}" ${r.kin === k ? 'selected' : ''}>${v}${k === 'blood' ? '（亲生）' : k === 'adoptive' ? '（正式收养）' : k === 'foster' ? '（带大/寄养）' : k === 'step' ? '（继父母/继子女）' : k === 'inlaw' ? '（配偶方亲属）' : k === 'sworn' ? '（结义/干亲）' : ''}</option>`).join('')}
        </select></label>
        <label>线型<select data-field="style">
          <option value="solid" ${r.style === 'solid' ? 'selected' : ''}>实线（亲缘/同盟）</option>
          <option value="dashed" ${r.style === 'dashed' ? 'selected' : ''}>虚线（对立/伤害）</option>
          <option value="dotted" ${r.style === 'dotted' ? 'selected' : ''}>点线（情人/过去/间接）</option>
        </select></label>
        <label title="时间旅行用：这条关系从第几章成立（留空＝按依据事件里最小的章号）">成立章 fromCh<input type="number" min="1" data-field="fromCh" value="${r.fromCh ?? ''}" placeholder="如 25"></label>
        <label title="时间旅行用：从第几章起这条关系不再存在（独占；留空＝一直有效）。例：吕布↔董卓「义父子」第 3–8 章">结束章 toCh<input type="number" min="1" data-field="toCh" value="${r.toCh ?? ''}" placeholder="如 9（可空）"></label>
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
      const pl = (ed.book.places.find((p) => p.id === e.place) || {}).name || '';
      return `<tr>
        <td>${esc(ph)} · ${e.order}</td><td>${esc(e.name)}</td><td>${e.ch ?? ''}</td><td>${esc(pl)}</td><td>${(e.chars || []).length}</td>
        <td class="ops"><button class="ghost tiny" data-act="edit" data-sec="events" data-idx="${i}">编辑</button>
        <button class="ghost tiny" data-act="del" data-sec="events" data-idx="${i}">删除</button></td></tr>`;
    }).join('');
    return `${head('事件', '重大事件轴上的卡片；ch＝发生章（剧透保护），chars＝涉及人物，place＝发生地点（可空）', '<button class="primary" type="button" data-act="add" data-sec="events">＋ 新增事件</button>')}
      <table class="ed-table"><thead><tr><th>阶段·顺序</th><th>名称</th><th>章</th><th>地点</th><th>涉及</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="hint">还没有事件</td></tr>'}</tbody></table>
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
        <label>地点<select data-field="place">${placeOptions(e.place)}</select></label>
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
  "characters": [{ "id": "拼音-kebab", "name": "", "aliases": [], "altNames": ["只放**其他译本的写法**（奥雷良诺/乌苏拉/雷贝卡/拉斯科利尼科夫…）；昵称、外号、简称仍放 aliases。这是可选项，拿不准就省略"], "parents": ["父母 id，可选；但每个原生血缘人物都应该填，否则门禁查不出漏掉的关系线"], "generation": 1, "gender": "m|f", "firstCh": 1, "faction": "", "title": "", "desc": "", "fate": "", "note": "" }],
  "relations": [{ "from": "id", "to": "id", "type": "", "kin": "blood|marriage|inlaw|adoptive|foster|step|sworn（只有亲属才填，不是亲属就省略这个字段）", "style": "solid|dashed|dotted", "fromCh": "可选：这条关系从第几章成立", "toCh": "可选：从第几章起不再存在（同盟变敌对时，请拆成两条并各给 fromCh/toCh）", "events": [{ "text": "", "chapter": "第X章", "place": "地点 id 或空" }] }],
  "places": [{ "id": "拼音-kebab", "name": "", "aliases": [], "type": "城镇|宅邸|酒馆…", "firstCh": 1, "desc": "" }],
  "phases": [{ "id": "p1", "name": "", "order": 1 }],
  "events": [{ "id": "e1", "phase": "p1", "order": 1, "ch": 1, "name": "", "chars": ["id"], "place": "地点 id 或空", "summary": "", "impact": "", "quote": "" }]
}`;

  function formAi() {
    const key = localStorage.getItem('ba-ai-key') || '';
    const base = localStorage.getItem('ba-ai-base') || 'https://api.deepseek.com/v1';
    const model = localStorage.getItem('ba-ai-model') || 'deepseek-flash';
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
    const model = (($('#ai-model') || {}).value || '').trim() || 'deepseek-flash';
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
    const system = '你是文学作品的资料整理员，为「人物关系 + 事件时间轴」应用生成数据草稿。硬性要求：严格输出 JSON（不要 markdown 围栏、不要解释）；人物 25–45 个（主要出场人物尽量都收）；关系 40–75 条且每条至少 1 个「定义关系的小事件」并尽量给章节；事件 18–30 个并按 5–8 个阶段分组；地点（places）6–15 个（城镇/宅邸/酒馆/机构这类能当筛选维度的），事件的 place 与关系小事件的 place 必须引用 places 里已有的 id；**血缘/收养/继亲/姻亲必须分开写**（父子、母子、养父、养女、继母、岳父…，别把收养写成"母子"）；没有明确年份就禁止编造年份，用 phase+order 排序；style 约定 solid=亲缘/同盟、dashed=对立/伤害、dotted=情人/过去/间接；**同一对人如果关系变了（同盟→反目、主从→仇敌），拆成两条并各给 fromCh/toCh**（toCh 独占，第 3–8 章写作 fromCh:3, toCh:9）；易混同名人物在 note 里写消歧提示；全部字段中文，id 用拼音 kebab-case。';
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
      ed.aiDraft = parseLooseJson(raw);
      const n = { c: (ed.aiDraft.characters || []).length, r: (ed.aiDraft.relations || []).length, e: (ed.aiDraft.events || []).length, p: (ed.aiDraft.places || []).length };
      out.className = 'ed-msg ok';
      out.innerHTML = `✓ 生成完成：${n.c} 人 / ${n.r} 关系 / ${n.e} 事件 / ${n.p} 地点
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
      toast(`已合并：+${st.cAdd} 人 / +${st.rAdd} 关系 / +${st.eAdd} 事件 / +${st.evAdd} 条小事件${st.pAdd ? ` / +${st.pAdd} 地点` : ''}${st.dropped ? `（丢弃 ${st.dropped} 处悬空引用）` : ''}`);
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
      model: read('ai-model', 'ba-ai-model', 'deepseek-flash'),
    };
  }

  function saveAiConfig(cfg) {
    try {
      localStorage.setItem('ba-ai-base', cfg.base);
      localStorage.setItem('ba-ai-key', cfg.key);
      localStorage.setItem('ba-ai-model', cfg.model);
    } catch (e) { /* 忽略 */ }
  }

  // AI 返回的 JSON 偶发被 max_tokens 截断：从后往前退到最近的完整元素，自动补齐括号
  function parseLooseJson(raw) {
    const text = String(raw || '');
    const start = text.indexOf('{');
    if (start < 0) throw new Error('返回里没有找到 JSON：' + text.slice(0, 120));
    const body = text.slice(start);
    try { return JSON.parse(body.slice(0, body.lastIndexOf('}') + 1 || undefined)); } catch (e) { /* 继续修复 */ }
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
    /* v85 补一个分支：max_tokens 把输出**拦腰截断**时，正文末尾往往一个括号都没合上
     * （marks 为空 ⇒ 下面那个"往前退一格"的循环一次都跑不到），此前只能直接抛错。
     * 而这恰恰是最常见的截断形态。现在把未闭合的括号补齐再试一次。
     * 只在栈非空、且没停在字符串中间时补，避免把半截内容拼成看似合法的脏数据。 */
    if (stack.length && !inStr) {
      try { return JSON.parse(body + stack.reverse().join('')); } catch (e) { /* 补不齐就算了，走下面的老路 */ }
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
      try { return JSON.parse(cand + s.reverse().join('')); } catch (e) { /* 再往前退一格 */ }
    }
    throw new Error('返回的 JSON 无法解析（多半是这一章内容太长、输出被截断）。可以先跳过这章，或把这一章拆成两半再跑');
  }

  async function callLLM(system, user) {
    const cfg = aiConfig();
    if (!cfg.key) throw new Error('请先填 API Key（只存在本机浏览器）');
    saveAiConfig(cfg);
    const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
    const payload = (jsonMode) => JSON.stringify(jsonMode
      ? { model: cfg.model, temperature: 0.4, max_tokens: 8192, response_format: { type: 'json_object' }, messages }
      : { model: cfg.model, temperature: 0.4, max_tokens: 8192, messages });
    const call = (jsonMode) => fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: payload(jsonMode),
    });
    let res = await call(true);
    if (res.status === 400) {
      const t = await res.text().catch(() => '');
      // 有些兼容端点不认 response_format，就退回普通模式再来一次
      if (/response_format/i.test(t)) res = await call(false);
      else throw new Error(`API 400：${t.slice(0, 200)}`);
    }
    if (!res.ok) throw new Error(`API ${res.status}：${(await res.text().catch(() => '')).slice(0, 200)}`);
    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content || '';
    return parseLooseJson(raw);
  }

  /* —— 多格式读取：txt / md / html / epub / pdf —— */
  function cleanHtml(html) {
    const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', mdash: '—', hellip: '…' };
    return String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
        if (g[0] === '#') {
          const code = (g[1] === 'x' || g[1] === 'X') ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return ENT[g] !== undefined ? ENT[g] : m;
      })
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const decodeBytes = (bytes) => {
    try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); } catch (e) { return ''; }
  };

  // 汉字数字 → 阿拉伯数字（一百二十 → 120）
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
  const HEAD_LINE = /^[ \t　]*第[ \t　]*[一二三四五六七八九十百千零〇两\d]+[ \t　]*[回章节卷]/;
  const headingNo = (line) => {
    const m = String(line || '').match(/^[ \t　]*第[ \t　]*([一二三四五六七八九十百千零〇两\d]+)[ \t　]*[回章节卷]/);
    return m ? hanToNum(m[1]) : 0;
  };

  function extractEpub(arrayBuffer) {
    if (typeof fflate === 'undefined') throw new Error('缺少 zip 库：vendor/fflate.min.js 没有加载');
    const files = fflate.unzipSync(new Uint8Array(arrayBuffer));
    const container = files['META-INF/container.xml'];
    if (!container) throw new Error('不是有效的 EPUB（缺少 META-INF/container.xml）');
    const opfPath = decodeBytes(container).match(/full-path="([^"]+)"/i)?.[1];
    if (!opfPath) throw new Error('EPUB 里找不到 OPF 路径');
    const opf = decodeBytes(files[opfPath] || new Uint8Array());
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const manifest = new Map();
    for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
      const id = m[0].match(/\bid="([^"]+)"/i)?.[1];
      const href = m[0].match(/\bhref="([^"]+)"/i)?.[1];
      if (id && href) manifest.set(id, { href: decodeURIComponent(href), nav: /properties="[^"]*\bnav\b/i.test(m[0]) });
    }
    const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/gi)].map((m) => m[1]);
    const parts = [];
    const docs = [];
    for (const id of spine) {
      const item = manifest.get(id);
      if (!item) continue;
      const raw = files[base + item.href] || files[item.href];
      if (!raw) continue;
      const text = cleanHtml(decodeBytes(raw));
      if (!text) continue;
      parts.push(`\n==== [${String(parts.length + 1).padStart(3, '0')}] ${item.href} ====\n\n${text}`);
      // 目录页（nav / 满是章节标题的文档）不当正文
      const headCount = (text.match(/^[ \t　]*第[ \t　]*[一二三四五六七八九十百千零〇两\d]+[ \t　]*[回章节卷][^\n]{0,40}$/gm) || []).length;
      const firstLine = (text.split('\n').map((s) => s.trim()).find(Boolean) || '').slice(0, 40);
      docs.push({ href: item.href, nav: item.nav, headCount, title: HEAD_LINE.test(firstLine) ? firstLine : '', text });
    }
    if (!parts.length) throw new Error('EPUB 里没有可读的正文');
    // 优先用 EPUB 自带目录分章（一回 = 一个文档，比正则切分可靠），失败再退回整本正则分章
    const chapters = docs
      .filter((d) => !d.nav && d.headCount < 4 && headingNo(d.title))
      .map((d) => ({ no: headingNo(d.title), title: d.title, text: d.text }));
    return { text: parts.join('\n'), chapters: chapters.length >= 3 ? chapters : [] };
  }

  async function readBookFile(file, onProgress) {
    const name = String(file.name || '').toLowerCase();
    if (name.endsWith('.epub')) { const r = extractEpub(await file.arrayBuffer()); return { text: r.text, chapters: r.chapters, kind: 'EPUB' }; }
    if (name.endsWith('.pdf')) return { text: await extractPdf(await file.arrayBuffer(), onProgress), kind: 'PDF' };
    if (name.endsWith('.html') || name.endsWith('.htm')) return { text: cleanHtml(await file.text()), kind: 'HTML' };
    return { text: await file.text(), kind: name.endsWith('.md') ? 'Markdown' : '纯文本' };
  }

  /* —— PDF：内置 pdf.js 在浏览器里抽文字层（扫描件没有文字层，会明确提示） —— */
  const PDF_WORKER = 'vendor/pdf.worker.min.js?v=153';

  // 页面文字层 → 行：按 y 坐标分行（比只看 hasEOL 稳），行距突然变大就空一行
  function pageToLines(items) {
    const lines = [];
    let line = null;
    for (const it of items) {
      const str = it.str !== undefined ? it.str : (it.text || '');
      if (!str) continue;
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      const y = tr[5], x = tr[4];
      const h = Math.abs(tr[3]) || Math.abs(tr[0]) || 10;
      if (!line || Math.abs(line.y - y) > Math.max(2.5, h * 0.4)) {
        line = { y, x: x + (it.width || 0), text: str, h };
        lines.push(line);
      } else {
        const gap = x - line.x;
        const needSpace = gap > Math.max(2, h * 0.25) && !/[\u4e00-\u9fff]$/.test(line.text) && !/^[\u4e00-\u9fff]/.test(str);
        line.text += (needSpace ? ' ' : '') + str;
        line.x = x + (it.width || 0);
      }
    }
    // 行距突变（>1.6 倍中位行距）＝段落断开
    const gaps = [];
    for (let i = 1; i < lines.length; i++) gaps.push(Math.abs(lines[i].y - lines[i - 1].y));
    const sorted = gaps.filter((g) => g > 0.5).sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (i && med && Math.abs(lines[i].y - lines[i - 1].y) > med * 1.6) out.push('');
      out.push(lines[i].text.trim());
    }
    // 页眉页脚里的纯页码（只在本页首/尾行才算）——丢掉，别混进正文
    const clean = out.filter((t, i) => !(t && /^[\s\-—·.第页]*\d{1,4}[\s\-—·.页]*$/.test(t) && (i < 2 || i > out.length - 3)));
    // 合并 PDF 的硬换行（保守）：上一行是满行且不以句末标点结尾、本行也不是新章节标题 → 接上
    const w = clean.filter(Boolean).map((t) => t.length).sort((a, b) => a - b);
    const full = w.length ? w[Math.floor(w.length * 0.9)] : 0;
    const HEAD = /^[ \t　]*第[ \t　]*[一二三四五六七八九十百千零〇两\d]+[ \t　]*[章回节卷]/;
    const joined = [];
    for (const t of clean) {
      const prev = joined.length ? joined[joined.length - 1] : '';
      const glue = t && prev && !HEAD.test(t) && full && prev.length >= full * 0.85 && !/[。！？；：…—」』”"’）)]$/.test(prev);
      if (glue) joined[joined.length - 1] = prev + t;
      else joined.push(t);
    }
    return joined.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function extractPdf(arrayBuffer, onProgress) {
    if (typeof pdfjsLib === 'undefined') throw new Error('缺少 PDF 库：vendor/pdf.min.js 没有加载');
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false }).promise;
    try {
      const parts = [];
      let chars = 0;
      for (let n = 1; n <= doc.numPages; n++) {
        if (onProgress) onProgress(n, doc.numPages);
        const page = await doc.getPage(n);
        const tc = await page.getTextContent();
        const text = pageToLines(tc.items || []);
        chars += text.length;
        parts.push(text ? `==== [${String(n).padStart(3, '0')}] 第 ${n} 页 ====\n\n${text}` : '');
        page.cleanup();
      }
      if (chars / doc.numPages < 20 && doc.numPages >= 3) {
        throw new Error(`只抽到 ${chars} 个字（共 ${doc.numPages} 页）——这个 PDF 大概没有文字层（扫描件 / 图片版），需要先 OCR，或用 Calibre 转成带文字层的 epub / txt`);
      }
      return parts.filter(Boolean).join('\n\n');
    } finally {
      await doc.destroy().catch(() => {});
    }
  }

  function splitChapters(text) {
    const t = String(text || '').replace(/\r\n?/g, '\n');
    const re = /^[ \t　]*第[ \t　]*[一二三四五六七八九十百千零〇两\d]+[ \t　]*[章回节卷][^\n]{0,40}$/gm;
    const marks = [...t.matchAll(re)].map((m) => ({ idx: m.index, title: m[0].trim() }));
    if (marks.length < 2) return t.trim() ? [{ no: 0, title: '全文（未识别到章节，按一整段处理）', text: t.trim() }] : [];
    const out = [];
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].idx;
      const end = i + 1 < marks.length ? marks[i + 1].idx : t.length;
      out.push({ no: headingNo(marks[i].title), title: marks[i].title.slice(0, 40), text: t.slice(start, end).trim() });
    }
    return out;
  }

  function formBatch() {
    const cfgKey = localStorage.getItem('ba-ai-key') || '';
    const cfgBase = localStorage.getItem('ba-ai-base') || 'https://api.deepseek.com/v1';
    const cfgModel = localStorage.getItem('ba-ai-model') || 'deepseek-flash';
    const chapters = ed.chapters || [];
    const results = ed.genResults || [];
    const saved = savedBatch();
    const list = chapters.map((c, i) => {
      const r = results[i];
      const flag = r ? (r.error ? ' ✗' : ` ✓ ${(r.characters || []).length}人/${(r.relations || []).length}关系${(r.places || []).length ? `/${r.places.length}地点` : ''}`) : '';
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
          <label class="ghost tiny" style="cursor:pointer">上传图书文件<input type="file" id="batch-file" accept=".txt,.md,.html,.htm,.epub,.pdf,text/plain,text/markdown,text/html,application/epub+zip,application/pdf" hidden></label>
          <button class="ghost tiny" type="button" data-tool="batch-clear">清空</button>
          <span class="hint">支持 txt / md / html / epub / pdf；PDF 用内置 pdf.js 抽文字层（扫描件要先 OCR）</span>
        </div>
        <textarea id="batch-text" style="min-height:150px" placeholder="把整本 txt 粘贴到这里（或上传 .txt 文件）…">${ed.batchText ? esc(ed.batchText) : ''}</textarea>
      </div>
      ${chapters.length ? `<div class="ed-sub">
        <div class="ed-sub-head">已分章 ${chapters.length} 章
          <button class="ghost tiny" type="button" data-tool="batch-all">全选</button>
          <button class="ghost tiny" type="button" data-tool="batch-none">全不选</button>
          ${saved && !results.some(Boolean) ? `<button class="ghost tiny" type="button" data-tool="batch-restore">↺ 接回上次的 ${saved.results.filter(Boolean).length} 条结果</button>` : ''}
        </div>
        <div class="ed-chars" id="batch-list">${list}</div>
      </div>` : ''}
      <div id="batch-out" class="ed-msg"></div>`;
  }

  /* 整本生成的结果存本地（长跑可中断恢复；只存草稿结果，不存正文） */
  function batchKey() { return 'ba-batch-' + (ed.book?.meta?.slug || 'draft'); }

  function saveBatchResults() {
    if (!ed.book) return;
    try {
      localStorage.setItem(batchKey(), JSON.stringify({
        count: (ed.chapters || []).length,
        at: Date.now(),
        results: ed.genResults || []
      }));
    } catch (e) { /* 超配额就算了 */ }
  }

  function savedBatch() {
    try {
      const d = JSON.parse(localStorage.getItem(batchKey()) || 'null');
      return d && Array.isArray(d.results) && d.results.some(Boolean) ? d : null;
    } catch (e) { return null; }
  }

  // 分章完成后：如果本地存的批次章数对得上，自动把上次的结果接回来
  function autoRestoreBatch() {
    const saved = savedBatch();
    if (!saved) return 0;
    const have = (ed.genResults || []).some(Boolean);
    if (have || saved.count !== (ed.chapters || []).length) return 0;
    ed.genResults = saved.results;
    return saved.results.filter(Boolean).length;
  }

  function batchLog(text, cls) {    const out = document.getElementById('batch-out');
    if (!out) return;
    out.className = 'ed-msg ' + (cls || '');
    out.innerHTML = `<div>${text}</div>` + (out.innerHTML || '');
  }

  function batchSplit() {
    const box = document.getElementById('batch-text');
    ed.batchText = box ? box.value : (ed.batchText || '');
    ed.chapters = splitChapters(ed.batchText);
    ed.genResults = [];
    const restored = autoRestoreBatch();
    renderBody();
    batchLog(ed.chapters.length
      ? `已分章：${ed.chapters.length} 章${restored ? `（并接回上次的 ${restored} 条生成结果）` : ''}。勾选要生成的部分，然后点「② 逐章生成」。`
      : '没有内容可分章，请先粘贴或上传 txt。', ed.chapters.length ? 'ok' : 'bad');
  }

  function batchRoster() {
    const names = new Map();
    for (const c of ed.book.characters) names.set(c.id, c.name);
    for (const r of ed.genResults || []) for (const c of (r && r.characters) || []) if (!names.has(c.id)) names.set(c.id, c.name);
    return [...names.entries()].slice(0, 300).map(([id, name]) => `${id}: ${name}`).join('；');
  }

  function batchPlaceRoster() {
    const names = new Map();
    for (const p of ed.book.places || []) names.set(p.id, p.name);
    for (const r of ed.genResults || []) for (const p of (r && r.places) || []) if (!names.has(p.id)) names.set(p.id, p.name);
    return [...names.entries()].slice(0, 100).map(([id, name]) => `${id}: ${name}`).join('；');
  }

  /* 第二轮：只抽本章事件（第一轮的长输出常被网关截断，events 整段丢掉） */
  async function callLLMEvents(ch) {
    const n = ch.no || 1;
    const body = ch.text.length > 30000 ? ch.text.slice(0, 30000) : ch.text;
    const roster = batchRoster();
    const total = Number(ed.book.meta.chapters) || (ed.chapters || []).length;
    const sys = '你是文学作品的资料整理员。只做一件事：从给定章节里抽出**重大事件**（推动剧情、改变人物关系的节点），输出 JSON。' +
      '硬性要求：严格输出 {"events": [...]}（不要 markdown 围栏、不要解释）；**3–6 个**事件；每个事件：' +
      'id 用「e-章号-序号」（例 e-3-1）、ch 写本章章号、name ≤ 14 字、summary ≤ 45 字（谁·对谁·做了什么·后果）、' +
      'impact ≤ 30 字、chars 必须从「人物名单」里选 id、place 用「已有地点名单」里的 id（没把握就省略 place）、quote 可省略；phase 省略（我会按章号自动归入阶段）；全部中文。';
    const user = `书名《${ed.book.meta.title || '未命名'}》，共 ${total} 章。现在是第 ${n} 章：${ch.title}。\n\n` +
      (roster ? `人物名单（chars 只能从这里选 id）：\n${roster}\n\n` : '') +
      `只输出 JSON：{"events":[{"id":"e-${n}-1","ch":${n},"name":"","summary":"","impact":"","chars":["id"],"place":""}]}\n\n` +
      `<<<本章原文开始>>>\n${body}\n<<<本章原文结束>>>`;
    return callLLM(sys, user);
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
        // 事件单独跑一轮：长输出里 events 常被截断丢掉
        try {
          const ev = await callLLMEvents(ch);
          draft.events = ev.events || [];
        } catch (e) {
          batchLog(`⚠ ${esc(ch.title)} 事件抽取失败（人物/关系照常保留）：${esc(String(e.message))}`, 'bad');
        }
        ed.genResults[idx] = draft;
        ok++;
        saveBatchResults();
        batchLog(`✓ ${n + 1}/${picks.length} ${esc(ch.title)}：${(draft.characters || []).length} 人 / ${(draft.relations || []).length} 关系 / ${(draft.events || []).length} 事件`, 'ok');
      } catch (e) {
        ed.genResults[idx] = { error: String(e.message) };
        saveBatchResults();
        batchLog(`✗ ${esc(ch.title)}：${esc(String(e.message))}`, 'bad');
      }
    }
    ed.generating = false;
    batchLog(`本轮结束：成功 ${ok} / ${picks.length} 章。点「③ 合并去重」把它们并进当前书。`, ok ? 'ok' : 'bad');
  }

  function batchFactionRoster() {
    return (ed.book.factions || []).map((f) => `${f.key}: ${f.name}`).join('；');
  }

  function batchSystem() {
    return '你是文学作品的资料整理员，正在**逐章**整理一本书，供「人物关系 + 事件时间轴」应用使用。硬性要求：' +
      '严格输出 JSON（不要 markdown 围栏、不要解释）；**只从给定章节抽取**，不要引入本章没出现的内容；' +
      '**篇幅控制靠"写短"，不靠漏人**：本章出现的人物尽量都收（有名有姓、有行动或对话的都算，不设人数上限）；用短字段省长度——desc/fate/note/title 各 ≤ 30 字，事件 summary ≤ 45 字，每条关系小事件文案 ≤ 35 字、只写 1 条；' +
      '人物 id 必须沿用「已有名单」里对应的 id，若是名单外的新人物才新起 id（拼音 kebab-case）；' +
      '带血缘/姻亲/收养关系的人物，relation 的 type 要写清是哪一种（血缘=父子/母子/兄弟…，收养=养父/养女…，姻亲=继母/岳父…，只写得出含糊说法就标 dashed 并在 events 里说清），并同时给出 kin 字段（blood 血缘 / adoptive 收养 / step 继亲 / inlaw 姻亲 / sworn 结义 / foster 抚养 / 空）；' +
      'relations 每条至少 1 个「定义关系的小事件」，chapter 写「第N章」，place 写这条小事件发生的地点 id（有把握才写）；**关系的两端、事件的 chars 都必须出现在本次 characters 里**（没抽出来的人物不要写进关系）；' +
      'events 的 ch 写这一章的章号，place 写地点 id，**id 用「e-章号-序号」**（例：第 3 章的第二个事件写 e-3-2），phase 可省略（我会自动补）；phases 只在第 1 章输出；' +
      'places：沿用「已有地点名单」的 id，本章新出现的地点可以新增（id 拼音 kebab），没把握就不写 place；' +
      'faction 必须沿用「已有阵营」里的 key（确实不属于任何已有阵营才新起 key）；' +
      'style 约定 solid=亲缘/同盟、dashed=对立/伤害、dotted=情人/过去/间接；**同一对人如果关系变了（同盟→反目），拆成两条并各给 fromCh/toCh**（toCh 独占）；易混同名人物在 note 里写消歧提示；' +
      '多个人物共用一个名字或绰号时，必须在 name 里带世代/身份（如「何塞·阿尔卡蒂奥（第二代，绰号「巨人」）」）；全部字段中文。';
  }

  function batchUser(ch, idx) {
    const n = ch.no || idx + 1;
    const body = ch.text.length > 40000 ? ch.text.slice(0, 40000) + '\n…（本章过长，已截断）' : ch.text;
    const roster = batchRoster();
    const placeRoster = batchPlaceRoster();
    const factionRoster = batchFactionRoster();
    const total = Number(ed.book.meta.chapters) || (ed.chapters || []).length;
    return `书名《${ed.book.meta.title || '未命名'}》，共 ${total} 章。现在是第 ${n} 章：${ch.title}。\n\n` +
      (roster ? `已有名单（同一个人必须沿用这些 id）：\n${roster}\n\n` : '') +
      (placeRoster ? `已有地点名单（同一个地点必须沿用这些 id）：\n${placeRoster}\n\n` : '') +
      (factionRoster ? `已有阵营（faction 用这些 key）：\n${factionRoster}\n\n` : '') +
      `JSON schema：\n${AI_SCHEMA}\n\n` +
      `请只从本章抽取，输出 JSON。events[].ch = ${n}；relations[].events[].chapter 写「第${n}章」。\n\n` +
      `<<<本章原文开始>>>\n${body}\n<<<本章原文结束>>>`;
  }

  function mergeDraft(draft) {
    const b = ed.book;
    const st = { cAdd: 0, rAdd: 0, eAdd: 0, evAdd: 0, pAdd: 0, dropped: 0 };
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
    const placeById = new Map(b.places.map((p) => [p.id, p]));
    const placeByName = new Map(b.places.map((p) => [p.name, p]));
    const mergePlaceInto = (t, p) => {
      t.aliases = [...new Set([...(t.aliases || []), ...(p.aliases || [])])];
      if (!t.type && p.type) t.type = p.type;
      if (!t.desc && p.desc) t.desc = p.desc;
      if (!t.firstCh && p.firstCh) t.firstCh = p.firstCh;
    };
    for (const p of draft.places || []) {
      const id = String(p.id || '').trim();
      if (id && placeById.has(id)) { mergePlaceInto(placeById.get(id), p); continue; }
      if (p.name && placeByName.has(p.name)) { mergePlaceInto(placeByName.get(p.name), p); continue; }
      const item = { ...p, id: id || uid('pl'), firstCh: p.firstCh ?? 0 };
      b.places.push(item);
      placeById.set(item.id, item);
      if (item.name) placeByName.set(item.name, item);
      st.pAdd++;
    }
    for (const p of draft.phases || []) if (p.id && !b.phases.some((x) => x.id === p.id)) b.phases.push(p);
    const fallbackPhase = (b.phases[0] || { id: 'p1' }).id;
    const relKey = (r) => `${r.from}|${r.to}|${(r.type || '').trim()}`;
    const relMap = new Map(b.relations.map((r) => [relKey(r), r]));
    for (const r of draft.relations || []) {
      // 两端必须都存在——AI 常把没抽出来的人物写进关系里（悬空引用，宁可丢）
      if (!byId.has(r.from) || !byId.has(r.to)) { st.dropped++; continue; }
      const k = relKey(r);
      if (relMap.has(k)) {
        const t = relMap.get(k);
        if (!t.kin && r.kin) t.kin = r.kin;
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
    const evSig = (e) => `${e.ch ?? 0}|${e.name || ''}|${String(e.summary || '').slice(0, 24)}`;
    const evSigs = new Set(b.events.map(evSig));
    for (const e of draft.events || []) {
      const ev = { ...e, id: e.id || uid('e'), ch: e.ch ?? 0 };
      if (!b.phases.some((p) => p.id === ev.phase)) ev.phase = fallbackPhase;
      // 同一章、同名、同摘要＝真重复，丢掉；只是 id 撞车（每章都从 e1 起）就换个 id 留下
      if (evSigs.has(evSig(ev))) continue;
      if (evIds.has(ev.id)) ev.id = uid('e');
      if (Array.isArray(ev.chars)) ev.chars = ev.chars.filter((cid) => byId.has(cid));   // 丢掉没抽出来的人物
      b.events.push(ev);
      evIds.add(ev.id);
      evSigs.add(evSig(ev));
      st.eAdd++;
    }
    // 容错：AI 偶尔把「地点名」当 id 用 —— 名字能对上就改回 id；对不上的直接清掉（真空引用）
    const placeNames = new Map(b.places.map((p) => [p.name, p.id]));
    const fixPlace = (o) => {
      if (!o || !o.place) return;
      if (placeById.has(o.place)) return;
      if (placeNames.has(o.place)) { o.place = placeNames.get(o.place); return; }
      o.place = '';
      st.dropped++;
    };
    for (const e of b.events) fixPlace(e);
    for (const r of b.relations) for (const ev of r.events || []) fixPlace(ev);
    // kin 容错：AI 会把「空」/none/无 当值写出来，等同于没填
    const cleanKin = (o) => { if (o && (o.kin === '' || /^(空|无|none|null|-|否)$/i.test(String(o.kin)))) delete o.kin; };
    for (const r of b.relations) cleanKin(r);
    return st;
  }

  function batchMerge() {
    const results = (ed.genResults || []).filter((r) => r && !r.error);
    if (!results.length) { batchLog('还没有可合并的结果，先跑「② 逐章生成」', 'bad'); return; }
    const total = { cAdd: 0, rAdd: 0, eAdd: 0, evAdd: 0, pAdd: 0, dropped: 0 };
    for (const d of results) {
      const st = mergeDraft(d);
      total.cAdd += st.cAdd; total.rAdd += st.rAdd; total.eAdd += st.eAdd; total.evAdd += st.evAdd; total.pAdd += st.pAdd; total.dropped += st.dropped;
    }
    adopt(ed.book, true);
    saveDraft();
    batchLog(`✓ 合并完成：+${total.cAdd} 人 / +${total.pAdd} 地点 / +${total.rAdd} 关系 / +${total.eAdd} 事件 / +${total.evAdd} 条小事件（并按 id 或姓名合并了重复人物）${total.dropped ? `；丢弃 ${total.dropped} 处悬空引用（关系两端/地点没抽到）` : ''}。记得逐条校对。`, 'ok');
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
    $('#ed-undo').addEventListener('click', undo);
    $('#ed-redo').addEventListener('click', redo);
    document.addEventListener('keydown', (ev) => {
      const mod = ev.ctrlKey || ev.metaKey;
      if (!mod) return;
      const k = String(ev.key || '').toLowerCase();
      if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); }
      else if ((k === 'z' && ev.shiftKey) || k === 'y') { ev.preventDefault(); redo(); }
    });
    $('#ed-new').addEventListener('click', () => { if (confirm('新建空白书？当前未保存的改动会丢。')) newBlank(); });
    $('#ed-save').addEventListener('click', () => { saveDraft(); refreshPreview(); });
    $('#ed-export').addEventListener('click', exportJson);
    $('#ed-preview').addEventListener('click', () => togglePreview());
    $('#ed-preview-tab').addEventListener('click', () => {
      saveDraft();
      window.open(previewUrl(), '_blank');
    });
    $('#ed-preview-refresh').addEventListener('click', () => refreshPreview(0));
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
        const what = ({ characters: '人物', relations: '关系', events: '事件', phases: '阶段', factions: '阵营', places: '地点' })[sec] || sec;
        if (confirm(`删除这条${what}？`)) {
          const removed = list()[Number(idx)];
          list().splice(Number(idx), 1);
          snapshotBook(`删除${what}${removed && removed.name ? '「' + removed.name + '」' : ''}`);
          saveDraft();
          refreshPreview();
          renderBody();
        }
        return;
      }
      if (act === 'cancel') { ed.editing = null; renderBody(); return; }
      if (act === 'health-run') { renderBody(); return; }
      if (act === 'health-jump') { jumpTo(sec, Number(idx)); return; }
      if (act === 'health-variants') { applyVariantFixes(); return; }
      if (act === 'health-copy') {
        const text = healthReportText();
        const done = () => alert('体检报告已复制到剪贴板（可直接贴到 Issue / PR）');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
        else fallbackCopy(text, done);
        return;
      }
      if (act === 'meta-save') { saveDraft(); renderBody(); return; }
      if (act === 'rel-add-event') {
        ed.form.events = ed.form.events || [];
        ed.form.events.push({ text: '', chapter: '', place: '' });
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

    // 整本图书上传（txt / md / html / epub）
    document.addEventListener('change', async (ev) => {
      if (ev.target.id !== 'batch-file') return;
      const file = ev.target.files[0];
      if (!file) return;
      try {
        const { text, chapters, kind } = await readBookFile(file, (n, total) => {
          const out = document.getElementById('batch-out');
          if (out) { out.className = 'ed-msg'; out.textContent = `⏳ 正在解析 PDF 第 ${n} / ${total} 页…`; }
        });
        ed.batchText = text;
        ed.chapters = Array.isArray(chapters) && chapters.length ? chapters : [];
        ed.genResults = [];
        const restored = ed.chapters.length ? autoRestoreBatch() : 0;
        renderBody();
        if (ed.chapters.length) {
          batchLog(`已读入 ${esc(file.name)}（${kind} · ${text.length} 字）—— 用 EPUB 自带目录分好了 ${ed.chapters.length} 章${restored ? `，并接回上次的 ${restored} 条生成结果` : ''}`, 'ok');
        } else {
          batchSplit();   // 没有自带目录时自动按标题分章
          batchLog(`已读入 ${esc(file.name)}（${kind} · ${text.length} 字）`, 'ok');
        }
      } catch (e) {
        renderBody();
        batchLog('读取失败：' + esc(String(e.message)), 'bad');
      }
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
        saveDraft(); refreshPreview(); renderBody(); return;
      }
      const item = buildItem(sec);
      if (!item) return;
      const idx = ed.editing.idx;
      const what = ({ characters: '人物', relations: '关系', events: '事件', phases: '阶段', factions: '阵营', places: '地点' })[sec] || sec;
      if (idx === null) ed.book[sec].push(item); else ed.book[sec][idx] = item;
      ed.editing = null;
      snapshotBook(`${idx === null ? '新增' : '修改'}${what}${item.name ? '「' + item.name + '」' : ''}`);
      saveDraft();
      refreshPreview();
      renderBody();
    });
  }

  function templateFor(sec) {
    if (sec === 'characters') return { id: '', name: '', aliases: [], altNames: [], parents: [], generation: 1, gender: 'm', firstCh: 1, faction: (ed.book.factions[0] || {}).key || '', title: '', desc: '', fate: '', note: '' };
    if (sec === 'relations') return { from: (ed.book.characters[0] || {}).id || '', to: (ed.book.characters[1] || ed.book.characters[0] || {}).id || '', type: '', style: 'solid', events: [{ text: '', chapter: '', place: '' }] };
    if (sec === 'events') return { id: uid('e'), name: '', phase: (ed.book.phases[0] || {}).id || '', order: (ed.book.events.length + 1), ch: 1, chars: [], summary: '', impact: '', quote: '' };
    if (sec === 'phases') return { id: uid('p'), name: '', order: ed.book.phases.length + 1 };
    if (sec === 'factions') return { key: '', name: '', color: '#8b94a7' };
    if (sec === 'places') return { id: '', name: '', aliases: [], type: '', firstCh: 1, desc: '' };
    return {};
  }

  function buildItem(sec) {
    const f = ed.form;
    if (sec === 'characters') {
      const item = {
        ...f,
        id: (f.id || '').trim() || uid('c'),
        aliases: toList(f.aliases),
        /* v0.95：`altNames` 标出「哪个别名是另一个译本」，界面分开措辞（又译 vs 别名）。
         * 留空时**不写这个键**（而不是写 []）—— validate 只在"填了"时才校验一致性。
         * 注意它不必是 aliases 的子集：一条别名里混了译名差异和绰号时
         *（如「奥雷良诺·布恩迪亚上校」），这里写拆干净的变体「奥雷良诺·布恩迪亚」即可。 */
        ...(toList(f.altNames).length ? { altNames: toList(f.altNames) } : {}),
        /* v0.95：`parents` 让血缘变成可核对的结构化声明 ——
         * 以前父子关系只是一条普通 relations 边，漏一条没有任何机制能发现它
         * （"上校与奥雷里亚诺第二明明是叔侄却一条线都没有"就是这么漏的）。 */
        ...(toList(f.parents).length ? { parents: toList(f.parents) } : {}),
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
      const fromCh = Number(f.fromCh) || 0;
      const toCh = Number(f.toCh) || 0;
      if (fromCh && toCh && toCh <= fromCh) { alert('「结束章 toCh」必须大于「成立章 fromCh」（区间是 [fromCh, toCh)）'); return null; }
      const kin = f.kin || guessKin(f.type);      // 没选亲属类型时，按关系名自动判一个（可以在表单里改）
      return {
        from: f.from, to: f.to, type: f.type, ...(kin ? { kin } : {}), style: f.style || 'solid',
        ...(fromCh > 0 ? { fromCh } : {}), ...(toCh > 0 ? { toCh } : {}), events
      };
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
    if (sec === 'places') {
      if (!(f.name || '').trim()) { alert('地点名不能为空'); return null; }
      return { ...f, id: (f.id || '').trim() || uid('pl'), name: f.name.trim(), type: (f.type || '').trim(), aliases: toList(f.aliases), firstCh: Number(f.firstCh) || 0, desc: f.desc || '' };
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
      if (btn.dataset.tool === 'batch-restore') {
        const saved = savedBatch();
        if (!saved) { batchLog('没有可接回的本地结果', 'bad'); return; }
        ed.genResults = saved.results;
        renderBody();
        batchLog(`已接回 ${saved.results.filter(Boolean).length} 条生成结果（章数 ${saved.count}，本机保存于 ${new Date(saved.at).toLocaleString()}）。点「③ 合并去重」把它们并进当前书。`, 'ok');
      }
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

  // 调试入口（控制台里可以跑体检、看报告、跳条目）
  window.__ed = {
    state: ed,
    health: () => healthCheck(),
    report: () => healthReportText(),
    jump: (sec, idx) => jumpTo(sec, idx),
    variants: () => applyVariantFixes(),
    /* v85：把纯逻辑暴露出来给 test/editor.mjs 断言。
     * 这些是编辑器里最容易出错、又最难手测的部分：
     *   parseLooseJson —— 修 LLM 返回的截断/带尾随文字的 JSON（整本生成的成败全靠它）
     *   hanToNum / headingNo / splitChapters / pageToLines —— 从 EPUB/PDF 里切章节
     *   normalize / guessKin / validate / mergeDraft —— 数据规整与合并
     * 全部是纯函数或只依赖 ed.state，不碰 DOM。 */
    parseLooseJson: (raw) => parseLooseJson(raw),
    hanToNum: (s) => hanToNum(s),
    headingNo: (line) => headingNo(line),
    splitChapters: (text) => splitChapters(text),
    pageToLines: (items) => pageToLines(items),
    normalize: (book) => normalize(book),
    guessKin: (type) => guessKin(type),
    /* v0.152：kin ⇄ type 的唯一判定，以及走它的两个入口。
     * 暴露出来是为了让 test/editor.mjs 能对着真实数据断言
     * 「校验」与「体检」对同一条关系给同一个答案（此前它俩各抄一份、漂过）。 */
    kinIssues: (type, kin) => kinIssues(type, kin),
    validate: () => validate(),
    /* v0.153：亲子边的判定（与 `scripts/kin-terms.mjs` 的 `isParentChild` 同一套，含收养边）。
     * 返回 `from>to` 的边集，供 test/parent-child.mjs 对着真实数据与权威对拍 ——
     * 这里曾用一套不同的规则（只认 kin=blood），静默漏掉了全部收养亲子边。 */
    parentChildEdges: (book) => {
      const rels = ((book || ed.book) || {}).relations || [];
      return rels.filter((r) => isParentChildType(r.type)).map((r) => `${r.from}>${r.to}`);
    },
    cleanHtml: (html) => cleanHtml(html),
    mergeDraft: (draft) => mergeDraft(draft),
    undo: () => undo(),
    redo: () => redo(),
    /** 撤销栈深度（供测试断言；ed.history 是快照数组，hIndex 是当前指针） */
    historyDepth: () => ({ total: (ed.history || []).length, index: ed.hIndex, limit: ed.histLimit }),
  };
})();