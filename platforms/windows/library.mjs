import * as fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createService } from './service.mjs';
import { validateSave, serializeSave, importSave as parseSave } from '../../src/core/model.js';
import { DomainError } from '../../src/ai/protocol.js';

const MAX_SLOTS = 100;
const REGISTRY_BYTES = 128 * 1024;
const slotPattern = /^(legacy|slot-[a-f0-9-]{36})$/u;
const fail = code => { throw new DomainError(code); };
const clone = value => structuredClone(value);
function slotName(value) {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 40 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) fail('INVALID_SLOT_NAME');
  return value.trim();
}
function atomicWrite(file, data) {
  const temporary = `${file}.${randomUUID()}.pending`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
function parseRegistry(text) {
  let value;
  try { if (Buffer.byteLength(text) > REGISTRY_BYTES) fail('LIBRARY_CORRUPT'); value = JSON.parse(text); } catch { fail('LIBRARY_CORRUPT'); }
  if (!value || value.formatVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.slots) || !value.slots.length || value.slots.length > MAX_SLOTS) fail('LIBRARY_CORRUPT');
  const ids = new Set();
  try {
    for (const slot of value.slots) {
      if (!slot || !slotPattern.test(slot.id) || ids.has(slot.id) || (slot.id === 'legacy' ? slot.kind !== 'legacy' : slot.kind !== 'slot') || typeof slot.createdAt !== 'string' || !Number.isFinite(Date.parse(slot.createdAt))) fail('LIBRARY_CORRUPT');
      slotName(slot.name); ids.add(slot.id);
    }
    if (!ids.has(value.activeSlotId) || !ids.has('legacy')) fail('LIBRARY_CORRUPT');
  } catch { fail('LIBRARY_CORRUPT'); }
  // 注册表不接受任意路径；所有目录都由固定kind与原生生成的槽号推导。
  return { formatVersion: 1, revision: value.revision, activeSlotId: value.activeSlotId,
    slots: value.slots.map(slot => ({ id: slot.id, name: slotName(slot.name), kind: slot.kind, createdAt: slot.createdAt })) };
}

/** 每个槽使用独立SQLite、pending和副本，设备凭据始终保存在旧版dataDir。 */
export function createLibrary(options) {
  const { dataDir } = options;
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) fail('STORAGE_ERROR');
  const registryFile = path.join(dataDir, 'library.json'), markerFile = path.join(dataDir, 'library.created');
  const slotsDir = path.join(dataDir, 'slots'), services = new Map();
  let registry = null, registryText = null, registryError = null, busy = 0, activeService = null, configuring = false;
  function readRegistry() {
    const fd = fs.openSync(registryFile, 'r');
    try { const size = fs.fstatSync(fd).size; if (size > REGISTRY_BYTES) fail('LIBRARY_CORRUPT'); return fs.readFileSync(fd, 'utf8'); }
    finally { fs.closeSync(fd); }
  }
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(registryFile)) { registryText = readRegistry(); registry = parseRegistry(registryText); }
    else {
      if (fs.existsSync(markerFile) || (fs.existsSync(slotsDir) && fs.readdirSync(slotsDir).length)) fail('LIBRARY_CORRUPT');
      registry = { formatVersion: 1, revision: 0, activeSlotId: 'legacy', slots: [{ id: 'legacy', name: '存档 1', kind: 'legacy', createdAt: new Date().toISOString() }] };
      registryText = JSON.stringify(registry); atomicWrite(registryFile, registryText);
    }
    // 标记用于区分首次运行与注册表意外丢失；不含任何凭据或玩家内容。
    if (!fs.existsSync(markerFile)) atomicWrite(markerFile, 'created\n');
  } catch (error) { registryError = error instanceof DomainError ? error : new DomainError('LIBRARY_CORRUPT'); registry = null; }
  function ready() { if (!registry) throw registryError || new DomainError('LIBRARY_CORRUPT'); }
  function locate(id) { ready(); const slot = registry.slots.find(item => item.id === id); if (!slot) fail('SLOT_NOT_FOUND'); return slot; }
  function scoped(id) { ready(); if (id !== registry.activeSlotId) fail('SLOT_CHANGED'); return locate(id); }
  function directory(slot) { return slot.kind === 'legacy' ? dataDir : path.join(slotsDir, slot.id); }
  function serviceFor(slot) {
    if (!services.has(slot.id)) {
      const folder = directory(slot);
      // 缺失的已登记槽保留恢复能力，但不能自动新建空库掩盖损坏。
      services.set(slot.id, createService({ ...options, dataDir: folder, credentialDir: dataDir, requireExisting: slot.kind !== 'legacy' }));
    }
    return services.get(slot.id);
  }
  function named(save, slot) {
    if (!save) return null;
    // Save v2使用name；读取旧档只做模型升级投影，不为登记槽位改写旧数据库。
    return Object.hasOwn(save, 'name') ? { ...save, name: slot.name } : save;
  }
  function persist(next) {
    ready();
    try {
      if (readRegistry() !== registryText) fail('LIBRARY_CHANGED');
      const clean = parseRegistry(JSON.stringify(next)), text = JSON.stringify(clean); atomicWrite(registryFile, text);
      registry = clean; registryText = text;
    } catch (error) { if (error instanceof DomainError) throw error; fail('LIBRARY_WRITE_FAILED'); }
  }
  function assertCanLeave(slotId) {
    const slot = scoped(slotId); if (busy) fail('BUSY');
    try { if (serviceFor(slot).loadPending()) fail('PENDING_SAVE_REQUIRED'); }
    catch (error) { if (!['STORAGE_CORRUPT', 'SLOT_UNAVAILABLE'].includes(error.code)) throw error; }
  }
  function result() {
    let save = null;
    try { const slot = locate(registry.activeSlotId); save = named(serviceFor(slot).load(), slot); }
    catch (error) { if (!['STORAGE_CORRUPT', 'SLOT_UNAVAILABLE'].includes(error.code)) throw error; }
    return { save, library: library.status() };
  }
  function createSlot({ name, save, slotId }, importing) {
    assertCanLeave(slotId);
    const cleanName = slotName(name);
    if (registry.slots.length >= MAX_SLOTS) fail('SLOT_LIMIT');
    let snapshot = typeof save === 'string' ? parseSave(save) : validateSave(save);
    serializeSave(snapshot);
    const slot = { id: `slot-${randomUUID()}`, name: cleanName, kind: 'slot', createdAt: new Date().toISOString() };
    snapshot = named(snapshot, slot);
    if (importing) snapshot = { ...snapshot, id: `save:${randomUUID()}`, revision: 0 };
    const service = createService({ ...options, dataDir: directory(slot), credentialDir: dataDir });
    try {
      if (importing) service.importSave(snapshot); else service.initialize(snapshot);
      // 完整数据库先落盘，注册表最后发布；登记失败留下孤立新槽，不动旧槽或活动指针。
      persist({ ...registry, revision: registry.revision + 1, activeSlotId: slot.id, slots: [...registry.slots, slot] });
      services.set(slot.id, service);
      return result();
    } catch (error) { service.close(); throw error; }
  }
  async function request(slotId, method, value) {
    const slot = scoped(slotId);
    if (configuring || (method === 'configure' && busy)) fail('BUSY');
    if (method === 'configure' && serviceFor(slot).loadPending()) fail('PENDING_SAVE_REQUIRED');
    const service = serviceFor(method === 'configure' ? locate('legacy') : slot); busy++; activeService = service;
    if (method === 'configure') configuring = true;
    try { return await service[method](value); }
    finally {
      busy--;
      if (method === 'configure') configuring = false;
      if (!busy && activeService === service) activeService = null;
    }
  }
  const library = {
    assertSlot(slotId) { scoped(slotId); },
    status() {
      ready();
      return { activeSlotId: registry.activeSlotId, slots: registry.slots.map(slot => {
        const empty = { id: slot.id, name: slot.name, saveId: null, cardCount: 0, recipeCount: 0, synthesisCount: 0, updatedAt: null, modCount: 0, available: false };
        try {
          const save = serviceFor(slot).load();
          if (!save) return { ...empty, available: true };
          return { ...empty, available: true, saveId: save.id, cardCount: save.cards.length, recipeCount: save.recipes.length,
            synthesisCount: save.stats.synthesisCount, updatedAt: save.updatedAt, modCount: Array.isArray(save.mods) ? save.mods.length : 0 };
        } catch { return empty; }
      }) };
    },
    load(slotId) { const slot = scoped(slotId); return clone(named(serviceFor(slot).load(), slot)); },
    initialize(save, slotId) { const slot = scoped(slotId); if (busy) fail('BUSY'); return named(serviceFor(slot).initialize(named(save, slot)), slot); },
    save(save, expectedRevision, slotId) { const slot = scoped(slotId); return named(serviceFor(slot).save(named(save, slot), expectedRevision), slot); },
    async configStatus(slotId) { scoped(slotId); return serviceFor(locate('legacy')).configStatus(); },
    configure(config, slotId) { return request(slotId, 'configure', config); },
    generate(args) { scoped(args?.slotId); return request(args.slotId, 'generate', args); },
    cancel(slotId, operationId) { scoped(slotId); activeService?.cancel(operationId); },
    loadPending(slotId, operationId) { return serviceFor(scoped(slotId)).loadPending(operationId); },
    listPending(slotId) { return serviceFor(scoped(slotId)).listPending(); },
    stageModResult(args) { const slot = scoped(args?.slotId); if (configuring) fail('BUSY'); return serviceFor(slot).stageModResult(args); },
    updatePending(args) { const slot = scoped(args?.slotId); if (configuring) fail('BUSY'); return serviceFor(slot).updatePending(args); },
    exportJSON(slotId) { const slot = scoped(slotId); const save = serviceFor(slot).load(); if (!save) fail('STORAGE_ERROR'); return serializeSave(named(save, slot)); },
    // 显式恢复当前槽使用本方法；普通“导入存档”在窗口层调用importAsSlot。
    importSave(save, slotId) { const slot = scoped(slotId); if (busy) fail('BUSY'); return named(serviceFor(slot).importSave(named(typeof save === 'string' ? parseSave(save) : save, slot)), slot); },
    listBackups(slotId) { return serviceFor(scoped(slotId)).listBackups(); },
    restoreBackup(id, slotId) { const slot = scoped(slotId); if (busy) fail('BUSY'); return named(serviceFor(slot).restoreBackup(id), slot); },
    recoveryStatus(slotId) {
      const slot = scoped(slotId);
      try { return serviceFor(slot).recoveryStatus(); }
      catch (error) { return { storageAvailable: false, error: error.code || 'STORAGE_CORRUPT', backupWarning: false }; }
    },
    createSlot(args) { return createSlot(args, false); },
    importAsSlot(args) { return createSlot(args, true); },
    switchSlot({ id, slotId }) {
      assertCanLeave(slotId); locate(id);
      if (id !== registry.activeSlotId) persist({ ...registry, revision: registry.revision + 1, activeSlotId: id });
      return result();
    },
    renameSlot({ id, name, slotId }) {
      scoped(slotId); if (busy) fail('BUSY'); locate(id); const cleanName = slotName(name);
      persist({ ...registry, revision: registry.revision + 1, slots: registry.slots.map(slot => slot.id === id ? { ...slot, name: cleanName } : slot) });
      return result();
    },
    close() { for (const service of services.values()) service.close(); services.clear(); },
  };
  return library;
}
