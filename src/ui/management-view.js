import { CATEGORIES, DEFAULT_AI_CONFIG } from '../content/catalog.js';
import { listModAppearances, normalizeModName } from '../core/mods.js';
import { showUsageNotice } from './usage-notice.js';
import { DEFAULT_SYNTHESIS_PROMPT, SYNTHESIS_PROMPT_LIMIT, getSynthesisPrompt } from '../ai/prompt.js';

const SKINS = [['default','原色'],['sea','蔚海'],['hearth','灶火'],['starfire','星砂琉璃'],['firefly','萤火'],['dawn','破晓']];
const TABLES = [['paper','纸面'],['deep','深蓝星野'],['cosmos','星空']];
const BACKS = [['plain','素纸'],['rainbow','彩虹']];
const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
const button = (text, action, cls='') => { const b=el('button','wx-button '+cls,text); b.type='button'; if(action)b.addEventListener('click',action); return b; };
const setText = (node,text) => { if(node.textContent!==String(text))node.textContent=String(text); };

// 三代新增的管理能力沿用原管理面板；工厂和主界面的绘制/输入由二代原场景负责。
export function createManagementView(root, callbacks={}, {onModalChange=()=>{},onAddCard=()=>{}}={}) {
  let state={save:null,configStatus:{configured:false,...DEFAULT_AI_CONFIG},busy:false,error:''};
  let panel=null,apiOpen=false,apiInitialized=false,lastConfigured=false,localAccess=false,destroyed=false;
  let saveEpoch=0,newSlotName='',renameId=null,renameName='',restoreSelection=null,promptDraft=null;
  let recordQuery='',recordSource='',recordCategory='',recordPage=0,recordDiscovery='',modEnableId=null,modRemoveId=null;
  let toastTimer=null,panelBackdropDown=false;
  const configured=()=>!!state.configStatus?.configured;
  const canAccess=()=>!!state.save&&(configured()||localAccess||state.canRetrySave||state.pendingBlocked);
  const hasProgress=()=>!!state.save&&(state.save.stats.synthesisCount>0||state.save.recipes.length>0||state.save.cards.some(c=>!c.isBase));
  const invoke=(name,...args)=>{try{const task=callbacks[name]?.(...args);if(task?.catch)task.catch(()=>showMessage('操作未完成，请重试。'));return task;}catch{showMessage('操作未完成，请重试。');}};
  root.classList.add('wxgc3','wx-legacy-management');
  const shell=el('div','wx-shell wx-management-shell');
  const panelLayer=el('div','wx-panel-layer'),aside=el('section','wx-dialog');panelLayer.hidden=true;panelLayer.append(aside);
  // 原画布在按下时打开窗口；不能把同一手势随后的松手算作点背景关闭。
  panelLayer.addEventListener('pointerdown',event=>{panelBackdropDown=event.target===panelLayer;});
  panelLayer.addEventListener('pointercancel',()=>{panelBackdropDown=false;});
  panelLayer.addEventListener('click',event=>{const close=event.target===panelLayer&&panelBackdropDown;panelBackdropDown=false;if(close){panel=null;renderPanel();}});
  const modalLayer=el('div','wx-modal-layer');modalLayer.hidden=true;
  const toast=el('div','wx-toast');toast.hidden=true;toast.setAttribute('role','status');
  const status=el('div','wx-legacy-status'),errorText=el('span'),retry=button('重试保存',()=>invoke('onRetrySave'),'wx-small-button');
  status.setAttribute('role','alert');status.append(errorText,retry);status.hidden=true;
  shell.append(panelLayer,modalLayer,toast,status);root.replaceChildren(shell);
  const factory={addCard:id=>onAddCard(id)};
  function refreshCanvas(){onModalChange(!!panel||!modalLayer.hidden);}
  function syncHome(){refreshCanvas();}
  function updateSelection(){}
  function fit(){const r=root.getBoundingClientRect(),scale=Math.max(1,r.height)/540;shell.style.width=(r.width/scale)+'px';shell.style.height='540px';shell.style.transform='scale('+scale+')';}
  const resize=new ResizeObserver(fit);resize.observe(root);fit();
  function showMessage(text){setText(toast,text);toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.hidden=true,2800);}
  function dialogTitle(title){const heading=el('div','wx-dialog-heading');heading.append(el('h2','',title),button('✕',()=>{panel=null;renderPanel();},'wx-close'));return heading;}
  function preferenceSelect(label,key,options){
    const wrap=el('label','wx-field'),select=el('select','wx-select');wrap.append(el('span','wx-label',label));
    options.forEach(([value,text])=>{const option=el('option','',text);option.value=value;select.append(option);});
    select.value=state.save?.preferences?.[key]||options[0][0];select.disabled=!!state.busy;
    select.addEventListener('change',()=>invoke('onSavePreferences',{[key]:select.value}));wrap.append(select);return wrap;
  }
  function settings(){
    aside.append(dialogTitle('⚙️ 设置'),el('p','wx-subtle','无限工厂3'));
    const ai=el('section','wx-settings-section');ai.append(el('h3','','模型服务'),el('p','wx-subtle',configured()?state.configStatus?.model:'未配置模型，已知配方仍可合成。'),button(configured()?'修改 API 配置':'配置 API',()=>{apiOpen=true;renderApi();refreshCanvas();}));aside.append(ai);
    const appearances=(kind,base)=>[...base,...listModAppearances(state.save,kind).map(item=>[item.id,item.name])];
    const look=el('section','wx-settings-section');look.append(el('h3','','外观'),preferenceSelect('卡面','skinId',appearances('skins',SKINS)),preferenceSelect('台面','tabletopId',appearances('tabletops',TABLES)),preferenceSelect('卡背','cardBackId',appearances('cardBacks',BACKS)));aside.append(look);
    const feedback=el('section','wx-settings-section');feedback.append(el('h3','','操作与声音'));
    [['soundEnabled','合成与操作音效'],['musicEnabled','背景音乐'],['reduceMotion','减少动态效果']].forEach(([key,label])=>{const row=el('label','wx-check-row'),input=el('input');input.type='checkbox';input.checked=!!state.save?.preferences?.[key];input.disabled=!!state.busy;input.addEventListener('change',()=>invoke('onSavePreferences',{[key]:input.checked}));row.append(el('span','',label),input);feedback.append(row);});aside.append(feedback);
    appendSaveTools(aside);
    aside.append(button('使用须知',()=>showUsageNotice(root,null,{review:true})));
  }
  function appendSaveTools(container){
    const saves=el('section','wx-settings-section');saves.append(el('h3','','存档'),el('p','wx-subtle',state.library?'导出包含当前存档与 Mod 内容。导入会添加一份新存档。API Key 不随存档导出。':'导出存档可备份进度或换设备继续玩。API Key 不随存档导出。'));
    if(state.canRetrySave)saves.append(el('p','wx-subtle','这次合成还没有保存，导出只包含之前已保存的进度。请先回到台面重试保存。'));
    if(state.backupWarning)saves.append(el('p','wx-subtle','本机备份暂时无法更新，请导出存档另存一份。'));
    const actions=el('div','wx-action-row'),exportButton=button('导出存档',()=>invoke('onExport')),importButton=button('导入存档',()=>invoke('onImport'));
    const backupsButton=button('本机备份',()=>invoke('onListBackups'));backupsButton.disabled=!!state.busy||!!state.canRetrySave;
    exportButton.disabled=!!state.busy||!state.save;importButton.disabled=!!state.busy||!!state.canRetrySave;actions.append(exportButton,importButton,backupsButton);saves.append(actions);appendBackups(saves);container.append(saves);
    const fileMessage=['import','export'].includes(state.busy)
      ? (state.busy==='import'?'请在文件窗口选择存档并确认导入。':'请在文件窗口选择导出位置。')
      : state.fileFeedback?.message;
    if(fileMessage){const feedback=el('p','wx-file-feedback'+(state.fileFeedback?.kind==='error'?' wx-file-error':''),fileMessage);feedback.setAttribute('role',state.fileFeedback?.kind==='error'?'alert':'status');saves.append(feedback);}
  }
  function appendSlots(container,{compact=false}={}){
    const library=state.library;if(!library)return;
    const blocked=!!state.busy||!!state.canRetrySave;
    const list=el('div','wx-slot-list');
    for(const slot of library.slots){
      const active=slot.id===library.activeSlotId,entry=el('article','wx-slot'+(active?' wx-slot-active':''));entry.dataset.slotId=slot.id;
      const heading=el('div','wx-slot-heading');heading.append(el('strong','',slot.name));if(active)heading.append(el('span','wx-tag','当前存档'));entry.append(heading);
      entry.append(el('p','wx-subtle',slot.available?`${slot.cardCount} 张卡牌 · ${slot.recipeCount} 条配方 · ${slot.synthesisCount} 次合成 · ${slot.modCount} 个 Mod`:'这份存档暂时无法读取，可切换后恢复备份。'));
      if(slot.available&&slot.updatedAt)entry.append(el('p','wx-slot-time','最近保存 '+new Date(slot.updatedAt).toLocaleString('zh-CN')));
      const actions=el('div','wx-action-row');
      const enter=button(active?'正在游玩':slot.available?'继续游玩':'打开恢复',()=>invoke('onSwitchSlot',slot.id),active?'wx-button-quiet':'wx-button-primary');enter.disabled=blocked||active;actions.append(enter);
      if(!compact){
        if(renameId===slot.id){
          const form=el('form','wx-inline-form'),name=el('input','wx-input');name.value=renameName;name.maxLength=80;name.required=true;name.setAttribute('aria-label','新的存档名称');name.disabled=blocked;
          name.addEventListener('input',()=>{renameName=name.value;});const save=el('button','wx-button wx-small-button','保存名称');save.type='submit';save.disabled=blocked;
          const cancel=button('取消',()=>{renameId=null;renderPanel();},'wx-small-button');cancel.disabled=blocked;
          form.append(name,save,cancel);form.addEventListener('submit',event=>{event.preventDefault();if(!blocked)invoke('onRenameSlot',slot.id,name.value);});entry.append(form);
        }else{const rename=button('重命名',()=>{renameId=slot.id;renameName=slot.name;renderPanel();},'wx-small-button');rename.disabled=blocked;actions.append(rename);}
      }
      entry.append(actions);list.append(entry);
    }
    container.append(list);
  }
  function savesPanel(){
    aside.append(dialogTitle('💾 存档'),el('p','wx-subtle','每份存档都有自己的卡牌、配方、台面和 Mod。'));
    if(state.canRetrySave)aside.append(el('p','wx-api-error','这次合成还没有保存。请先回到台面重试保存，再切换存档。'));
    appendSlots(aside);
    if(state.library){
      const form=el('form','wx-slot-create wx-settings-section'),label=el('label','wx-field'),name=el('input','wx-input');name.value=newSlotName;name.placeholder='给新存档起个名字';name.required=true;name.maxLength=80;name.setAttribute('aria-label','新存档名称');name.disabled=!!state.busy||!!state.canRetrySave;name.addEventListener('input',()=>{newSlotName=name.value;});label.append(el('span','wx-label','新存档'),name);
      const create=el('button','wx-button wx-button-primary','创建存档');create.type='submit';create.disabled=!!state.busy||!!state.canRetrySave;form.append(label,el('p','wx-subtle','从金木水火土重新开始，已有存档会保留。'),create);form.addEventListener('submit',event=>{event.preventDefault();if(!create.disabled)invoke('onCreateSlot',name.value);});aside.append(form);
    }
    appendSaveTools(aside);
    if(state.error){const error=el('p','wx-api-error',state.error);error.setAttribute('role','alert');aside.append(error);}
  }
  function recordsPanel(kind){
    const history=kind==='history';aside.append(dialogTitle(history?'📜 合成历史':'📋 配方表'));
    aside.append(el('p','wx-subtle',history?'这里记录本存档每一次已保存的合成。':'查找已经发现的配方，点材料可放回台面。'));
    const controls=el('div','wx-record-controls'),query=el('input','wx-input'),source=el('select','wx-select'),categorySelect=el('select','wx-select'),discovery=el('select','wx-select');
    query.type='search';query.placeholder='搜索材料或结果';query.value=recordQuery;query.setAttribute('aria-label','搜索材料或结果');
    for(const [value,label] of [['','全部来源'],['ai','模型生成'],['recipe','已知配方'],['mod','Mod'],['unknown','来源未知']]){const option=el('option','',label);option.value=value;source.append(option);}source.value=recordSource;source.setAttribute('aria-label','按来源筛选');
    for(const value of ['',...CATEGORIES]){const option=el('option','',value||'全部分类');option.value=value;categorySelect.append(option);}categorySelect.value=recordCategory;categorySelect.setAttribute('aria-label','按结果分类筛选');
    controls.append(query,source,categorySelect);aside.append(controls);
    if(!history){for(const [value,label]of[['','全部配方'],['discovered','已发现'],['preset','Mod 预设']]){const option=el('option','',label);option.value=value;discovery.append(option);}discovery.value=recordDiscovery;discovery.setAttribute('aria-label','按发现状态筛选');controls.append(discovery);}
    const results=el('div','wx-record-results');aside.append(results);
    const cards=new Map((state.save?.cards||[]).map(card=>[card.id,card]));
    const recipes=new Map((state.save?.recipes||[]).map(recipe=>[recipe.key,recipe]));
    const sourceName={ai:'模型生成',recipe:'已知配方',mod:'Mod',unknown:'来源未知'},cardsByName=new Map([...cards.values()].map(card=>[normalizeModName(card.name),card]));
    const firstSource=new Map();for(const operation of state.save?.operations||[])if(!firstSource.has(operation.recipeKey))firstSource.set(operation.recipeKey,operation.source||{kind:'unknown'});
    const entries=history?(state.save?.operations||[]).toReversed().map(operation=>{
      let fingerprint={};try{fingerprint=JSON.parse(operation.fingerprint);}catch{}
      const recipe=recipes.get(operation.recipeKey);
      return {id:operation.id,ingredientIds:fingerprint.ingredientIds||recipe?.ingredientIds||[],resultId:operation.resultId,at:operation.completedAt,source:operation.source||{kind:'unknown'}};
    }):(state.save?.recipes||[]).toReversed().map(recipe=>({...recipe,id:recipe.key,at:recipe.createdAt,source:firstSource.get(recipe.key)||{kind:'unknown'},discovery:'discovered'}));
    if(!history)for(const mod of state.save?.mods||[]){
      if(!mod.enabled)continue;
      for(const [index,recipe]of mod.manifest.recipes.entries()){
        const ingredientIds=recipe.ingredients.map(name=>cardsByName.get(normalizeModName(name))?.id||null),result=cardsByName.get(normalizeModName(recipe.result)),definition=mod.manifest.cards.find(card=>normalizeModName(card.name)===normalizeModName(recipe.result))||result;
        entries.push({id:`${mod.manifest.id}:${index}`,ingredientIds,ingredientNames:recipe.ingredients,resultId:result?.id,resultName:recipe.result,resultCategory:definition?.category,at:null,source:{kind:'mod',modId:mod.manifest.id,modName:mod.manifest.name},discovery:'preset'});
      }
    }
    function putCard(id){if((state.busy&&!['combine','save','cancel'].includes(state.busy))||state.canRetrySave||state.pendingBlocked||!canAccess()||!cards.has(id))return;panel=null;renderPanel();factory.addCard(id);}
    function cardButton(id,name){const card=cards.get(id),b=button(card?`${card.emoji} ${card.name}`:name||'未知卡牌',()=>putCard(id),'wx-record-card');b.disabled=!card||(!!state.busy&&!['combine','save','cancel'].includes(state.busy))||!!state.canRetrySave||!!state.pendingBlocked;b.setAttribute('aria-label',card?`${card.name}，放回台面`:(name||'未知卡牌')+'，尚未发现');return b;}
    function drawRows(){
      results.replaceChildren();const search=recordQuery.normalize('NFKC').trim().toLocaleLowerCase();
      const filtered=entries.filter(entry=>{const card=cards.get(entry.resultId),names=[...(entry.ingredientNames||entry.ingredientIds.map(id=>cards.get(id)?.name||'')),entry.resultName||card?.name||''];return(!recordSource||entry.source.kind===recordSource)&&(!recordCategory||(card?.category||entry.resultCategory)===recordCategory)&&(history||!recordDiscovery||entry.discovery===recordDiscovery)&&(!search||names.some(name=>name.normalize('NFKC').toLocaleLowerCase().includes(search)));});
      const pageCount=Math.max(1,Math.ceil(filtered.length/30));recordPage=Math.min(recordPage,pageCount-1);results.append(el('p','wx-subtle',`共 ${filtered.length} ${history?'次合成':'条配方'}`));
      if(!filtered.length)results.append(el('p','wx-empty',entries.length?'没有符合条件的记录。':history?'还没有合成记录，先试着把两张卡叠在一起。':'还没有发现配方，先从五种本源开始探索。'));
      for(const entry of filtered.slice(recordPage*30,recordPage*30+30)){
        const row=el('article','wx-record-row'),formula=el('div','wx-record-formula');
        entry.ingredientIds.forEach((id,index)=>{if(index)formula.append(el('span','wx-record-symbol','＋'));formula.append(cardButton(id,entry.ingredientNames?.[index]));});formula.append(el('span','wx-record-symbol','→'),cardButton(entry.resultId,entry.resultName));
        const meta=el('div','wx-record-meta');meta.append(el('span','wx-tag',(entry.discovery==='preset'?'Mod 预设':entry.discovery==='discovered'?'已发现 · ':'')+(entry.discovery==='preset'?'':sourceName[entry.source.kind]||'来源未知')+(entry.source.modName?' · '+entry.source.modName:'')),el('time','',entry.at?new Date(entry.at).toLocaleString('zh-CN'):''));row.append(formula,meta);results.append(row);
      }
      if(pageCount>1){const pager=el('div','wx-pagination'),previous=button('‹ 上一页',()=>{recordPage--;drawRows();},'wx-small-button'),next=button('下一页 ›',()=>{recordPage++;drawRows();},'wx-small-button');previous.disabled=recordPage===0;next.disabled=recordPage===pageCount-1;pager.append(previous,el('span','',`${recordPage+1} / ${pageCount}`),next);results.append(pager);}
    }
    query.addEventListener('input',()=>{recordQuery=query.value;recordPage=0;drawRows();});source.addEventListener('change',()=>{recordSource=source.value;recordPage=0;drawRows();});categorySelect.addEventListener('change',()=>{recordCategory=categorySelect.value;recordPage=0;drawRows();});discovery.addEventListener('change',()=>{recordDiscovery=discovery.value;recordPage=0;drawRows();});drawRows();
  }
  function modsPanel(){
    aside.append(dialogTitle('🧩 Mod'),el('p','wx-subtle','Mod 随当前存档保存，可添加卡牌、配方、玩法与外观。'));
    const blocked=!!state.busy||!!state.canRetrySave||!!state.pendingBlocked,importButton=button('导入 Mod 文件',()=>invoke('onChooseMod'),'wx-button-primary');importButton.disabled=blocked;aside.append(importButton);
    if(state.canRetrySave)aside.append(el('p','wx-api-error','请先保存这次合成结果，再修改 Mod。'));
    if(state.modCandidate){
      const manifest=state.modCandidate,preview=el('section','wx-mod-preview wx-settings-section'),exists=state.save?.mods?.some(mod=>mod.manifest.id===manifest.id);
      preview.append(el('h3','',`${manifest.name} · ${manifest.version}`),el('p','wx-subtle',manifest.description||'没有填写介绍。'),el('p','wx-subtle',`${manifest.cards.length} 个卡牌定义 · ${manifest.recipes.length} 条预设配方 · ${manifest.actions.length} 个玩法按钮`));
      if(manifest.script)preview.append(el('p','wx-api-error','含玩法脚本，安装后默认停用。启用前请确认你信任这个 Mod 的来源。'));
      if(exists)preview.append(el('p','wx-subtle','已有相同 ID 的 Mod。替换会使用这份文件的内容。'));
      const install=button(exists?'替换这个 Mod':'安装 Mod',()=>invoke('onInstallMod',!!exists),'wx-button-primary'),cancel=button('取消导入',()=>invoke('onCancelModImport'),'wx-button-quiet');install.disabled=cancel.disabled=blocked;preview.append(install,cancel);aside.append(preview);
    }
    const list=state.save?.mods||[];if(!list.length)aside.append(el('p','wx-empty','这份存档还没有安装 Mod。'));
    for(const mod of list){
      const {manifest}=mod,entry=el('article','wx-slot wx-mod-entry'),heading=el('div','wx-slot-heading');heading.append(el('strong','',manifest.name),el('span','wx-tag',mod.enabled?'已启用':'已停用'));entry.append(heading,el('p','wx-subtle',`${manifest.version} · ${manifest.description||'没有填写介绍。'}`));
      const parts=[];if(manifest.recipes.length)parts.push(manifest.recipes.length+' 条配方');if(manifest.script)parts.push('玩法脚本');if(manifest.tabletops.length)parts.push('台面');if(manifest.skins.length||manifest.cardBacks.length)parts.push('卡牌外观');if(Object.keys(manifest.sounds).length)parts.push('音效');entry.append(el('p','wx-slot-time',parts.join(' · ')||'卡牌内容'));
      const actions=el('div','wx-action-row'),toggle=button(mod.enabled?'停用':'启用',()=>{if(!mod.enabled&&manifest.script){modEnableId=manifest.id;renderPanel();}else invoke('onToggleMod',manifest.id,!mod.enabled);},mod.enabled?'wx-small-button':'wx-button-primary'),remove=button('移除',()=>{modRemoveId=manifest.id;renderPanel();},'wx-small-button');toggle.disabled=remove.disabled=blocked;actions.append(toggle,remove);entry.append(actions);
      if(modEnableId===manifest.id&&!mod.enabled){entry.append(el('p','wx-api-error','这个 Mod 会运行作者提供的脚本，并影响这份存档。请只启用你信任的来源。'));const confirm=button('启用脚本 Mod',()=>{modEnableId=null;invoke('onToggleMod',manifest.id,true);},'wx-button-primary'),cancel=button('取消',()=>{modEnableId=null;renderPanel();},'wx-button-quiet');confirm.disabled=cancel.disabled=blocked;entry.append(confirm,cancel);}
      if(modRemoveId===manifest.id){entry.append(el('p','wx-subtle','移除后会停用它的玩法与外观，已经发现的卡牌和配方会保留。'));const confirm=button('确认移除',()=>{modRemoveId=null;invoke('onRemoveMod',manifest.id);}),cancel=button('取消',()=>{modRemoveId=null;renderPanel();},'wx-button-quiet');confirm.disabled=cancel.disabled=blocked;entry.append(confirm,cancel);}
      if(mod.enabled&&manifest.actions.length){const gameplay=el('section','wx-settings-section');gameplay.append(el('h3','','玩法'));for(const action of manifest.actions){const b=button(action.name,()=>invoke('onModAction',manifest.id,action.id));b.disabled=blocked;gameplay.append(b);if(action.description)gameplay.append(el('p','wx-subtle',action.description));}entry.append(gameplay);}
      aside.append(entry);
    }
    if(state.modFeedback){const feedback=el('p','wx-file-feedback'+(state.modFeedback.kind==='error'?' wx-file-error':''),state.modFeedback.message);feedback.setAttribute('role',state.modFeedback.kind==='error'?'alert':'status');aside.append(feedback);}else if(state.error)aside.append(el('p','wx-api-error',state.error));
  }
  function appendBackups(container){
    if(!Array.isArray(state.backups))return;
    const list=el('section','wx-settings-section wx-backups');list.append(el('h3','','本机备份'));
    if(!state.backups.length)list.append(el('p','wx-subtle','还没有可用的本机备份，可以导入之前导出的存档。'));
    for(const backup of state.backups){
      const entry=el('div','wx-settings-section'),date=new Date(backup.createdAt).toLocaleString('zh-CN');
      entry.append(el('p','',`${date} · ${backup.cardCount} 张卡牌 · ${backup.recipeCount} 条配方`));
      if(restoreSelection===backup.id){
        entry.append(el('p','wx-subtle','恢复后将使用这份备份的进度。当前可读进度会先另存为本机备份。'));
        const confirm=button('确认恢复',()=>invoke('onRestoreBackup',backup.id),'wx-button-primary'),cancel=button('取消',()=>{restoreSelection=null;renderApi();if(panel)renderPanel();});
        confirm.disabled=cancel.disabled=!!state.busy;entry.append(confirm,cancel);
      }else{const select=button('恢复这份备份',()=>{restoreSelection=backup.id;renderApi();if(panel)renderPanel();});select.disabled=!!state.busy||!!state.canRetrySave;entry.append(select);}
      list.append(entry);
    }
    container.append(list);
  }
  function promptPanel(){
    const identity=`${state.save?.id}:${state.saveEpoch||0}`;
    if(!promptDraft||promptDraft.identity!==identity){
      promptDraft={identity,text:getSynthesisPrompt(state.save?.preferences.synthesisPrompt),saving:false,message:''};aside.replaceChildren();
    }
    const draft=promptDraft;
    // 保存响应等状态刷新不能重建文本框，否则会丢失选区、滚动位置和未保存的编辑。
    if(!aside.querySelector('.wx-prompt-editor')){
      aside.append(dialogTitle('合成提示词'),el('p','wx-subtle','保存到当前存档，用于之后的未知配方。已有配方保留原结果。'));
      const editor=el('textarea','wx-prompt-editor');editor.setAttribute('aria-label','合成提示词');editor.spellcheck=false;editor.maxLength=SYNTHESIS_PROMPT_LIMIT;editor.value=draft.text;
      const meta=el('div','wx-prompt-meta'),feedback=el('span','wx-prompt-feedback'),count=el('span','wx-prompt-count');feedback.setAttribute('role','status');meta.append(feedback,count);
      const actions=el('div','wx-action-row wx-prompt-actions');
      const reset=button('恢复默认',()=>{draft.text=DEFAULT_SYNTHESIS_PROMPT;draft.message='已恢复默认内容，保存后生效。';editor.value=draft.text;promptPanel();},'wx-prompt-reset');
      const saveButton=button('保存提示词',async()=>{
        if(draft.saving||state.busy||state.canRetrySave||state.pendingBlocked||!draft.text.trim())return;
        const text=draft.text,stored=text===DEFAULT_SYNTHESIS_PROMPT?'':text;
        draft.saving=true;draft.message='正在保存…';promptPanel();
        try{
          await invoke('onSavePreferences',{synthesisPrompt:stored});
          if(destroyed||promptDraft!==draft||`${state.save?.id}:${state.saveEpoch||0}`!==identity)return;
          // 控制器会吞掉存储异常并显示错误；必须看到实际保存响应才能提示成功。
          draft.message=(state.save?.preferences.synthesisPrompt??'')===stored?'已保存。':'没有保存成功，请重试。';
        }catch{draft.message='没有保存成功，请重试。';}
        finally{draft.saving=false;if(!destroyed&&promptDraft===draft&&panel==='prompt')promptPanel();}
      },'wx-button-primary wx-prompt-save');
      editor.addEventListener('input',()=>{draft.text=editor.value;draft.message='';promptPanel();});
      actions.append(reset,saveButton);aside.append(editor,meta,actions,el('p','wx-prompt-format','材料会自动附上，游戏会要求模型按卡牌格式返回结果。'));
    }
    const editor=aside.querySelector('.wx-prompt-editor'),saveButton=aside.querySelector('.wx-prompt-save'),reset=aside.querySelector('.wx-prompt-reset');
    const changed=draft.text!==getSynthesisPrompt(state.save?.preferences.synthesisPrompt);
    editor.disabled=reset.disabled=draft.saving;
    saveButton.disabled=draft.saving||!!state.busy||!!state.canRetrySave||!!state.pendingBlocked||!changed||!draft.text.trim()||draft.text.length>SYNTHESIS_PROMPT_LIMIT;
    setText(saveButton,draft.saving?'正在保存…':'保存提示词');setText(aside.querySelector('.wx-prompt-count'),`${draft.text.length} / ${SYNTHESIS_PROMPT_LIMIT}`);
    setText(aside.querySelector('.wx-prompt-feedback'),draft.message||(changed?'尚未保存':'当前使用的提示词'));
  }
  function renderPanel(){
    if(panel!=='prompt'||!aside.classList.contains('wx-prompt-dialog'))aside.replaceChildren();
    panelLayer.hidden=!panel;
    aside.classList.toggle('wx-management-dialog',['saves','mods','history','recipes'].includes(panel));
    aside.classList.toggle('wx-prompt-dialog',panel==='prompt');
    if(panel==='settings')settings();else if(panel==='saves')savesPanel();else if(panel==='history'||panel==='recipes')recordsPanel(panel);else if(panel==='mods')modsPanel();else if(panel==='prompt')promptPanel();
    panelLayer.hidden=!panel;renderApi();refreshCanvas();
  }
  const form=el('form','wx-api-dialog');form.setAttribute('role','dialog');form.setAttribute('aria-modal','true');form.setAttribute('aria-labelledby','wx-api-title');
  const closeApi=button('✕',()=>{if(!canAccess()||state.busy==='configure')return;apiOpen=false;key.value='';renderApi();refreshCanvas();},'wx-api-close wx-close');
  const apiTitle=el('h2','','无限工厂3');apiTitle.id='wx-api-title';
  const apiIntro=el('p','wx-subtle','填入你的 API Key，从金木水火土开始合成。');
  const keyLabel=el('label','wx-field'),key=el('input','wx-input');key.type='password';key.autocomplete='off';key.spellcheck=false;key.name='api-key';key.required=true;keyLabel.append(el('span','wx-label','API Key'),key);
  const advanced=el('details','wx-api-advanced');advanced.append(el('summary','','服务地址与模型'));
  const addressLabel=el('label','wx-field'),address=el('input','wx-input');address.type='url';address.required=true;address.spellcheck=false;address.autocomplete='off';addressLabel.append(el('span','wx-label','服务地址'),address);
  const modelLabel=el('label','wx-field'),model=el('input','wx-input');model.required=true;model.spellcheck=false;model.autocomplete='off';modelLabel.append(el('span','wx-label','模型'),model);advanced.append(addressLabel,modelLabel);
  const apiError=el('p','wx-api-error');apiError.setAttribute('role','alert');apiError.hidden=true;
  const apiCost=el('p','wx-api-cost','检测和新配方会调用你选择的服务，可能产生费用。');
  const submit=el('button','wx-button wx-button-primary wx-api-submit','检测并开始');submit.type='submit';
  const localButton=button('先查看本地卡牌',()=>{
    if(!hasProgress()||state.busy)return;
    localAccess=true;apiOpen=false;key.value='';renderApi();updateSelection();refreshCanvas();

  },'wx-local-access wx-button-quiet');
  const manageSlotsButton=button('管理存档',()=>{apiOpen=false;panel='saves';renderPanel();invoke('onRefreshLibrary');},'wx-local-access wx-button-quiet');
  const recoveryPanel=el('section','wx-api-dialog wx-recovery-dialog');recoveryPanel.setAttribute('role','dialog');recoveryPanel.setAttribute('aria-modal','true');recoveryPanel.setAttribute('aria-label','恢复存档');recoveryPanel.hidden=true;
  form.append(closeApi,el('div','wx-api-mark','✦'),apiTitle,apiIntro,keyLabel,advanced,apiError,apiCost,submit,localButton,manageSlotsButton);modalLayer.append(form,recoveryPanel);
  form.addEventListener('submit',event=>{event.preventDefault();if(state.busy||!state.save)return;const task=invoke('onConfigure',{baseUrl:address.value.trim(),model:model.value.trim(),key:key.value.trim()});
    Promise.resolve(task).then(()=>{if(!destroyed&&configured()&&!state.error){apiOpen=false;key.value='';renderApi();refreshCanvas();}}).catch(()=>{});});
  function renderApi(){paintApi();syncHome();}
  function paintApi(){
    if(panel==='saves'&&state.library){modalLayer.hidden=true;key.value='';apiInitialized=false;return;}
    manageSlotsButton.hidden=!state.library;manageSlotsButton.disabled=!!state.busy||!!state.canRetrySave;
    const recover=!!state.recoveryRequired&&!state.save;recoveryPanel.hidden=!recover;form.hidden=recover;
    if(recover){
      modalLayer.hidden=false;key.value='';apiInitialized=false;recoveryPanel.replaceChildren(el('h2','','恢复存档'));
      const message=el('p','wx-api-error',state.error||'本地存档无法读取，请选择一份备份恢复。');message.setAttribute('role','alert');recoveryPanel.append(message);
      const actions=el('div','wx-action-row'),importButton=button('导入存档',()=>invoke('onImport'),'wx-button-primary'),backupsButton=button('查看本机备份',()=>invoke('onListBackups'));
      importButton.disabled=backupsButton.disabled=!!state.busy;actions.append(importButton,backupsButton);recoveryPanel.append(actions);appendBackups(recoveryPanel);
      if(state.library){recoveryPanel.append(el('h3','','其他存档'));appendSlots(recoveryPanel,{compact:true});const manage=button('管理存档',()=>{panel='saves';renderPanel();},'wx-button-quiet');manage.disabled=!!state.busy;recoveryPanel.append(manage);}
      if(state.fileFeedback?.message)recoveryPanel.append(el('p','wx-file-feedback',state.fileFeedback.message));
      if(state.busy)recoveryPanel.append(el('p','wx-subtle',state.busy==='import'?'请选择存档并确认导入。':state.busy==='restore'?'正在恢复存档…':'正在读取备份…'));
      return;
    }
    const visible=!canAccess()||apiOpen;modalLayer.hidden=!visible;
    if(!visible){key.value='';apiInitialized=false;return;}
    if(!apiInitialized){address.value=state.configStatus?.baseUrl||DEFAULT_AI_CONFIG.baseUrl;model.value=state.configStatus?.model||DEFAULT_AI_CONFIG.model;apiInitialized=true;queueMicrotask(()=>{if(!destroyed)(key.disabled?submit:key).focus();});}
    const loading=state.busy==='configure';key.disabled=loading;key.required=!configured();
    key.placeholder=configured()?'留空继续使用已保存的 Key':'输入 API Key';
    address.disabled=model.disabled=submit.disabled=loading;closeApi.hidden=!canAccess();closeApi.disabled=loading;
    localButton.hidden=canAccess()||!hasProgress();localButton.disabled=!!state.busy;
    setText(submit,loading?'正在检测…':configured()?'检测并保存':'检测并开始');
    setText(apiIntro,hasProgress()?'配置模型服务后，就能继续探索新配方。':'填入你的 API Key，从金木水火土开始合成。');apiError.hidden=!state.error;setText(apiError,state.error||'');
  }
  const keydown=event=>{
    if(event.key==='Escape'){
      if(apiOpen&&canAccess()&&state.busy!=='configure'){apiOpen=false;renderApi();}
      else if(panel){panel=null;renderPanel();}
    }
    if(event.key==='Tab'&&!modalLayer.hidden){
      const focusable=[...(recoveryPanel.hidden?form:recoveryPanel).querySelectorAll('input,button,summary')].filter(n=>!n.disabled&&!n.hidden&&n.getClientRects().length);
      if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  };
  document.addEventListener('keydown',keydown);
  return {
    open(name){
      if(name==='api'){apiOpen=true;renderApi();return;}
      if(name==='appearance')name='settings';
      if(name==='notice'){showUsageNotice(root,null,{review:true});return;}
      if(['settings','saves','mods','history','recipes','prompt'].includes(name)){panel=name;renderPanel();if(name==='saves')invoke('onRefreshLibrary');}
    },
    isModalOpen(){return !!panel||!modalLayer.hidden||!!root.querySelector('dialog[open]');},
    canAccess,
    render(next){
      if(destroyed)return;state={...state,...next,configStatus:{...state.configStatus,...next.configStatus}};
      if(saveEpoch!==(state.saveEpoch||0)){saveEpoch=state.saveEpoch||0;renameId=null;newSlotName='';restoreSelection=null;localAccess=false;recordPage=0;modEnableId=null;modRemoveId=null;}
      if(configured()&&!lastConfigured){apiOpen=false;key.value='';}lastConfigured=configured();
      renderApi();if(panel)renderPanel();
      setText(errorText,state.error||(state.canRetrySave?'结果还没有保存，请重试保存。':''));
      retry.hidden=!state.canRetrySave;
      status.hidden=(!state.error&&!state.canRetrySave)||!modalLayer.hidden||!!panel;
      refreshCanvas();
    },
    clearApiKey(){key.value='';},
    showMessage,
    destroy(){destroyed=true;clearTimeout(toastTimer);resize.disconnect();document.removeEventListener('keydown',keydown);key.value='';root.replaceChildren();}
  };
}
