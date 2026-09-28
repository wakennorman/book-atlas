/**
 * AI 默认配置（共享模块）
 */
export const AI_DEFAULT_BASE = 'https://api.deepseek.com/v1';
export const AI_DEFAULT_MODEL = 'deepseek-chat';

export function getAiConfig() {
  try {
    return {
      base: localStorage.getItem('ba-ai-base') || AI_DEFAULT_BASE,
      model: localStorage.getItem('ba-ai-model') || AI_DEFAULT_MODEL,
      key: localStorage.getItem('ba-ai-key') || '',
    };
  } catch (e) {
    return { base: AI_DEFAULT_BASE, model: AI_DEFAULT_MODEL, key: '' };
  }
}

export function saveAiConfig(base, model, key) {
  try {
    localStorage.setItem('ba-ai-base', (base || AI_DEFAULT_BASE).replace(/\/+$/, ''));
    localStorage.setItem('ba-ai-model', model || AI_DEFAULT_MODEL);
    localStorage.setItem('ba-ai-key', key || '');
  } catch (e) { /* 隐私模式忽略 */ }
}
