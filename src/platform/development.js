// 仅限127.0.0.1开发验证。此模块不进入安装包，不接受或保存真实Key。
import { validateSave, serializeSave } from '../core/model.js';
import { DEFAULT_AI_CONFIG } from '../content/catalog.js';
const DATA = 'wxgc3-development-save-v1', CONFIG = 'wxgc3-development-config-v1';
export function createDevelopmentPlatform() {
  let generation = 0;
  return {
    mode: 'development',
    async load() { const raw = localStorage.getItem(DATA); return raw ? validateSave(JSON.parse(raw)) : null; },
    async initialize(save) { if (localStorage.getItem(DATA)) throw Error('ALREADY_INITIALIZED'); localStorage.setItem(DATA, serializeSave(save)); return validateSave(save); },
    async save(save, expectedRevision) {
      const current = JSON.parse(localStorage.getItem(DATA));
      if (current.revision !== expectedRevision || save.revision !== expectedRevision + 1) throw Error('REVISION_CONFLICT');
      const clean = validateSave(save); localStorage.setItem(DATA, serializeSave(clean)); return clean;
    },
    async configStatus() { return { ...DEFAULT_AI_CONFIG, configured: localStorage.getItem(CONFIG) === 'ready' }; },
    async configure(config) {
      if (config.key !== 'local-fixture') throw Error('DEVELOPMENT_KEY_ONLY');
      localStorage.setItem(CONFIG, 'ready'); return this.configStatus();
    },
    async generate(ids) {
      const epoch = ++generation; await new Promise(resolve => setTimeout(resolve, 1800));
      if (epoch !== generation) throw Error('CANCELLED');
      const save = await this.load(); const names = ids.map(id => save.cards.find(c => c.id === id).name);
      return { name: names.join('与').slice(0, 25), emoji: '✨', category: '抽象', description: '这是一张用于检查本地合成与保存的开发样例卡。' };
    },
    async cancel() { generation++; },
    async exportSave() {
      const blob = new Blob([serializeSave(await this.load())], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = '无限工厂3-开发验证.wxgc3-save'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return true;
    },
    async readImport() {
      return new Promise(resolve => {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.wxgc3-save,.json';
        input.addEventListener('cancel', () => resolve(null), { once: true });
        input.addEventListener('change', async () => {
          const file = input.files?.[0]; if (!file) return resolve(null);
          if (file.size > 10 * 1024 * 1024) return resolve('');
          resolve(await file.text());
        }, { once: true }); input.click();
      });
    },
    async confirmImport(save) {
      return window.confirm(`导入包含 ${save.cards.length} 张卡牌、${save.recipes.length} 个配方的存档？当前进度会先保留一份恢复副本。`);
    },
    async importSave(save) {
      const current = await this.load(); const clean = validateSave({ ...save, revision: (current?.revision ?? 0) + 1 });
      localStorage.setItem(DATA + '-before-import', serializeSave(current));
      localStorage.setItem(DATA, serializeSave(clean)); return clean;
    },
  };
}
