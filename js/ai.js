/**
 * 书脉 BookAtlas · AI 讲解模块（按需加载）
 *
 * 用户点击「🤖 讲一遍」时才动态 import() 加载此文件。
 * 核心逻辑通过 window.__ba 调用 app.js 暴露的方法。
 */
(function () {
  'use strict';

  const BA = window.__ba;
  if (!BA) return;

  const { state } = BA;
  const AI_DEFAULT_BASE = 'https://api.deepseek.com/v1';

  function aiConfig() {
    try {
      return {
        base: localStorage.getItem('ba-ai-base') || AI_DEFAULT_BASE,
        model: localStorage.getItem('ba-ai-model') || 'deepseek-chat',
        key: localStorage.getItem('ba-ai-key') || '',
      };
    } catch (e) {
      return { base: AI_DEFAULT_BASE, model: 'deepseek-chat', key: '' };
    }
  }

  function openAiModal(msg) {
    const modal = document.getElementById('ai-modal');
    if (!modal) return;
    const cfg = aiConfig();
    const base = document.getElementById('ai-base');
    const model = document.getElementById('ai-model');
    const key = document.getElementById('ai-key');
    if (base) base.value = cfg.base;
    if (model) model.value = cfg.model;
    if (key) key.value = cfg.key;
    const hint = document.getElementById('ai-hint');
    if (hint) hint.textContent = msg || 'DeepSeek 官方端点允许浏览器直连；换成别的端点若报 CORS，就用编辑器里的命令行方式。';
    modal.hidden = false;
  }

  function saveAiConfig() {
    const base = ((document.getElementById('ai-base') || {}).value || '').trim() || AI_DEFAULT_BASE;
    const model = ((document.getElementById('ai-model') || {}).value || '').trim() || 'deepseek-chat';
    const key = ((document.getElementById('ai-key') || {}).value || '').trim();
    try {
      localStorage.setItem('ba-ai-base', base.replace(/\/+$/, ''));
      localStorage.setItem('ba-ai-model', model);
      localStorage.setItem('ba-ai-key', key);
    } catch (e) { /* 隐私模式忽略 */ }
    const modal = document.getElementById('ai-modal');
    if (modal) modal.hidden = true;
    BA.toast(key ? '已保存 AI 配置（只在本机，与编辑器共用）' : '已清空 API Key');
  }

  async function runAi(kind, payload) {
    const cfg = aiConfig();
    if (!cfg.key) { openAiModal('请先填 API Key'); return ''; }
    const { system, user } = BA.aiPrompt(kind, payload);
    const res = await fetch(`${cfg.base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.3 }),
    });
    if (!res.ok) throw new Error(`AI 请求失败（${res.status}）`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  // 暴露给 app.js 调用
  window.__BA_AI__ = {
    aiConfig,
    openAiModal,
    saveAiConfig,
    runAi,
  };
})();
