const safeError = value => {
  const code = String(value?.code || value?.message || value || '').split(/[:\s]/)[0];
  return new Error(/^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'NATIVE_REQUEST_FAILED');
};

export function hasNativeBridge(target = window) {
  return typeof target.wxgcNative?.invoke === 'function' || typeof target.wxgcAndroid?.postMessage === 'function' || typeof target.__TAURI__?.core?.invoke === 'function';
}

function androidInvoker(target) {
  let nextId = 0;
  const pageId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const waiting = new Map();
  // 只认本次页面发出的请求编号；迟到、重复或其他页面的回调不能完成新请求。
  target.__wxgcReceive = (id, response) => {
    const task = waiting.get(id);
    if (!task) return;
    waiting.delete(id);
    if (response?.ok === true) task.resolve(response.data);
    else task.reject(safeError(response?.error));
  };
  return (command, args = {}) => new Promise((resolve, reject) => {
    const id = `${pageId}:${++nextId}`;
    waiting.set(id, { resolve, reject });
    try { target.wxgcAndroid.postMessage(JSON.stringify({ id, command, args })); }
    catch (error) { waiting.delete(id); reject(safeError(error)); }
  });
}

export function createNativePlatform(target = window) {
  let activeSlotId = null;
  const modern = typeof target.wxgcNative?.invoke === 'function' || typeof target.wxgcAndroid?.postMessage === 'function';
  const transport = typeof target.wxgcNative?.invoke === 'function'
    ? (command, args) => target.wxgcNative.invoke(command, args)
    : typeof target.wxgcAndroid?.postMessage === 'function'
      ? androidInvoker(target)
      : typeof target.__TAURI__?.core?.invoke === 'function'
        ? (command, args) => target.__TAURI__.core.invoke(command, args)
        : null;
  if (!transport) throw Error('NATIVE_BRIDGE_REQUIRED');
  const invoke = async (command, args = {}) => {
    try { return await transport(command, args); }
    catch (error) { throw safeError(error); }
  };
  const scoped = args => modern ? { ...args, slotId: activeSlotId } : args;
  const rememberLibrary = library => { if (library && typeof library.activeSlotId === 'string') activeSlotId = library.activeSlotId; return library; };
  const slotAction = async (command, args) => {
    const result = await invoke(command, scoped(args));
    rememberLibrary(result?.library);
    return result;
  };
  return {
    mode: 'native',
    durablePending: modern,
    usageNotice: (version, accept = false) => invoke('usage_notice', { version, accept }),
    exitGame: () => invoke('exit_game'),
    libraryStatus: async () => modern ? rememberLibrary(await invoke('library_status')) : null,
    createSlot: (name, save) => slotAction('create_slot', { name, save }),
    switchSlot: id => slotAction('switch_slot', { id }),
    renameSlot: (id, name) => slotAction('rename_slot', { id, name }),
    importAsSlot: (name, save) => slotAction('import_as_slot', { name, save }),
    chooseModFile: () => invoke('choose_mod_file', scoped({})),
    stageModResult: operation => invoke('stage_mod_result', scoped(operation)),
    updatePending: operation => invoke('update_pending', scoped(operation)),
    load: () => invoke('load_save', scoped({})),
    initialize: save => invoke('initialize_save', scoped({ save })),
    save: (save, expectedRevision) => invoke('save_snapshot', scoped({ save, expectedRevision })),
    configStatus: () => invoke('config_status', scoped({})),
    configure: config => invoke('configure_ai', scoped({ config })),
    generate: (ingredientIds, operationId) => invoke('generate_card', scoped({ ingredientIds, operationId })),
    loadPending: operationId => modern ? invoke('load_pending', scoped(operationId ? { operationId } : {})) : Promise.resolve(null),
    listPending: () => modern ? invoke('list_pending', scoped({})) : Promise.resolve([]),
    recoveryStatus: () => modern ? invoke('recovery_status', scoped({})) : Promise.resolve({ storageAvailable: true, error: null, backupWarning: false }),
    listBackups: () => modern ? invoke('list_backups', scoped({})) : Promise.resolve([]),
    restoreBackup: id => invoke('restore_backup', scoped({ id })),
    cancel: operationId => invoke('cancel_request', scoped(operationId ? { operationId } : {})),
    exportSave: () => invoke('export_save_file', scoped({})),
    readImport: () => invoke('choose_import_file', scoped({})),
    confirmImport: save => invoke('confirm_import', scoped({ cardCount: save.cards.length, recipeCount: save.recipes.length,
      modCount:save.mods?.length||0,enabledScriptCount:(save.mods||[]).filter(mod=>mod.enabled&&mod.manifest.script.trim()).length })),
    importSave: save => invoke('import_save', scoped({ save })),
  };
}
