/**
 * AI 默认配置（共享模块）
 *
 * ⚠ v0.94：这里原来还写着 deepseek-chat，和 web 端（app.js 的 AI_DEFAULT_MODEL）不一致 ——
 *   v0.93 只改了 web 那 7 处，漏了这个文件。已同步为 deepseek-flash。
 *   另外：这个模块目前**没有任何地方 import**（孤儿文件），parity 测试也不覆盖它，
 *   所以这类不一致不会被门禁发现。要么用起来，要么删掉，别留一份会漂移的副本。
 */
export const AI_DEFAULT_BASE = 'https://api.deepseek.com/v1';
export const AI_DEFAULT_MODEL = 'deepseek-flash';

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
