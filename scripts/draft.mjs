#!/usr/bin/env node
/**
 * AI 草稿生成（只出草稿，必须人工校对 + validate.mjs 校验后才能发布）
 *
 * 用法：
 *   node scripts/draft.mjs --title "书名"
 *   node scripts/draft.mjs --title "书名" --text path/to/book.txt   # 有原文时按原文抽取，更可靠
 *   node scripts/draft.mjs --title "书名" --out data/ming.json
 *
 * 环境变量：
 *   DEEPSEEK_API_KEY（或 LLM_API_KEY）   必填
 *   LLM_BASE_URL   默认 https://api.deepseek.com/v1（可换成任何 OpenAI 兼容端点）
 *   LLM_MODEL      默认 deepseek-chat
 *
 * 说明：
 *   - 不带 --text 时，AI 只能凭自己的知识写，**一定会有错**（重名、张冠李戴），只当打字员用；
 *   - 带 --text 时，把原文截取到 PROMPT 里让它抽取，质量高很多；
 *   - 输出文件最后要人工过一遍，再 `node scripts/validate.mjs <文件>`。
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const get = (name, def = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? true) : def;
};

const title = get('--title');
if (!title) {
  console.error('用法：node scripts/draft.mjs --title "书名" [--slug slug] [--text book.txt] [--out data/xx.json]');
  process.exit(1);
}
const slug = (get('--slug') || title).toString().trim().toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');
const outFile = path.resolve(get('--out') || `data/${slug}.json`);
const textFile = get('--text');

const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY;
if (!apiKey) {
  console.error('缺少 DEEPSEEK_API_KEY（或 LLM_API_KEY）环境变量');
  process.exit(1);
}
const baseUrl = (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const model = process.env.LLM_MODEL || 'deepseek-chat';

const SCHEMA = `{
  "meta": { "slug": "", "title": "", "author": "", "translator": "", "prophecy": "", "note": "", "license": "CC BY-SA 4.0", "updated": "YYYY-MM-DD", "sources": [{ "name": "" }] },
  "factions": [{ "key": "", "name": "", "color": "#hex" }],
  "characters": [{ "id": "拼音-kebab", "name": "", "aliases": [], "generation": 1, "gender": "m|f", "firstCh": 1, "faction": "", "title": "", "desc": "", "fate": "", "note": "" }],
  "relations": [{ "from": "id", "to": "id", "type": "关系名", "style": "solid|dashed|dotted", "events": [{ "text": "定义这段关系的小事件", "chapter": "第X章", "place": "地点 id 或空" }] }],
  "places": [{ "id": "拼音-kebab", "name": "", "aliases": [], "type": "城镇|宅邸|酒馆…", "firstCh": 1, "desc": "" }],
  "phases": [{ "id": "p1", "name": "阶段名", "order": 1 }],
  "events": [{ "id": "e01", "phase": "p1", "order": 1, "ch": 1, "name": "", "chars": ["id"], "place": "地点 id 或空", "summary": "", "impact": "", "quote": "" }]
}`;

const SYSTEM = `你是文学作品的资料整理员，为一个「人物关系 + 事件时间轴」应用生成数据草稿。
硬性要求：
- 严格输出上面的 JSON schema，不要 markdown 代码围栏，不要任何解释文字；
- 人物 25–45 个（覆盖所有主要出场人物，含反派、次要但推动情节的人）；
- 关系 40–75 条，每条关系必须有 1–2 个「定义这段关系的小事件」（小事件=看着不起眼但能解释两人关系的事），并尽量给出章节；
- 事件 18–30 个，按 5–8 个阶段（phases）分组；**如果作品没有明确年份，禁止编造年份**，用 phase+order 排序；
- 地点（places）6–15 个：只收能当筛选维度的地点（城镇 / 宅邸 / 酒馆 / 机构…），不要每个房间都建；
  events[].place 与 relations[].events[].place 必须引用 places 里已有的 id，没把握就留空；
- **血缘 / 收养 / 继亲 / 姻亲必须分开写**（父子、母子、养父、养女、继母、岳父…）：收养关系不许写成"母子"，拿不准就在关系小事件里说清；
- 关系 style 约定：solid=亲缘/同盟；dashed=对立/伤害；dotted=情人/过去/间接；
- 对容易混淆的同名人物，在 note 字段写一句消歧提示；
- 全部字段用中文（id 用拼音 kebab-case）。`;

const examples = fs.existsSync(path.resolve('data/one-hundred-years-of-solitude.json'))
  ? fs.readFileSync(path.resolve('data/one-hundred-years-of-solitude.json'), 'utf8').slice(0, 20000)
  : null;

let userMsg = `请为《${title}》生成数据草稿。\n\nJSON schema（必须完全遵循）：\n${SCHEMA}\n`;
if (examples) userMsg += `\n参考一个已有样例的写法（只参考格式与粒度，不要抄内容）：\n${examples}\n`;
if (textFile) {
  const raw = fs.readFileSync(path.resolve(textFile), 'utf8');
  const cut = raw.slice(0, 120000);
  userMsg += `\n以下是原文（节选 ${cut.length} 字），请优先从原文中抽取人物、关系与事件：\n<<<原文开始>>>\n${cut}\n<<<原文结束>>>\n`;
} else {
  userMsg += `\n注意：没有提供原文，请仅依据广泛公认的公开资料整理；不确定的细节宁可省略，也不要说错（把不确定之处写进 note）。\n`;
}

console.log(`▶ 生成《${title}》草稿 → ${outFile}`);
console.log(`  模型：${model} @ ${baseUrl}${textFile ? '（带原文）' : '（无原文，质量有限）'}`);

const resp = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model,
    temperature: 0.4,
    max_tokens: 8192,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg }],
  }),
});
if (!resp.ok) {
  console.error(`API 错误 ${resp.status}：${await resp.text().catch(() => '')}`);
  process.exit(1);
}
const json = await resp.json();
const raw = json.choices?.[0]?.message?.content || '';
const m = raw.match(/\{[\s\S]*\}/);
if (!m) {
  console.error('AI 返回内容无法解析出 JSON。原始返回前 500 字：\n' + raw.slice(0, 500));
  process.exit(1);
}
let data;
try {
  data = JSON.parse(m[0]);
} catch (e) {
  console.error('JSON 解析失败：' + e.message);
  process.exit(1);
}
if (!data.meta) data.meta = {};
data.meta.slug = data.meta.slug || slug;
data.meta.title = data.meta.title || title;
data.meta.updated = new Date().toISOString().slice(0, 10);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8');
console.log(`✅ 草稿已写入 ${outFile}（${(data.characters || []).length} 角色 / ${(data.places || []).length} 地点 / ${(data.relations || []).length} 关系 / ${(data.events || []).length} 事件）`);
console.log('📌 下一步：人工校对 → node scripts/validate.mjs ' + path.relative(process.cwd(), outFile));
