import { BASE_CARDS, FORMAT_VERSION, CONTENT_VERSION, DEFAULT_PREFERENCES, APPEARANCE_IDS } from '../content/catalog.js';
import { DomainError, validateCardResult } from '../ai/protocol.js';
import { validSynthesisPrompt } from '../ai/prompt.js';
import { validateMods, validateModPackage, validateModStates, validateModState, validateSource, listModAppearances } from './mods.js';
export { DomainError, validateCardResult } from '../ai/protocol.js';

export const SAVE_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024, cards: 25000, recipes: 100000, operations: 100000, favorites: 100, layout: 20000 });
const fail = (code, field = '') => { throw new DomainError(code, field); };
const record = (v, field) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail('INVALID_SAVE', field); return v; };
const integer = (v, field) => { if (!Number.isSafeInteger(v) || v < 0) fail('INVALID_SAVE', field); return v; };
const identifier = (v, field) => { if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(v)) fail('INVALID_ID', field); return v; };
function timestamp(v, field) {
  if ((typeof v !== 'string' && typeof v !== 'number') || v === '') fail('INVALID_TIMESTAMP', field);
  const ms = new Date(v).getTime();
  if (!Number.isFinite(ms)) fail('INVALID_TIMESTAMP', field);
  return new Date(ms).toISOString();
}
function array(v, field, limit) { if (!Array.isArray(v) || v.length > limit) fail('INVALID_SAVE', field); return v; }
function unique(value, set, field) { if (set.has(value)) fail('DUPLICATE_ID', field); set.add(value); return value; }
function shortText(v, field, max) { if (typeof v !== 'string' || !v.trim() || [...v].length > max || /[\u0000-\u001f\u007f]/u.test(v)) fail('INVALID_SAVE', field); return v.trim(); }

// 名称身份统一使用兼容规范化、空白收敛与小写；显示名称保留首个有效结果。
export function normalizeName(name) {
  if (typeof name !== 'string') fail('INVALID_CARD_RESULT', 'name');
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function recipeKey(ids) {
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4) fail('INVALID_INGREDIENT_COUNT');
  // JSON 数组保留重复材料，也不会出现字符串分隔符碰撞。
  return JSON.stringify(ids.map(id => identifier(id, 'ingredientIds')).sort());
}

export function findRecipe(save, ids) { const key = recipeKey(ids); return save.recipes.find(recipe => recipe.key === key) ?? null; }

export function createNewSave({ id, now, name = '我的世界' }) {
  const at = timestamp(now, 'now');
  return {
    formatVersion: FORMAT_VERSION, contentVersion: CONTENT_VERSION, id: identifier(id, 'id'), name: shortText(name, 'name', 40), mods: [],
    createdAt: at, updatedAt: at, revision: 0,
    cards: BASE_CARDS.map(card => ({ ...card, discoveredAt: at })), recipes: [],
    stats: { synthesisCount: 0 }, preferences: { ...DEFAULT_PREFERENCES },
    favorites: [], layout: [], operations: [],
  };
}

function cleanPreferences(value, mods) {
  const source = record(value, 'preferences');
  const result = { ...DEFAULT_PREFERENCES };
  for (const [key, values] of Object.entries(APPEARANCE_IDS)) {
    if (source[key] !== undefined) {
      const kind = {skinId:'skins',tabletopId:'tabletops',cardBackId:'cardBacks'}[key];
      const custom = listModAppearances(mods.map(m=>({...m,enabled:true})), kind).some(v=>v.id===source[key]);
      if (!values.includes(source[key]) && !custom) fail('INVALID_SAVE', `preferences.${key}`);
      result[key] = source[key];
    }
  }
  for (const key of ['soundEnabled', 'musicEnabled', 'reduceMotion', 'layoutInitialized']) {
    if (source[key] !== undefined) {
      if (typeof source[key] !== 'boolean') fail('INVALID_SAVE', `preferences.${key}`);
      result[key] = source[key];
    }
  }
  if (source.zoom !== undefined) {
    if (!Number.isFinite(source.zoom) || source.zoom < 0.25 || source.zoom > 4) fail('INVALID_SAVE', 'preferences.zoom');
    result.zoom = source.zoom;
  }
  if (source.synthesisPrompt !== undefined) {
    if (!validSynthesisPrompt(source.synthesisPrompt)) fail('INVALID_SAVE', 'preferences.synthesisPrompt');
    result.synthesisPrompt = source.synthesisPrompt;
  }
  return result;
}

function fingerprint(ingredientIds, result) {
  return JSON.stringify({ ingredientIds: JSON.parse(recipeKey(ingredientIds)), result: result == null ? null : validateCardResult(result) });
}
function cleanFingerprint(value) {
  if (typeof value !== 'string' || value.length > 4096) fail('INVALID_SAVE', 'operations.fingerprint');
  let parsed;
  try { parsed = JSON.parse(value); } catch { fail('INVALID_SAVE', 'operations.fingerprint'); }
  record(parsed, 'operations.fingerprint');
  return fingerprint(parsed.ingredientIds, parsed.result);
}

// 导入与导出共用白名单投影。不能把任意preferences/模型扩展字段原封不动存入档案。
export function validateSave(value) {
  const source = record(value, 'save');
  if (![1, FORMAT_VERSION].includes(source.formatVersion)) fail('UNSUPPORTED_SAVE_VERSION', 'formatVersion');
  if (source.contentVersion !== CONTENT_VERSION) fail('UNSUPPORTED_CONTENT_VERSION', 'contentVersion');
  const id = identifier(source.id, 'id');
  const name = source.formatVersion === 1 ? '我的世界' : shortText(source.name ?? '我的世界', 'name', 40);
  const mods = source.formatVersion === 1 ? [] : validateMods(source.mods ?? []);
  const createdAt = timestamp(source.createdAt, 'createdAt');
  const updatedAt = timestamp(source.updatedAt, 'updatedAt');
  if (updatedAt < createdAt) fail('INVALID_TIMESTAMP', 'updatedAt');
  const revision = integer(source.revision, 'revision');
  const ids = new Set(), names = new Set();
  const cards = array(source.cards, 'cards', SAVE_LIMITS.cards).map(raw => {
    const card = record(raw, 'cards');
    const cardId = unique(identifier(card.id, 'cards.id'), ids, 'cards.id');
    const result = validateCardResult(card);
    const normalized = normalizeName(result.name);
    if (names.has(normalized)) fail('DUPLICATE_CARD_NAME');
    names.add(normalized);
    if (typeof card.isBase !== 'boolean') fail('INVALID_SAVE', 'cards.isBase');
    return { id: cardId, ...result, isBase: card.isBase, discoveredAt: timestamp(card.discoveredAt, 'cards.discoveredAt') };
  });
  const byId = new Map(cards.map(card => [card.id, card]));
  const baseIds = new Set(BASE_CARDS.map(card => card.id));
  if (cards.filter(card => card.isBase).length !== BASE_CARDS.length) fail('INVALID_BASE_CARDS');
  for (const base of BASE_CARDS) {
    const card = byId.get(base.id);
    if (!card || !card.isBase || ['name', 'emoji', 'category', 'description'].some(field => card[field] !== base[field])) fail('INVALID_BASE_CARDS');
  }
  for (const card of cards) if (card.isBase && !baseIds.has(card.id)) fail('INVALID_BASE_CARDS');
  const keys = new Set();
  const recipes = array(source.recipes, 'recipes', SAVE_LIMITS.recipes).map(raw => {
    const recipe = record(raw, 'recipes');
    const key = recipeKey(recipe.ingredientIds);
    if (recipe.key !== key) fail('INVALID_RECIPE_KEY');
    unique(key, keys, 'recipes.key');
    const ingredientIds = JSON.parse(key);
    if (ingredientIds.some(cardId => !byId.has(cardId)) || !byId.has(recipe.resultId)) fail('INVALID_CARD_REFERENCE');
    return { key, ingredientIds, resultId: recipe.resultId, createdAt: timestamp(recipe.createdAt, 'recipes.createdAt') };
  });
  const byRecipe = new Map(recipes.map(recipe => [recipe.key, recipe]));
  const operationIds = new Set();
  const operations = array(source.operations, 'operations', SAVE_LIMITS.operations).map(raw => {
    const operation = record(raw, 'operations');
    const operationId = unique(identifier(operation.id, 'operations.id'), operationIds, 'operations.id');
    const clean = cleanFingerprint(operation.fingerprint);
    const materialKey = recipeKey(JSON.parse(clean).ingredientIds);
    const recipe = byRecipe.get(operation.recipeKey);
    if (!recipe || materialKey !== recipe.key || operation.resultId !== recipe.resultId) fail('INVALID_OPERATION_REFERENCE');
    return { id: operationId, recipeKey: recipe.key, resultId: recipe.resultId, completedAt: timestamp(operation.completedAt, 'operations.completedAt'), fingerprint: clean, source: validateSource(operation.source) };
  });
  const synthesisCount = integer(record(source.stats, 'stats').synthesisCount, 'stats.synthesisCount');
  // revision 是当前设备的写版本；从别的设备导入后可以小于历史合成次数。
  if (synthesisCount !== operations.length) fail('INVALID_STATISTICS');
  const folderIds = new Set();
  const favorites = array(source.favorites, 'favorites', SAVE_LIMITS.favorites).map(raw => {
    const group = record(raw, 'favorites');
    const groupId = unique(identifier(group.id, 'favorites.id'), folderIds, 'favorites.id');
    const seen = new Set();
    const cardIds = array(group.cardIds, 'favorites.cardIds', SAVE_LIMITS.cards).map(cardId => {
      if (!byId.has(cardId)) fail('INVALID_CARD_REFERENCE');
      return unique(cardId, seen, 'favorites.cardIds');
    });
    return { id: groupId, name: shortText(group.name, 'favorites.name', 40), cardIds };
  });
  const instanceIds = new Set();
  const layout = array(source.layout, 'layout', SAVE_LIMITS.layout).map(raw => {
    const item = record(raw, 'layout');
    const instanceId = unique(identifier(item.id, 'layout.id'), instanceIds, 'layout.id');
    if (!byId.has(item.cardId)) fail('INVALID_CARD_REFERENCE');
    if (![item.x, item.y].every(n => Number.isFinite(n) && Math.abs(n) <= 10000000)) fail('INVALID_SAVE', 'layout.position');
    if (item.pinned !== undefined && typeof item.pinned !== 'boolean') fail('INVALID_SAVE', 'layout.pinned');
    return { id: instanceId, cardId: item.cardId, x: item.x, y: item.y, pinned: item.pinned ?? false };
  });
  return { formatVersion: FORMAT_VERSION, contentVersion: CONTENT_VERSION, id, name, mods, createdAt, updatedAt, revision, cards, recipes, stats: { synthesisCount }, preferences: cleanPreferences(source.preferences, mods), favorites, layout, operations };
}

export function commitSynthesis(save, { operationId, ingredientIds, result, now, source, modStates = [] }) {
  const current = validateSave(save);
  const opId = identifier(operationId, 'operationId');
  if (opId.length > 128) fail('INVALID_ID', 'operationId');
  const key = recipeKey(ingredientIds);
  const byId = new Map(current.cards.map(card => [card.id, card]));
  if (ingredientIds.some(id => !byId.has(id))) fail('UNKNOWN_INGREDIENT');
  const inputFingerprint = fingerprint(ingredientIds, result);
  const previous = current.operations.find(operation => operation.id === opId);
  if (previous) {
    if (previous.fingerprint !== inputFingerprint) fail('OPERATION_CONFLICT');
    return { save: current, card: byId.get(previous.resultId), recipe: current.recipes.find(recipe => recipe.key === previous.recipeKey), isNewCard: false, isNewRecipe: false, alreadyCommitted: true };
  }
  const submittedAt = timestamp(now, 'now');
  // 设备时钟回拨不倒写档案时间，也不影响材料身份和幂等键。
  const at = submittedAt < current.updatedAt ? current.updatedAt : submittedAt;
  let recipe = current.recipes.find(item => item.key === key);
  let card, isNewCard = false;
  const isNewRecipe = !recipe;
  const checkedSource = validateSource(source ?? { kind: recipe ? 'recipe' : 'ai' }, current.mods);
  const stateChanges = validateModStates(modStates, current.mods);
  if (recipe) card = byId.get(recipe.resultId);
  else {
    if (result == null) fail('RESULT_REQUIRED');
    const checked = validateCardResult(result);
    card = current.cards.find(item => normalizeName(item.name) === normalizeName(checked.name));
    if (!card) {
      const cardId = identifier(`card:${opId}`, 'cards.id');
      if (byId.has(cardId)) fail('DUPLICATE_ID', 'cards.id');
      card = { id: cardId, ...checked, isBase: false, discoveredAt: at };
      isNewCard = true;
    }
    recipe = { key, ingredientIds: JSON.parse(key), resultId: card.id, createdAt: at };
  }
  const next = {
    ...current, updatedAt: at, revision: current.revision + 1,
    cards: isNewCard ? [...current.cards, card] : current.cards,
    recipes: isNewRecipe ? [...current.recipes, recipe] : current.recipes,
    stats: { synthesisCount: current.stats.synthesisCount + 1 },
    mods: current.mods.map(mod => ({ ...mod, state: stateChanges.find(v=>v.id===mod.manifest.id)?.state ?? mod.state })),
    operations: [...current.operations, { id: opId, recipeKey: key, resultId: card.id, completedAt: at, fingerprint: inputFingerprint, source: checkedSource }],
  };
  // 返回新的存档快照，调用方在事务提交后显示结果。
  return { save: validateSave(next), card, recipe, isNewCard, isNewRecipe, alreadyCommitted: false };
}

function changeSave(save, patch, now) {
  const current = validateSave(save);
  const at = timestamp(now, 'now');
  return validateSave({ ...current, ...patch, revision: current.revision + 1, updatedAt: at < current.updatedAt ? current.updatedAt : at });
}
function addModCards(save, modId, definitions) {
  const cards = save.cards.slice();
  for (const [index, definition] of definitions.entries()) {
    const card = validateCardResult(definition);
    if (cards.some(c=>normalizeName(c.name)===normalizeName(card.name))) continue;
    let id = `mod:${modId}:${save.revision}:${index}`;
    while (cards.some(c=>c.id===id)) id += 'x';
    cards.push({ id, ...card, isBase:false, discoveredAt:save.updatedAt });
  }
  return cards;
}
export function installMod(save, raw, { replace = false, now } = {}) {
  const current = validateSave(save), manifest = validateModPackage(raw);
  const existing = current.mods.find(m=>m.manifest.id===manifest.id);
  if (existing && !replace) fail('MOD_ALREADY_INSTALLED');
  // 新包和更新均先停用，由玩家查看内容后启用；不隐式执行收到的脚本。
  const installed = { manifest, enabled:false, state:existing?.state ?? {} };
  const mods = existing ? current.mods.map(m=>m===existing?installed:m) : [...current.mods,installed];
  const preferences = { ...current.preferences };
  for (const key of ['skinId','tabletopId','cardBackId']) if (preferences[key].startsWith(`mod/${manifest.id}/`)) preferences[key] = DEFAULT_PREFERENCES[key];
  return changeSave(current, { mods, preferences }, now);
}
export function toggleMod(save, modId, enabled, now) {
  const current = validateSave(save), mod = current.mods.find(m=>m.manifest.id===modId);
  if (!mod || typeof enabled !== 'boolean') fail('MOD_NOT_FOUND');
  const mods = validateMods(current.mods.map(m=>m===mod?{...m,enabled}:m));
  const starters = enabled ? mod.manifest.startingCards.map(name=>[...BASE_CARDS,...mod.manifest.cards].find(c=>normalizeName(c.name)===normalizeName(name))) : [];
  return changeSave(current, { mods, cards:addModCards(current,modId,starters) }, now);
}
export function removeMod(save, modId, now) {
  const current = validateSave(save);
  if (!current.mods.some(m=>m.manifest.id===modId)) fail('MOD_NOT_FOUND');
  const preferences = { ...current.preferences };
  for (const key of ['skinId','tabletopId','cardBackId']) if (preferences[key].startsWith(`mod/${modId}/`)) preferences[key] = DEFAULT_PREFERENCES[key];
  return changeSave(current, { mods:current.mods.filter(m=>m.manifest.id!==modId), preferences }, now);
}
export function applyModAction(save, modId, output, now) {
  const current = validateSave(save), mod = current.mods.find(m=>m.manifest.id===modId&&m.enabled);
  if (!mod || !output || typeof output !== 'object') fail('MOD_NOT_FOUND');
  const added = array(output.cards ?? [], 'mod.cards', 50).map(validateCardResult);
  const state = output.state == null ? mod.state : validateModState(output.state);
  return changeSave(current, { cards:addModCards(current,modId,added), mods:current.mods.map(m=>m===mod?{...m,state}:m) }, now);
}

export function serializeSave(save) {
  const json = JSON.stringify(validateSave(save));
  if (new TextEncoder().encode(json).length > SAVE_LIMITS.bytes) fail('SAVE_TOO_LARGE');
  return json;
}

export function importSave(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > SAVE_LIMITS.bytes) fail('SAVE_TOO_LARGE');
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('INVALID_SAVE_JSON'); }
  return validateSave(parsed);
}
