import { BASE_CARDS } from '../content/catalog.js';
import { DomainError, validateCardResult } from '../ai/protocol.js';

export const MOD_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024, script: 128 * 1024, state: 64 * 1024, count: 16, asset: 512 * 1024, assets: 32 });
const fail = code => { throw new DomainError(code); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
export const normalizeModName = name => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
function text(value, max, empty = false) {
  if (typeof value !== 'string' || [...value].length > max || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) || (!empty && !value.trim())) fail('INVALID_MOD');
  return value.trim();
}
function id(value) { if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,47}$/u.test(value)) fail('INVALID_MOD'); return value; }
function list(value, max) { if (value == null) return []; if (!Array.isArray(value) || value.length > max) fail('INVALID_MOD'); return value; }
function unique(values, key) { const seen = new Set(); for (const value of values) { const k = key(value); if (seen.has(k)) fail('MOD_CONFLICT'); seen.add(k); } return values; }
function color(value, fallback) { value ??= fallback; if (typeof value !== 'string' || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu.test(value)) fail('INVALID_MOD'); return value; }
function asset(value) {
  if (typeof value !== 'string') fail('INVALID_MOD_ASSET');
  const match = /^data:(image\/(?:png|jpeg|webp)|audio\/(?:wav|mpeg|ogg));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match || match[2].length % 4 || match[2].length > Math.ceil(MOD_LIMITS.asset / 3) * 4) fail('INVALID_MOD_ASSET');
  let raw;
  try { raw = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)); } catch { fail('INVALID_MOD_ASSET'); }
  if (!raw.length || raw.length > MOD_LIMITS.asset) fail('INVALID_MOD_ASSET');
  const view = new DataView(raw.buffer), ascii = (start, count) => String.fromCharCode(...raw.subarray(start, start + count));
  let width, height;
  if (match[1] === 'image/png') {
    if (raw.length < 24 || raw[0] !== 137 || ascii(1, 3) !== 'PNG' || ascii(12, 4) !== 'IHDR') fail('INVALID_MOD_ASSET');
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (match[1] === 'image/jpeg') {
    if (raw[0] !== 255 || raw[1] !== 216) fail('INVALID_MOD_ASSET');
    let p = 2;
    while (p + 4 <= raw.length) {
      if (raw[p++] !== 255) fail('INVALID_MOD_ASSET');
      while (raw[p] === 255) p++;
      const marker = raw[p++]; if (marker === 217 || marker === 218) break;
      const length = view.getUint16(p); if (length < 2 || p + length > raw.length) fail('INVALID_MOD_ASSET');
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { if (length < 7) fail('INVALID_MOD_ASSET'); height = view.getUint16(p + 3); width = view.getUint16(p + 5); break; }
      p += length;
    }
  } else if (match[1] === 'image/webp') {
    if (raw.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') fail('INVALID_MOD_ASSET');
    if (ascii(12, 4) === 'VP8X') { width = 1 + raw[24] + (raw[25] << 8) + (raw[26] << 16); height = 1 + raw[27] + (raw[28] << 8) + (raw[29] << 16); }
    else if (ascii(12, 4) === 'VP8L' && raw[20] === 47) { width = 1 + ((raw[21] | (raw[22] << 8)) & 16383); height = 1 + (((raw[22] >> 6) | (raw[23] << 2) | (raw[24] << 10)) & 16383); }
    else if (ascii(12, 4) === 'VP8 ' && raw[23] === 157 && raw[24] === 1 && raw[25] === 42) { width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383; }
  } else if (match[1] === 'audio/wav') { if (raw.length < 44 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') fail('INVALID_MOD_ASSET'); }
  else if (match[1] === 'audio/ogg') { if (ascii(0, 4) !== 'OggS') fail('INVALID_MOD_ASSET'); }
  else if (ascii(0, 3) !== 'ID3' && !(raw[0] === 255 && (raw[1] & 224) === 224)) fail('INVALID_MOD_ASSET');
  if (match[1].startsWith('image/') && (!width || !height || width > 2048 || height > 2048)) fail('INVALID_MOD_ASSET');
  return value;
}

export function validateModPackage(value) {
  if (typeof value === 'string') { if (bytes(value) > MOD_LIMITS.bytes) fail('MOD_TOO_LARGE'); try { value = JSON.parse(value); } catch { fail('INVALID_MOD'); } }
  if (!record(value) || value.modFormat !== 1 || bytes(value) > MOD_LIMITS.bytes) fail('INVALID_MOD');
  const assets = {};
  if (value.assets != null && !record(value.assets)) fail('INVALID_MOD_ASSET');
  if (Object.keys(value.assets || {}).length > MOD_LIMITS.assets) fail('INVALID_MOD_ASSET');
  for (const [key, data] of Object.entries(value.assets || {})) Object.defineProperty(assets, id(key), { value: asset(data), enumerable: true });
  function mediaRef(key, kind) { if (key == null) return undefined; key = id(key); if (!assets[key]?.startsWith(`data:${kind}/`)) fail('INVALID_MOD_ASSET'); return key; }
  const cards = unique(list(value.cards, 200).map(validateCardResult), c => normalizeModName(c.name));
  const definitions = new Map([...BASE_CARDS, ...cards].map(c => [normalizeModName(c.name), c]));
  for (const c of cards) if (BASE_CARDS.some(b => normalizeModName(b.name) === normalizeModName(c.name))) fail('MOD_CONFLICT');
  const startingCards = unique(list(value.startingCards, 50).map(n => text(n, 32)), normalizeModName);
  if (startingCards.some(n => !definitions.has(normalizeModName(n)))) fail('MOD_CARD_MISSING');
  const recipes = unique(list(value.recipes, 1000).map(r => {
    if (!record(r)) fail('INVALID_MOD');
    const ingredients = list(r.ingredients, 4).map(n => text(n, 32));
    if (ingredients.length < 2) fail('INVALID_MOD');
    const result = text(r.result, 32);
    if (!definitions.has(normalizeModName(result))) fail('MOD_CARD_MISSING');
    return { ingredients, result };
  }), r => JSON.stringify(r.ingredients.map(normalizeModName).sort()));
  function appearances(kind) { return unique(list(value[kind], 20).map(v => {
    if (!record(v)) fail('INVALID_MOD');
    const common = { id: id(v.id), name: text(v.name, 48) }, image = mediaRef(v.image, 'image');
    return { ...common, ...(kind === 'tabletops' ? { color: color(v.color, '#f4efe6'), gridColor: color(v.gridColor, '#26363a22') } : { face: color(v.face, '#f4efe6'), ink: color(v.ink, '#23303a'), border: color(v.border, '#23303a'), accent: color(v.accent, '#c79a3e') }), ...(image ? { image } : {}) };
  }), v => v.id); }
  const sounds = {};
  if (value.sounds != null && !record(value.sounds)) fail('INVALID_MOD');
  for (const kind of ['lift','think','discovery','repeat','failure']) { const ref = mediaRef(value.sounds?.[kind], 'audio'); if (ref) sounds[kind] = ref; }
  const script = value.script ?? '';
  if (typeof script !== 'string' || bytes(script) > MOD_LIMITS.script || script.includes('\0')) fail('INVALID_MOD_SCRIPT');
  const actions = unique(list(value.actions, 12).map(v => { if (!record(v)) fail('INVALID_MOD'); return { id: id(v.id), name: text(v.name, 32), description: text(v.description ?? '', 200, true) }; }), v => v.id);
  if (actions.length && !script.trim()) fail('INVALID_MOD_SCRIPT');
  return { modFormat: 1, id: id(value.id), name: text(value.name, 48), version: text(value.version, 32), description: text(value.description ?? '', 400, true), theme: text(value.theme ?? '', 1200, true), cards, startingCards, recipes, tabletops: appearances('tabletops'), skins: appearances('skins'), cardBacks: appearances('cardBacks'), sounds, assets, script, actions };
}

export function validateModState(value) {
  if (!record(value) || bytes(value) > MOD_LIMITS.state) fail('INVALID_MOD_STATE');
  function clean(v, depth) {
    if (depth > 20) fail('INVALID_MOD_STATE');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (Array.isArray(v)) { if (v.length > 1000) fail('INVALID_MOD_STATE'); return v.map(item => clean(item, depth + 1)); }
    if (!record(v)) fail('INVALID_MOD_STATE');
    const result = {};
    for (const [key, item] of Object.entries(v)) { if (['__proto__','constructor','prototype'].includes(key) || key.length > 100) fail('INVALID_MOD_STATE'); result[key] = clean(item, depth + 1); }
    return result;
  }
  return clean(value, 0);
}
export function validateMods(value = []) {
  const mods = unique(list(value, MOD_LIMITS.count).map(v => {
    if (!record(v) || typeof v.enabled !== 'boolean') fail('INVALID_MOD');
    return { manifest: validateModPackage(v.manifest), enabled: v.enabled, state: validateModState(v.state ?? {}) };
  }), v => v.manifest.id);
  const recipes = new Set();
  for (const mod of mods.filter(m => m.enabled)) for (const recipe of mod.manifest.recipes) {
    const key = JSON.stringify(recipe.ingredients.map(normalizeModName).sort()); if (recipes.has(key)) fail('MOD_RECIPE_CONFLICT'); recipes.add(key);
  }
  return mods;
}
export function validateModStates(value = [], mods = []) {
  return unique(list(value, MOD_LIMITS.count).map(v => { if (!record(v) || !mods.some(m => m.manifest.id === v.id && m.enabled)) fail('INVALID_MOD_STATE'); return { id: id(v.id), state: validateModState(v.state) }; }), v => v.id);
}
export function validateSource(value = { kind: 'unknown' }, mods) {
  if (!record(value) || !['ai','recipe','mod','unknown'].includes(value.kind)) fail('INVALID_SOURCE');
  if (value.kind !== 'mod') return { kind: value.kind };
  const modId = id(value.modId), modName = text(value.modName, 48);
  if (mods && !mods.some(m => m.enabled && m.manifest.id === modId)) fail('INVALID_SOURCE');
  return { kind: 'mod', modId, modName };
}
export function findModRecipe(save, ingredientIds) {
  const names = ingredientIds.map(id => save.cards.find(c => c.id === id)?.name);
  if (names.some(n => !n)) return null;
  const key = JSON.stringify(names.map(normalizeModName).sort());
  for (const { manifest, enabled } of save.mods || []) {
    if (!enabled) continue;
    const recipe = manifest.recipes.find(r => JSON.stringify(r.ingredients.map(normalizeModName).sort()) === key);
    if (recipe) return { result: validateCardResult([...BASE_CARDS,...manifest.cards].find(c => normalizeModName(c.name) === normalizeModName(recipe.result))), source: { kind: 'mod', modId: manifest.id, modName: manifest.name } };
  }
  return null;
}
export function listModAppearances(saveOrMods, kind) {
  const mods = Array.isArray(saveOrMods) ? saveOrMods : saveOrMods?.mods || [];
  return mods.filter(m => m.enabled).flatMap(({manifest}) => (manifest[kind] || []).map(item => ({ ...item, id: `mod/${manifest.id}/${kind}/${item.id}`, name: `${item.name} · ${manifest.name}`, image: item.image ? manifest.assets[item.image] : null })));
}
export function getModSound(mods, kind) {
  for (const {enabled,manifest} of [...(mods || [])].reverse()) if (enabled && manifest.sounds[kind]) return manifest.assets[manifest.sounds[kind]];
  return null;
}
