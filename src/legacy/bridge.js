import { recipeKey } from '../core/model.js';
import { listModAppearances, getModSound } from '../core/mods.js';

const activePhases = new Set(['requesting', 'queued', 'saving', 'save-failed']);
const failure = (error, message) => ({ ok: false, error, message });

// 旧场景只接收已提交状态的投影。存档、模型请求和 Mod 处理仍由三代控制器负责。
export function createLegacyBridge(controller, {
  onOpen = () => {}, onMessage = () => {}, isModalOpen = () => false,
  canAccess, uuid = () => crypto.randomUUID(),
} = {}) {
  let state = controller.state, destroyed = false, factory = null;
  let sourceCards = null, rows = [], byName = new Map(), byId = new Map();
  const subscribers = new Set(), waiting = new Map(), installed = [];
  const slotKey = () => state.library?.activeSlotId || state.save?.id || '';

  function projectCards() {
    const cards = state.save?.cards || [];
    if (cards === sourceCards) return;
    sourceCards = cards;
    rows = cards.map((card, index) => ({
      id: card.id, name: card.name, emoji: card.emoji, cat: card.category,
      descr: card.description, seq: index + 1, rar: card.isBase ? 9 : 0,
      owned: true, listed: false, mine_first: false, by_name: '', holder_cnt: 0,
      collect_cnt: 0, borrow_cnt: 0, creator_first_frame_active: false,
      creator_dawn_active: false, unlocked_at: card.discoveredAt,
    }));
    byName = new Map(rows.map(card => [card.name, card]));
    byId = new Map(rows.map(card => [card.id, card]));
  }
  function collections() {
    const ids = new Set((state.save?.favorites || []).flatMap(folder => folder.cardIds));
    const collected = rows.filter(card => ids.has(card.id));
    return { ok: true, accountId: slotKey(), collected,
      collectedNames: collected.map(card => card.name) };
  }
  function folders() {
    return (state.save?.favorites || []).map(folder => ({ id: folder.id, name: folder.name,
      cards: folder.cardIds.map(id => byId.get(id)?.name).filter(Boolean) }));
  }
  function settings() {
    const prefs = state.save?.preferences || {};
    return { ...prefs, fx: !prefs.reduceMotion, cardFx: !prefs.reduceMotion,
      celebrate: !prefs.reduceMotion, comboFx: !prefs.reduceMotion, fallEmoji: !prefs.reduceMotion,
      sfx: prefs.soundEnabled !== false, bgmOn: prefs.musicEnabled !== false,
      bgmTrack: 4, vibrate: false, dictDefault: 'mine', dictBig: false,
      tabletopStar: prefs.tabletopId === 'cosmos', dawnSkin: prefs.skinId === 'dawn', debug: false };
  }
  function me() {
    return { ok: !!state.save, account: state.save ? {
      id: slotKey(), name: state.save.name, unlocks: [],
      total_combines: state.save.stats.synthesisCount,
      discovered_count: state.save.cards.filter(card => !card.isBase).length,
    } : null, stats: state.save?.stats || null };
  }
  function page(query = '', options = {}) {
    projectCards();
    const text = String(query || '').normalize('NFKC').trim().toLowerCase();
    const category = options.cat || options.category || '全部';
    const length = Number(options.length) || 0;
    const before = /^seq:(\d+)$/.exec(String(options.cursor || ''));
    const matches = rows.filter(card => (!text || card.name.normalize('NFKC').toLowerCase().includes(text))
      && (category === '全部' || card.cat === category)
      && (!length || [...card.name].length === length));
    const available = matches.filter(card => !before || card.seq < Number(before[1])).slice().reverse();
    const limit = Math.max(1, Math.min(300, Number(options.limit) || 100));
    const cards = available.slice(0, limit);
    const cursor = available.length > cards.length ? `seq:${cards.at(-1).seq}` : null;
    return { ok: true, cards, rows: cards, total: matches.length, cursor, nextCursor: cursor,
      hasMore: !!cursor, accountId: slotKey(), season: 'local' };
  }
  async function saveFavorites(input) {
    if (!Array.isArray(input) || !state.save) return failure('INVALID_SAVE', '收藏夹无法保存。');
    projectCards();
    const previous = state.save.favorites || [], used = new Set();
    const favorites = [];
    for (let index = 0; index < input.length; index++) {
      const folder = input[index];
      if (!folder || typeof folder.name !== 'string' || !Array.isArray(folder.cards)) {
        return failure('INVALID_SAVE', '收藏夹内容不完整。');
      }
      const old = previous.find(item => item.id === folder.id && !used.has(item.id))
        || previous.find(item => item.name === folder.name && !used.has(item.id))
        || previous[index];
      const id = old && !used.has(old.id) ? old.id : `favorite:${uuid()}`;
      used.add(id);
      const cardIds = [];
      for (const name of folder.cards) {
        const card = byName.get(name);
        if (!card) return failure('INVALID_CARD_REFERENCE', '收藏中有当前存档不存在的卡牌。');
        if (!cardIds.includes(card.id)) cardIds.push(card.id);
      }
      favorites.push({ id, name: folder.name, cardIds });
    }
    const saved = await controller.callbacks.onSaveFavorites(favorites);
    update(controller.state);
    return saved === false ? failure('SAVE_WRITE_FAILED', state.error || '收藏夹还没有保存。') : { ok: true };
  }
  async function patchSettings(patch) {
    const translated = {};
    for (const key of ['skinId', 'tabletopId', 'cardBackId', 'zoom', 'soundEnabled', 'musicEnabled', 'reduceMotion', 'synthesisPrompt']) {
      if (Object.hasOwn(patch, key)) translated[key] = patch[key];
    }
    if (Object.hasOwn(patch, 'sfx')) translated.soundEnabled = !!patch.sfx;
    if (Object.hasOwn(patch, 'bgmOn')) translated.musicEnabled = !!patch.bgmOn;
    if (Object.hasOwn(patch, 'fx')) translated.reduceMotion = !patch.fx;
    const saved = await controller.callbacks.onSavePreferences(translated);
    update(controller.state);
    return saved === false ? failure('SAVE_WRITE_FAILED', state.error || '设置还没有保存。') : { ok: true };
  }
  function finish(waiter, value) {
    waiting.delete(waiter.key);
    waiter.resolve(value);
  }
  function checkWaiter(waiter) {
    if (waiter.slot !== slotKey()) {
      finish(waiter, failure('SLOT_CHANGED', '当前存档已经切换。'));return;
    }
    const job = (state.syntheses || []).find(item => item.id === waiter.id);
    if (!job) return;
    if (job.source === 'ai' && job.phase === 'requesting' && !waiter.thinking) {
      waiter.thinking = true;
      waiter.onThinking?.(job.id);
    }
    const operation = state.save?.operations.find(item => item.id === job.id);
    if (job.phase === 'committed' && operation) {
      projectCards();
      const card = byId.get(operation.resultId);
      if (card) finish(waiter, { ok: true, card, operationId: job.id,
        isNew: !!job.result?.isNewCard, isNewRecipe: !!job.result?.isNewRecipe });
    } else if (job.phase === 'failed' || job.phase === 'cancelled' && waiter.finished) {
      finish(waiter, failure(job.phase === 'cancelled' ? 'CANCELLED' : 'REQUEST_FAILED', job.error || state.error || '合成未完成。'));
    }
    // 保存失败仍保留原等待卡背，重试只提交原生已经保存的答案。
  }
  function combineAndWait(names, onThinking) {
    projectCards();
    if (!Array.isArray(names)) return Promise.resolve(failure('INVALID_INGREDIENT_COUNT', '请选择两到四张卡。'));
    const ids = names.map(name => byName.get(name)?.id);
    if (ids.some(id => !id)) return Promise.resolve(failure('UNKNOWN_INGREDIENT', '材料不在当前存档中。'));
    let key;
    try { key = recipeKey(ids); }
    catch { return Promise.resolve(failure('INVALID_INGREDIENT_COUNT', '请选择两到四张卡。')); }
    if (waiting.has(key) || (state.syntheses || []).some(job => activePhases.has(job.phase) && recipeKey(job.ingredientIds) === key)) {
      return Promise.resolve(failure('SYNTHESIS_ALREADY_RUNNING', '这个组合正在合成。'));
    }
    const before = new Set((state.syntheses || []).map(job => job.id));
    const task = controller.callbacks.onCombine(ids);
    state = controller.state;
    const job = (state.syntheses || []).find(item => !before.has(item.id) && recipeKey(item.ingredientIds) === key);
    if (!job) return Promise.resolve(failure('BUSY', state.error || '当前操作尚未结束。'));
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const waiter = { id: job.id, key, slot: slotKey(), resolve, onThinking, finished: false, thinking: false };
    waiting.set(key, waiter);
    promise.operationId = job.id;
    checkWaiter(waiter);
    Promise.resolve(task).then(() => {
      waiter.finished = true;update(controller.state);
    }, () => {
      waiter.finished = true;update(controller.state);
      if (waiting.get(key) === waiter) finish(waiter, failure('REQUEST_FAILED', state.error || '合成未完成。'));
    });
    return promise;
  }
  function open(name, payload) {
    onOpen(name, payload);
    // 弹层开合由管理界面持有，旧场景每次输入/绘制实时读 isModalOpen。
    // 不在这里缓存阻塞值，否则纯关闭界面没有业务状态更新，会把台面永远锁住。
  }
  function ensurePlay() {
    if (!state.save || state.recoveryRequired || state.pendingBlocked) { open('recovery');return false; }
    const allowed = canAccess ? canAccess() : !!state.configStatus?.configured
      || state.save.cards.some(card => !card.isBase);
    if (!allowed) open('api');
    return !!allowed;
  }
  const api = {
    me: async () => me(), baseCards: async () => ({ ok: true, cards: rows.filter(card => card.rar === 9) }),
    meCards: async (limit = 0, query = '', options = {}) => page(query, { ...(limit > 0 ? { limit } : {}), ...options }),
    meCollections: async () => collections(),
    browse: async (limit = 100, sort = 'new', cursor, cat, length) => page('', { limit, cursor, cat, length }),
    search: async (query, cursor, cat, length) => page(query, { cursor, cat, length }),
    searchAll: async (query, cursor, cat, length) => page(query, { cursor, cat, length }),
    token: () => slotKey(), cachedAccountId: () => slotKey(), cachedSeason: () => 'local',
    isLoggedIn: () => !!state.save, isJudgeEntry: () => false,
    combineAndWait, isCombining: names => {
      const ids = (names || []).map(name => byName.get(name)?.id);
      if (ids.some(id => !id)) return false;
      try { const key = recipeKey(ids);return waiting.has(key); } catch { return false; }
    },
    cancel: async id => { await controller.callbacks.onCancel(id);update(controller.state);return { ok: true }; },
    prefsGet: async () => {
      const data = { favFolders: { folders: folders() } };return { ok: true, data, prefs: data };
    },
    prefsPut: async input => input?.favFolders ? saveFavorites(input.favFolders.folders) : { ok: true },
    updateFavorites: saveFavorites,
    saveLayout: async layout => {
      const saved = await controller.callbacks.onSaveLayout(layout);update(controller.state);
      return saved === false ? failure('SAVE_WRITE_FAILED', state.error || '画布还没有保存。') : { ok: true };
    },
    settings: { all: settings, get: key => settings()[key], patch: patchSettings,
      set: (key, value) => patchSettings({ [key]: value }) },
  };
  const localRead = key => ({ me, meCards: () => page(), meCollections: collections })[key]?.() || null;
  const dc = { get: localRead, ageOf: () => 0,
    ensure: async key => localRead(key), refresh: async key => localRead(key),
    fence() {}, bust: async (...keys) => keys.map(localRead), clearAll() {} };
  const dictionary = {
    ok: () => !!state.save, degraded: () => false,
    setIdentity: async () => true,
    loadInitial: async (options = {}) => ({ ...page('', options), cached: !!state.save, degraded: false }),
    ownedSeqs: async seqs => seqs.filter(seq => rows.some(card => card.seq === Number(seq))),
    putRows: async () => false,
    syncAll: async () => ({ ok: true, ownedTotal: rows.length, publicTotal: 0, season: 'local' }),
  };
  const ui = {
    getState: () => state, open, ensurePlay, isModalOpen,
    subscribe(listener) { subscribers.add(listener);return () => subscribers.delete(listener); },
    bindFactory(binding) {
      factory = binding;factory?.setSnapshot?.(state);
      return () => { if (factory === binding) factory = null; };
    },
    retrySave: async id => { await controller.callbacks.onRetrySave(id);update(controller.state); },
    cancel: api.cancel,
    getModAppearances: kind => listModAppearances(state.save?.mods || [], kind),
    getAppearance(kind, id) {
      const preference = { skins: 'skinId', tabletops: 'tabletopId', cardBacks: 'cardBackId' }[kind];
      const chosen = id || state.save?.preferences?.[preference];
      return listModAppearances(state.save?.mods || [], kind).find(item => item.id === chosen) || null;
    },
    getModSound: kind => getModSound(state.save?.mods || [], kind),
    getModActions: () => (state.save?.mods || []).filter(mod => mod.enabled).flatMap(mod => mod.manifest.actions.map(action => ({ ...action, modId: mod.manifest.id, modName: mod.manifest.name }))),
    runModAction: async (modId, actionId) => { await controller.callbacks.onModAction(modId, actionId);update(controller.state); },
    message: onMessage,
  };
  function update(next = controller.state) {
    if (destroyed) return;
    state = next;projectCards();
    for (const waiter of [...waiting.values()]) checkWaiter(waiter);
    factory?.setSnapshot?.(state);
    for (const listener of subscribers) listener(state);
  }
  function install(target = window) {
    for (const [name, value] of Object.entries({ WXGC2_API: api, DC: dc, WXGC2_DICTDB: dictionary, WXGC2_DICT: dictionary, WXGC3_UI: ui })) {
      installed.push({ target, name, previous: target[name], value });target[name] = value;
    }
    update(controller.state);
    return ui;
  }
  function destroy() {
    destroyed = true;
    for (const waiter of [...waiting.values()]) finish(waiter, failure('CANCELLED', '已离开游戏。'));
    subscribers.clear();factory = null;
    for (const { target, name, previous, value } of installed) if (target[name] === value) {
      if (previous === undefined) delete target[name];else target[name] = previous;
    }
  }
  projectCards();
  return { install, update, destroy, api, ui };
}
