// 内容定义不包含配方；新档只从这五张本源开始。
export const FORMAT_VERSION = 2;
export const CONTENT_VERSION = 1;
export const CATEGORIES = Object.freeze(['自然', '科技', '人文', '食物', '生物', '抽象', '整活']);
export const BASE_CARDS = Object.freeze([
  { id: 'base:metal', name: '金', emoji: '🪙', category: '自然', description: '金属之始。' },
  { id: 'base:wood', name: '木', emoji: '🌳', category: '自然', description: '草木之始。' },
  { id: 'base:water', name: '水', emoji: '💧', category: '自然', description: '流水之始。' },
  { id: 'base:fire', name: '火', emoji: '🔥', category: '自然', description: '火焰之始。' },
  { id: 'base:earth', name: '土', emoji: '🪨', category: '自然', description: '大地之始。' },
].map(card => Object.freeze({ ...card, isBase: true })));

// 示例配置不含凭据；玩家在设备原生凭据层保存自己的 Key。
export const DEFAULT_AI_CONFIG = Object.freeze({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' });
export const DEFAULT_PREFERENCES = Object.freeze({
  skinId: 'default', tabletopId: 'paper', cardBackId: 'plain',
  soundEnabled: true, musicEnabled: true, reduceMotion: false, zoom: 1,
  // 区分尚未摆放的新档和玩家主动收空的台面；旧档缺省保留首次铺本源的行为。
  layoutInitialized: false,
  // 空串表示使用内置提示；自定义内容跟随当前存档分享，不进入API凭据配置。
  synthesisPrompt: '',
});
export const APPEARANCE_IDS = Object.freeze({
  skinId: Object.freeze(['default', 'sea', 'hearth', 'starfire', 'firefly', 'dawn']),
  tabletopId: Object.freeze(['paper', 'deep', 'cosmos']),
  cardBackId: Object.freeze(['plain', 'rainbow']),
});
export const CARD_LIMITS = Object.freeze({ name: 32, emoji: 16, description: 240, responseBytes: 32768 });
