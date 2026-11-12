import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createLibrary} from '../platforms/windows/library.mjs';
import {createNativePlatform} from '../src/platform/native.js';
import {createController} from '../src/controller.js';

const ROOT=process.env.WXGC3_TEST_DIR||path.join(tmpdir(), 'wxgc3-frontend-native-tests');
fs.mkdirSync(ROOT,{recursive:true});
const MOD={modFormat:1,id:'integration',name:'整合工坊',version:'1',cards:[{name:'工具',emoji:'🛠️',category:'科技',description:'让双手更有办法。'}],recipes:[{ingredients:['木','金'],result:'工具'}]};

test('真实SQLite库接正式bridge与controller：首次空槽初始化、Mod合成、切档与整档分享导入',async t=>{
  const dataDir=fs.mkdtempSync(path.join(ROOT,'case-'));let requests=0,input=JSON.stringify(MOD),exported=null,sequence=0,confirmation=null;
  const library=createLibrary({dataDir,encrypt:text=>Buffer.from(text),decrypt:bytes=>Buffer.from(bytes).toString('utf8'),fetchImpl:async()=>{requests++;throw Error('不应访问网络');}});t.after(()=>library.close());
  const target={wxgcNative:{async invoke(command,args){
    if(command!=='library_status')library.assertSlot(args.slotId);
    switch(command){
      case 'library_status':return library.status();case 'load_save':return library.load(args.slotId);case 'initialize_save':return library.initialize(args.save,args.slotId);
      case 'config_status':return library.configStatus(args.slotId);case 'load_pending':return library.loadPending(args.slotId);case 'recovery_status':return library.recoveryStatus(args.slotId);
      case 'save_snapshot':return library.save(args.save,args.expectedRevision,args.slotId);case 'stage_mod_result':return library.stageModResult(args);case 'update_pending':return library.updatePending(args);
      case 'create_slot':return library.createSlot(args);case 'switch_slot':return library.switchSlot(args);case 'rename_slot':return library.renameSlot(args);case 'import_as_slot':return library.importAsSlot(args);
      case 'choose_mod_file':case 'choose_import_file':return input;case 'confirm_import':confirmation=args;return true;
      case 'export_save_file':exported=library.exportJSON(args.slotId);return true;case 'generate_card':return library.generate(args);
      default:assert.fail('未覆盖原生命令 '+command);
    }
  }}};
  const platform=createNativePlatform(target),controller=createController(platform,()=>{},{uuid:()=>`integration:${++sequence}`,confirmImport:save=>platform.confirmImport(save)});
  await controller.start();assert.equal(controller.state.error,'');assert.equal(controller.state.save.cards.length,5);assert.equal(controller.state.library.activeSlotId,'legacy');assert.equal(controller.state.library.slots[0].cardCount,5);
  await controller.callbacks.onChooseMod();await controller.callbacks.onInstallMod();await controller.callbacks.onToggleMod('integration',true);assert.equal(controller.state.save.mods[0].enabled,true);
  await controller.callbacks.onCombine(['base:wood','base:metal']);assert.equal(controller.state.error,'');assert.equal(controller.state.save.stats.synthesisCount,1);assert.equal(controller.state.save.operations[0].source.kind,'mod');assert.equal(library.loadPending('legacy'),null);assert.equal(requests,0);
  const originalId=controller.state.save.id;await controller.callbacks.onCreateSlot('新世界');assert.equal(controller.state.save.cards.length,5);assert.equal(controller.state.save.mods.length,0);assert.notEqual(controller.state.library.activeSlotId,'legacy');
  await controller.callbacks.onSwitchSlot('legacy');assert.equal(controller.state.save.stats.synthesisCount,1);assert.equal(controller.state.save.mods[0].manifest.name,'整合工坊');
  await controller.callbacks.onExport();input=exported;await controller.callbacks.onImport();assert.equal(controller.state.error,'');assert.notEqual(controller.state.save.id,originalId);assert.equal(controller.state.library.slots.length,3);assert.equal(controller.state.save.mods.length,1);assert.equal(controller.state.save.stats.synthesisCount,1);assert.equal(confirmation.modCount,1);assert.equal(confirmation.enabledScriptCount,0);assert.equal(requests,0);
});
