/**
 * 批量生成经典小说人物关系图谱缓存
 * 用法：node generate-examples.js [小说名1] [小说名2] ...
 * 不带参数则使用默认列表
 * 需要先配置 .env 中的 DEEPSEEK_API_KEY
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey || apiKey.startsWith('sk-xxx')) {
  console.error('❌ 请先在 .env 中配置有效的 DEEPSEEK_API_KEY');
  process.exit(1);
}

const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const DEFAULT_NOVELS = ['西游记', '水浒传'];

const novels = process.argv.length > 2
  ? process.argv.slice(2)
  : DEFAULT_NOVELS;

console.log(`📚 将为以下小说生成图谱：${novels.join('、')}`);
console.log('');

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

async function generateOne(name) {
  const cacheKey = name.replace(/[\\/:*?"<>|]/g, '_');
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);

  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (cached.characters && cached.characters.length > 0) {
        console.log(`📦 ${name} — 已缓存，跳过`);
        return;
      }
    } catch (_) { /* 损坏，重新生成 */ }
  }

  console.log(`📖 正在生成「${name}」…`);
  const start = Date.now();

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
      throw new Error(errBody.error?.message || `API 错误（${resp.status}）`);
    }

    const json = await resp.json();
    const rawText = json.choices?.[0]?.message?.content || '';
    const data = extractJSON(rawText);

    if (!data || !data.characters || data.characters.length === 0) {
      throw new Error('AI 返回格式异常，未提取到有效数据');
    }

    if (!data.novelName) data.novelName = name;
    if (!data.relations) data.relations = [];
    if (!data.events) data.events = [];
    assignFactionColors(data);

    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf-8');
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✅ ${name} — ${data.characters.length} 角色 · ${data.relations.length} 关系 · ${data.events.length} 事件（${elapsed}s）`);
  } catch (err) {
    console.error(`❌ ${name} 失败：${err.message}`);
  }
}

async function main() {
  console.log(`🔑 API Key：${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);
  console.log('');

  for (const name of novels) {
    await generateOne(name.trim());
    // 间隔 2 秒避免被限流
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('');
  console.log('🎉 全部完成！重启服务后即可使用。');
}

main().catch(err => {
  console.error('运行失败：', err.message);
  process.exit(1);
});
