import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateSave, serializeSave, importSave as parseSave, commitSynthesis, findRecipe, recipeKey, SAVE_LIMITS } from '../../src/core/model.js';
import { DomainError, buildSynthesisMessages, parseCardResponse, validateCardResult } from '../../src/ai/protocol.js';
import { validateModStates, validateSource } from '../../src/core/mods.js';
import { BASE_CARDS, DEFAULT_AI_CONFIG } from '../../src/content/catalog.js';

const APP_ID = 0x57464733;
const RESPONSE_BYTES = 1024 * 1024;
const CONFIG_BYTES = 8192;
const SCHEMA = `
 CREATE TABLE current_save(singleton INTEGER PRIMARY KEY CHECK(singleton=1), save_id TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL);
 CREATE TABLE cards(id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, document TEXT NOT NULL);
 CREATE INDEX cards_name ON cards(name COLLATE NOCASE);
 CREATE INDEX cards_category ON cards(category, name COLLATE NOCASE);
 CREATE TABLE recipes(recipe_key TEXT PRIMARY KEY, result_id TEXT NOT NULL REFERENCES cards(id), document TEXT NOT NULL);
 CREATE TABLE pending(singleton INTEGER PRIMARY KEY CHECK(singleton=1), document TEXT NOT NULL);
 CREATE TABLE backups(id TEXT PRIMARY KEY, document TEXT NOT NULL, created_at TEXT NOT NULL, reason TEXT NOT NULL);
 PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;`;
const fail = code => { throw new DomainError(code); };
const copy = value => structuredClone(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const isMissing = error => error?.code === 'ENOENT';
function storageError(error) {
  if (error instanceof DomainError) return error;
  return new DomainError([11, 26].includes(error?.errcode) ? 'STORAGE_CORRUPT' : 'STORAGE_ERROR');
}
function checkedSave(value) {
  const clean = validateSave(value);
  serializeSave(clean);
  return clean;
}

export function normalizeConfig(input) {
  if (!record(input)) fail('INVALID_CONFIG');
  const { baseUrl, model } = input;
  if (typeof baseUrl !== 'string' || baseUrl.length > 2048 || typeof model !== 'string' || !model.trim() || model.length > 128 || /[\u0000-\u001f\u007f]/u.test(model)) fail('INVALID_CONFIG');
  let url;
  try { url = new URL(baseUrl.trim()); } catch { fail('INVALID_CONFIG'); }
  if (url.protocol !== 'https:') fail('AI_HTTPS_REQUIRED');
  if (url.username || url.password || url.search || url.hash) fail('AI_BASE_URL_HAS_CREDENTIALS_OR_QUERY');
  if (/\/chat\/completions\/?$/iu.test(url.pathname)) fail('AI_BASE_URL_IS_ENDPOINT');
  url.pathname = url.pathname.replace(/\/+$/u, '') || '/';
  return { baseUrl: url.href.replace(/\/+$/u, ''), model: model.trim() };
}
function checkedKey(key) {
  if (typeof key !== 'string' || !key.trim()) fail('KEY_REQUIRED');
  if (key.length > CONFIG_BYTES || /[\u0000-\u0020\u007f-\u009f]/u.test(key)) fail('INVALID_KEY');
  return key;
}
function configSize(value) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { fail('INVALID_CONFIG'); }
  if (!encoded || Buffer.byteLength(encoded) > CONFIG_BYTES) fail('CONFIG_TOO_LARGE');
}
function atomicWrite(file, content) {
  // 同目录临时文件 + fsync + rename；失败文件保留，绝不先清空原文件。
  const temp = `${file}.${randomUUID()}.pending`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function readLimited(file, max) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size > max) fail('SAVE_TOO_LARGE');
    const data = Buffer.alloc(size + 1);
    const count = fs.readSync(fd, data, 0, data.length, 0);
    if (count > max || count !== size) fail('FILE_READ_FAILED');
    return data.subarray(0, count);
  } finally { fs.closeSync(fd); }
}
function statusError(status) {
  if (status >= 200 && status < 300) return null;
  if (status >= 300 && status < 400) return 'REDIRECT_REJECTED';
  return ({ 400: 'REQUEST_FAILED', 401: 'AUTH_FAILED', 402: 'NO_BALANCE', 403: 'AUTH_FAILED', 404: 'MODEL_NOT_FOUND', 408: 'REQUEST_TIMEOUT', 413: 'RESPONSE_TOO_LARGE', 422: 'REQUEST_FAILED', 429: 'RATE_LIMITED', 504: 'REQUEST_TIMEOUT' })[status] || (status >= 500 ? 'SERVER_ERROR' : 'REQUEST_FAILED');
}
async function boundedResponse(response) {
  if (Number(response.headers?.get('content-length')) > RESPONSE_BYTES) { await response.body?.cancel().catch(() => {}); fail('RESPONSE_TOO_LARGE'); }
  if (!response.body?.getReader) fail('INVALID_RESPONSE');
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_BYTES) { await reader.cancel(); fail('RESPONSE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  let envelope;
  try { envelope = JSON.parse(Buffer.concat(chunks, length).toString('utf8')); } catch { fail('INVALID_RESPONSE'); }
  if (!record(envelope) || envelope.error != null) fail('INVALID_RESPONSE');
  const choice = envelope.choices?.[0], message = choice?.message;
  if (choice?.finish_reason === 'length') fail('AI_OUTPUT_TRUNCATED');
  if (choice?.finish_reason === 'content_filter' || message?.refusal || (message?.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length))) fail('AI_RESPONSE_REFUSED');
  if (choice?.finish_reason != null && choice.finish_reason !== 'stop') fail('INVALID_RESPONSE');
  try { return parseCardResponse(message?.content); }
  catch (error) { if (error.code === 'INVALID_CARD_RESULT') throw error; fail('INVALID_RESPONSE'); }
}

/** 仅供可信主进程使用。窗口只获得逐项 IPC 方法，不能传 SQL、路径或加密回调。 */
export function createService({ dataDir, credentialDir = dataDir, requireExisting = false, encrypt, decrypt, fetchImpl = globalThis.fetch, timeoutMs = 60000 }) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) fail('STORAGE_ERROR');
  if (typeof credentialDir !== 'string' || !path.isAbsolute(credentialDir)) fail('STORAGE_ERROR');
  const databaseFile = path.join(dataDir, 'world.sqlite3');
  const recoveryDir = path.join(dataDir, 'recovery');
  const configFile = path.join(credentialDir, 'ai-config.encrypted');
  const markerFile = path.join(credentialDir, 'configured.marker');
  let database = null, openError = null, active = null, backupWarning = false;

  function open(file = databaseFile) {
    const db = new DatabaseSync(file);
    try {
      db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
      const version = db.prepare('PRAGMA user_version').get().user_version;
      const appId = db.prepare('PRAGMA application_id').get().application_id;
      if (version !== 0 && version !== 1) fail('UNSUPPORTED_SAVE_VERSION');
      if (version === 1 && appId !== APP_ID) fail('STORAGE_CORRUPT');
      if (version === 0 && db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n) fail('STORAGE_CORRUPT');
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      if (!version) { db.exec('BEGIN IMMEDIATE'); try { db.exec(SCHEMA); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } }
      return db;
    } catch (error) { db.close(); throw error; }
  }
  try {
    fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(credentialDir, { recursive: true }); fs.mkdirSync(recoveryDir, { recursive: true });
    if (requireExisting && (!fs.existsSync(databaseFile) || fs.statSync(databaseFile).size === 0)) fail('STORAGE_CORRUPT');
    const hasPreviousData = fs.readdirSync(recoveryDir).some(file => file.endsWith('.wxgc3-save')) ||
      fs.readdirSync(dataDir).some(file => /^world\.sqlite3\.damaged-|^recovered-[a-f0-9-]+\.sqlite3$/u.test(file));
    // 中断换库或原文件丢失时不能悄悄初始化空档；保留恢复入口和所有现场文件。
    if (hasPreviousData && (!fs.existsSync(databaseFile) || fs.statSync(databaseFile).size === 0)) fail('STORAGE_CORRUPT');
    database = open();
  }
  catch (error) { openError = error instanceof DomainError ? error : new DomainError('STORAGE_CORRUPT'); }
  function db() { if (!database) throw openError || new DomainError('STORAGE_ERROR'); return database; }
  function transaction(work) {
    const connection = db();
    try {
      connection.exec('BEGIN IMMEDIATE');
      try { const result = work(connection); connection.exec('COMMIT'); return result; }
      catch (error) { try { connection.exec('ROLLBACK'); } catch {} throw error; }
    } catch (error) { throw storageError(error); }
  }
  function readCurrent(connection = db()) {
    try {
      const row = connection.prepare('SELECT save_id,revision,document FROM current_save WHERE singleton=1').get();
      if (!row) return null;
      let value;
      try { value = parseSave(row.document); } catch { fail('STORAGE_CORRUPT'); }
      if (value.id !== row.save_id || value.revision !== row.revision) fail('STORAGE_CORRUPT');
      return value;
    } catch (error) { throw storageError(error); }
  }
  function writeSnapshot(connection, value) {
    const previous = connection.prepare('SELECT document FROM current_save WHERE singleton=1').get()?.document;
    if (previous && JSON.parse(previous).formatVersion === 1 && value.formatVersion >= 2) {
      // 迁移前原文独立保留，不进入五槽轮换；备份未完整落盘就拒绝写新格式。
      const migrationFile = path.join(dataDir, 'migration-v1.wxgc3');
      try {
        if (fs.existsSync(migrationFile)) {
          const original = readLimited(migrationFile, SAVE_LIMITS.bytes).toString('utf8');
          if (JSON.parse(original).formatVersion !== 1) fail('MIGRATION_BACKUP_FAILED');
          parseSave(original);
        } else {
          const fd = fs.openSync(migrationFile, 'wx', 0o600);
          try { fs.writeFileSync(fd, previous, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
          if (readLimited(migrationFile, SAVE_LIMITS.bytes).toString('utf8') !== previous) fail('MIGRATION_BACKUP_FAILED');
        }
      } catch { fail('MIGRATION_BACKUP_FAILED'); }
    }
    const document = serializeSave(value);
    connection.prepare('INSERT INTO current_save VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET save_id=excluded.save_id,revision=excluded.revision,document=excluded.document').run(value.id, value.revision, document);
    connection.exec('DELETE FROM recipes; DELETE FROM cards;');
    const card = connection.prepare('INSERT INTO cards VALUES(?,?,?,?)');
    for (const item of value.cards) card.run(item.id, item.name, item.category, JSON.stringify(item));
    const recipe = connection.prepare('INSERT INTO recipes VALUES(?,?,?)');
    for (const item of value.recipes) recipe.run(item.key, item.resultId, JSON.stringify(item));
  }
  function backupFile(value, reason = 'auto') {
    const id = reason === 'auto' ? `auto-${value.revision % 5}` : `before-import-${randomUUID()}`;
    atomicWrite(path.join(recoveryDir, `${id}.wxgc3-save`), serializeSave(value));
    return id;
  }
  function rememberCommitted(value) {
    // 主事务成功后，副本失败不能把已提交的操作伪报为失败；设置恢复告警供窗口层读取。
    try { backupFile(value); backupWarning = false; } catch { backupWarning = true; }
    return copy(value);
  }
  function cleanPending(raw, current) {
    if (!record(raw) || raw.saveId !== current.id || !safeId(raw.operationId) || !Array.isArray(raw.ingredientIds)) fail('STORAGE_CORRUPT');
    if (raw.modProcessed !== undefined && typeof raw.modProcessed !== 'boolean') fail('STORAGE_CORRUPT');
    const ingredientIds = JSON.parse(recipeKey(raw.ingredientIds));
    const result = raw.result == null ? null : validateCardResult(raw.result);
    const time = new Date(raw.now);
    if (!Number.isFinite(time.getTime())) fail('STORAGE_CORRUPT');
    const clean = { saveId: current.id, operationId: raw.operationId, ingredientIds, result, now: time.toISOString(), modProcessed: raw.modProcessed ?? false,
      ...(raw.source === undefined ? {} : { source: validateSource(raw.source, current.mods) }),
      ...(raw.modStates === undefined ? {} : { modStates: validateModStates(raw.modStates, current.mods) }) };
    // reducer 同时验证引用与已提交操作的指纹，不能给旧答案换材料或操作身份。
    commitSynthesis(current, clean);
    return clean;
  }
  function pendingFor(current, connection = db()) {
    const row = connection.prepare('SELECT document FROM pending WHERE singleton=1').get();
    if (!row) return null;
    try { return cleanPending(JSON.parse(row.document), current); } catch { fail('STORAGE_CORRUPT'); }
  }
  async function readConfig() {
    try {
      const encrypted = readLimited(configFile, 32768);
      if (typeof decrypt !== 'function') fail('KEY_UNAVAILABLE');
      const raw = await decrypt(encrypted);
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > CONFIG_BYTES) fail('KEY_UNAVAILABLE');
      const parsed = JSON.parse(raw), normalized = normalizeConfig(parsed);
      const key = checkedKey(parsed.key);
      if (parsed.origin !== new URL(normalized.baseUrl).origin) fail('KEY_UNAVAILABLE');
      return { ...normalized, key, origin: parsed.origin };
    } catch (error) { if (isMissing(error)) return null; fail('KEY_UNAVAILABLE'); }
  }
  function configuredBefore() { return fs.existsSync(markerFile) || fs.existsSync(configFile); }
  function beginRequest() {
    if (active) fail('BUSY');
    const request = { controller: new AbortController(), cancelled: false, timedOut: false };
    active = request;
    return request;
  }
  async function requestCard(config, cards, request, themes = [], customPrompt = '') {
    const timer = setTimeout(() => { request.timedOut = true; request.controller.abort(); }, Math.max(1, Math.min(timeoutMs, 60000)));
    try {
      const body = { model: config.model, messages: buildSynthesisMessages(cards, themes, customPrompt), stream: false, max_tokens: 1024, response_format: { type: 'json_object' } };
      if (new URL(config.baseUrl).hostname === 'api.deepseek.com') body.thinking = { type: 'disabled' };
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST', redirect: 'manual', signal: request.controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` }, body: JSON.stringify(body),
      });
      const error = statusError(response.status);
      if (error) { await response.body?.cancel().catch(() => {}); fail(error); }
      const result = await boundedResponse(response);
      if (request.cancelled) fail('CANCELLED');
      if (request.timedOut) fail('REQUEST_TIMEOUT');
      // 极少数模型会复述认证字符串；不允许它借卡牌字段进入导出与分享。
      if (Object.values(result).some(value => value.includes(config.key))) fail('AI_SENSITIVE_RESPONSE');
      return result;
    } catch (error) {
      if (request.cancelled) fail('CANCELLED');
      if (request.timedOut) fail('REQUEST_TIMEOUT');
      if (error instanceof DomainError) throw error;
      fail('REQUEST_FAILED');
    } finally { clearTimeout(timer); }
  }
  function recoveryReplace(value) {
    if (active) fail('BUSY');
    // 先在独立库完整写入、关闭，再把损坏原件连同 WAL/SHM 留在原目录；绝不清库修复。
    const temp = path.join(dataDir, `recovered-${randomUUID()}.sqlite3`);
    let replacement, swapping = false, installed = false;
    const moved = [];
    try {
      replacement = open(temp);
      replacement.exec('BEGIN IMMEDIATE'); writeSnapshot(replacement, value); replacement.exec('COMMIT');
      replacement.exec('PRAGMA wal_checkpoint(TRUNCATE)'); replacement.close(); replacement = null;
      database?.close(); database = null; swapping = true;
      const suffix = `.damaged-${randomUUID()}`;
      for (const extension of ['', '-wal', '-shm']) {
        const file = `${databaseFile}${extension}`;
        if (fs.existsSync(file)) { const preserved = `${file}${suffix}`; fs.renameSync(file, preserved); moved.push([file, preserved]); }
      }
      fs.renameSync(temp, databaseFile); installed = true;
      database = open(); openError = null;
      return rememberCommitted(value);
    } catch (error) {
      try { replacement?.close(); } catch {}
      if (swapping) {
        try { database?.close(); } catch {} database = null;
        // 换名失败尽量撤回已移动的原件。撤回也失败时保留两边文件，启动守卫会阻止空档。
        if (installed) {
          for (const extension of ['', '-wal', '-shm']) {
            const file = `${databaseFile}${extension}`;
            try { if (fs.existsSync(file)) fs.renameSync(file, `${file}.failed-recovery-${randomUUID()}`); } catch {}
          }
        }
        for (const [original, preserved] of moved.reverse()) {
          try { if (!fs.existsSync(original) && fs.existsSync(preserved)) fs.renameSync(preserved, original); } catch {}
        }
        try { database = open(); } catch {}
      }
      openError = storageError(error);
      throw openError;
    }
  }

  const service = {
    load: () => copy(readCurrent()),
    initialize(snapshot) {
      const value = checkedSave(snapshot);
      if (value.revision !== 0 || value.cards.length !== 5 || value.recipes.length || value.operations.length || value.stats.synthesisCount) fail('INVALID_SAVE');
      transaction(connection => { if (readCurrent(connection)) fail('ALREADY_INITIALIZED'); writeSnapshot(connection, value); });
      return rememberCommitted(value);
    },
    save(snapshot, expectedRevision) {
      const value = checkedSave(snapshot);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || value.revision !== expectedRevision + 1) fail('REVISION_CONFLICT');
      transaction(connection => {
        const current = readCurrent(connection);
        if (!current) fail('STORAGE_ERROR');
        if (current.revision !== expectedRevision) {
          // IPC 成功响应丢失后的同一完整快照可以安全确认，不接受其他旧版本覆盖。
          if (current.revision === value.revision && serializeSave(current) === serializeSave(value)) return;
          fail('REVISION_CONFLICT');
        }
        if (value.id !== current.id || value.createdAt !== current.createdAt || value.updatedAt < current.updatedAt) fail('INVALID_SAVE');
        // 普通保存只能增加发现；换档必须走有备份的 import，布局响应不能顺带删历史。
        for (const [field, identity] of [['cards', 'id'], ['recipes', 'key'], ['operations', 'id']]) {
          const next = new Map(value[field].map(item => [item[identity], item]));
          if (current[field].some(item => JSON.stringify(next.get(item[identity])) !== JSON.stringify(item))) fail('INVALID_SAVE');
        }
        const pending = pendingFor(current, connection);
        if ((pending || active) && !value.operations.some(operation => operation.id === pending?.operationId) && JSON.stringify(value.mods) !== JSON.stringify(current.mods)) fail('PENDING_SAVE_REQUIRED');
        if (pending && value.operations.some(operation => operation.id === pending.operationId)) {
          const expected = commitSynthesis(current, pending);
          const actualOp = value.operations.find(operation => operation.id === pending.operationId);
          const expectedOp = expected.save.operations.find(operation => operation.id === pending.operationId);
          const withoutTime = (items, field) => items.map(item => { const clean = { ...item }; delete clean[field]; return clean; });
          // 前端可能在 IPC 返回后才取得提交时间；身份、材料、答案与计数必须相同，时间允许向前。
          if (['id', 'recipeKey', 'resultId', 'fingerprint'].some(field => actualOp[field] !== expectedOp[field]) ||
            JSON.stringify(withoutTime(value.cards, 'discoveredAt')) !== JSON.stringify(withoutTime(expected.save.cards, 'discoveredAt')) ||
            JSON.stringify(withoutTime(value.recipes, 'createdAt')) !== JSON.stringify(withoutTime(expected.save.recipes, 'createdAt')) ||
            value.stats.synthesisCount !== expected.save.stats.synthesisCount || JSON.stringify(actualOp.source) !== JSON.stringify(expectedOp.source) ||
            JSON.stringify(value.mods) !== JSON.stringify(expected.save.mods)) fail('OPERATION_CONFLICT');
          connection.exec('DELETE FROM pending');
        }
        writeSnapshot(connection, value);
      });
      return rememberCommitted(value);
    },
    async configStatus() {
      try { const config = await readConfig(); return config ? { baseUrl: config.baseUrl, model: config.model, configured: true, previouslyConfigured: true } : { ...DEFAULT_AI_CONFIG, configured: false, previouslyConfigured: configuredBefore() }; }
      catch { return { ...DEFAULT_AI_CONFIG, configured: false, previouslyConfigured: configuredBefore(), keyUnavailable: true }; }
    },
    async configure(input) {
      configSize(input);
      const normalized = normalizeConfig(input);
      const request = beginRequest();
      try {
        let key = input.key;
        if (key === '' || key == null) {
          const existing = await readConfig();
          if (!existing) fail('KEY_REQUIRED');
          if (existing.origin !== new URL(normalized.baseUrl).origin) fail('SERVICE_CHANGED_KEY_REQUIRED');
          key = existing.key;
        }
        if (request.cancelled) fail('CANCELLED');
        key = checkedKey(key);
        const config = { ...normalized, key, origin: new URL(normalized.baseUrl).origin };
        configSize(config);
        if (typeof encrypt !== 'function') fail('KEY_UNAVAILABLE');
        await requestCard(config, BASE_CARDS.slice(0, 2), request);
        if (request.cancelled) fail('CANCELLED');
        let encrypted;
        try { encrypted = await encrypt(JSON.stringify(config)); if (!(encrypted instanceof Uint8Array) || !encrypted.length) fail('KEY_UNAVAILABLE'); if (request.cancelled) fail('CANCELLED'); atomicWrite(configFile, encrypted); }
        catch (error) { if (error.code === 'CANCELLED') throw error; fail('KEY_UNAVAILABLE'); }
        // 密文已成功保存，标记只为文件丢失时允许玩家先看本地；标记失败不废弃成功配置。
        try { atomicWrite(markerFile, 'configured\n'); } catch {}
        return service.configStatus();
      } finally { if (active === request) active = null; }
    },
    async generate({ ingredientIds, operationId } = {}) {
      if (!safeId(operationId)) fail('INVALID_ID');
      const current = readCurrent();
      if (!current) fail('STORAGE_ERROR');
      const ids = JSON.parse(recipeKey(ingredientIds));
      const cards = ids.map(id => current.cards.find(card => card.id === id));
      if (cards.some(card => !card)) fail('UNKNOWN_INGREDIENT');
      const existing = pendingFor(current);
      if (existing) {
        if (existing.operationId === operationId && recipeKey(existing.ingredientIds) === recipeKey(ids)) return copy(existing.result);
        fail('PENDING_SAVE_REQUIRED');
      }
      const committed = current.operations.find(operation => operation.id === operationId);
      if (committed) {
        if (committed.recipeKey !== recipeKey(ids)) fail('OPERATION_CONFLICT');
        return validateCardResult(current.cards.find(card => card.id === committed.resultId));
      }
      const known = findRecipe(current, ids);
      if (known) return validateCardResult(current.cards.find(card => card.id === known.resultId));
      const request = beginRequest();
      try {
        const config = await readConfig();
        if (!config) fail('KEY_REQUIRED');
        if (request.cancelled) fail('CANCELLED');
        const themes = (current.mods || []).filter(mod => mod.enabled).map(mod => mod.manifest.theme).filter(Boolean);
        // 读取已提交存档的提示；API检测使用默认值，改提示也不会重发已知配方或待存答案。
        const result = await requestCard(config, cards, request, themes, current.preferences.synthesisPrompt);
        const pending = { saveId: current.id, operationId, ingredientIds: ids, result, now: new Date().toISOString(), modProcessed: false, source: { kind: 'ai' }, modStates: [] };
        transaction(connection => {
          const latest = readCurrent(connection);
          if (!latest || latest.id !== current.id || latest.createdAt !== current.createdAt) fail('REVISION_CONFLICT');
          cleanPending(pending, latest);
          if (pendingFor(latest, connection)) fail('PENDING_SAVE_REQUIRED');
          connection.prepare('INSERT INTO pending VALUES(1,?)').run(JSON.stringify(pending));
        });
        return copy(result);
      } finally { if (active === request) active = null; }
    },
    cancel() { if (active) { const request = active; active = null; request.cancelled = true; request.controller.abort(); } },
    stageModResult({ ingredientIds, operationId, result, source, modStates = [] } = {}) {
      if (active) fail('BUSY');
      return transaction(connection => {
        const current = readCurrent(connection); if (!current) fail('STORAGE_ERROR');
        const pending = cleanPending({ saveId: current.id, ingredientIds, operationId, result, source, modStates, now: new Date().toISOString(), modProcessed: true }, current);
        if (!['mod', 'recipe'].includes(pending.source?.kind)) fail('INVALID_SOURCE');
        if (pending.source.kind === 'recipe') {
          const known = findRecipe(current, pending.ingredientIds);
          if (!known || JSON.stringify(validateCardResult(current.cards.find(card => card.id === known.resultId))) !== JSON.stringify(pending.result)) fail('OPERATION_CONFLICT');
        }
        const existing = pendingFor(current, connection);
        if (existing) {
          if (existing.operationId !== operationId) fail('PENDING_SAVE_REQUIRED');
          if (JSON.stringify({ ...pending, now: existing.now }) !== JSON.stringify(existing)) fail('OPERATION_CONFLICT');
          return copy(existing);
        }
        // 重复提交已完成的操作只确认原操作，不重新生成一个未清理journal。
        if (!current.operations.some(operation => operation.id === operationId)) connection.prepare('INSERT INTO pending VALUES(1,?)').run(JSON.stringify(pending));
        return copy(pending);
      });
    },
    updatePending({ operationId, result, source, modStates } = {}) {
      if (active) fail('BUSY');
      return transaction(connection => {
        const current = readCurrent(connection); if (!current) fail('STORAGE_ERROR');
        const existing = pendingFor(current, connection);
        if (!existing) fail('PENDING_NOT_FOUND');
        if (existing.operationId !== operationId) fail('OPERATION_CONFLICT');
        const pending = cleanPending({ ...existing, result, modProcessed: true,
          ...(source === undefined ? {} : { source }), ...(modStates === undefined ? {} : { modStates }) }, current);
        connection.prepare('UPDATE pending SET document=? WHERE singleton=1').run(JSON.stringify(pending));
        return copy(pending);
      });
    },
    exportJSON() { const current = readCurrent(); if (!current) fail('STORAGE_ERROR'); return serializeSave(current); },
    importSave(snapshot) {
      if (active) fail('BUSY');
      const value = typeof snapshot === 'string' ? parseSave(snapshot) : checkedSave(snapshot);
      let current;
      try { current = readCurrent(); }
      catch (error) { if (error.code !== 'STORAGE_CORRUPT') throw error; return recoveryReplace(checkedSave({ ...value, revision: value.revision + 1 })); }
      if (current && pendingFor(current)) fail('PENDING_SAVE_REQUIRED');
      value.revision = (current?.revision ?? -1) + 1;
      if (!Number.isSafeInteger(value.revision)) fail('INVALID_SAVE');
      // 导入前强制完成库外备份；磁盘不够时停止，不牺牲当前进度。
      let backupId;
      if (current) { try { backupId = backupFile(current, 'before-import'); } catch { fail('STORAGE_ERROR'); } }
      transaction(connection => {
        const latest = readCurrent(connection);
        if ((latest?.revision ?? null) !== (current?.revision ?? null) || (latest?.id ?? null) !== (current?.id ?? null)) fail('REVISION_CONFLICT');
        if (current) connection.prepare('INSERT INTO backups VALUES(?,?,?,?)').run(backupId, serializeSave(current), new Date().toISOString(), 'before_import');
        writeSnapshot(connection, value);
        connection.exec('DELETE FROM pending');
      });
      return rememberCommitted(value);
    },
    loadPending() {
      const current = readCurrent();
      if (!current) return null;
      const pending = pendingFor(current);
      if (!pending) return null;
      if (current.operations.some(operation => operation.id === pending.operationId)) { transaction(connection => connection.exec('DELETE FROM pending')); return null; }
      return copy(pending);
    },
    listBackups() {
      let files;
      try { files = fs.readdirSync(recoveryDir); } catch { return []; }
      return files.filter(file => /^(auto-[0-4]|before-import-[a-f0-9-]+)\.wxgc3-save$/u.test(file)).flatMap(file => {
        try {
          const fullPath = path.join(recoveryDir, file), value = parseSave(readLimited(fullPath, SAVE_LIMITS.bytes).toString('utf8'));
          return [{ id: file.slice(0, -11), saveId: value.id, revision: value.revision,
            createdAt: fs.statSync(fullPath).mtime.toISOString(), reason: file.startsWith('auto-') ? 'auto' : 'before_import',
            cardCount: value.cards.length, recipeCount: value.recipes.length, updatedAt: value.updatedAt, synthesisCount: value.stats.synthesisCount }];
        } catch { return []; }
      }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.revision - a.revision);
    },
    restoreBackup(id) {
      if (typeof id !== 'string' || !/^(auto-[0-4]|before-import-[a-f0-9-]+)$/u.test(id)) fail('INVALID_ID');
      let value;
      try { value = parseSave(readLimited(path.join(recoveryDir, `${id}.wxgc3-save`), SAVE_LIMITS.bytes).toString('utf8')); } catch { fail('INVALID_SAVE'); }
      return service.importSave(value);
    },
    recoveryStatus() {
      try { readCurrent(); return { storageAvailable: true, error: null, backupWarning }; }
      catch (error) { return { storageAvailable: false, error: error.code || 'STORAGE_CORRUPT', backupWarning }; }
    },
    close() { service.cancel(); try { database?.close(); } finally { database = null; } },
  };
  return service;
}
