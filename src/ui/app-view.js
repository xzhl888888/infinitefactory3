import { CATEGORIES, DEFAULT_AI_CONFIG } from '../content/catalog.js';
import { createFactoryCanvas } from './canvas.js';
import { createCardPainter } from './card-art.js';
import { findRecipe } from '../core/model.js';
import { listModAppearances, normalizeModName } from '../core/mods.js';
import { createModImages } from '../mods/media.js';
import { showUsageNotice } from './usage-notice.js';
import { createHome } from './home.js';
import { DEFAULT_SYNTHESIS_PROMPT, SYNTHESIS_PROMPT_LIMIT, getSynthesisPrompt } from '../ai/prompt.js';

const SKINS = [['default','原色'],['sea','蔚海'],['hearth','灶火'],['starfire','星砂琉璃'],['firefly','萤火'],['dawn','破晓']];
const TABLES = [['paper','纸面'],['deep','深蓝星野'],['cosmos','星空']];
const BACKS = [['plain','素纸'],['rainbow','彩虹']];
const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
const button = (text, action, cls='') => { const b=el('button','wx-button '+cls,text); b.type='button'; if(action)b.addEventListener('click',action); return b; };
const setText = (node,text) => { if(node.textContent!==String(text))node.textContent=String(text); };

export function createAppView(root, callbacks = {}) {
  let state={save:null,configStatus:{configured:false,...DEFAULT_AI_CONFIG},busy:false,error:'',lastResult:null,mode:'native'};
  let selected=[],panel=null,detailId=null,share=false,filter='',category='',lengthFilter=0,onlyFavorites=false,page=0;
  let dictOpen=true,favOpen=false,dockOpen=false,menuOpen=false,apiOpen=false,apiInitialized=false,lastConfigured=false,localAccess=false;
  let toastTimer=null,destroyed=false,layoutReady=false,uiScale=1,logicalWidth=960,dictWidth=326,listSignature='',favoritesSignature='';
  let factory=null,presentationBusy=false,pendingSlots=null,revealedId=null,saveEpoch=0,restoreSelection=null;
  let newSlotName='',renameId=null,renameName='',recordQuery='',recordSource='',recordCategory='',recordPage=0,recordDiscovery='',modEnableId=null,modRemoveId=null;
  let paintedMods=null;
  let homeActive=true, discoveries=0;
  let promptDraft=null;
  // 一个视图共用媒体缓存；详情重绘不能反复创建Image并触发下一轮onload。
  const modImages=createModImages(()=>{if(destroyed)return;paintTiles();if(panel==='detail')renderPanel();});
  const dispose=[];
  const cardById=id=>state.save?.cards.find(c=>c.id===id);
  const configured=()=>!!state.configStatus?.configured;
  const canAccess=()=>!!state.save&&(configured()||localAccess||state.canRetrySave||state.pendingBlocked);
  const selectionLocked=()=>!!state.busy||presentationBusy||!!state.canRetrySave||!!state.pendingBlocked;
  // 请求及待存只占用本次材料；管理操作、损坏档与弹层仍阻止台面改动。
  const boardLocked=()=>homeActive||!canAccess()||!!state.pendingBlocked||!!state.recoveryRequired||apiOpen||!!panel||!modalLayer.hidden||(!!state.busy&&!['combine','save','cancel'].includes(state.busy));
  const hasProgress=()=>!!state.save&&(state.save.stats.synthesisCount>0||state.save.recipes.length>0||state.save.cards.some(card=>!card.isBase));
  const invoke=(name,...args)=>{try{const result=callbacks[name]?.(...args);if(result&&typeof result.catch==='function')result.catch(()=>showMessage('操作未完成，请重试。'));return result;}catch{showMessage('操作未完成，请重试。');}};
  root.classList.add('wxgc3');
  const shell=el('div','wx-shell'),board=el('main','wx-board'),canvas=el('canvas','wx-canvas');
  canvas.setAttribute('aria-label','合成工作台：拖叠两张卡合成，点卡查看详情');canvas.tabIndex=0;
  const help=el('div','wx-board-help','拖叠两张卡合成 · 点卡查看详情');
  const controls=el('div','wx-board-controls');
  const tidy=button('🧽 整理画布',()=>factory.arrange());
  const zoomControls=el('div','wx-zoom-controls');
  zoomControls.append(button('−',()=>factory.zoomBy(.88),'wx-icon-button'),button('＋',()=>factory.zoomBy(1.12),'wx-icon-button'));
  controls.append(tidy,zoomControls);
  const hud=el('div','wx-hud'),stats=el('div','wx-stats');
  const more=button('☰ 更多',()=>{menuOpen=!menuOpen;renderMenu();},'wx-more');
  hud.append(stats,more);
  const menu=el('nav','wx-menu');menu.setAttribute('aria-label','更多');menu.hidden=true;
  const launch=button('🔧 多卡合成台',()=>{dockOpen=!dockOpen;updateSelection();},'wx-combine-launch wx-button-primary');
  const dock=el('section','wx-dock'),tray=el('div','wx-materials'),combine=button('放入材料',combineSelected,'wx-button-primary');
  const collapse=button('收起 ▾',()=>{dockOpen=false;updateSelection();},'wx-collapse');
  const dockTitle=el('div','wx-dock-title','🔧 多卡合成台 · 点卡放入材料（最多 4 张）');
  const row=el('div','wx-dock-row'),resultSlot=el('span','wx-result-slot','？？');
  tray.setAttribute('aria-label','已选材料');row.append(tray,el('span','wx-equals','='),resultSlot,combine);dock.append(dockTitle,collapse,row);dock.hidden=true;
  const progress=el('div','wx-progress'),progressText=el('span'),cancel=button('取消等待',()=>invoke('onCancel'),'wx-button-quiet');
  progress.append(el('span','wx-spinner'),progressText,cancel);progress.hidden=true;
  const status=el('div','wx-status'),errorText=el('span'),retry=button('重试保存',()=>invoke('onRetrySave'),'wx-small-button');
  status.setAttribute('role','alert');status.append(errorText,retry);status.hidden=true;
  const resultStatus=el('div','wx-result-status wx-visually-hidden');resultStatus.setAttribute('role','status');resultStatus.setAttribute('aria-atomic','true');
  const dictionary=el('aside','wx-dictionary');dictionary.setAttribute('aria-label','我的词典');
  const dictToggle=button('📖\n›',()=>{dictOpen=!dictOpen;fitLayout();},'wx-dict-toggle');
  const favoritePanel=el('div','wx-favorite-panel'),favoriteDrawer=el('aside','wx-favorite-drawer');favoriteDrawer.inert=true;favoriteDrawer.setAttribute('aria-hidden','true');
  const favoriteToggle=button('',()=>{favOpen=!favOpen;renderFavorites();fitLayout();},'wx-favorite-toggle');
  // 与纸面标签一致逐字居中，避免竖排换行被浏览器排成两列、挤出边框。
  favoriteToggle.append(el('span','wx-favorite-tab-star','★'),el('span','','收'),el('span','','藏'));
  favoriteToggle.setAttribute('aria-label','展开收藏');favoriteDrawer.setAttribute('aria-label','收藏卡牌');
  const panelLayer=el('div','wx-panel-layer'),aside=el('section','wx-dialog');panelLayer.hidden=true;
  panelLayer.append(aside);panelLayer.addEventListener('click',event=>{if(event.target===panelLayer){panel=null;renderPanel();}});
  const modalLayer=el('div','wx-modal-layer');modalLayer.hidden=true;
  const toast=el('div','wx-toast');toast.hidden=true;toast.setAttribute('role','status');
  // 抽屉与标签共用位移，收起时内容不可聚焦，标签继续留在台面边缘。
  favoritePanel.append(favoriteDrawer,favoriteToggle);
  board.append(canvas,help,controls,hud,menu,launch,dock,progress,status,resultStatus,favoritePanel);
  const home=createHome({
    enter(){if(!canAccess()||state.busy)return;homeActive=false;factory.playClick();syncHome();refreshCanvas();canvas.focus();},
    saves(){if(!state.library)return;panel='saves';factory.playClick();renderPanel();invoke('onRefreshLibrary');},
    mods(){if(!canAccess())return;panel='mods';factory.playClick();renderPanel();},
  });
  shell.append(board,dictionary,dictToggle,panelLayer,modalLayer,toast);root.replaceChildren(home.element,shell);
  shell.classList.add('wx-home-active');
  function syncHome(){
    shell.classList.toggle('wx-home-active',homeActive);
    board.inert=homeActive;dictToggle.inert=homeActive;dictionary.inert=homeActive||!dictOpen;
    home.render(state,discoveries,homeActive,!!panel||!modalLayer.hidden);
    factory?.setVisible(!homeActive);
  }
  // 取卡由画布在实际取出时发声；其余按钮在动作前统一播放点击声，避免一次点击双响。
  shell.addEventListener('click',event=>{const target=event.target.closest?.('button');if(target&&!target.disabled&&!target.matches('.wx-card-tile,.wx-record-card'))factory?.playClick();},{capture:true});

  // 按设计高度 540 缩放整套排版，画布输入再换算回设计坐标。
  function fitLayout(){
    const rect=root.getBoundingClientRect(),height=Math.max(1,rect.height),width=Math.max(1,rect.width);
    uiScale=height/540;logicalWidth=width/uiScale;
    if(!layoutReady){dictOpen=logicalWidth>=700;layoutReady=true;}
    dictWidth=Math.min(Math.max(logicalWidth*.34,320),380,Math.max(230,logicalWidth-92),logicalWidth-30);
    shell.style.width=logicalWidth+'px';shell.style.height='540px';shell.style.transform='scale('+uiScale+')';
    shell.style.setProperty('--dict-width',dictWidth+'px');shell.style.setProperty('--dict-space',dictOpen?dictWidth+'px':'0px');
    shell.classList.toggle('wx-dict-open',dictOpen);shell.classList.toggle('wx-narrow',logicalWidth<700);shell.classList.toggle('wx-reduce-motion',!!state.save?.preferences.reduceMotion);
    dictionary.inert=homeActive||!dictOpen;dictionary.setAttribute('aria-hidden',String(!dictOpen));
    dictToggle.setAttribute('aria-expanded',String(dictOpen));dictToggle.setAttribute('aria-label',dictOpen?'收起词典':'展开词典');setText(dictToggle,dictOpen?'📖\n›':'📖\n‹');
    const available=logicalWidth<700?logicalWidth:logicalWidth-(dictOpen?dictWidth:0);
    shell.style.setProperty('--favorite-width',Math.max(100,Math.min(272,available-38))+'px');
    board.classList.toggle('wx-favorites-open',favOpen);board.classList.toggle('wx-dock-open',dockOpen);
    factory?.resize();
  }
  fitLayout();
  factory=createFactoryCanvas(canvas,{
    // 点卡的含义由可见合成台决定，不让单击和双击争抢同一份材料。
    onPick(id){if(dockOpen&&!selectionLocked())addIngredient(id);else openDetail(id);},
    onCombine(ids){if(ensureRecipeAccess(ids))invoke('onCombine',ids);},
    onPresentationBusy(value){presentationBusy=value;updateSelectionLocks();},
    onReveal(result){
      if(destroyed||state.synthesis?.id!==result.operationId)return;
      revealedId=result.operationId;pendingSlots=null;
      // 可见反馈在结果卡附近完成；这里只给读屏器保留一次揭晓通知。
      setText(resultStatus,(result.isNewCard?'发现新卡：':'合成完成：')+result.card.name);
    },
    onLayoutChange(value){invoke('onSaveLayout',value);},
    onZoomChange(value){invoke('onSavePreferences',{zoom:value});},
    onCardDetails:openDetail,
    isDictionaryDrop({clientX,clientY}){
      if(!dictOpen)return false;
      const rect=dictionary.getBoundingClientRect();
      return clientX>=rect.left&&clientX<rect.right&&clientY>=rect.top&&clientY<rect.bottom;
    },
  });
  const resize=new ResizeObserver(()=>{fitLayout();paintTiles();});resize.observe(root);dispose.push(()=>resize.disconnect());
  function refreshCanvas(){tidy.disabled=boardLocked();factory.update({save:state.save,saveEpoch:state.saveEpoch,busy:state.busy,selectedIds:selected,lastResult:state.lastResult,synthesis:state.synthesis,enabled:!boardLocked()});}
  function showMessage(text){setText(toast,text);toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},2600);}
  function openDetail(id){if(!cardById(id))return;detailId=id;share=false;panel='detail';renderPanel();}
  function addIngredient(id){
    if(!canAccess()||selectionLocked()||!cardById(id))return false;
    if(selected.length>=4){showMessage('最多放入四张材料。');return false;}
    selected.push(id);dockOpen=true;updateSelection();return true;
  }
  function ensureRecipeAccess(ids){
    if(!state.save||state.pendingBlocked)return false;
    if(configured()||findRecipe(state.save,ids)||state.save.mods?.some(mod=>mod.enabled))return true;
    apiOpen=true;renderApi();refreshCanvas();return false;
  }
  function combineSelected(){
    if(selected.length<2||state.busy||presentationBusy||state.canRetrySave||!canAccess())return;
    if(!ensureRecipeAccess(selected))return;
    const ids=selected.slice(),rect=canvas.getBoundingClientRect(),w=canvas.clientWidth||rect.width,h=canvas.clientHeight||rect.height;
    const points=[...tray.children].slice(0,ids.length).map(slot=>{const r=slot.getBoundingClientRect();return {x:(r.left+r.width/2-rect.left)*w/rect.width,y:(r.top+r.height/2-rect.top)*h/rect.height};});
    if(!factory.prepareSynthesis(ids,points))return;
    pendingSlots={id:null,ids};selected=[];updateSelection();invoke('onCombine',ids);
  }
  function updateSelectionLocks(){
    combine.disabled=selected.length<2||selectionLocked()||!canAccess();
    [...tray.children].forEach((slot,i)=>{slot.disabled=!selected[i]||selectionLocked();});
  }
  function updateSelection(){
    const picking=dockOpen&&!selectionLocked();
    setText(help,picking?'点卡加入材料 · 收起合成台后点卡看详情':'拖叠两张卡合成 · 点卡查看详情');
    canvas.setAttribute('aria-label',picking?'合成工作台：点卡加入多卡合成台，拖叠两张卡合成':'合成工作台：拖叠两张卡合成，点卡查看详情');
    tray.replaceChildren();
    for(let i=0;i<4;i++){
      const card=cardById(selected[i]),slot=button('',()=>{if(card&&!selectionLocked()){selected.splice(i,1);updateSelection();}},'wx-material-slot'+(card?' wx-filled':''));
      if(card){slot.append(el('span','wx-slot-emoji',card.emoji),el('span','wx-slot-name',card.name),el('span','wx-slot-remove','×'));slot.setAttribute('aria-label','移除材料：'+card.name);}
      else {setText(slot,'＋');slot.disabled=true;slot.setAttribute('aria-label','空材料格');}
      tray.append(slot);
    }
    updateSelectionLocks();
    setText(combine,selected.length>=2?'合成':'放入材料');dock.hidden=!dockOpen;launch.hidden=dockOpen;fitLayout();refreshCanvas();
  }
  function favoriteIds(){return new Set((state.save?.favorites||[]).flatMap(group=>group.cardIds));}
  function toggleFavorite(id){
    const groups=(state.save?.favorites||[]).map(g=>({...g,cardIds:g.cardIds.slice()}));let group=groups[0];
    if(!group){group={id:'default',name:'收藏',cardIds:[]};groups.push(group);}
    if(favoriteIds().has(id))groups.forEach(g=>g.cardIds=g.cardIds.filter(v=>v!==id));else group.cardIds.push(id);
    invoke('onSaveFavorites',groups);
  }
  function renderMenu(){
    menu.replaceChildren();menu.hidden=!menuOpen;
    if(!menuOpen)return;
    const items=[
      ['返回主页',()=>{if(selectionLocked()){showMessage('请等这次操作结束后再返回主页。');return;}homeActive=true;syncHome();refreshCanvas();home.play.focus();}],
      ['📖 我的词典',()=>{dictOpen=true;fitLayout();}],
      ['⭐ 我的收藏',()=>{favOpen=true;renderFavorites();fitLayout();}],
      ['💾 存档',()=>{panel='saves';renderPanel();invoke('onRefreshLibrary');}],
      ['🧩 Mod',()=>{panel='mods';renderPanel();}],
      ['📜 合成历史',()=>{recordPage=0;panel='history';renderPanel();}],
      ['📋 配方表',()=>{recordPage=0;panel='recipes';renderPanel();}],
      ['📝 提示词',()=>{panel='prompt';renderPanel();}],
      ['🎨 外观',()=>{panel='settings';renderPanel();}],
      ['⚙️ 设置',()=>{panel='settings';renderPanel();}],
      ['使用协议',async()=>{await showUsageNotice(root);more.focus();}],
    ];
    items.forEach(([label,action])=>menu.append(button(label,()=>{menuOpen=false;renderMenu();action();})));
  }
  const searchBox=el('label','wx-search'),search=el('input');
  search.type='search';search.placeholder='搜我的卡牌…';search.setAttribute('aria-label','搜索我的卡牌');searchBox.append(el('span','','🔎'),search);
  const views=el('div','wx-chips'),categories=el('div','wx-chips'),lengths=el('div','wx-chips');
  const summary=el('div','wx-dictionary-summary'),grid=el('div','wx-library-grid'),pagination=el('div','wx-pagination');
  dictionary.append(searchBox,views,categories,lengths,summary,grid,pagination);
  search.addEventListener('input',()=>{filter=search.value;page=0;renderLibrary();});
  function chip(parent,label,active,action){const b=button(label,action,'wx-chip'+(active?' wx-active':''));b.setAttribute('aria-pressed',String(active));parent.append(b);}
  function renderLibrary(){
    views.replaceChildren();categories.replaceChildren();lengths.replaceChildren();grid.replaceChildren();pagination.replaceChildren();
    chip(views,'我的卡牌',!onlyFavorites,()=>{onlyFavorites=false;page=0;renderLibrary();});
    chip(views,'收藏',onlyFavorites,()=>{onlyFavorites=true;page=0;renderLibrary();});
    for(const cat of ['全部',...CATEGORIES])chip(categories,cat,cat===(category||'全部'),()=>{category=cat==='全部'?'':cat;page=0;renderLibrary();});
    for(const n of [0,1,2,3,4])chip(lengths,n?n+'字':'全部',lengthFilter===n,()=>{lengthFilter=n;page=0;renderLibrary();});
    const favorites=favoriteIds(),query=filter.normalize('NFKC').trim().toLocaleLowerCase();
    const cards=(state.save?.cards||[]).filter(c=>(!category||category===c.category)&&(!onlyFavorites||favorites.has(c.id))&&(!lengthFilter||Array.from(c.name).length===lengthFilter)&&(!query||c.name.normalize('NFKC').toLocaleLowerCase().includes(query)));
    const totalPages=Math.max(1,Math.ceil(cards.length/40));page=Math.min(page,totalPages-1);
    summary.replaceChildren(el('span','',onlyFavorites?'我的收藏':'我的卡牌'),el('span','',cards.length+' 种'));
    if(!cards.length)grid.append(el('p','wx-empty',onlyFavorites?'还没有收藏的卡牌。':'没有找到这张卡。'));
    cards.slice(page*40,page*40+40).forEach(card=>grid.append(cardTile(card)));
    if(totalPages>1){const prev=button('‹ 上一页',()=>{page--;renderLibrary();},'wx-small-button'),next=button('下一页 ›',()=>{page++;renderLibrary();},'wx-small-button');prev.disabled=page===0;next.disabled=page===totalPages-1;pagination.append(prev,el('span','',(page+1)+' / '+totalPages),next);}
    paintTiles();
  }
  function cardTile(card){
    const tile=button('',()=>factory.addCard(card.id),'wx-card-tile');tile.setAttribute('aria-label',card.name+'，放上台面；右键查看详情');tile.title=card.name;
    const picture=el('canvas','wx-tile-art');picture.dataset.cardId=card.id;tile.append(picture);
    tile.addEventListener('contextmenu',event=>{event.preventDefault();detailId=card.id;share=false;panel='detail';renderPanel();});
    return tile;
  }
  function paintTiles(){
    const pixels=Math.min(window.devicePixelRatio||1,2)*uiScale;
    for(const picture of shell.querySelectorAll('.wx-tile-art')){
      const card=cardById(picture.dataset.cardId);if(!card)continue;
      const w=picture.clientWidth||58,h=picture.clientHeight||58;
      picture.width=Math.max(1,Math.round(w*pixels));picture.height=Math.max(1,Math.round(h*pixels));
      const ctx=picture.getContext('2d');ctx.setTransform(pixels,0,0,pixels,0,0);
      createCardPainter(ctx,{getMods:()=>state.save?.mods||[],images:modImages}).drawTile(2,2,w-4,h-5,card,{skinId:state.save.preferences.skinId,animate:false,now:0});
    }
  }
  function renderFavorites(){
    favoriteDrawer.inert=!favOpen;favoriteDrawer.setAttribute('aria-hidden',String(!favOpen));favoriteToggle.setAttribute('aria-expanded',String(favOpen));favoriteToggle.setAttribute('aria-label',favOpen?'收起收藏':'展开收藏');
    if(!favOpen)return;
    favoriteDrawer.replaceChildren();
    const ids=favoriteIds(),cards=(state.save?.cards||[]).filter(c=>ids.has(c.id)),heading=el('div','wx-favorite-heading');
    heading.append(el('h2','','我的收藏'),el('span','wx-favorite-count',cards.length+' 张'));favoriteDrawer.append(heading);
    if(cards.length){
      favoriteDrawer.append(el('p','wx-favorite-hint','点卡放上台面'));
      const list=el('div','wx-favorite-grid');cards.forEach(c=>list.append(cardTile(c)));favoriteDrawer.append(list);
    }else{
      const empty=el('div','wx-favorite-empty');empty.append(el('span','wx-favorite-empty-star','☆'),el('p','','把常用的卡牌留在这里'),el('span','wx-favorite-hint','打开卡牌详情，点“收藏”。'));favoriteDrawer.append(empty);
    }
    paintTiles();
  }
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
    [['soundEnabled','合成与操作音效'],['reduceMotion','减少动态效果']].forEach(([key,label])=>{const row=el('label','wx-check-row'),input=el('input');input.type='checkbox';input.checked=!!state.save?.preferences?.[key];input.disabled=!!state.busy;input.addEventListener('change',()=>invoke('onSavePreferences',{[key]:input.checked}));row.append(el('span','',label),input);feedback.append(row);});aside.append(feedback);
    appendSaveTools(aside);
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
    function putCard(id){if(state.busy||state.canRetrySave||!canAccess()||!cards.has(id))return;panel=null;renderPanel();factory.addCard(id);}
    function cardButton(id,name){const card=cards.get(id),b=button(card?`${card.emoji} ${card.name}`:name||'未知卡牌',()=>putCard(id),'wx-record-card');b.disabled=!card||!!state.busy||!!state.canRetrySave;b.setAttribute('aria-label',card?`${card.name}，放回台面`:(name||'未知卡牌')+'，尚未发现');return b;}
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
  function detail(){
    const card=cardById(detailId);if(!card){panel=null;return;}
    const pixels=Math.min(window.devicePixelRatio||1,2)*uiScale;
    if(share){
      const cardWidth=logicalWidth<700?125:logicalWidth*.17,cardHeight=cardWidth*108/84;
      const picture=el('canvas','wx-share-large-card'),w=cardWidth+40,h=cardHeight+40;
      picture.style.width=w+'px';picture.style.height=h+'px';picture.width=Math.round(w*pixels);picture.height=Math.round(h*pixels);
      const context=picture.getContext('2d');context.scale(pixels,pixels);createCardPainter(context,{getMods:()=>state.save?.mods||[],images:modImages}).drawCard(w/2,h/2,cardWidth,cardHeight,card,{skinId:state.save.preferences.skinId,animate:false,now:0});
      const copy=el('div','wx-share-copy');copy.append(el('p','wx-share-overline','✦ 我的发现'),el('h3','',card.name),el('p','wx-subtle',card.category),el('p','wx-card-description',card.description));
      aside.append(picture,copy,el('div','wx-share-brand','无限工厂3'),button('返回卡牌详情',()=>{share=false;renderPanel();},'wx-share-return wx-button-quiet'));return;
    }
    aside.append(dialogTitle('卡牌详情'));
    const head=el('div','wx-detail-head'),icon=el('canvas','wx-detail-icon');icon.width=Math.round(56*pixels);icon.height=Math.round(56*pixels);
    const iconContext=icon.getContext('2d');iconContext.scale(pixels,pixels);createCardPainter(iconContext,{getMods:()=>state.save?.mods||[],images:modImages}).drawTile(1,1,54,54,card,{skinId:state.save.preferences.skinId,now:0});
    const names=el('div');names.append(el('h3','',card.name),el('p','wx-subtle',(card.isBase?'世界本源':'我的发现')+' · '+card.category));head.append(icon,names);aside.append(head);
    const display=el('div','wx-detail-lore');
    display.append(el('p','wx-card-description',card.description));
    if(!card.isBase&&card.discoveredAt){const date=new Date(card.discoveredAt);if(!Number.isNaN(date.getTime()))display.append(el('p','wx-subtle','发现于 '+date.toLocaleDateString('zh-CN')));}
    aside.append(display);
    const actions=el('div','wx-action-row'),add=button('加入合成台',()=>{if(addIngredient(card.id)){panel=null;renderPanel();}},'wx-add-ingredient');
    add.disabled=!!state.busy||presentationBusy||!!state.canRetrySave;
    actions.append(add,button('查看分享',()=>{share=true;renderPanel();}),button(favoriteIds().has(card.id)?'取消收藏':'收藏',()=>toggleFavorite(card.id),'wx-favorite-action'));aside.append(actions);
    if(!share){const recipes=(state.save.recipes||[]).filter(r=>r.resultId===card.id),box=el('section','wx-settings-section');box.append(el('h3','','已知配方'));
      if(!recipes.length)box.append(el('p','wx-subtle',card.isBase?'本源是探索的起点。':'还没有记录获得它的配方。'));
      recipes.slice(0,24).forEach(recipe=>box.append(el('p','wx-recipe-line',recipe.ingredientIds.map(id=>cardById(id)?.name||'未知材料').join(' ＋ '))));aside.append(box);
    }
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
          // 控制器会吞掉存储异常并显示错误；必须看到实际存档响应才能提示成功。
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
    if(panel!=='prompt')aside.replaceChildren();
    else if(!aside.classList.contains('wx-prompt-dialog'))aside.replaceChildren();
    panelLayer.hidden=!panel;panelLayer.classList.toggle('wx-prompt-layer',panel==='prompt');aside.classList.toggle('wx-share-dialog',!!share&&panel==='detail');aside.classList.toggle('wx-management-dialog',['saves','mods','history','recipes'].includes(panel));aside.classList.toggle('wx-prompt-dialog',panel==='prompt');
    if(panel==='settings')settings();else if(panel==='detail')detail();else if(panel==='saves')savesPanel();else if(panel==='history'||panel==='recipes')recordsPanel(panel);else if(panel==='mods')modsPanel();else if(panel==='prompt')promptPanel();
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
    more.disabled=dictToggle.disabled=favoriteToggle.disabled=launch.disabled=tidy.disabled=false;
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
    if(event.key==='Escape'){if(home.element.querySelector('dialog[open]')){event.preventDefault();home.element.querySelector('dialog[open]').close();return;}if(apiOpen&&canAccess()&&state.busy!=='configure'){apiOpen=false;renderApi();refreshCanvas();}else if(panel){panel=null;renderPanel();if(homeActive)home.play.focus();}else if(menuOpen){menuOpen=false;renderMenu();}}
    if(event.key==='Tab'&&!modalLayer.hidden){const focusable=[...(recoveryPanel.hidden?form:recoveryPanel).querySelectorAll('input,button,summary')].filter(n=>!n.disabled&&!n.hidden&&n.getClientRects().length);if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  };
  document.addEventListener('keydown',keydown);dispose.push(()=>document.removeEventListener('keydown',keydown));
  return {
    render(next){
      if(destroyed)return;state={...state,...next,configStatus:{...state.configStatus,...next.configStatus}};
      if(saveEpoch!==(state.saveEpoch||0)){saveEpoch=state.saveEpoch||0;pendingSlots=null;selected=[];revealedId=null;restoreSelection=null;renameId=null;newSlotName='';localAccess=false;recordPage=0;modEnableId=null;modRemoveId=null;modImages.clear();}
      // 合成槽保留原顺序和重复材料，取消/失败不让玩家重新点一遍。
      if(pendingSlots&&state.synthesis){
        pendingSlots.id ||= state.synthesis.id;
        if(pendingSlots.id===state.synthesis.id&&['failed','cancelled'].includes(state.synthesis.phase)){selected=pendingSlots.ids.slice();pendingSlots=null;dockOpen=true;}
      }
      if(!state.lastResult||state.lastResult.operationId!==revealedId)setText(resultStatus,'');
      if(configured()&&!lastConfigured){apiOpen=false;key.value='';}lastConfigured=configured();
      const count=state.save?.stats?.synthesisCount||0;
      discoveries=state.save?.cards.filter(c=>!c.isBase).length||0;
      if(state.canRetrySave||state.pendingBlocked||state.recoveryRequired||state.synthesis?.phase==='saving')homeActive=false;
      stats.replaceChildren(el('span','wx-hud-segment','⚒ '+count+' 次'),el('span','wx-hud-segment','✦ '+discoveries+' 张'));stats.setAttribute('aria-label','合成 '+count+' 次，发现 '+discoveries+' 张');
      more.disabled=dictToggle.disabled=favoriteToggle.disabled=launch.disabled=!canAccess();
      progress.hidden=!state.busy||state.busy==='configure';setText(progressText,({save:'正在保存…',cancel:'正在取消…',import:'正在导入存档…',export:'正在导出存档…',backups:'正在读取备份…',restore:'正在恢复存档…',library:'正在读取存档列表…','create-slot':'正在创建存档…','switch-slot':'正在切换存档…','rename-slot':'正在保存名称…','mod-import':'正在读取 Mod…','mod-save':'正在保存 Mod…','mod-action':'正在运行 Mod 玩法…'})[state.busy]||(state.synthesis?.source==='mod'?'正在运行 Mod…':'正在生成新配方…'));cancel.hidden=state.busy!=='combine';
      setText(errorText,state.error||(state.canRetrySave?'结果还没有保存，请重试保存。':''));retry.hidden=!state.canRetrySave;selected=selected.filter(id=>cardById(id));updateSelection();
      const signature=JSON.stringify([state.save?.id,state.saveEpoch,state.save?.cards.length,state.save?.preferences.skinId,state.save?.favorites]);
      if(signature!==listSignature){listSignature=signature;renderLibrary();}
      if(signature!==favoritesSignature){favoritesSignature=signature;renderFavorites();}
      if(paintedMods!==state.save?.mods){paintedMods=state.save?.mods;paintTiles();}
      renderApi();if(panel)renderPanel();refreshCanvas();status.hidden=(!state.error&&!state.canRetrySave)||!modalLayer.hidden;help.hidden=!!state.save?.layout?.length;

    },
    clearApiKey(){key.value='';},
    openSettings(){if(canAccess()){panel='settings';renderPanel();}},
    showMessage,
    destroy(){destroyed=true;clearTimeout(toastTimer);home.destroy();modImages.clear();factory.destroy();dispose.forEach(fn=>fn());key.value='';root.replaceChildren();root.classList.remove('wxgc3');},
  };
}

