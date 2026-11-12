const { contextBridge, ipcRenderer } = require('electron');

// 只给游戏页面固定能力，不暴露 IPC、文件系统或凭据读取接口。
const commands = new Set([
  'usage_notice', 'exit_game',
  'load_save', 'initialize_save', 'save_snapshot', 'config_status', 'configure_ai',
  'generate_card', 'cancel_request', 'export_save_file', 'choose_import_file',
  'confirm_import', 'import_save', 'load_pending', 'recovery_status', 'list_backups', 'restore_backup',
  'library_status', 'create_slot', 'switch_slot', 'rename_slot', 'import_as_slot',
  'choose_mod_file', 'stage_mod_result', 'update_pending',
]);
contextBridge.exposeInMainWorld('wxgcNative', Object.freeze({
  async invoke(command, args = {}) {
    if (!commands.has(command)) throw new Error('COMMAND_NOT_ALLOWED');
    const response = await ipcRenderer.invoke('wxgc:command', command, args);
    if (!response?.ok) throw new Error(response?.error || 'STORAGE_ERROR');
    return response.data;
  },
}));
