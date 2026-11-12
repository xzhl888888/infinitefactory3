import { CATEGORIES, CARD_LIMITS } from '../content/catalog.js';
import { buildSystemPrompt, validSynthesisPrompt } from './prompt.js';

// 错误只携带机器码和字段路径，禁止把原始模型响应或认证信息写入异常。
export class DomainError extends Error {
  constructor(code, field = '') {
    super(code);
    this.name = 'DomainError';
    this.code = code;
    if (field) this.field = field;
  }
}

function textField(value, field, maxLength) {
  if (typeof value !== 'string') throw new DomainError('INVALID_CARD_RESULT', field);
  const text = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!text || [...text].length > maxLength || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text)) {
    throw new DomainError('INVALID_CARD_RESULT', field);
  }
  return text;
}

export function validateCardResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('INVALID_CARD_RESULT');
  const name = textField(value.name, 'name', CARD_LIMITS.name);
  const emoji = textField(value.emoji, 'emoji', CARD_LIMITS.emoji);
  const category = textField(value.category, 'category', 8);
  const description = textField(value.description, 'description', CARD_LIMITS.description);
  if (!CATEGORIES.includes(category)) throw new DomainError('INVALID_CARD_RESULT', 'category');
  // 仅返回游戏字段。供应商额外字段、AI伪造的ID/统计/Key不会进入存档。
  return { name, emoji, category, description };
}

export function buildSynthesisMessages(cards, themes = [], customPrompt = '') {
  if (!Array.isArray(cards) || cards.length < 2 || cards.length > 4) throw new DomainError('INVALID_INGREDIENT_COUNT');
  if (!validSynthesisPrompt(customPrompt)) throw new DomainError('INVALID_SAVE', 'preferences.synthesisPrompt');
  const materials = cards.map(card => {
    const checked = validateCardResult(card);
    return { name: checked.name, emoji: checked.emoji, category: checked.category, description: checked.description };
  });
  return [
    { role: 'system', content: buildSystemPrompt(customPrompt) },
    { role: 'user', content: JSON.stringify({ materials, ...(themes.length ? { worldThemes: themes.filter(t=>typeof t==='string').slice(0,16).map(t=>t.slice(0,1200)) } : {}) }) },
  ];
}

export function parseCardResponse(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > CARD_LIMITS.responseBytes) {
    throw new DomainError('INVALID_AI_RESPONSE');
  }
  let source = text.trim();
  // 只接受完整 JSON 或一个完整代码围栏；不截取夹杂解释的首个对象冒充成功。
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/iu.exec(source);
  if (fenced) source = fenced[1].trim();
  let value;
  try { value = JSON.parse(source); }
  catch { throw new DomainError('INVALID_AI_RESPONSE'); }
  return validateCardResult(value);
}
