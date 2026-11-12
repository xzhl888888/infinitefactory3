import { createNewSave, commitSynthesis, findRecipe, validateSave, importSave, recipeKey } from './core/model.js';
import { DEFAULT_AI_CONFIG } from './content/catalog.js';
import { validateCardResult } from './ai/protocol.js';
import * as ModModel from './core/model.js';
import { validateModPackage, validateModStates, validateSource } from './core/mods.js';
import { createModRuntime } from './mods/runtime.js';

const MESSAGES = {
  INVALID_CONFIG: '检查服务地址和模型名称后重试。', INVALID_KEY: '请输入有效的 API Key。',
  CONFIG_TOO_LARGE: 'API 配置过长，请检查地址、模型和 Key 是否填入了多余内容。',
  KEY_REQUIRED: '请填写 API Key。', KEY_UNAVAILABLE: '无法读取这台设备保存的 Key，请重新配置。',
  SERVICE_CHANGED_KEY_REQUIRED: '服务地址已改变，请重新填写对应的 API Key。',
  AUTH_FAILED: 'Key 无效或没有访问权限，请检查配置。', NO_BALANCE: '模型服务余额不足，请到服务商处检查。',
  MODEL_NOT_FOUND: '找不到这个模型，请检查模型名称。', RATE_LIMITED: '模型服务暂时限流，请稍后再试。',
  SERVER_ERROR: '模型服务暂时不可用，请稍后再试。', REQUEST_FAILED: '未能连接模型服务，请检查网络和服务地址。',
  REQUEST_TIMEOUT: '等待模型结果超时，可以稍后重试。', REDIRECT_REJECTED: '服务地址发生跳转，请核对并填写最终服务地址。',
  RESPONSE_TOO_LARGE: '模型返回的内容过长，请调整模型设置。', INVALID_CARD_RESULT: '模型返回的卡牌格式不符合要求，请重试或更换模型。',
  INVALID_JSON: '模型没有返回有效的卡牌数据，请重试或更换模型。', INVALID_RESPONSE: '模型没有返回有效的卡牌数据。',
  CANCELLED: '已停止等待。模型服务可能仍会计算这次请求的费用。', BUSY: '请等当前操作结束。',
  REVISION_CONFLICT: '存档已经发生变化，请重新打开游戏后再试。',
  UNSUPPORTED_SAVE_VERSION: '这个存档的格式版本暂不支持，原进度没有改变。',
  UNSUPPORTED_CONTENT_VERSION: '这个存档的内容版本暂不支持，原进度没有改变。',
  SAVE_TOO_LARGE: '存档超过当前支持的大小，原进度没有改变。',
  INVALID_SAVE: '存档内容不完整或已损坏，原进度没有改变。',
  SAVE_WRITE_FAILED: '结果还没有保存。请检查剩余空间，再点“重试保存”。',
  STORAGE_ERROR: '无法保存进度，请检查剩余空间后重试。',
  FILE_READ_FAILED: '无法读取所选文件，请检查文件权限后重新选择。',
  FILE_WRITE_FAILED: '文件未能完整导出，请换一个保存位置重试。',
  EXPORT_FILE_EXISTS: '这个文件已有内容。请使用新文件名导出，保留原来的备份。',
  AI_HTTPS_REQUIRED: '服务地址需要以 https:// 开头。',
  AI_BASE_URL_IS_ENDPOINT: '请填写服务的基础地址，不要包含 /chat/completions。',
  AI_BASE_URL_HAS_CREDENTIALS_OR_QUERY: '服务地址不能包含账号、密码或查询参数。',
  AI_OUTPUT_TRUNCATED: '模型结果没有生成完整，请重试或更换模型。',
  AI_RESPONSE_REFUSED: '模型未提供这次合成结果，可以换一组材料。',
  AI_SENSITIVE_RESPONSE: '模型返回了不适合保存的内容，这次结果已忽略。',
  STORAGE_CORRUPT: '本地存档无法读取。请保留现有文件，通过备份恢复进度。',
  PENDING_INVALID: '上次合成的待保存记录无法读取。请保留现有文件，通过备份恢复进度。',
  PENDING_MISMATCH: '待保存记录不属于当前存档。请保留现有文件，通过备份恢复进度。',
  PENDING_SAVE_REQUIRED: '上次的合成结果还没有保存，请先重试保存。',
  BACKUP_NOT_FOUND: '这份备份已无法读取，请刷新列表或导入其他备份。',
  BACKUP_WRITE_FAILED: '本机备份暂时无法更新，请导出存档另存一份。',
  LIBRARY_CORRUPT: '存档列表无法读取。请保留现有文件，再通过备份恢复。',
  SLOT_NOT_FOUND: '找不到这份存档，请刷新存档列表。',
  SLOT_CONTEXT_REQUIRED: '存档状态已变化，请重新打开游戏。',
  SLOT_CHANGED: '当前存档已经切换，请重试刚才的操作。',
  SLOT_LIMIT: '存档数量已达到 100 份，无法继续添加。',
  LIBRARY_CHANGED: '存档列表已经变化，请刷新列表后重试。',
  LIBRARY_WRITE_FAILED: '存档列表未能保存，请检查剩余空间后重试。',
  INVALID_SLOT_NAME: '请输入 1 至 40 字的存档名称。',
  INVALID_MOD: '这个 Mod 的内容不完整或格式不支持，请检查文件。',
  MOD_TOO_LARGE: '这个 Mod 超过大小限制，请使用更小的资源文件。',
  MOD_CONFLICT: '这个 Mod 与已启用的配方冲突，请先停用冲突的 Mod。',
  MOD_SCRIPT_ERROR: 'Mod 运行失败，请检查脚本或停用这个 Mod 后再试。',
  MOD_TIMEOUT: 'Mod 运行超时，请检查脚本或停用这个 Mod 后再试。',
  MOD_RECIPE_CONFLICT: '这个 Mod 的配方与其他已启用的 Mod 冲突，请先停用其中一个。',
  MOD_CARD_MISSING: '这个 Mod 引用了缺失的卡牌，请检查 Mod 文件。',
  INVALID_MOD_ASSET: '这个 Mod 的图片或音效无法读取，请检查资源格式和大小。',
  INVALID_MOD_SCRIPT: '这个 Mod 的玩法脚本不完整或超过大小限制。',
  INVALID_MOD_STATE: 'Mod 返回的玩法进度格式不正确，这次操作未保存。',
  MOD_SCRIPT_FAILED: 'Mod 脚本运行失败，请检查脚本或停用这个 Mod 后再试。',
  MOD_UNAVAILABLE: '这台设备暂时无法运行 Mod 脚本，请重新打开游戏后再试。',
  MOD_CANCELLED: '已停止这次 Mod 操作。',
  INVALID_MOD_RESULT: 'Mod 返回的内容不符合要求，这次操作未保存。',
  MOD_ACTION_MISSING: '这个 Mod 的玩法入口已不可用，请检查它是否仍然启用。',
  MOD_ALREADY_INSTALLED: '这份存档已安装相同 ID 的 Mod，请确认是否替换。',
  MOD_NOT_FOUND: '找不到这个 Mod，请重新打开 Mod 列表。',
  PENDING_NOT_FOUND: '找不到这次合成的待存结果，请保留现有文件并重新打开游戏。',
  MOD_PROCESS_FAILED: 'Mod 处理失败，模型原始结果已保留。可以点“重试保存”直接保存原始结果。',
};
const ERROR_ALIASES = {
  AI_INVALID_BASE_URL:'INVALID_CONFIG', AI_INVALID_MODEL:'INVALID_CONFIG', AI_INVALID_KEY:'INVALID_KEY',
  AI_ACCESS_DENIED:'AUTH_FAILED', AI_INSUFFICIENT_BALANCE:'NO_BALANCE', AI_MODEL_OR_ENDPOINT_NOT_FOUND:'MODEL_NOT_FOUND',
  AI_RATE_LIMITED:'RATE_LIMITED', AI_SERVICE_UNAVAILABLE:'SERVER_ERROR', AI_PROVIDER_ERROR:'SERVER_ERROR',
  AI_CLIENT_INIT_FAILED:'REQUEST_FAILED', AI_HTTP_ERROR:'REQUEST_FAILED', AI_NETWORK_UNAVAILABLE:'REQUEST_FAILED',
  AI_REQUEST_FAILED:'REQUEST_FAILED', AI_REQUEST_REJECTED:'REQUEST_FAILED', AI_REQUEST_TOO_LARGE:'RESPONSE_TOO_LARGE',
  AI_TIMEOUT:'REQUEST_TIMEOUT', AI_REDIRECT_BLOCKED:'REDIRECT_REJECTED', AI_RESPONSE_TOO_LARGE:'RESPONSE_TOO_LARGE',
  AI_INVALID_CARD:'INVALID_CARD_RESULT', AI_INVALID_CATEGORY:'INVALID_CARD_RESULT', AI_INVALID_RESPONSE:'INVALID_RESPONSE',
  STORAGE_REVISION_CONFLICT:'REVISION_CONFLICT', STORAGE_UNSUPPORTED_VERSION:'UNSUPPORTED_SAVE_VERSION',
  STORAGE_SAVE_TOO_LARGE:'SAVE_TOO_LARGE', STORAGE_INVALID_JSON:'INVALID_SAVE', STORAGE_DATABASE_ERROR:'STORAGE_ERROR',
  STORAGE_FILE_ERROR:'STORAGE_ERROR',
  STORAGE_PENDING_INVALID:'PENDING_INVALID', STORAGE_PENDING_MISMATCH:'PENDING_MISMATCH',
  STORAGE_BACKUP_NOT_FOUND:'BACKUP_NOT_FOUND',
};
export function errorText(error) {
  const code = String(error?.code || error?.message || error || '').split(/[:\s]/)[0];
  return MESSAGES[ERROR_ALIASES[code] || code] || (code.startsWith('STORAGE_INVALID_') ? MESSAGES.INVALID_SAVE : '操作没有完成，请重试。原有进度会保留。');
}

function checkedPending(value, save) {
  const keys = ['saveId', 'operationId', 'ingredientIds', 'result', 'now'], optional = ['source', 'modStates', 'modProcessed'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key=>!keys.includes(key)&&!optional.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw Error('PENDING_INVALID');
  if (value.saveId !== save.id) throw Error('PENDING_MISMATCH');
  if (typeof value.operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.operationId)) throw Error('PENDING_INVALID');
  if (typeof value.now !== 'string' || !Number.isFinite(Date.parse(value.now)) || new Date(value.now).toISOString() !== value.now) throw Error('PENDING_INVALID');
  if (!value.result || Object.keys(value.result).sort().join(',') !== 'category,description,emoji,name') throw Error('PENDING_INVALID');
  if(value.modProcessed!==undefined&&typeof value.modProcessed!=='boolean')throw Error('PENDING_INVALID');
  try {
    const operation = { operationId: value.operationId, ingredientIds: [...value.ingredientIds], result: validateCardResult(value.result), now: value.now,
      modProcessed:value.modProcessed??false,
      ...(value.source!==undefined?{source:validateSource(value.source)}:{}),...(value.modStates!==undefined?{modStates:validateModStates(value.modStates,save.mods)}:{}) };
    // 同一操作号也必须核对材料和结果；用提交规则验证，但这里不写入也不发布答案。
    const checked = commitSynthesis(save, operation);
    return { operation, alreadyCommitted: checked.alreadyCommitted };
  } catch { throw Error('PENDING_INVALID'); }
}

function checkedLibrary(value) {
  if (!value || typeof value.activeSlotId !== 'string' || !Array.isArray(value.slots) || !value.slots.length) throw Error('LIBRARY_CORRUPT');
  const seen = new Set();
  const slots = value.slots.map(slot => {
    if (!slot || typeof slot.id !== 'string' || !slot.id || seen.has(slot.id) || typeof slot.name !== 'string' || !slot.name.trim() || typeof slot.available !== 'boolean') throw Error('LIBRARY_CORRUPT');
    seen.add(slot.id);
    if (['cardCount', 'recipeCount', 'synthesisCount', 'modCount'].some(key => !Number.isSafeInteger(slot[key]) || slot[key] < 0)) throw Error('LIBRARY_CORRUPT');
    const empty = slot.saveId === null && slot.updatedAt === null && ['cardCount','recipeCount','synthesisCount','modCount'].every(key=>slot[key]===0);
    if (slot.available && !empty && (typeof slot.saveId !== 'string' || !Number.isFinite(Date.parse(slot.updatedAt)))) throw Error('LIBRARY_CORRUPT');
    const { id, name, saveId, cardCount, recipeCount, synthesisCount, updatedAt, modCount, available } = slot;
    return { id, name, saveId, cardCount, recipeCount, synthesisCount, updatedAt, modCount, available };
  });
  if (!seen.has(value.activeSlotId)) throw Error('LIBRARY_CORRUPT');
  return { activeSlotId: value.activeSlotId, slots };
}
function checkedSlotName(value) {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 40 || /[\u0000-\u001f\u007f]/u.test(value)) throw Error('INVALID_SLOT_NAME');
  return value.trim();
}

// 所有写操作进入同一条队列，布局/外观保存不能覆盖刚完成的合成。
export function createController(platform, render, { now = () => new Date().toISOString(), uuid = () => crypto.randomUUID(), confirmImport = () => true, modRuntime = createModRuntime() } = {}) {
  let state = { save: null, library: null, saveEpoch: 0, configStatus: { ...DEFAULT_AI_CONFIG, configured: false }, busy: false, error: '', fileFeedback: null, modFeedback: null, modCandidate: null, lastResult: null, synthesis: null, mode: platform.mode, canRetrySave: false, recoveryRequired: false, pendingBlocked: false, backups: null, backupWarning: false };
  let writeQueue = Promise.resolve(), pending = null, saving = null, requestEpoch = 0, skipPendingMods = false;
  const show = patch => { state = { ...state, ...patch }; render(state); };
  // 动画只读这份操作状态；答案留在 pending 中，提交成功前不向视图发布结果卡。
  const showSynthesisPhase = (id, phase, patch = {}) => {
    if (state.synthesis?.id === id) show({ ...patch, synthesis: { ...state.synthesis, phase } });
  };
  const enqueue = fn => { const task = writeQueue.then(fn); writeQueue = task.catch(() => {}); return task; };
  async function persist(snapshot) {
    const committed = await platform.save(validateSave(snapshot), state.save.revision);
    const clean = validateSave(committed);
    // 列表摘要跟随已落盘的当前档案，避免每次拖卡都再读取整份存档库。
    const library = state.library && { ...state.library, slots: state.library.slots.map(slot => slot.id === state.library.activeSlotId
      ? { ...slot, saveId: clean.id, cardCount: clean.cards.length, recipeCount: clean.recipes.length, synthesisCount: clean.stats.synthesisCount, updatedAt: clean.updatedAt, modCount: clean.mods?.length || 0, available: true } : slot) };
    show({ save: clean, ...(library ? { library } : {}) }); return committed;
  }
  async function acceptSlot(result, message) {
    const library = checkedLibrary(result?.library), clean = result?.save === null ? null : validateSave(result?.save);
    const slot = library.slots.find(item => item.id === library.activeSlotId);
    if ((clean && (!slot.available || slot.saveId !== clean.id)) || (!clean && slot.available)) throw Error('LIBRARY_CORRUPT');
    ++requestEpoch;
    pending = null;
    skipPendingMods = false;
    show({ save: clean, library, saveEpoch: state.saveEpoch + 1, lastResult: null, synthesis: null, canRetrySave: false,
      recoveryRequired: !clean, pendingBlocked: false, backups: null, modCandidate: null, modFeedback: null, error: clean ? '' : MESSAGES.STORAGE_CORRUPT, fileFeedback: clean && message ? { action: 'slot', kind: 'success', message } : null });
    if (clean && platform.loadPending) {
      try { await recoverPending(); }
      catch (e) { show({ error: errorText(e), pendingBlocked: true }); }
    }
    try { show({ configStatus: await platform.configStatus() }); }
    catch (e) { if (!state.error) show({ error: errorText(e) }); }
  }
  async function changeSlot(kind, action, message) {
    if (state.busy || pending || state.canRetrySave) return;
    show({ busy: kind, error: '', fileFeedback: null });
    try { await writeQueue; await acceptSlot(await action(), message); }
    catch (e) { show({ error: errorText(e) }); }
    finally { show({ busy: false }); }
  }
  async function recoverPending() {
    const journal = await platform.loadPending();
    if (journal === null) return false;
    const checked = checkedPending(journal, state.save);
    if (checked.alreadyCommitted) return false;
    pending = checked.operation;
    skipPendingMods = false;
    let message = '上次的合成结果还没有保存，点“重试保存”继续。';
    if(!pending.modProcessed&&state.save.mods?.some(mod=>mod.enabled)){
      try{
        const output=await modRuntime.process(state.save,pending.ingredientIds,pending.result,{operationId:pending.operationId,source:pending.source||{kind:'ai'},modStates:pending.modStates||[],cached:pending.source?.kind==='recipe'});
        const operation={operationId:pending.operationId,result:output?.result||pending.result,source:output?.source||pending.source||{kind:'ai'},modStates:output?.modStates||pending.modStates||[]};
        const updated=await platform.updatePending(operation);
        const next=checkedPending(updated,state.save);
        if(next.operation.operationId!==pending.operationId||recipeKey(next.operation.ingredientIds)!==recipeKey(pending.ingredientIds))throw Error('PENDING_MISMATCH');
        pending=next.operation;
      }catch{skipPendingMods=true;message=MESSAGES.MOD_PROCESS_FAILED;}
    }
    show({ canRetrySave: true, pendingBlocked: false, lastResult: null, error: message,
      synthesis: { id: pending.operationId, ingredientIds: pending.ingredientIds, source: 'ai', phase: 'save-failed' } });
    return true;
  }
  function savePending() {
    // 连点重试共享同一次提交；已保存的结果不能被第二个回调改成失败。
    if (saving) return saving;
    if (!pending) return Promise.resolve();
    if (state.busy && !['combine', 'save'].includes(state.busy)) return Promise.resolve();
    let operation = pending;
    showSynthesisPhase(operation.operationId, 'saving', { busy: 'save', error: '' });
    saving = enqueue(async () => {
        // 玩家已明确点击保存原答案；先把“跳过失败脚本”也记入日志，重开不能再重跑一次。
        if(skipPendingMods&&platform.durablePending){
          const updated=checkedPending(await platform.updatePending({operationId:operation.operationId,result:operation.result,source:operation.source||{kind:'ai'},modStates:operation.modStates||[]}),state.save);
          if(updated.operation.operationId!==operation.operationId||recipeKey(updated.operation.ingredientIds)!==recipeKey(operation.ingredientIds))throw Error('PENDING_MISMATCH');
          operation=pending=updated.operation;skipPendingMods=false;
        }
        const result = commitSynthesis(state.save, operation);
        if (!result.alreadyCommitted) await persist(result.save);
        pending = null;
        skipPendingMods = false;
        showSynthesisPhase(operation.operationId, 'committed', {
          lastResult: { operationId: operation.operationId, card: result.card, isNewCard: result.isNewCard, isNewRecipe: result.isNewRecipe }, canRetrySave: false,
        });
      }).catch(e => {
        const conflict = /^(STORAGE_)?REVISION_CONFLICT/.test(String(e?.code || e?.message || e));
        showSynthesisPhase(operation.operationId, 'save-failed', { error: conflict ? MESSAGES.REVISION_CONFLICT : MESSAGES.SAVE_WRITE_FAILED, canRetrySave: true });
      }).finally(() => { saving = null; show({ busy: false }); });
    return saving;
  }
  const callbacks = {
    async onConfigure(config) {
      if (state.busy) return;
      const epoch = ++requestEpoch;
      show({ busy: 'configure', error: '' });
      try { const status = await platform.configure(config); if (epoch === requestEpoch) show({ configStatus: status }); }
      catch (e) { if (epoch === requestEpoch) show({ error: errorText(e) }); }
      finally { config.key = ''; if (epoch === requestEpoch) show({ busy: false }); }
    },
    async onCombine(ingredientIds) {
      if (state.busy || pending || state.pendingBlocked || !state.save) return;
      const epoch = ++requestEpoch;
      const operationId = uuid();
      let synthesis, checkingJournal = false;
      try {
        // 将同一材料选择固定在操作上，迟到响应不能改成玩家后续的选择。
        const ids = [...ingredientIds];
        const known = findRecipe(state.save, ids);
        const usesMods = state.save.mods?.some(mod => mod.enabled);
        // 已记录配方只使用本地答案，凭据丢失不能锁住玩家已有进度。
        if (!known && !usesMods && !state.configStatus.configured) { show({ error: MESSAGES.KEY_REQUIRED }); return; }
        synthesis = { id: operationId, ingredientIds: ids, source: known ? 'cache' : usesMods ? 'mod' : 'ai', phase: known ? 'saving' : 'requesting' };
        // 本地配方直接保存；不伪造模型等待，也不为动画延迟实际提交。
        show({ busy: known ? 'save' : 'combine', error: '', lastResult: null, canRetrySave: false, synthesis });
        const local = !known && usesMods ? await modRuntime.resolve(state.save, ids, operationId) : null;
        if (epoch !== requestEpoch) return;
        let result = known && usesMods ? validateCardResult(state.save.cards.find(card=>card.id===known.resultId)) : local ? validateCardResult(local.result) : null;
        let source = known ? {kind:'recipe'} : local?.source || {kind:'ai'}, modStates = local?.modStates || [];
        let aiResult = false;
        if (!known && !local) {
          if (!state.configStatus.configured) { showSynthesisPhase(operationId,'failed',{error:MESSAGES.KEY_REQUIRED}); return; }
          show({ synthesis: { ...state.synthesis, source: 'ai' } });
          result = validateCardResult(await platform.generate(ids, operationId));
          if (epoch !== requestEpoch) return;
          aiResult = true;
        }
        if (aiResult && platform.durablePending) {
          checkingJournal = true;
          const journal = checkedPending(await platform.loadPending(), state.save);
          if (epoch !== requestEpoch) return;
          if (journal.operation.operationId !== operationId || recipeKey(journal.operation.ingredientIds) !== recipeKey(ids) || JSON.stringify(journal.operation.result) !== JSON.stringify(result)) throw Error('PENDING_MISMATCH');
          pending = journal.operation;
          checkingJournal = false;
        } else if (!usesMods) pending = { operationId, ingredientIds: ids, result, source, now: now() };
        if (usesMods) {
          try {
            // resolve 已包含本地答案的 transform/afterCombine，不能在这里重复执行状态更新。
            const output = local || await modRuntime.process(state.save,ids,result,{operationId,source,modStates,cached:!!known});
            if (epoch !== requestEpoch) return;
            result = validateCardResult(output?.result || result);source = output?.source || source;modStates = output?.modStates || modStates;
            const operation = { operationId, ingredientIds: ids, result, source, modStates };
            if (platform.durablePending) {
              const journal = aiResult ? await platform.updatePending(operation) : await platform.stageModResult(operation);
              if (epoch !== requestEpoch) return;
              const checked = checkedPending(journal,state.save);
              if(checked.operation.operationId!==operationId||recipeKey(checked.operation.ingredientIds)!==recipeKey(ids))throw Error('PENDING_MISMATCH');
              pending = checked.operation;
            } else pending = {...operation,now:now()};
            if(output?.message||local?.message)show({modFeedback:{kind:'success',message:output?.message||local.message}});
          } catch (modError) {
            // AI 原始答案已经持久化。脚本失败只暂停提交，不丢掉已付费结果，也不自动重跑脚本。
            if (aiResult && pending) { skipPendingMods=true;showSynthesisPhase(operationId,'save-failed',{error:MESSAGES.MOD_PROCESS_FAILED,canRetrySave:true});return; }
            throw modError;
          }
        }
        await savePending();
      } catch (e) {
        if (epoch === requestEpoch) {
          // 取消和答案落盘可能交错。原生已保存答案时，只恢复这份结果，不发第二次付费请求。
          if (platform.durablePending && String(e?.code || e?.message || e) === 'PENDING_SAVE_REQUIRED') {
            try { if (await recoverPending()) return; }
            catch (recoveryError) { e = recoveryError; checkingJournal = true; }
          }
          if (synthesis) showSynthesisPhase(operationId, 'failed', { error: errorText(e), ...(checkingJournal ? { pendingBlocked: true } : {}) });
          else show({ error: errorText(e) });
        }
      }
      finally { if (epoch === requestEpoch) show({ busy: false }); }
    },
    async onCancel() {
      if (!['combine', 'configure'].includes(state.busy)) return;
      const cancellingSynthesis = state.busy === 'combine' ? state.synthesis : null;
      const epoch = ++requestEpoch;
      // 立即终止本次视觉等待；取消配置不能改动之前合成的已提交／待存状态。
      show({ busy: 'cancel', ...(cancellingSynthesis ? { synthesis: { ...cancellingSynthesis, phase: 'cancelled' } } : {}) });
      if(cancellingSynthesis)modRuntime.dispose?.();
      try { await platform.cancel(); } catch {}
      if (epoch === requestEpoch) {
        if (cancellingSynthesis && platform.durablePending) {
          try { if (await recoverPending()) { show({ busy: false }); return; } }
          catch (e) { show({ busy: false, pendingBlocked: true, error: errorText(e) }); return; }
        }
        show({ busy: false, error: MESSAGES.CANCELLED });
      }
    },
    onRetrySave: savePending,
    async onRefreshLibrary() {
      if (state.busy || !platform.libraryStatus) return;
      show({ busy: 'library' });
      try { const library = await platform.libraryStatus(); if (library) show({ library: checkedLibrary(library) }); }
      catch (e) { show({ error: errorText(e) }); }
      finally { show({ busy: false }); }
    },
    async onCreateSlot(name) {
      if (!platform.createSlot) return;
      return changeSlot('create-slot', () => platform.createSlot(checkedSlotName(name), createNewSave({ id: uuid(), now: now() })), '新存档已创建。');
    },
    async onSwitchSlot(id) {
      if (!platform.switchSlot || id === state.library?.activeSlotId || !state.library?.slots.some(slot => slot.id === id)) return;
      return changeSlot('switch-slot', () => platform.switchSlot(id), '已切换存档。');
    },
    async onRenameSlot(id, name) {
      if (state.busy || pending || state.canRetrySave || !platform.renameSlot || !state.library?.slots.some(slot => slot.id === id)) return;
      show({ busy: 'rename-slot', error: '' });
      try {
        await writeQueue;
        const result = await platform.renameSlot(id, checkedSlotName(name));
        show({ library: checkedLibrary(result.library), ...(result.save?{save:validateSave(result.save)}:{}), fileFeedback: { action: 'slot', kind: 'success', message: '存档名称已修改。' } });
      } catch (e) { show({ error: errorText(e) }); }
      finally { show({ busy: false }); }
    },
    async onChooseMod() {
      if(state.busy||pending||!state.save||!platform.chooseModFile)return;
      show({busy:'mod-import',error:'',modFeedback:null,modCandidate:null});
      try {const text=await platform.chooseModFile();if(text!==null)show({modCandidate:validateModPackage(text)});}
      catch(e){show({error:errorText(e),modFeedback:{kind:'error',message:errorText(e)}});}
      finally{show({busy:false});}
    },
    onCancelModImport(){if(!state.busy)show({modCandidate:null});},
    async onInstallMod(replace=false){
      if(!state.modCandidate)return;const manifest=state.modCandidate;
      return modifyMod(()=>ModModel.installMod(state.save,manifest,{replace,now:now()}),manifest.script?'Mod 已安装。启用后才会运行其中的脚本。':'Mod 已安装。',true);
    },
    async onToggleMod(id,enabled){return modifyMod(()=>ModModel.toggleMod(state.save,id,enabled,now()),enabled?'Mod 已启用。':'Mod 已停用，已经发现的卡牌和配方会保留。');},
    async onRemoveMod(id){return modifyMod(()=>ModModel.removeMod(state.save,id,now()),'Mod 已移除，已经发现的卡牌和配方会保留。');},
    async onModAction(modId,actionId){
      if(state.busy||pending||!state.save||state.pendingBlocked)return;
      show({busy:'mod-action',error:'',modFeedback:null});
      try{await writeQueue;const output=await modRuntime.action(state.save,modId,actionId);await enqueue(()=>persist(ModModel.applyModAction(state.save,modId,output,now())));show({modFeedback:{kind:'success',message:output?.message||'玩法操作已保存。'}});}
      catch(e){const message=errorText(e);show({error:message,modFeedback:{kind:'error',message}});}
      finally{show({busy:false});}
    },
    async onSavePreferences(patch) {
      const previousError = state.error, epoch = requestEpoch;
      const saved = await patchSave(save => ({ ...save, preferences: { ...save.preferences, ...patch } }));
      // 提示词重试成功后撤掉旧错误；保存期间新操作的错误和待存提示仍由原操作处理。
      if (saved && Object.hasOwn(patch, 'synthesisPrompt') && previousError && state.error === previousError && epoch === requestEpoch
        && !state.busy && !pending && !state.canRetrySave && !state.pendingBlocked) show({ error: '' });
      return saved;
    },
    async onSaveFavorites(favorites) { return patchSave(save => ({ ...save, favorites })); },
    async onSaveLayout(layout) {
      // 空数组也可能是玩家收完了所有台面卡；标记和布局一起提交，重开不能擅自铺回本源。
      return patchSave(save => ({ ...save, layout, preferences: { ...save.preferences, layoutInitialized: true } }));
    },
    async onExport() {
      if (state.busy || !state.save) return;
      // 文件选择期间保持互斥；等已有写入结束后再取导出快照。
      show({ busy: 'export', error: '', fileFeedback: null });
      try {
        await writeQueue;
        const saved = await platform.exportSave();
        if (saved !== true && saved !== false) throw Error('FILE_WRITE_FAILED');
        show({ fileFeedback: { action: 'export', kind: saved ? 'success' : 'cancelled', message: saved
          ? '存档已导出。'
          : '已取消导出。' } });
      } catch (e) { const message = errorText(e); show({ error: message, fileFeedback: { action: 'export', kind: 'error', message } }); }
      finally { show({ busy: false }); }
    },
    async onImport() {
      if (state.busy || pending || (!state.save && !state.recoveryRequired)) return;
      show({ busy: 'import', error: '', fileFeedback: null });
      try {
        await writeQueue;
        const text = await platform.readImport();
        if (text === null) { show({ fileFeedback: { action: 'import', kind: 'cancelled', message: '已取消导入，当前进度未改变。' } }); return; }
        const parsed = importSave(text);
        if (!await confirmImport(parsed)) { show({ fileFeedback: { action: 'import', kind: 'cancelled', message: '已取消导入，当前进度未改变。' } }); return; }
        if (state.library && platform.importAsSlot) {
          const name = '导入存档 ' + now().slice(0,16).replace('T',' ');
          await acceptSlot(await enqueue(() => platform.importAsSlot(name, parsed)), `已添加新存档：${parsed.cards.length} 张卡牌，${parsed.stats.synthesisCount} 次合成。`);
          return;
        }
        const saved = await enqueue(() => platform.importSave(parsed));
        // 同一档案的旧备份仍有相同 id，视图需要明确区分导入和普通写入响应。
        const clean = validateSave(saved);
        show({ save: clean, saveEpoch: state.saveEpoch + 1, lastResult: null, synthesis: null, recoveryRequired: false, pendingBlocked: false, backups: null, error: '',
          fileFeedback: { action: 'import', kind: 'success', message: `存档已导入：${clean.cards.length} 张卡牌，${clean.stats.synthesisCount} 次合成。` } });
      } catch (e) { const message = errorText(e); show({ error: message, fileFeedback: { action: 'import', kind: 'error', message } }); }
      finally { show({ busy: false }); }
    },
    async onListBackups() {
      if (state.busy || !platform.listBackups) return;
      show({ busy: 'backups' });
      try {
        const backups = await platform.listBackups();
        if (!Array.isArray(backups) || backups.some(item => !item || typeof item.id !== 'string' || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isSafeInteger(item.cardCount) || item.cardCount < 5 || !Number.isSafeInteger(item.recipeCount) || item.recipeCount < 0)) throw Error('STORAGE_ERROR');
        show({ backups: backups.map(({ id, createdAt, cardCount, recipeCount }) => ({ id, createdAt, cardCount, recipeCount })) });
      } catch (e) { show({ error: errorText(e) }); }
      finally { show({ busy: false }); }
    },
    async onRestoreBackup(id) {
      if (state.busy || pending || !state.backups?.some(item => item.id === id) || !platform.restoreBackup) return;
      show({ busy: 'restore', error: '', fileFeedback: null });
      try {
        await writeQueue;
        const clean = validateSave(await platform.restoreBackup(id));
        show({ save: clean, saveEpoch: state.saveEpoch + 1, lastResult: null, synthesis: null, recoveryRequired: false, pendingBlocked: false, backups: null,
          fileFeedback: { action: 'restore', kind: 'success', message: `存档已恢复：${clean.cards.length} 张卡牌，${clean.stats.synthesisCount} 次合成。` } });
      } catch (e) { const message = errorText(e); show({ error: message, fileFeedback: { action: 'restore', kind: 'error', message } }); }
      finally { show({ busy: false }); }
    },
  };
  async function modifyMod(mutator,message,clearCandidate=false){
    if(state.busy||pending||!state.save||state.pendingBlocked)return;
    show({busy:'mod-save',error:'',modFeedback:null});
    try{await enqueue(()=>persist(mutator()));show({modFeedback:{kind:'success',message},...(clearCandidate?{modCandidate:null}:{})});}
    catch(e){const message=errorText(e);show({error:message,modFeedback:{kind:'error',message}});}
    finally{show({busy:false});}
  }
  async function patchSave(mutator) {
    if (!state.save || state.pendingBlocked || ['import', 'export', 'restore', 'create-slot', 'switch-slot', 'rename-slot', 'mod-import', 'mod-save', 'mod-action'].includes(state.busy)) return false;
    try { await enqueue(() => persist({ ...mutator(state.save), updatedAt: now(), revision: state.save.revision + 1 })); return true; }
    catch (e) { show({ error: errorText(e) }); return false; }
  }
  return {
    callbacks,
    get state() { return state; },
    async start() {
      try {
        if (platform.libraryStatus) { const library = await platform.libraryStatus(); if (library) show({ library: checkedLibrary(library) }); }
        const loaded = await platform.load();
        const save = loaded ? validateSave(loaded) : await platform.initialize(createNewSave({ id: uuid(), now: now() }));
        show({ save: validateSave(save) });
        if (!loaded && platform.libraryStatus) { const library = await platform.libraryStatus(); if (library) show({ library: checkedLibrary(library) }); }
      } catch (e) { show({ error: errorText(e), recoveryRequired: true }); }
      if (state.save && platform.loadPending) {
        try { await recoverPending(); }
        catch (e) { show({ error: errorText(e), pendingBlocked: true }); }
      }
      try { show({ configStatus: await platform.configStatus() }); }
      catch (e) { if (!state.error) show({ error: errorText(e) }); }
      if (platform.recoveryStatus) {
        try { const recovery = await platform.recoveryStatus(); show({ backupWarning: !!recovery.backupWarning }); }
        catch (e) { if (!state.error) show({ error: errorText(e) }); }
      }
    },
  };
}
