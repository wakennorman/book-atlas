require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const apiKey = process.env.DEEPSEEK_API_KEY;
let apiReady = false;

if (!apiKey) {
  console.warn('⚠️  未设置 DEEPSEEK_API_KEY，图谱生成功能暂不可用');
  console.warn('   复制 .env.example 为 .env 并填入你的 DeepSeek API Key 后重启服务');
  console.warn('   当前仍可使用《三国演义》示例数据体验基本功能');
} else {
  apiReady = true;
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

// ── LLM 系统提示词 ──
const SYSTEM_PROMPT = `You are a literary analyst. Output a character graph in STRICT JSON with Chinese text fields:

{
  "novelName":"书名",
  "characters":[{"id":"pinyin-kebab","name":"角色名","faction":"阵营key","title":"身份","desc":"一句话描述"}],
  "factions":[{"key":"阵营key","name":"阵营名","color":"#hex"}],
  "relations":[{"from":"id","to":"id","type":"关系类型","style":"solid|dashed|dotted"}],
  "events":[{"year":数字或null,"name":"事件名","chars":["id"],"summary":"概述"}]
}

Rules:
- 20-35 characters, 3-6 factions (assign distinct #hex colors), 30-60 relations, 8-14 events
- solid=family/ally/loyalty, dashed=rivary/enemy/betrayal, dotted=mentor/former/indirect
- All text in Chinese, ids in pinyin-kebab
- No markdown fences, raw JSON only`;

// ── 自动分配阵营颜色 ──
const FACTION_PALETTE = [
  '#e74c3c', '#3498db', '#2ecc71', '#9b59b6',
  '#e67e22', '#1abc9c', '#f39c12', '#e91e63',
  '#00bcd4', '#ff5722', '#8bc34a', '#3f51b5',
];

function assignFactionColors(data) {
  if (!data.factions) data.factions = [];
  const factionKeys = new Set(data.characters.map(c => c.faction));
  factionKeys.forEach((key, i) => {
    if (!data.factions.find(f => f.key === key)) {
      data.factions.push({ key, name: key, color: FACTION_PALETTE[i % FACTION_PALETTE.length] });
    }
  });
  data.factions.forEach((f, i) => {
    if (!f.color) f.color = FACTION_PALETTE[i % FACTION_PALETTE.length];
  });
}

// ── 提取 JSON ──
function extractJSON(text) {
  try { return JSON.parse(text); } catch (_) {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch (_) {} }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch (_) {}
  }
  return null;
}

// ── API 路由 ──
app.post('/api/generate', async (req, res) => {
  if (!apiReady) {
    return res.status(503).json({ error: '未配置 API Key。请复制 .env.example 为 .env，填入 DEEPSEEK_API_KEY，重启服务。' });
  }

  const { novelName } = req.body;
  if (!novelName || typeof novelName !== 'string' || novelName.trim().length < 2) {
    return res.status(400).json({ error: '请输入有效的小说名称（至少2个字）' });
  }

  const name = novelName.trim();

  // ── 检查缓存 ──
  const cacheKey = name.replace(/[\\/:*?"<>|]/g, '_');
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      console.log(`📦 命中缓存：「${name}」→ ${cached.characters?.length || 0} 个人物`);
      return res.json({ ...cached, _fromCache: true });
    } catch (_) { /* 缓存损坏，重新生成 */ }
  }

  console.log(`📖 正在生成「${name}」的人物关系图谱...`);

  try {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 8192,
        temperature: 0.7,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `请生成小说《${name}》的人物关系图谱。` },
        ],
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      if (resp.status === 401) {
        return res.status(500).json({ error: 'API Key 无效，请检查 .env 文件中的 DEEPSEEK_API_KEY' });
      }
      if (resp.status === 429) {
        return res.status(500).json({ error: 'API 请求过于频繁，请稍后重试' });
      }
      return res.status(500).json({ error: errBody.error?.message || `API 错误（${resp.status}）` });
    }

    const json = await resp.json();
    const rawText = json.choices?.[0]?.message?.content || '';

    const data = extractJSON(rawText);
    if (!data) {
      console.error('❌ LLM 返回内容无法解析为 JSON');
      console.error('原始返回（前500字）:', rawText.slice(0, 500));
      return res.status(500).json({ error: 'AI 返回的内容格式异常，请重试', raw: rawText.slice(0, 500) });
    }

    if (!data.novelName) data.novelName = name;
    if (!data.characters) data.characters = [];
    if (!data.relations) data.relations = [];
    if (!data.events) data.events = [];
    assignFactionColors(data);

    // 写入缓存
    try { fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf-8'); } catch (_) {}
    console.log(`✅ 生成完成：${data.characters.length} 个人物，${data.relations.length} 条关系 · 已缓存`);
    res.json(data);
  } catch (err) {
    console.error('❌ API 调用失败:', err.message);
    res.status(500).json({ error: `生成失败：${err.message}` });
  }
});

// ── 智能搜索 API（自然语言 → 图谱高亮） ──
const SEARCH_PROMPT = `You are a character relationship search engine. The user has a character graph and asks a natural-language question about it.

I will give you:
1. A JSON array of characters (id, name, faction, title, desc)
2. A JSON array of relations (from, to, type)
3. The user's question

Analyze the question against the data. Reply in STRICT JSON only:
{
  "found": true,
  "answer": "用中文回答问题，一句话",
  "highlightIds": ["要在图谱上高亮的所有角色ID"],
  "pathIds": ["可选，如果问的是两个角色间的路径关系，给出路径上所有角色ID"]
}

Rules:
- If the question is NOT about character relationships, return {"found": false}
- Match character names flexibly (partial name, alias, title)
- Trace multi-hop relationships if needed
- Keep the answer concise (1-2 sentences)`;

app.post('/api/search', async (req, res) => {
  if (!apiReady) {
    return res.status(503).json({ error: '未配置 API Key' });
  }

  const { query, characters, relations } = req.body;
  if (!query || !characters) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  // 精简数据：只传必要字段，节省 token
  const slimChars = characters.map(c => ({ id: c.id, name: c.name, faction: c.faction, title: c.title || '', desc: (c.desc || '').slice(0, 60) }));
  const slimRels = relations.map(r => ({ from: r.from, to: r.to, type: r.type }));

  try {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 512,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SEARCH_PROMPT },
          { role: 'user', content: `Characters:\n${JSON.stringify(slimChars)}\n\nRelations:\n${JSON.stringify(slimRels)}\n\nQuestion: ${query}` },
        ],
      }),
    });

    if (!resp.ok) {
      return res.status(500).json({ error: `搜索 API 异常（${resp.status}）` });
    }

    const json = await resp.json();
    const raw = json.choices?.[0]?.message?.content || '';
    const data = extractJSON(raw);

    if (!data || !data.found) {
      return res.json({ found: false });
    }

    console.log(`🔍 搜索：「${query}」→ ${(data.highlightIds || []).length} 个角色高亮`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `搜索失败：${err.message}` });
  }
});

// ── 关系路径解释 API ──
app.post('/api/explain-path', async (req, res) => {
  if (!apiReady) return res.status(503).json({ error: '未配置 API Key' });

  const { charA, charB, relations, novelName } = req.body;
  if (!charA || !charB) return res.status(400).json({ error: '缺少参数' });

  const relSummary = (relations || []).map(r => `${r.aName} -[${r.type}]-> ${r.bName}`).join('; ');

  try {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 256,
        temperature: 0.3,
        messages: [
          { role: 'system', content: '用1-2句中文回答两个人物的关系，简洁直接。' },
          { role: 'user', content: `小说《${novelName || '未知'}》中，${charA.name}和${charB.name}的关系链：${relSummary}。请一句话概括他们的关系。` },
        ],
      }),
    });
    if (!resp.ok) return res.status(500).json({ error: 'API异常' });
    const json = await resp.json();
    const explanation = json.choices?.[0]?.message?.content || '';
    res.json({ explanation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 数据同步 API ──
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.post('/api/sync/save', (req, res) => {
  const { code, profile, favorites, layouts, customEdges } = req.body;
  if (!code || typeof code !== 'string' || code.length < 4) {
    return res.status(400).json({ error: '请设置至少 4 位的同步码' });
  }
  const file = path.join(DATA_DIR, `${code.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
  const data = { profile, favorites, layouts, customEdges, updatedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ ok: true, message: '数据已同步到服务器' });
  } catch (err) {
    res.status(500).json({ error: '保存失败' });
  }
});

app.post('/api/sync/load', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: '缺少同步码' });
  const file = path.join(DATA_DIR, `${code.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
  if (!fs.existsSync(file)) return res.json({ ok: false, message: '未找到数据' });
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ error: '读取失败' });
  }
});

// ── 启动服务器 ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('📚  小说人物关系图谱 · 服务器已启动');
  console.log(`   API 引擎：DeepSeek (deepseek-chat)`);
  console.log(`   打开浏览器访问：http://localhost:${PORT}`);
  console.log('');
});
