import { DomainError, validateCardResult } from '../ai/protocol.js';
import { findModRecipe, validateModState, validateModStates, validateSource } from '../core/mods.js';

// 每次调用一个一次性 Worker。闭包中的通信函数不交给脚本，主线程只接收经过校验的数据。
// Blob Worker 继承页面 CSP；connect-src none 与原生壳禁用 Node 是第二道边界。
export function modWorkerSource(script) {
  return `(() => {
    const send = self.postMessage.bind(self), listen = self.addEventListener.bind(self);
    let hooks = null;
    Object.defineProperty(self, 'registerMod', { value(value) {
      if (hooks || !value || typeof value !== 'object') throw new Error('INVALID_MOD_SCRIPT');
      hooks = value;
    }, writable:false, configurable:false });
    for (const key of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','Worker','SharedWorker','BroadcastChannel','indexedDB','caches']) {
      try { Object.defineProperty(self, key, { value:undefined, writable:false, configurable:false }); } catch {}
    }
    listen('message', async event => {
      const { hook, actionId, context } = event.data;
      try {
        if (!hooks) throw new Error('INVALID_MOD_SCRIPT');
        const fn = hook === 'action' ? hooks.actions?.[actionId] : hooks[hook];
        if (fn != null && typeof fn !== 'function') throw new Error('INVALID_MOD_SCRIPT');
        const value = fn ? await fn(context) : null;
        const json = JSON.stringify(value ?? null);
        if (json.length > 262144) throw new Error('MOD_OUTPUT_TOO_LARGE');
        send({ ok:true, value:JSON.parse(json) });
      } catch { send({ ok:false }); }
    }, { once:true });
  })();\n${script}\n`;
}

function defaultRun(script, input, timeoutMs, active) {
  return new Promise((resolve, reject) => {
    let worker, url, timer, settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true;
      clearTimeout(timer); worker?.terminate(); if (url) URL.revokeObjectURL(url);
      active.delete(cancel);
      if (error) reject(new DomainError(error)); else resolve(value);
    };
    const cancel = () => finish('MOD_CANCELLED');
    try {
      url = URL.createObjectURL(new Blob([modWorkerSource(script)], { type:'text/javascript' }));
      worker = new Worker(url); active.add(cancel);
      timer = setTimeout(() => finish('MOD_TIMEOUT'), timeoutMs);
      worker.onmessage = event => event.data?.ok === true ? finish(null, event.data.value) : finish('MOD_SCRIPT_FAILED');
      worker.onerror = event => { event.preventDefault?.(); finish('MOD_SCRIPT_FAILED'); };
      worker.onmessageerror = () => finish('MOD_SCRIPT_FAILED');
      worker.postMessage(input);
    } catch { finish('MOD_UNAVAILABLE'); }
  });
}

function output(value, { action = false } = {}) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new DomainError('INVALID_MOD_RESULT');
  const result = {};
  if (value.card != null) result.card = validateCardResult(value.card);
  if (value.state != null) result.state = validateModState(value.state);
  if (value.message != null) {
    if (typeof value.message !== 'string' || value.message.length > 240 || /[\u0000-\u001f\u007f]/u.test(value.message)) throw new DomainError('INVALID_MOD_RESULT');
    result.message = value.message;
  }
  if (action && value.cards != null) {
    if (!Array.isArray(value.cards) || value.cards.length > 50) throw new DomainError('INVALID_MOD_RESULT');
    result.cards = value.cards.map(validateCardResult);
  }
  return result;
}

export function createModRuntime({ run, timeoutMs = 1500 } = {}) {
  const active = new Set();
  const execute = run || ((script, input) => defaultRun(script, input, timeoutMs, active));
  function context(save, ids, result, state, operationId) {
    // 挑选公开字段，不把配置、凭据、其他 Mod 的脚本或状态带进沙箱。
    return structuredClone({ ingredients:ids.map(id => save.cards.find(c => c.id === id)), result,
      world:{ name:save.name, cards:save.cards, recipes:save.recipes, stats:save.stats }, state, operationId });
  }
  async function call(mod, hook, ctx, actionId) {
    try { return output(await execute(mod.manifest.script, { hook, actionId, context:ctx }), { action:hook === 'action' }); }
    catch (error) { throw new DomainError(error?.code?.startsWith('MOD_') || error?.code?.startsWith('INVALID_MOD') ? error.code : 'MOD_SCRIPT_FAILED'); }
  }
  async function process(save, ids, result, options = {}) {
    let card = validateCardResult(result), source = validateSource(options.source || {kind:'ai'}, save.mods);
    const states = new Map(validateModStates(options.modStates || [], save.mods).map(v => [v.id,v.state]));
    let message = '';
    for (const mod of (save.mods || []).filter(m => m.enabled && m.manifest.script.trim())) {
      const id = mod.manifest.id;
      for (const hook of options.cached ? ['afterCombine'] : ['transform','afterCombine']) {
        const answer = await call(mod, hook, context(save, ids, card, states.get(id) ?? mod.state, options.operationId));
        if (answer.card && hook === 'transform') { card = answer.card; source = {kind:'mod',modId:id,modName:mod.manifest.name}; }
        if (answer.state) states.set(id,answer.state);
        if (answer.message) message = answer.message;
      }
    }
    return {result:card,source,modStates:[...states].map(([id,state]) => ({id,state})),message};
  }
  return {
    async resolve(save, ids, operationId) {
      const fixed = findModRecipe(save, ids);
      if (fixed) return process(save,ids,fixed.result,{...fixed,operationId});
      const states = new Map(); let message = '';
      for (const mod of (save.mods || []).filter(m => m.enabled && m.manifest.script.trim())) {
        const answer = await call(mod,'resolve',context(save,ids,null,mod.state,operationId));
        if (answer.state) states.set(mod.manifest.id,answer.state);
        if (answer.message) message = answer.message;
        if (answer.card) {
          const processed = await process(save,ids,answer.card,{operationId,source:{kind:'mod',modId:mod.manifest.id,modName:mod.manifest.name},modStates:[...states].map(([id,state])=>({id,state}))});
          return {...processed,message:processed.message || message};
        }
      }
      // resolve 没有产出卡牌时，不提交试探状态；AI 成功后由 transform/afterCombine 更新。
      return null;
    },
    process,
    async action(save, modId, actionId) {
      const mod = save.mods?.find(m => m.enabled && m.manifest.id === modId);
      if (!mod || !mod.manifest.actions.some(a => a.id === actionId)) throw new DomainError('MOD_ACTION_MISSING');
      return call(mod,'action',context(save,[],null,mod.state,null),actionId);
    },
    dispose() { for (const cancel of [...active]) cancel(); },
  };
}
