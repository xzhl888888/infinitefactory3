'use strict';
/* 二代正式工厂场景：绘制、动画和输入保留；数据及事务由三代本地接口提供。 */
(function(){
  let BASES=[],PLAYER='你',DICT=[];
  const DICT_LOAD={mine:false};
  const VIEWKEY={'我的卡牌':'mine','收藏':'collected'},VIEWLABEL={mine:'我的卡牌',collected:'收藏'};
  const MY_RECENT_KEY='wxgc2_my_cards_recent_v1';
  const MENU=[['💾','存档'],['🧩','Mod'],['📜','合成历史'],['📋','配方表'],['📝','提示词'],['🎨','外观'],['🔑','API 配置'],['📸','截图模式'],['❔','操作说明'],['⚙️','设置'],['🏠','返回主页']];
  const META={};   // 当前存档卡牌的画布显示缓存
  const COLL_META={};   // 卡名→卡片详情记忆：收藏夹只存卡名，详情靠这里兜底（图标/分类/编号/首发者等）·与大词库下没下完彻底脱钩
  function rememberCollMeta(name,e,cat,seq,extra){
    if(name&&typeof name==='object'){ const c=name; extra=c; name=c.name||c.n; e=c.emoji||c.e; cat=c.cat; seq=c.seq; }
    if(!name) return; const prev=COLL_META[name]||{}, ex=extra||{}, by=ex.byName||ex.by_name||ex.by||prev.byName||prev.by||'';
    COLL_META[name]={
      e:e||prev.e||'⭐', cat:cat||prev.cat||'收藏', seq:Number(seq)||prev.seq||0,
      byName:by, by:by, q:ex.descr||ex.q||prev.q||'', rar:(ex.rar!=null?Number(ex.rar):prev.rar)||0,
      holder:(ex.holder!=null?Number(ex.holder):(ex.holder_cnt!=null?Number(ex.holder_cnt):prev.holder)),
      collectCnt:(ex.collectCnt!=null?Number(ex.collectCnt):(ex.collect_cnt!=null?Number(ex.collect_cnt):prev.collectCnt)),
      borrowCnt:(ex.borrowCnt!=null?Number(ex.borrowCnt):(ex.borrow_cnt!=null?Number(ex.borrow_cnt):prev.borrowCnt)),
      listed:(ex.listed!=null?!!ex.listed:prev.listed), listingStatus:ex.listingStatus||ex.listing_status||prev.listingStatus||'',
      lim:ex.lim||ex.skin||ex.card_skin||prev.lim||'', creatorFrame:!!(ex.creatorFrame||ex.creator_first_frame_active||prev.creatorFrame),
      mineFirst:!!(ex.mineFirst||ex.mine_first||prev.mineFirst), foodTaste:ex.foodTaste||prev.foodTaste||null,
      friendShared:(ex.friend_shared!=null?!!ex.friend_shared:(ex.friendShared!=null?!!ex.friendShared:!!prev.friendShared)),
      providers:Array.isArray(ex.providers)?ex.providers.slice():((ex.friend_shared===false)?[]:(Array.isArray(prev.providers)?prev.providers.slice():[]))
    };
  }


  let localState=null, localIdentity='', localCardsKey='', localFavoritesKey='', localSkin='', lastLayoutSignature='', externalBlocked=false, localHydrationNeeded=false, lastZoomSaved=null;
  const nativeCard=name=>localState&&localState.save&&localState.save.cards.find(card=>card.name===name);
  function localCardData(card,index){
    return {n:card.name,e:card.emoji,cat:card.category,q:card.description,seq:index+1,rar:card.isBase?9:0,
      id:card.id,origin:!!card.isBase,owned:true,only:false,broken:false,sponsor:false,mineFirst:false,
      by:'',byName:'',lim:cardLim(card),bornAt:card.discoveredAt,unlockedAt:card.discoveredAt,unlockedTs:Date.parse(card.discoveredAt)||0};
  }
  function newInstanceId(){return 'table:'+crypto.randomUUID();}
  function localFolders(save){
    const names=new Map(save.cards.map(card=>[card.id,card.name]));
    const folders=(save.favorites||[]).map(folder=>({id:folder.id,name:folder.name,cards:folder.cardIds.map(id=>names.get(id)).filter(Boolean)}));
    while(folders.length<3)folders.push({id:'legacy-folder-'+folders.length,name:'收藏夹'+(folders.length+1),cards:[]});
    return folders;
  }
  function setLocalSnapshot(next){
    if(!next||!next.save)return;
    const save=next.save,identity=save.id+':'+(next.saveEpoch||0),changed=identity!==localIdentity;
    localState=next;
    const cardsKey=save.cards.map(card=>card.id).join('|'),favoritesKey=JSON.stringify(save.favorites||[]),skin=(save.preferences||{}).skinId||'default';
    st.account={id:save.id,name:save.name};st.accountToken=save.id;PLAYER=save.name||'我的世界';
    if(changed){
      clearGestures();st.cards=[];st.slots=[null,null,null,null];st.pending=[];st.effects=[];st.floats=[];
      st.detail=null;st.share=null;st.favPick=null;st.menuOpen=false;st.dictView='mine';st.dictScroll=0;st.favScroll=0;
      st.seen=new Set();st._seeded=false;localIdentity=identity;localCardsKey='';lastLayoutSignature='';lastZoomSaved=null;localHydrationNeeded=true;
      Object.keys(META).forEach(key=>delete META[key]);Object.keys(COLL_META).forEach(key=>delete COLL_META[key]);
    }
    if(changed||cardsKey!==localCardsKey||skin!==localSkin){
      st.myCards=save.cards.map(localCardData);DICT=st.myCards.slice();BASES=st.myCards.filter(card=>card.origin);
      st.owned=new Set(st.myCards.map(card=>card.n));st.myFirsts=new Set();st.firstCount=st.myCards.length-BASES.length;
      st.myCards.forEach(card=>{META[card.n]=card;rememberCollMeta(card);st.seen.add(card.n);});
      st.cards.forEach(card=>{const known=META[card.n];if(known){card.lim=known.lim;card.only=false;card.broken=false;card.sponsor=false;}});
      DICT_LOAD.mine=false;DICT_LOAD.myfirst=false;_dataStamp++;_dictCache=null;st._favItemCache=null;
      localCardsKey=cardsKey;localSkin=skin;
    }
    if(changed||favoritesKey!==localFavoritesKey){
      st.favFolders=localFolders(save);st.collected=new Set(st.favFolders.flatMap(folder=>folder.cards));
      st._favItemCache=null;_dictCache=null;_dataStamp++;localFavoritesKey=favoritesKey;
    }
    if(localHydrationNeeded&&CUR_NAME==='工厂界面'&&st.PLAY_W>0){loadFactoryCanvas();localHydrationNeeded=false;}
  }

  /* ---------- 世界/视图 ---------- */
  const Z_MIN=0.6, Z_MAX=2, CW=84, CH=108;
  // Lv.45 永久成长：画布宽、高各扩大 25%。扩建前后中心都保持 (750,500)，旧卡坐标/存档不用迁移。
  const WORLD_BASE_W=1500, WORLD_BASE_H=1000, WORLD_LV45_SCALE=1.25;
  const WORLD_LV45_W=WORLD_BASE_W*WORLD_LV45_SCALE, WORLD_LV45_H=WORLD_BASE_H*WORLD_LV45_SCALE;
  const WORLD_LV45_DX=(WORLD_LV45_W-WORLD_BASE_W)/2, WORLD_LV45_DY=(WORLD_LV45_H-WORLD_BASE_H)/2;
  const WORLD_BASE={minX:0,minY:0,maxX:WORLD_BASE_W,maxY:WORLD_BASE_H,w:WORLD_BASE_W,h:WORLD_BASE_H};
  const WORLD_LV45={minX:-WORLD_LV45_DX,minY:-WORLD_LV45_DY,maxX:WORLD_BASE_W+WORLD_LV45_DX,maxY:WORLD_BASE_H+WORLD_LV45_DY,w:WORLD_LV45_W,h:WORLD_LV45_H};
  const view={x:0,y:0,s:1};
  const st={ cards:[], drawerOpen:false, slots:[null,null,null,null], seen:new Set(), pending:[], effects:[], floats:[],
    menuOpen:false, detail:null, share:null, confirmClear:null, hot:[], drag:null, pan:null, lastNow:0, TICK_H:0, DICT_W:260, DICT_X:0, PLAY_W:0, PLAY_H:0,
    dictOpen:true, dictT:1, drawerLeft:0, dictContentX:0, dictContentW:0, panelX:0, toggleRect:{x:0,y:0,w:24,h:64},
    favOpen:false, favT:0, favTab:0, favScroll:0, favPan:null, favPick:null, favFolders:null, favQuery:'', favSearchActive:false, _favCells:[], _favMaxScroll:0, _favDrawer:null,
    dictQuery:'', dictCat:'全部', dictLen:0, dictView:'mine', dictScroll:0, dictSearchActive:false, dictPan:null, _dictCells:[], _dictMaxScroll:0, _dictGridTop:0,
    recentCombines:[], recentCombinesVisible:false,   // 「最近合成」默认隐藏（2026-07-02 用户拍板·点📜最近可打开·选择会记住）
    account:null, accountToken:'', owned:new Set(), collectionOwned:new Set(), collectionOwnedAccount:'', myFirsts:new Set(), firstCount:0, canvasLocked:false, photoMode:null, _seeded:false };   // photoMode={phase,hideAt,restoreAt,view}:工厂净屏截图模式（不落盘·离场必恢复）   // account=真账号(HUD)·accountToken=这份账号资料属于哪张登录凭证·owned/myFirsts=我拥有/我首发(来自 me/cards)·collectionOwned=收藏接口按当前账号补齐的拥有态·_seeded=本源是否已铺到画布
  const FAV_STORE='wxgc2_fav_folders_v1';
  const FACTORY_CANVAS_STORE='wxgc2_factory_canvas_v1', CANVAS_LOCK_STORE='wxgc2_canvas_lock_v1', RECENT_COMBINE_STORE='wxgc2_recent_combines_v1', RECENT_COMBINE_VISIBLE_STORE='wxgc2_recent_combines_visible_v1';
  function loadCanvasLock(){ try{ return localStorage.getItem(CANVAS_LOCK_STORE)==='1'; }catch(_){ return false; } }
  function setCanvasLock(on){
    st.canvasLocked=!!on; st.pan=null; st.pinch=null;
    try{ localStorage.setItem(CANVAS_LOCK_STORE, st.canvasLocked?'1':'0'); }catch(_){}
    toast(st.canvasLocked?'已固定画布缩放和移动':'已解除画布固定');
  }
  function canvasHasContent(){ return !!((st.cards&&st.cards.length)||(st.slots&&st.slots.some(Boolean))); }
  function saveFactoryCanvas(force){
    if(STILL||!localState||!localState.save||!st._seeded)return;
    const layout=st.cards.map(card=>{
      const known=nativeCard(card.n);if(!known)return null;
      card.instanceId=card.instanceId||newInstanceId();
      return {id:card.instanceId,cardId:known.id,x:Math.round(((card.tx!=null?card.tx:card.x)-800)*10)/10,
        y:Math.round(((card.ty!=null?card.ty:card.y)-500)*10)/10,pinned:!!card.pinned};
    }).filter(Boolean);
    const zoom=Math.round(view.s*10000)/10000;
    if(zoom!==lastZoomSaved&&zoom!==Number((localState.save.preferences||{}).zoom)){
      lastZoomSaved=zoom;
      Promise.resolve(WXGC2_API.settings.patch({zoom})).then(result=>{if(result&&result.ok===false&&lastZoomSaved===zoom)lastZoomSaved=null;}).catch(()=>{if(lastZoomSaved===zoom)lastZoomSaved=null;});
    }
    const signature=JSON.stringify(layout);
    if(signature===lastLayoutSignature)return;
    lastLayoutSignature=signature;
    const failed=message=>{
      if(lastLayoutSignature===signature)lastLayoutSignature='';
      toast(message||(localState&&localState.error)||'台面还没有保存，请检查设备剩余空间。');
    };
    Promise.resolve(WXGC2_API.saveLayout(layout)).then(result=>{
      if(result&&result.ok===false)failed(result.message);
    }).catch(()=>failed());
  }
  function loadFactoryCanvas(){
    const save=localState&&localState.save;if(!save)return false;
    const known=new Map(save.cards.map(card=>[card.id,card]));
    st.cards=(save.layout||[]).map(instance=>{
      const data=known.get(instance.cardId);if(!data)return null;
      const d=localCardData(data,save.cards.indexOf(data));
      const card=mk(d.n,d.e,d.cat,'',d.seq,instance.x+800,instance.y+500,d.origin,false,d.q,false);
      card.instanceId=instance.id;card.cardId=data.id;card.pinned=!!instance.pinned;card.lim=d.lim;card.bornAt=data.discoveredAt;
      return card;
    }).filter(Boolean);
    st._seeded=!!((save.preferences||{}).layoutInitialized||st.cards.length);
    if(!st._seeded&&BASES.length){resetBaseView();seedBases(BASES);st._seeded=true;saveFactoryCanvas(true);}
    else {view.s=clamp(Number((save.preferences||{}).zoom)||1,Z_MIN,Z_MAX);view.x=st.PLAY_W/2-800*view.s;view.y=st.PLAY_H/2-500*view.s;clampView();}
    return true;
  }
  function fitText(t,maxW,suf){ t=String(t||''); const raw=t; while(ctx.measureText(t+(suf||'…')).width>maxW&&t.length>1) t=t.slice(0,-1); return t===raw?t:(t+(suf||'…')); }
  function recentBrief(name){
    name=String(name||'');
    const d=(META[name]||DICT.find(x=>x.n===name)||BASES.find(x=>x.n===name)||{});
    return { n:name, e:String(d.e||'') };
  }
  function loadRecentCombines(){
    if(STILL) return;
    try{
      const raw=JSON.parse(localStorage.getItem(RECENT_COMBINE_STORE)||'[]');
      st.recentCombines=(Array.isArray(raw)?raw:[]).filter(r=>r&&Array.isArray(r.items)&&r.result&&r.result.n).slice(0,3);
    }catch(_){ st.recentCombines=[]; }
    try{ st.recentCombinesVisible=localStorage.getItem(RECENT_COMBINE_VISIBLE_STORE)==='1'; }catch(_){ st.recentCombinesVisible=false; }   // 默认隐藏·玩家点过「显示」(存'1')才常显（2026-07-02 用户拍板）
  }
  function saveRecentCombines(){
    if(STILL) return;
    try{ localStorage.setItem(RECENT_COMBINE_STORE, JSON.stringify((st.recentCombines||[]).slice(0,3))); }catch(_){}
  }
  function setRecentCombinesVisible(on){
    st.recentCombinesVisible=!!on;
    try{ localStorage.setItem(RECENT_COMBINE_VISIBLE_STORE, st.recentCombinesVisible?'1':'0'); }catch(_){}
    toast(st.recentCombinesVisible?'已显示最近合成':'已隐藏最近合成');
  }
  function rememberRecentCombine(items,result){
    const names=(Array.isArray(items)?items:[]).map(x=>String(x||'')).filter(Boolean).slice(0,4);
    if(names.length<2||!result||!result.name) return;
    const rec={ at:Date.now(), items:names.map(recentBrief), result:{n:String(result.name),e:String(result.e||result.emoji||'')} };
    st.recentCombines=[rec].concat(st.recentCombines||[]).slice(0,3);
    saveRecentCombines();
  }
  function favEnsure(){
    if(!st.favFolders)st.favFolders=localState&&localState.save?localFolders(localState.save):[0,1,2].map(i=>({name:'收藏夹'+(i+1),cards:[]}));
    return st.favFolders;
  }
  function favSave(){
    if(!localState||!localState.save)return;
    const folders=favEnsure().map(folder=>({id:folder.id,name:folder.name,cards:folder.cards.slice()}));
    Promise.resolve(WXGC2_API.updateFavorites(folders)).then(result=>{if(result&&result.ok===false){st.favFolders=localFolders(localState.save);st._favItemCache=null;toast(result.message||'收藏夹没有保存成功。');}}).catch(()=>{st.favFolders=localFolders(localState.save);st._favItemCache=null;toast('收藏夹没有保存成功。');});
  }   // 变更由三代接口保存到当前存档。
  function favFolderOf(name){ const fs=favEnsure(); for(let i=0;i<fs.length;i++) if(fs[i].cards.indexOf(name)>=0) return i; return -1; }
  function favHas(name){ return favFolderOf(name)>=0; }
  function favAddLocal(name,idx){ const fs=favEnsure(); idx=(idx>=0&&idx<fs.length)?idx:0; fs.forEach(fd=>{ const k=fd.cards.indexOf(name); if(k>=0) fd.cards.splice(k,1); }); fs[idx].cards.unshift(name); favSave(); }
  function favRemoveLocal(name){ favEnsure().forEach(fd=>{ const k=fd.cards.indexOf(name); if(k>=0) fd.cards.splice(k,1); }); favSave(); }
  function favSyncFromCollected(){
    if(!st.collected) return; const keep=st.collected, fs=favEnsure();
    fs.forEach(fd=>{ const seen={}; fd.cards=fd.cards.filter(n=>keep.has(n)&&!seen[n]&&(seen[n]=1)); });
    keep.forEach(n=>{ if(favFolderOf(n)<0) fs[0].cards.unshift(n); });
    favSave();
  }
  /* 【性能专项M5】收藏项缓存：原版收藏抽屉开着时每帧对每张收藏卡做两次线性查找（清点热点#2）。
     缓存按卡名记忆，数据变化（markOwnership/upsertDict）时整体作废。 */
  function favItem(name){
    const fc=st._favItemCache||(st._favItemCache={}); if(fc[name]) return fc[name];
    // 图标/详情解析链（2026-07-06 加固·修"收藏夹 emoji 全变⭐"）：我的卡 → 公共词典 → 本地词库 → 收藏图标记忆(来自 /me/collections·永远有真图标) → META → 实在没有才⭐
    const mine=(st.myCards||[]).find(d=>d.n===name), dic=DICT.find(d=>d.n===name);
    const cm=COLL_META[name]||{}, m=META[name]||{}, d=mine||dic||{};   // ld 惰性查·前两者命中就不查（2026-07-06 审查修·性能）
    const e=m.e||d.e||cm.e||'⭐', cat=m.cat||d.cat||cm.cat||'收藏', seq=m.seq||d.seq||cm.seq||0, by=m.byName||m.by||d.byName||d.by||cm.byName||cm.by||'';
    const item=Object.assign({}, d, cm, {n:name,e:e,cat:cat,seq:seq,q:m.q||d.q||cm.q||'',byName:by,by:by,lim:m.lim||cardLim(d)||cm.lim||'',owned:st.owned&&st.owned.has(name),friendShared:!!(cm.friendShared||d.friendShared),providers:(cm.providers||d.providers||[])});
    decorateCard(item,firstFrameOn());
    return fc[name]=item;
  }
  function firstFrameOn(){ return false; }
  // 已解锁外观/永久能力（等级里程碑·来自 /me 的 account.unlocks）：frame头像框/cardskin卡面/tabletop台面/cardback卡背/canvas画布扩建
  function hasUnlock(kind){
    const preferences=localState&&localState.save&&localState.save.preferences||{};
    return kind==='cardback'&&preferences.cardBackId==='rainbow';
  }
  function canvasExpanded(){ return false; }
  function worldBounds(){ return canvasExpanded()?WORLD_LV45:WORLD_BASE; }
  function worldGrid(){
    const b=worldBounds(), stepX=CW+8, stepY=CH+8, mx=CW/2+8, my=CH/2+8;
    const baseCols=Math.max(1,Math.floor((WORLD_BASE_W-mx*2)/stepX)+1);
    const baseRows=Math.max(1,Math.floor((WORLD_BASE_H-my*2)/stepY)+1);
    if(!canvasExpanded()) return {stepX:stepX,stepY:stepY,cols:baseCols,rows:baseRows,firstX:mx,firstY:my};
    // 25% 后的尺寸不是卡牌步长的整数倍：新增列/行从两侧均分，旧整理网格坐标继续原地不动。
    const addCols=Math.max(0,Math.round((b.w-WORLD_BASE_W)/stepX));
    const addRows=Math.max(0,Math.round((b.h-WORLD_BASE_H)/stepY));
    return {stepX:stepX,stepY:stepY,cols:baseCols+addCols,rows:baseRows+addRows,
      firstX:mx-Math.floor(addCols/2)*stepX,firstY:my-Math.floor(addRows/2)*stepY};
  }
  function tabletopMode(){
    const id=(localState&&localState.save&&localState.save.preferences||{}).tabletopId;
    return id==='cosmos'?'cosmos':id==='deep'?'deep':'';
  }
  function isFirstCardData(){ return false; }
  function cardLim(d){
    const skin=(localState&&localState.save&&localState.save.preferences||{}).skinId;
    return skin&&skin!=='default'?skin:((d&&(d.lim||d.skin||d.card_skin))||'');
  }
  // 本源/词典在 bootData 拉到后才有·此处不再预填（数据全来自真后端）

  /* ---------- 词典搜索：一个看不见的输入框只负责"接键盘/弹手机软键盘"，文字由 Canvas 自己画 ----------
     （小游戏端将来用适配层换成 wx.showKeyboard / tt.showKeyboard，Canvas 渲染逻辑不变） */
  const dq=document.createElement('input');
  dq.type='text'; dq.maxLength=12;
  dq.setAttribute('autocomplete','off'); dq.setAttribute('autocorrect','off'); dq.setAttribute('autocapitalize','off'); dq.setAttribute('spellcheck','false');
  dq.style.cssText='position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:0;border:0;outline:0;background:transparent;color:transparent;caret-color:transparent;font-size:16px;padding:0;margin:0;z-index:5;';
  document.body.appendChild(dq); registerInput(dq);
  // 彩蛋：词典搜特定词→俏皮回应（每个词每次会话只冒一次·顶部 toast·不影响正常搜索）
  const DICT_EGGS={ '彩蛋':'别找了，彩蛋才不在词典里~', '厂长':'厂长不就是你嘛！', '无限工厂':'整个工厂可装不进一张卡哦~', '无限工厂2':'整个工厂可装不进一张卡哦~' };
  const _dictEggSeen=new Set();
  function eggDictSearch(q){ q=String(q||'').trim(); const r=DICT_EGGS[q]; if(!r||_dictEggSeen.has(q)) return; _dictEggSeen.add(q); toast(r); }
  dq.addEventListener('input',()=>{ st.dictQuery=dq.value; st.dictScroll=0; eggDictSearch(dq.value); triggerDictServerSearch(); });   // 公共/个人搜索与分类、字数共用同一组服务器筛选
  dq.addEventListener('focus',()=>{ st.dictSearchActive=true; });
  dq.addEventListener('blur',()=>{ st.dictSearchActive=false; });
  const fq=document.createElement('input');
  fq.type='text'; fq.maxLength=12;
  fq.setAttribute('autocomplete','off'); fq.setAttribute('autocorrect','off'); fq.setAttribute('autocapitalize','off'); fq.setAttribute('spellcheck','false');
  fq.style.cssText=dq.style.cssText;
  document.body.appendChild(fq); registerInput(fq);
  fq.addEventListener('input',()=>{ st.favQuery=fq.value; st.favScroll=0; });
  fq.addEventListener('focus',()=>{ st.favSearchActive=true; });
  fq.addEventListener('blur',()=>{ st.favSearchActive=false; });
  /* 把隐形输入框对齐到搜索框位置（手机软键盘会贴着它弹），词典没开就挪走防误聚焦 */
  function syncSearchBox(){
    const r=cvRect(), sxr=r.width/W, syr=r.height/H;   // 【M5】画布位置走引擎缓存·不再每帧强制布局查询
    const hide=inp=>{ if(document.activeElement===inp) inp.blur(); inp.style.left='-9999px'; };
    if(st.dictOpen && st.dictT>=0.9){
      dq.style.pointerEvents='auto';   // 【v42修复】切场景收纳后必须恢复可点击——手机上直接点输入框原生弹键盘（玩家反馈：搜索点了没反应）
      // 【2026-07-05 手机防误触修复】隐形输入框内缩留安全边距·尤其下边多留(IMB)，离下方视图标签(新卡/收藏榜/借用榜…)更远——
      //   免得手指点标签时触摸范围够到它、误弹键盘(玩家反馈)。仍覆盖搜索框中心大片区域，"点搜索框弹键盘"原功能不受影响。
      var IMX=4, IMT=3, IMB=8;   // 左右/上/下内缩(逻辑px)
      dq.style.left=(r.left+(st.panelX+8+IMX)*sxr)+'px'; dq.style.top=(r.top+(st.TICK_H+8+IMT)*syr)+'px';
      dq.style.width=((st.DICT_W-16-IMX*2)*sxr)+'px'; dq.style.height=(Math.max(14,(st._dictBoxH||28)-IMT-IMB)*syr)+'px';   // 高度跟随词典大字模式的搜索框·下留 IMB 安全边距·至少 14px 保证可点
    } else hide(dq);
    const fd=st._favDrawer;
    if(fd&&st.favOpen&&st.favT>0.75&&fd.searchX!=null){
      fq.style.pointerEvents='auto';   // 【v42修复】同上·收藏搜索
      fq.style.left=(r.left+fd.searchX*sxr)+'px'; fq.style.top=(r.top+fd.searchY*syr)+'px';
      fq.style.width=(fd.searchW*sxr)+'px'; fq.style.height=(fd.searchH*syr)+'px';
    } else hide(fq);
  }
  let _myRecentCache=null, _recentStamp=0, _dataStamp=0, _dictCache=null;
  function loadMyRecentOrder(){ if(_myRecentCache) return _myRecentCache;
    try{ const a=JSON.parse(localStorage.getItem(MY_RECENT_KEY)||'[]'); _myRecentCache=Array.isArray(a)?a.filter(Boolean).slice(0,200):[]; }catch(_){ _myRecentCache=[]; }
    return _myRecentCache; }
  function saveMyRecentOrder(a){ _myRecentCache=(a||[]).filter(Boolean).slice(0,200); _recentStamp++;
    try{ localStorage.setItem(MY_RECENT_KEY,JSON.stringify(_myRecentCache)); }catch(_){} }
  function touchMyRecent(name){ if(!name)return; const a=loadMyRecentOrder().filter(n=>n!==name); a.unshift(name); saveMyRecentOrder(a); }
  function myRecentRankMap(){ const m={}; loadMyRecentOrder().forEach((n,i)=>{ if(m[n]==null) m[n]=i; }); return m; }
  function sortByMyRecent(ns){ const recent=myRecentRankMap(); ns.sort((a,b)=>{ const ra=(recent[a.n]!=null)?recent[a.n]:999999, rb=(recent[b.n]!=null)?recent[b.n]:999999;
    return (ra-rb)||((b.unlockedTs||0)-(a.unlockedTs||0))||((b.seq||0)-(a.seq||0)); }); return ns; }
  function cardNameLength(name){return Array.from(String(name||'')).length;}
  function dictFacetActive(){return st.dictCat!=='全部'||!!st.dictLen;}
  function ensureDictView(){_dictCache=null;}
  function triggerDictServerSearch(){_dictCache=null;}

  /* ---------- 操作说明：沿用二代分章、翻页和滚动交互 ---------- */
  var TUT_SEEN_KEY='wxgc3_tutorial_seen';
  var TUTORIAL=[
    {title:'合成卡牌',items:[
      '从金、木、水、火、土开始。把台面上两张卡拖到一起，就能合成。',
      '点右下角打开多卡合成台，可以放入 2 到 4 张材料；同一种卡可以重复放入。',
      '新组合使用你配置的 AI 服务。等待时卡背会持续晃动，保存完成后才揭晓结果。',
      '一次最多同时请求 4 组新组合。请求中的卡背下方可以取消；失败或取消后材料会放回。',
      '配方保存在当前存档。同样的材料再次合成会直接使用已有配方，无需请求 AI。',
      '出现等待保存时，请按提示重试保存；重试保存不会再次请求 AI。'
    ]},
    {title:'台面与词典',items:[
      '点击台面卡牌查看详情；在详情中可以收藏、分享，或加入合成台。',
      '右侧词典保存这份存档已发现的卡牌，可以按名字、编号、分类和字数查找。点词典中的卡牌可以取到台面。',
      '左侧收藏抽屉可以按收藏夹查找卡牌。详情中的收藏按钮用于加入或取消收藏。',
      '拖动空白处平移台面，鼠标滚轮或手机双指捏合可以缩放。固定画布后暂停平移和缩放。',
      '钉住的台面卡牌参与合成后仍留在原处；整理画布会保留已钉住卡牌的位置。'
    ]},
    {title:'存档与 Mod',items:[
      '在更多中管理存档。每份存档独立保存卡牌、配方、历史、台面、收藏和 Mod 状态。',
      '导出存档可以留作备份或分享给好友。导入会新增一份存档。API Key 不会随存档导出。',
      '在 Mod 中导入内容包或玩法扩展，按需启用。更换 Mod 不会删除已经发现的卡牌和历史。',
      '合成历史和配方表可以查看材料与结果，并把已发现的卡牌放回台面。',
      '外观中可以选择台面、卡牌皮肤、卡背和音效，也支持 Mod 提供的外观。'
    ]},
    {title:'API 与设置',items:[
      '在 API 配置中填写你自己的服务地址、模型和 Key，检测通过后即可尝试新组合。调用费用由对应 AI 服务收取。',
      '已发现的卡牌、收藏和已有配方保存在本机；新组合仍需连接你配置的 AI 服务。',
      '更多中的提示词可以切换合成主题，设置中可以调整画面、音乐和音效。',
      '主页的大数字显示这份存档已经发现的卡牌数量。'
    ]}
  ];
  function tutItemText(it){return String(it||'');}
  function tutChapters(){return TUTORIAL;}
  function tutWrap(text,maxW){ ctx.font=SB(13); var lines=[],cur=''; for(var i=0;i<text.length;i++){ var ch=text.charAt(i); if(cur&&ctx.measureText(cur+ch).width>maxW){ lines.push(cur); cur=ch; } else cur+=ch; } if(cur)lines.push(cur); return lines; }
  var _tutChap=0, _tutT0=null, _tutScroll=0, _tutMaxScroll=0, _tutBtns=null, _tutDrag=null;
  function openTutorial(){ _tutChap=0; _tutScroll=0; _tutT0=null; _tutDrag=null; OVERLAY={ draw:tutDraw, hit:tutDown, move:tutMove, up:tutUp, wheel:tutWheel }; }
  function tutClose(){ try{ localStorage.setItem(TUT_SEEN_KEY,'1'); }catch(_){} try{ initAudio(); sfxClick(); }catch(_){} OVERLAY=null; _tutT0=null; _tutDrag=null; }
  function maybeShowTutorial(){ try{ if(STILL) return; if(OVERLAY) return; if(st.noticeQueue&&st.noticeQueue.length) return; if(localStorage.getItem(TUT_SEEN_KEY)) return; openTutorial(); }catch(_){} }
  function inTut(p,r){ return r&&p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h; }
  function tutGo(delta){ var chs=tutChapters(); var n=chs.length; var nc=clamp(_tutChap+delta,0,n-1); if(nc!==_tutChap){ _tutChap=nc; _tutScroll=0; _tutT0=null; try{ initAudio(); sfxClick(); }catch(_){} } }
  function tutClick(p){ var b=_tutBtns; if(!b) return;
    if(inTut(p,b.close)){ tutClose(); return; }
    if(b.prev && inTut(p,b.prev)){ tutGo(-1); return; }
    if(inTut(p,b.next)){ if(b.last) tutClose(); else tutGo(1); return; } }
  function tutDown(p){ _tutDrag={ y:p.y, s:_tutScroll, moved:false }; }
  function tutMove(p){ if(!_tutDrag) return; if(Math.abs(p.y-_tutDrag.y)>5) _tutDrag.moved=true; _tutScroll=clamp(_tutDrag.s-(p.y-_tutDrag.y),0,_tutMaxScroll); }
  function tutUp(p){ if(!_tutDrag) return; var moved=_tutDrag.moved; _tutDrag=null; if(!moved) tutClick(p); }
  function tutWheel(e){ _tutScroll=clamp(_tutScroll+e.deltaY,0,_tutMaxScroll); }
  function tutDraw(t){
    var chs=tutChapters(); if(!chs.length){ OVERLAY=null; return; }
    if(_tutChap>=chs.length) _tutChap=chs.length-1;
    var ch=chs[_tutChap];
    if(_tutT0==null) _tutT0=t; var el=Math.max(0,t-_tutT0), e2=ease.outCubic(clamp(el/300,0,1));
    ctx.save(); ctx.globalAlpha=clamp(el/220,0,1); ctx.fillStyle='rgba(47,58,74,.55)'; ctx.fillRect(0,0,W,H); ctx.restore();
    var pw=Math.min(600,W-32), ph=Math.min(500,H-24), px=Math.round(W/2-pw/2), py=Math.round(H/2-ph/2+(1-e2)*18);
    ctx.save(); ctx.globalAlpha=e2;
    block(px,py,pw,ph,18,PANEL,INK,2.5,6);
    // 标题 + 关闭✕
    ctx.textBaseline='middle'; drawEmoji('📖',px+26,py+29,19); ctx.font=B(19); ctx.fillStyle=INK; ctx.textAlign='left'; ctx.fillText('新手教程',px+44,py+30);
    var clsX=px+pw-28, clsY=py+29; ctx.font=B(18); ctx.fillStyle=MUTE; ctx.textAlign='center'; ctx.fillText('✕',clsX,clsY);
    // 章名 + 进度
    ctx.font=SB(13.5); ctx.fillStyle=GOLD2; ctx.textAlign='left'; ctx.fillText('第 '+(_tutChap+1)+' 章 · '+ch.title,px+26,py+55);
    ctx.font=SB(12); ctx.fillStyle=MUTE; ctx.textAlign='right'; ctx.fillText((_tutChap+1)+' / '+chs.length,px+pw-26,py+55);
    ctx.strokeStyle=LINE; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(px+22,py+70); ctx.lineTo(px+pw-22,py+70); ctx.stroke();
    // 条目区(裁剪+滚动)
    var listX=px+22, listY=py+80, listW=pw-44, listBottom=py+ph-54, listH=listBottom-listY;
    ctx.save(); rr(listX-2,listY-2,listW+4,listH+4,8); ctx.clip();
    var yy=listY-_tutScroll;
    for(var i=0;i<ch.items.length;i++){ var it=ch.items[i], txt=tutItemText(it), web=false;
      var lines=tutWrap(txt,listW-30), rowH=lines.length*19+13;
      if(yy+rowH>listY-40 && yy<listBottom+40){
        block(listX,yy,listW,rowH-9,10, web?'#f8efdc':CREAM, LINE,1.2,1);
        var cyc=yy+(rowH-9)/2; ctx.beginPath(); ctx.arc(listX+14,cyc,3.4,0,7); ctx.fillStyle=web?GOLD2:TEAL; ctx.fill();
        ctx.font=SB(13); ctx.fillStyle=INK; ctx.textAlign='left'; ctx.textBaseline='middle';
        var ty=cyc-(lines.length-1)*9.5; for(var j=0;j<lines.length;j++){ ctx.fillText(lines[j], listX+28, ty+j*19); }
      }
      yy+=rowH;
    }
    ctx.restore();
    _tutMaxScroll=Math.max(0,(yy+_tutScroll-listY)-listH);
    if(_tutMaxScroll>0){ var contentH=yy+_tutScroll-listY, tr=Math.max(24,listH*listH/contentH), tby=listY+(listH-tr)*(_tutScroll/_tutMaxScroll); block(px+pw-13,tby,3,tr,2,'rgba(35,48,58,.22)',null,0,0); }
    // 底部：上一章 / 页码点 / 下一章·完成
    var footY=py+ph-28, bw=98, bh=34, prevOn=_tutChap>0, last=_tutChap>=chs.length-1;
    var dotN=chs.length, dotGap=13, dx=W/2-(dotN*dotGap)/2+dotGap/2;
    for(var d=0;d<dotN;d++){ ctx.beginPath(); ctx.arc(dx+d*dotGap,footY,d===_tutChap?4:3,0,7); ctx.fillStyle=d===_tutChap?GOLD:'#d8cfbc'; ctx.fill(); }
    block(px+22,footY-bh/2,bw,bh,10, prevOn?PANEL:'#efe8da', INK, prevOn?2.2:1.2,2); ctx.font=B(13); ctx.fillStyle=prevOn?INK:MUTE; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('‹ 上一章',px+22+bw/2,footY);
    block(px+pw-22-bw,footY-bh/2,bw,bh,10, GOLD, INK,2.5,3); ctx.fillStyle=INK; ctx.font=B(13); ctx.fillText(last?'完成 ✓':'下一章 ›',px+pw-22-bw/2,footY);
    _tutBtns={ close:{x:clsX-18,y:clsY-18,w:36,h:36}, prev:prevOn?{x:px+22,y:footY-bh/2,w:bw,h:bh}:null, next:{x:px+pw-22-bw,y:footY-bh/2,w:bw,h:bh}, last:last };
    ctx.restore();
  }

  // #1 TapTap 成就实时上报——2026-07-11 已下沉到全局：client.js 的 me() 在必经之路挂钩 __WXGC2_ON_NEW_ACH(处理器在 99-启动.js·弹横幅+报TapTap)·
  //   任何页面任何 /me 触发的解锁都能报到·治"在工厂以外的页面解锁→newAchievements 被丢弃→TapTap 漏报"。
  //   本场景原 TT_STEP 表 + reportAchievements 已整体搬走·勿在场景内重复处理(横幅会弹两次)。

  function computeDictRaw(){
    let list=(st.myCards||[]).slice(),raw=st.dictQuery.trim();
    if(st.dictView==='collected')list=list.filter(card=>st.collected&&st.collected.has(card.n));
    if(st.dictCat!=='全部')list=list.filter(card=>card.cat===st.dictCat);
    if(st.dictLen)list=list.filter(card=>cardNameLength(card.n)===st.dictLen);
    if(raw){const query=raw.toLowerCase(),digits=/^#?\d+$/.test(query),number=query.replace(/^#/,'');
      list=list.filter(card=>card.n.toLowerCase().includes(query)||(digits&&String(card.seq).includes(number)));
      const rank=card=>card.n.toLowerCase()===query||(digits&&String(card.seq)===number)?0:card.n.toLowerCase().startsWith(query)?1:2;
      list.sort((a,b)=>rank(a)-rank(b)||a.seq-b.seq);
    }else sortByMyRecent(list);
    return {list,qActive:!!raw,filterActive:dictFacetActive(),serverFilterActive:false,filterLoading:false};
  }
  /* 【性能专项M5】词典结果缓存：原版每帧全量 filter+sort（清点热点#1·卡越多越卡）。
     现在只有"视图/分类/搜索词/数据条数/最近顺序/拥有态"任一变化才重算，其余帧直接复用上次结果。 */
  function computeDict(){ const v=st.dictView;
    const key=v+'|'+st.dictCat+'|'+st.dictLen+'|'+st.dictQuery+'|'+((st.myCards&&st.myCards.length)||0)+'|'+_recentStamp+'|'+_dataStamp;
    if(_dictCache&&_dictCache.key===key) return _dictCache.res;
    const res=computeDictRaw(); _dictCache={key,res}; return res; }
  function photoHidden(){ return !!(st.photoMode&&st.photoMode.phase==='hidden'); }
  function computeGeom(){
    if(photoHidden()){   // 净屏时工作台铺满整块画布；退出后恢复原词典宽度与视图坐标
      st.panelX=W; st.dictContentW=st.DICT_W; st.DICT_X=W; st.PLAY_W=W; st.PLAY_H=H-st.TICK_H;
      st.toggleRect={x:W+40,y:0,w:0,h:0}; return;
    }
    st.panelX=W-st.DICT_W*st.dictT; st.dictContentW=st.DICT_W; st.DICT_X=st.panelX; st.PLAY_W=st.panelX; st.PLAY_H=H-st.TICK_H;
    const bw=30,bh=58,by=st.TICK_H+st.PLAY_H/2-bh/2; st.toggleRect={x:st.panelX-bw+3,y:by,w:bw,h:bh}; }   // 词典:开=右侧整块;收=滑出右缘·只留小开关标签(右缘+3 塞进词典盖住左边框→连成一体)
  function layout(){ st.TICK_H=0; const room=Math.max(230,W-92); st.DICT_W=Math.min(clamp(W*0.34,320,380),room); computeGeom(); clampView(); }
  function startPhotoMode(){
    if(st.photoMode) return;
    const now=performance.now(), hideAt=now+2000;
    clearGestures(); st.menuOpen=false; st.cardBubble=null; st.dictSearchActive=false; st.favSearchActive=false;
    try{ dq.blur(); fq.blur(); }catch(_){}
    st.photoMode={ phase:'countdown', hideAt, restoreAt:hideAt+10000, view:{x:view.x,y:view.y,s:view.s} };
  }
  function finishPhotoMode(reason,silent){
    const pm=st.photoMode; if(!pm) return;
    st.photoMode=null; clearGestures();
    if(pm.view){ view.x=pm.view.x; view.y=pm.view.y; view.s=pm.view.s; }
    computeGeom(); clampView();
    if(!silent) toast(reason==='auto'?'截图模式已自动结束':(reason==='cancel'?'已取消截图模式':'界面已恢复'));
  }
  function updatePhotoMode(now){
    const pm=st.photoMode; if(!pm) return false;
    if(pm.phase==='countdown'&&now>=pm.hideAt){ pm.phase='hidden'; clearGestures(); st.cardBubble=null; }
    if(pm.phase==='hidden'&&now>=pm.restoreAt){ finishPhotoMode('auto'); return false; }
    return photoHidden();
  }
  function drawPhotoCountdown(now){
    const pm=st.photoMode; if(!pm||pm.phase!=='countdown') return;
    const sec=Math.max(1,Math.ceil((pm.hideAt-now)/1000)), w=Math.min(384,W-32), h=78, x=W/2-w/2, y=H/2-h/2;
    ctx.save(); ctx.fillStyle='rgba(35,48,58,.18)'; ctx.fillRect(0,0,W,H);
    block(x,y,w,h,16,PANEL,INK,2.5,4);
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=B(17); ctx.fillStyle=GOLD2; ctx.fillText('📸 '+sec+' 秒后进入截图模式',W/2,y+27);
    ctx.font=SB(11.5); ctx.fillStyle=MUTE; ctx.fillText('净屏后轻触屏幕 / 按 Esc 恢复 · 10 秒后自动返回',W/2,y+54);
    ctx.restore();
  }
  // 引擎层的 toast / 成就横幅 / 奖励飞行动画也要一起藏掉，保证导出的画面真正干净。
  window.__WXGC2_SCREENSHOT_CLEAN=function(){ return CUR_NAME==='工厂界面'&&photoHidden(); };
  function mk(n,e,cat,by,seq,wx,wy,origin,only,q,season){ return {n,e,cat,by,seq,x:wx,y:wy,tx:wx,ty:wy,scale:1,tscale:1,origin:!!origin,only:!!only,owned:true,q:q||'',season:!!season}; }
  const BASE_SEED_POINTS=[[640,430],[800,360],[960,460],[720,600],[900,640],[1060,400],[800,760],[1040,740]];
  function resetBaseView(){
    view.s=1; view.x=st.PLAY_W/2-850; view.y=st.PLAY_H/2-590;
    // 只在没有保存画布、首次铺本源时调用。按整组卡的边界适配视角，不改玩家保存的摆放。
    // 原固定中心在小横屏会裁掉日月星辰；预留左侧收藏、右侧工具和底部HUD，不让卡藏在按钮后。
    if(BASES.length){
      const pts=BASE_SEED_POINTS.slice(0,Math.min(BASES.length,BASE_SEED_POINTS.length));
      const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
      const left=Math.min(...xs)-CW/2-10,right=Math.max(...xs)+CW/2+10,top=Math.min(...ys)-CH/2-12,bottom=Math.max(...ys)+CH/2+12;
      const compact=st.PLAY_W<480,safeW=Math.max(1,st.PLAY_W-(compact?16:210)),safeH=Math.max(1,st.PLAY_H-112);
      view.s=clamp(Math.min(1,safeW/(right-left),safeH/(bottom-top)),Z_MIN,Z_MAX);
      view.x=(compact?8:42)+safeW/2-(left+right)/2*view.s;
      view.y=24+safeH/2-(top+bottom)/2*view.s;
    }
    clampView();
  }
  function seedBases(bases){ const pts=BASE_SEED_POINTS;   // 把后端本源(rar=9)铺到画布·bootData 拉到后调一次
    bases.forEach((b,i)=>{ const p=pts[i%pts.length]; st.cards.push(mk(b.n,b.e,b.cat,'',b.seq||0,p[0],p[1],true,false,b.q,true)); }); }   // 本源都是本季卡
  function worldToScreen(wx,wy){ return {x:view.x+wx*view.s, y:st.TICK_H+view.y+wy*view.s}; }
  function screenToWorld(sx,sy){ return {x:(sx-view.x)/view.s, y:(sy-st.TICK_H-view.y)/view.s}; }
  function clampView(){ const b=worldBounds(), fw=b.w*view.s, fh=b.h*view.s, M=Math.min(180,fw*.5,fh*.5);
    const loX=M-b.maxX*view.s,hiX=st.PLAY_W-M-b.minX*view.s; view.x=loX>hiX?(st.PLAY_W-(b.minX+b.maxX)*view.s)/2:clamp(view.x,loX,hiX);
    const loY=M-b.maxY*view.s,hiY=st.PLAY_H-M-b.minY*view.s; view.y=loY>hiY?(st.PLAY_H-(b.minY+b.maxY)*view.s)/2:clamp(view.y,loY,hiY); }



  /* ---------- 画布(1代背景) ---------- */
  function drawPlay(now,clean){ ctx.save(); ctx.beginPath(); ctx.rect(0,st.TICK_H,st.PLAY_W,st.PLAY_H); ctx.clip();
    const tabletop=tabletopMode(),star=!!tabletop;
    const tabletopId=(localState&&localState.save.preferences||{}).tabletopId;
    const custom=WXGC3_UI.getAppearance&&WXGC3_UI.getAppearance('tabletops',tabletopId);
    const tabletopCacheKey=custom?custom.id+':'+custom.gridColor:tabletop;
    if(tabletop==='cosmos'){
      // S3 半程「星空台面」：墨蓝底、金色编号星轨与青色观测点；与 50 级纯蓝静星台面明确区分。
      const cg=ctx.createLinearGradient(0,st.TICK_H,st.PLAY_W,st.TICK_H+st.PLAY_H);cg.addColorStop(0,'#121829');cg.addColorStop(.55,'#17233a');cg.addColorStop(1,'#0d1628');ctx.fillStyle=cg;ctx.fillRect(0,st.TICK_H,st.PLAY_W,st.PLAY_H);
      ctx.save();ctx.lineWidth=1.15;ctx.strokeStyle='rgba(89,195,184,.19)';
      for(let i=0;i<5;i++){const cx=st.PLAY_W*(.18+i*.19),cy=st.TICK_H+st.PLAY_H*(.2+(i%3)*.27),r=70+i*17;ctx.beginPath();ctx.arc(cx,cy,r,-.65,2.75);ctx.stroke();}
      ctx.setLineDash([5,8]);ctx.strokeStyle='rgba(232,187,90,.22)';ctx.beginPath();ctx.moveTo(-20,st.TICK_H+st.PLAY_H*.72);ctx.bezierCurveTo(st.PLAY_W*.28,st.TICK_H+st.PLAY_H*.28,st.PLAY_W*.61,st.TICK_H+st.PLAY_H*.9,st.PLAY_W+30,st.TICK_H+st.PLAY_H*.34);ctx.stroke();ctx.setLineDash([]);
      for(let i=0;i<38;i++){const sx=limRnd(i+117)*st.PLAY_W,sy=st.TICK_H+limRnd(i+219)*st.PLAY_H,major=i%7===0,r=major?2.3:1.15;ctx.beginPath();ctx.arc(sx,sy,r,0,6.2832);ctx.fillStyle=major?'rgba(244,198,99,.82)':'rgba(134,224,215,.55)';ctx.fill();if(major&&FXSET.fx){const a=.18+.22*Math.abs(Math.sin(now*.0014+i));ctx.beginPath();ctx.arc(sx,sy,5.5,0,6.2832);ctx.strokeStyle='rgba(244,198,99,'+a+')';ctx.stroke();}}
      ctx.restore();
      const cvg=ctx.createRadialGradient(st.PLAY_W*.52,st.TICK_H+st.PLAY_H*.46,10,st.PLAY_W*.52,st.TICK_H+st.PLAY_H*.46,st.PLAY_W*.62);cvg.addColorStop(0,'rgba(42,101,135,.05)');cvg.addColorStop(1,'rgba(3,7,17,.58)');ctx.fillStyle=cvg;ctx.fillRect(0,st.TICK_H,st.PLAY_W,st.PLAY_H);
    } else if(tabletop==='deep'){
      // 深蓝夜空渐变 + 满天静星(离屏缓存·星空是"背景天空"不随卡平移) + 少量呼吸星 + 暗角
      const g0=ctx.createLinearGradient(0,st.TICK_H,0,st.TICK_H+st.PLAY_H); g0.addColorStop(0,'#0e2340'); g0.addColorStop(1,'#1a3a63'); ctx.fillStyle=g0; ctx.fillRect(0,st.TICK_H,st.PLAY_W,st.PLAY_H);
      { let sc2=st._starCache;
        if(!sc2||sc2.pw!==st.PLAY_W||sc2.ph!==st.PLAY_H||sc2.S!==S){
          const off=document.createElement('canvas'); off.width=Math.max(2,Math.ceil(st.PLAY_W*S)); off.height=Math.max(2,Math.ceil(st.PLAY_H*S));
          const oc=off.getContext('2d'); oc.scale(S,S);
          for(let i=0;i<52;i++){ const sx=limRnd(i+11)*st.PLAY_W, sy=limRnd(i+61)*st.PLAY_H, sz=limRnd(i+99)<0.85?1.1:1.9;
            oc.beginPath(); oc.arc(sx,sy,sz,0,6.2832); oc.fillStyle='rgba(226,238,255,'+(0.30+limRnd(i+7)*0.35)+')'; oc.fill(); }
          sc2=st._starCache={c:off,pw:st.PLAY_W,ph:st.PLAY_H,S};
        }
        ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.drawImage(sc2.c,0,st.TICK_H*S); ctx.restore(); }
      if(FXSET.fx){ for(let i=0;i<9;i++){ const sx=limRnd(i+31)*st.PLAY_W, sy=st.TICK_H+limRnd(i+81)*st.PLAY_H;   // 呼吸星(仅特效开·9颗·极轻)
          const a=0.25+0.55*Math.abs(Math.sin(now*0.0011+i*1.3));
          ctx.beginPath(); ctx.arc(sx,sy,1.7,0,6.2832); ctx.fillStyle='rgba(226,238,255,'+a+')'; ctx.fill(); } }
      const vg=ctx.createRadialGradient(st.PLAY_W/2,st.TICK_H+st.PLAY_H/2,st.PLAY_W*0.2,st.PLAY_W/2,st.TICK_H+st.PLAY_H/2,st.PLAY_W*0.62);
      vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(4,12,26,.5)'); ctx.fillStyle=vg; ctx.fillRect(0,st.TICK_H,st.PLAY_W,st.PLAY_H);
    } else {
      // 暖白工作台
      const g0=ctx.createLinearGradient(0,st.TICK_H,0,st.TICK_H+st.PLAY_H); g0.addColorStop(0,'#f6f1e8'); g0.addColorStop(1,'#ece5d8'); ctx.fillStyle=g0; ctx.fillRect(0,st.TICK_H,st.PLAY_W,st.PLAY_H);
    }
    if(custom){
      ctx.fillStyle=custom.color;ctx.fillRect(0,st.TICK_H,st.PLAY_W,st.PLAY_H);
      const media=window.WXGC3_LEGACY_MEDIA,image=media&&media.images.get(custom.image);
      if(image){ctx.save();ctx.globalAlpha=.35;ctx.drawImage(image,0,st.TICK_H,st.PLAY_W,st.PLAY_H);ctx.restore();}
    }
    // 蓝图点阵(随平移移动·工作台质感)【性能专项M5】离屏缓存：像素结果与原版逐点一致，
    //   只在"缩放/画布尺寸变化"时重画一次点阵（原来平移/静止时每帧数千次 fillRect·清点热点#4），平移=纯位块拷贝。
    //   深蓝星野下点阵换淡蓝(缓存键带主题·切台面自动重烘)。
    { const step=Math.max(16,28*view.s), oxp=((view.x%step)+step)%step, oyp=((view.y%step)+step)%step;
      let dc=st._dotCache;
      if(!dc||dc.step!==step||dc.pw!==st.PLAY_W||dc.ph!==st.PLAY_H||dc.S!==S||dc.tabletop!==tabletopCacheKey){
        const cw2=Math.ceil((st.PLAY_W+step*2)*S), ch2=Math.ceil((st.PLAY_H+step*2)*S);
        const off=document.createElement('canvas'); off.width=Math.max(2,cw2); off.height=Math.max(2,ch2);
        const oc=off.getContext('2d'); oc.scale(S,S); oc.fillStyle=custom?custom.gridColor:tabletop==='cosmos'?'rgba(131,214,207,.10)':star?'rgba(150,195,240,.14)':'rgba(60,80,95,.07)';
        for(let gx=0; gx<st.PLAY_W+step*2; gx+=step){ for(let gy=0; gy<st.PLAY_H+step*2; gy+=step){ oc.fillRect(gx,gy,1.5,1.5); } }
        dc=st._dotCache={c:off,step,pw:st.PLAY_W,ph:st.PLAY_H,S,tabletop:tabletopCacheKey};
      }
      ctx.save(); ctx.setTransform(1,0,0,1,0,0);
      ctx.drawImage(dc.c, (step-oxp)*S,(step-oyp)*S, st.PLAY_W*S, st.PLAY_H*S, 0, st.TICK_H*S, st.PLAY_W*S, st.PLAY_H*S);
      ctx.restore(); }
    // 中央造物射灯(星野下换淡蓝月光·弱一档)
    const cxl=st.PLAY_W*0.5, cyl=st.TICK_H+st.PLAY_H*0.46, lg=ctx.createRadialGradient(cxl,cyl,8,cxl,cyl,st.PLAY_W*0.52);
    if(tabletop==='cosmos'){ lg.addColorStop(0,'rgba(222,184,91,.11)'); lg.addColorStop(1,'rgba(222,184,91,0)'); }
    else if(star){ lg.addColorStop(0,'rgba(170,215,255,.16)'); lg.addColorStop(1,'rgba(170,215,255,0)'); }
    else { lg.addColorStop(0,'rgba(255,252,240,.72)'); lg.addColorStop(1,'rgba(255,252,240,0)'); }
    ctx.fillStyle=lg; ctx.fillRect(0,st.TICK_H,st.PLAY_W,st.PLAY_H);
    // (造物涟漪圆圈已按用户要求去掉·只留中央柔光)
    // 世界框(细虚线·工坊风·星野下调亮)
    const wb=worldBounds(), tl=worldToScreen(wb.minX,wb.minY), br=worldToScreen(wb.maxX,wb.maxY); ctx.setLineDash([7,7]); ctx.lineWidth=2; ctx.strokeStyle=star?'rgba(205,228,255,.32)':'rgba(40,60,70,.22)'; rr(tl.x,tl.y,br.x-tl.x,br.y-tl.y,20); ctx.stroke(); ctx.setLineDash([]);
    // 普通卡先画，等待卡及取消在其上层；当前拖动卡最后画，避免可见层与命中层不一致。
    const drag=st.drag&&st.drag.card;st.cards.forEach(c=>{if(c!==drag)drawWCard(c,now);});
    // 造物等待=背面朝上的卡在轻晃·造好原地翻开（2026-07-10 用户拍板"给卡背造的舞台"·替代原青光气泡）
    //   普通玩家=素纸卡背；60级「彩虹卡背」解锁=虹辉星厂(引擎 cardBack rainbow)。上方保留"造物中…"小药丸(信息不丢)。
    if(!clean) st.pending.forEach(p=>{p.cancel=null; const s=worldToScreen(p.x,p.y), cw2=CW*view.s*0.92, ch2=CH*view.s*0.92;
      const sway=FXSET.fx?Math.sin(now*0.0032)*0.055:0, bob=FXSET.fx?Math.sin(now*0.0021)*3*view.s:0;
      ctx.save(); ctx.translate(0,bob); ctx.translate(s.x,s.y); ctx.rotate(sway); ctx.translate(-s.x,-s.y);
      cardBack(s.x,s.y,cw2,ch2,now,hasUnlock('cardback'));
      ctx.restore();
      const job=(localState&&localState.syntheses||[]).find(item=>item.id===p.operationId),phase=job&&job.phase;const txt=(phase==='save-failed'?'等待保存':phase==='saving'?'正在保存':p.global?'造物中':'合成中')+'·'.repeat(1+Math.floor(now/300%3));
      ctx.font=B(10.5*view.s); const tw2=ctx.measureText(txt).width, bw2=tw2+18*view.s, bh2=22*view.s, by2=s.y-ch2/2-bh2-6*view.s;
      ctx.save(); ctx.shadowColor=GLOW; ctx.shadowBlur=9*view.s; rr(s.x-bw2/2,by2,bw2,bh2,bh2/2); ctx.fillStyle=PANEL; ctx.fill(); ctx.restore();
      rr(s.x-bw2/2,by2,bw2,bh2,bh2/2); ctx.lineWidth=1.8; ctx.strokeStyle=TEAL; ctx.stroke();
      ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle=GOLD2; ctx.fillText(txt,s.x,by2+bh2/2+.5);
      if(p.operationId&&phase==='requesting'){
        const cancelY=s.y+ch2/2+7*view.s,cancelW=42*view.s,cancelH=21*view.s;
        block(s.x-cancelW/2,cancelY,cancelW,cancelH,8*view.s,PANEL,INK,1.3);
        ctx.font=B(9.5*view.s);ctx.fillStyle=MUTE;ctx.textAlign='center';ctx.fillText('取消',s.x,cancelY+cancelH/2);
        p.cancel={x:s.x-cancelW/2,y:cancelY,w:cancelW,h:cancelH};
        if(controlsFree())pushHot(p.cancel.x,p.cancel.y,p.cancel.w,p.cancel.h,()=>WXGC2_API.cancel(p.operationId));
      } });
    // 卡片(拖动中最后画)
    if(drag)drawWCard(drag,now);
    // 飘字
    if(!clean) st.floats.forEach(f=>{ const life=(f.until-now)/(f.until-f.born); if(life<=0)return; ctx.globalAlpha=Math.min(1,life*1.6); ctx.font=B(13); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle=f.color; ctx.fillText(f.text,f.x,f.y-(1-life)*30); ctx.globalAlpha=1; });
    ctx.restore(); }
  function drawWCard(c,now){ const s=worldToScreen(c.x,c.y), lift=(c===(st.drag&&st.drag.card)); card(s.x,s.y,CW*view.s*c.scale,CH*view.s*c.scale,c,{now,rot:lift?-0.05:0,lift}); }

  /* ---------- HUD 整条卡(B) + ☰更多 ---------- */
  function drawHUD(){
    const save=localState&&localState.save,count=save?save.stats.synthesisCount:0,found=save?save.cards.filter(card=>!card.isBase).length:0;
    const segs=[['⚒',count+' 次',GOLD2],['✦',found+' 张',INK]],segW=segs.map(part=>{ctx.font=B(13);return ctx.measureText(part[1]).width+50;});
    const moreW=78,total=segW.reduce((a,b)=>a+b,moreW),h=38,x=14,y=st.TICK_H+st.PLAY_H-h-12;
    block(x,y,total,h,12,PANEL,INK,2.5);
    let cx=x;segs.forEach((part,index)=>{ctx.textAlign='left';ctx.textBaseline='middle';drawEmoji(part[0],cx+18,y+h/2,15);ctx.font=B(13);ctx.fillStyle=part[2];ctx.fillText(part[1],cx+32,y+h/2+.5);cx+=segW[index];ctx.strokeStyle=LINE;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(cx,y+7);ctx.lineTo(cx,y+h-7);ctx.stroke();});
    ctx.font=B(15);ctx.fillStyle=INK;ctx.textAlign='left';ctx.fillText('☰',cx+12,y+h/2);ctx.font=B(13);ctx.fillText('更多',cx+32,y+h/2+.5);
    if(controlsFree())pushHot(cx,y,moreW,h,()=>{st.menuOpen=!st.menuOpen;sfxClick();});
  }
  function drawMenu(){
    if(!st.menuOpen||!controlsFree())return;
    const cols=W<334?1:2,iw=Math.min(148,W-44),ih=34,pad=8,cg=8,rows=Math.ceil(MENU.length/cols),h=pad*2+rows*ih+(rows-1)*4,w=pad*2+cols*iw+(cols-1)*cg,x=14,y=st.TICK_H+st.PLAY_H-62-h;
    block(x,y,w,h,14,PANEL,INK,2.5);
    const routes={'存档':'saves','Mod':'mods','合成历史':'history','配方表':'recipes','提示词':'prompt','外观':'appearance','API 配置':'api','设置':'settings','返回主页':'home'};
    MENU.forEach((item,index)=>{const ix=x+pad+(index%cols)*(iw+cg),iy=y+pad+Math.floor(index/cols)*(ih+4);
      block(ix,iy,iw,ih,9,CREAM,INK,1.6,2);ctx.textBaseline='middle';ctx.font=B(12.5);const lw=ctx.measureText(item[1]).width,gx=ix+iw/2-(24+lw)/2;
      drawEmoji(item[0],gx+8,iy+ih/2,15);ctx.fillStyle=INK;ctx.textAlign='left';ctx.font=B(12.5);ctx.fillText(item[1],gx+24,iy+ih/2+.5);
      pushHot(ix,iy,iw,ih,()=>{st.menuOpen=false;sfxClick();if(item[1]==='截图模式')startPhotoMode();else if(item[1]==='操作说明')openTutorial();else if(routes[item[1]])WXGC3_UI.open(routes[item[1]]);});
    });
  }

  /* ---------- 左上收藏抽屉（3 个收藏栏位·参考 1 代收藏夹） ---------- */
  function drawFavTile(x,y,w,h,d,now){
    dcell(x,y,w,h,d,now);
    // 用户拍板：词典卡格不放 🤝（太挤）；收藏抽屉与画布仍标出“这是使用权限，不是拥有”。
    if(d.friendShared&&!d.owned){ ctx.textAlign='center'; ctx.textBaseline='middle'; drawEmoji('🤝',x+10,y+h-10,Math.max(14,w*.22)); }
  }
  function drawFavDrawer(now){
    favEnsure(); st.favT += ((st.favOpen?1:0)-st.favT)*0.22;
    const fw=Math.min(clamp(W*0.27,252,332), Math.max(218,st.PLAY_W-54)), tabW=30, tabH=78;
    const y=st.TICK_H+10, h=clamp(st.PLAY_H-106,294,420), x=-fw*(1-st.favT), tx=x+fw-1, ty=y+18;
    const tabY=y+64, searchY=y+101, boxH=28, listY=y+138, listH=h-152;
    st._favDrawer={x,y,w:fw,h,tabX:tx,tabY:ty,tabW,tabH,searchX:x+12,searchY,searchW:fw-24,searchH:boxH,listX:x+12,listY,listW:fw-24,listH};
    if(st.favT>0.02){
      block(x,y,fw,h,0,PANEL,INK,2.5,4);
      ctx.textAlign='left'; ctx.textBaseline='middle'; drawEmoji('🗂️',x+25,y+29,21);
      ctx.font=B(17); ctx.fillStyle=INK; ctx.fillText('我的收藏',x+50,y+25);
      const fs=favEnsure(),gap=6,tw=(fw-24-gap*2)/3,th=29;
      st.favTab=clamp(st.favTab||0,0,Math.max(0,fs.length-1));
      const page=Math.floor(st.favTab/3),pageCount=Math.ceil(fs.length/3),start=page*3;
      ctx.font=SB(10.5);ctx.fillStyle=MUTE;ctx.fillText(pageCount>1?(fs.length+' 个栏位 · 第 '+(page+1)+'/'+pageCount+' 页'):(fs.length+' 个栏位 · 搜索后点卡取出'),x+50,y+45);
      st._favTabs=[];st._favPages=null;
      if(pageCount>1){
        const previous={x:x+fw-57,y:y+16,w:22,h:25},next={x:x+fw-31,y:y+16,w:22,h:25};st._favPages={previous:page>0?previous:null,next:page+1<pageCount?next:null};
        [[previous,'‹',page>0,-1],[next,'›',page+1<pageCount,1]].forEach(([r,label,enabled,delta])=>{
          block(r.x,r.y,r.w,r.h,7,CREAM,enabled?INK:LINE,1.4,1);ctx.font=B(20);ctx.fillStyle=enabled?INK:LINE;ctx.textAlign='center';ctx.fillText(label,r.x+r.w/2,r.y+r.h/2);
          if(enabled&&st.favT>.9)pushHot(r.x,r.y,r.w,r.h,()=>{st.favTab=Math.min(fs.length-1,(page+delta)*3+st.favTab%3);st.favScroll=0;sfxClick();});
        });
      }
      let cx=x+12,cy=tabY;
      fs.slice(start,start+3).forEach((fd,offset)=>{const i=start+offset; const on=i===st.favTab; block(cx,cy,tw,th,9,on?GOLD:CREAM,on?INK:'rgba(35,48,58,.65)',1.8,1.5);
        ctx.textAlign='center'; ctx.font=B(10.5); ctx.fillStyle=on?INK:MUTE; ctx.fillText(fitText(fd.name,tw-10,''),cx+tw/2,cy+11);
        ctx.font=SB(9); ctx.fillStyle=on?INK:'#aeb6c0'; ctx.fillText(fd.cards.length+' 张',cx+tw/2,cy+23);
        st._favTabs.push({x:cx,y:cy,w:tw,h:th,index:i,name:fd.name});
        if(st.favT>0.9) pushHot(cx,cy,tw,th,()=>{ st.favTab=i; st.favScroll=0; sfxClick(); });
        cx+=tw+gap; });
      const sx=x+12, sw=fw-24; block(sx,searchY,sw,boxH,9,'#fdfbf6',INK,2,2);
      ctx.textBaseline='middle'; ctx.textAlign='left'; drawEmoji('🔎',sx+14,searchY+boxH/2,13);
      const tx2=sx+30, hasQ=!!st.favQuery;
      if(hasQ){ ctx.font=SB(12.5); ctx.fillStyle=INK; ctx.fillText(fitText(st.favQuery,sw-58,''),tx2,searchY+boxH/2+.5); }
      else { ctx.font=SB(11.5); ctx.fillStyle=MUTE; ctx.fillText('搜收藏卡牌…',tx2,searchY+boxH/2+.5); }
      if(st.favSearchActive && Math.floor(now/500)%2===0){ ctx.font=SB(12.5); const twq=hasQ?ctx.measureText(st.favQuery).width:0; ctx.fillStyle=INK; ctx.fillRect(tx2+twq+2,searchY+7,1.6,boxH-14); }
      if(hasQ){ const cbx=sx+sw-16; ctx.beginPath(); ctx.arc(cbx,searchY+boxH/2,8,0,7); ctx.fillStyle='#cfd6df'; ctx.fill(); ctx.fillStyle='#fff'; ctx.font=B(10); ctx.textAlign='center'; ctx.fillText('✕',cbx,searchY+boxH/2+.5);
        if(st.favT>0.9) pushHot(cbx-10,searchY+2,22,boxH-4,()=>{ fq.value=''; st.favQuery=''; st.favScroll=0; fq.focus(); sfxClick(); }); }
      if(st.favT>0.9) pushHot(sx,searchY,sw-(hasQ?22:0),boxH,()=>{ fq.focus(); sfxClick(); });
      const listX=x+12, listW=fw-24, fd=fs[st.favTab]||fs[0];
      const raw=(fd.cards||[]).map(favItem), q=String(st.favQuery||'').trim().toLowerCase();
      const cards=q?raw.filter(d=>[d.n,d.cat,String(d.seq||''),d.e].some(v=>String(v||'').toLowerCase().indexOf(q)>=0)):raw;
      const tileGap=5, cols=clamp(Math.floor((listW+tileGap)/(54+tileGap)),2,5), tileH=58, tileW=(listW-tileGap*(cols-1))/cols;
      st._favCells=[]; ctx.save(); ctx.beginPath(); ctx.rect(listX,listY,listW,listH); ctx.clip();
      const rows=Math.ceil(cards.length/cols), contentH=cards.length?rows*(tileH+tileGap)-tileGap:0; st._favMaxScroll=Math.max(0,contentH-listH); st.favScroll=clamp(st.favScroll,0,st._favMaxScroll);
      if(!cards.length){ ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.globalAlpha=.55; drawEmoji(q?'🔍':'⭐',listX+listW/2,listY+listH*0.34,30); ctx.globalAlpha=1; ctx.font=SB(12); ctx.fillStyle=MUTE; ctx.fillText(q?'没找到匹配收藏':'这个收藏夹还空着',listX+listW/2,listY+listH*0.34+36); ctx.font=SB(10.5); ctx.fillStyle='#aeb6c0'; ctx.fillText(q?'换个词试试':'点卡牌详情里的收藏加入',listX+listW/2,listY+listH*0.34+56); }
      else cards.forEach((d,i)=>{ const gx=listX+(i%cols)*(tileW+tileGap), gy=listY+Math.floor(i/cols)*(tileH+tileGap)-st.favScroll; if(gy+tileH<listY||gy>listY+listH) return; drawFavTile(gx,gy,tileW,tileH,d,now); if(st.favT>0.9) st._favCells.push({x:gx,y:gy,w:tileW,h:tileH,d}); });
      ctx.restore();
      if(st._favMaxScroll>0){ const trackH=listH-4, thumbH=Math.max(30,trackH*listH/(contentH||1)), thumbY=listY+2+(trackH-thumbH)*(st.favScroll/st._favMaxScroll); rr(listX+listW-4,thumbY,3,thumbH,1.5); ctx.fillStyle='rgba(47,58,74,.25)'; ctx.fill(); }
    }
    block(tx,ty,tabW,tabH,0,st.favOpen?'#fff1c9':'#ffe9f0',INK,2.3,3);
    ctx.textAlign='center'; ctx.textBaseline='middle'; drawEmoji('⭐',tx+tabW/2,ty+18,15); ctx.font=B(13); ctx.fillStyle=st.favOpen?GOLD2:PINKB; ctx.fillText('收',tx+tabW/2,ty+41); ctx.fillText('藏',tx+tabW/2,ty+58);
    pushHot(tx,ty,tabW,tabH,()=>{ st.favOpen=!st.favOpen; st.favScroll=0; sfxClick(); });
  }
  function overFavList(p){ const d=st._favDrawer; return d&&st.favOpen&&st.favT>0.75&&p.x>=d.listX&&p.x<=d.listX+d.listW&&p.y>=d.listY&&p.y<=d.listY+d.listH; }
  function overFavPanel(p){ const d=st._favDrawer; return d&&st.favOpen&&st.favT>0.75&&p.x>=d.x&&p.x<=d.x+d.w&&p.y>=d.y&&p.y<=d.y+d.h; }

  /* ---------- 多卡合成台 ---------- */
  function controlsFree(){ return !externalBlocked&&!(window.WXGC3_UI&&WXGC3_UI.isModalOpen&&WXGC3_UI.isModalOpen())&&!st.photoMode&&!st.detail&&!st.share&&!st.confirmClear; }
  function drawRecentToggle(x,y,w,h){
    block(x,y,w,h,10,PANEL,INK,1.8,2);
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=B(10.5); ctx.fillStyle=INK; ctx.fillText('📜 最近',x+w/2,y+h/2+.5);
    if(controlsFree()) pushHot(x,y,w,h,()=>{ sfxClick(); setRecentCombinesVisible(true); });
  }
  function drawRecentCombines(x,y,w,h){
    const rows=(st.recentCombines||[]).slice(0,3);
    block(x,y,w,h,11,'rgba(253,251,246,.96)','rgba(35,48,58,.34)',1.6,1.5);
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.font=B(10.5); ctx.fillStyle=GOLD2; ctx.fillText('最近合成',x+9,y+10);
    if(w>=172){ const bw=34,bh=16,bx=x+w-bw-6,by=y+3; block(bx,by,bw,bh,7,PANEL,'rgba(35,48,58,.34)',1.1,0); ctx.textAlign='center'; ctx.font=B(9.5); ctx.fillStyle=MUTE; ctx.fillText('隐藏',bx+bw/2,by+bh/2+.5); if(controlsFree()) pushHot(bx,by,bw,bh,()=>{ sfxClick(); setRecentCombinesVisible(false); }); ctx.textAlign='left'; }
    if(!rows.length){ ctx.font=SB(10); ctx.fillStyle='#aeb6c0'; ctx.fillText('成功后显示最近 3 条',x+9,y+31); return; }
    const rowH=Math.max(12,(h-20)/3);
    rows.forEach((r,i)=>{
      const mats=(r.items||[]).map(it=>(it.e||'')+(it.n||'')).join('+');
      const res=((r.result&&r.result.e)||'')+((r.result&&r.result.n)||'');
      ctx.font=SB(10.3); ctx.fillStyle=i===0?INK:MUTE;
      ctx.fillText(fitText(mats+' → '+res,w-18,''),x+9,y+23+i*rowH);
    });
  }
  function drawCombine(){ if(!st.drawerOpen){
      // 右下角保留原来的多卡合成台入口。
        const items=[
        {ic:'🔧',t:'多卡合成台', gold:true,  fn:()=>{ st.drawerOpen=true; }} ];
      const compact=st.PLAY_W<480,h=34,gap=8,rx=(compact?W:st.DICT_X)-12,baseY=st.TICK_H+st.PLAY_H-h-12-(compact?52:0);   // 右边缘=DICT_X-12·最底按钮位置同原多卡合成台
      ctx.font=B(12.5); let mw=0; items.forEach(it=>{ const tw=ctx.measureText(it.ic+' '+it.t).width; if(tw>mw) mw=tw; }); const w=mw+24;   // 按钮统一宽=最宽项·整齐右对齐
      items.forEach((it,i)=>{ const x=rx-w, y=baseY-(items.length-1-i)*(h+gap);st._combineGeometry={open:false,toggle:{x,y,w,h}};
        const stroke=it.danger?'#c0492f':(it.lock&&st.canvasLocked?TEAL:INK), fill=it.gold?GOLD:(it.lock&&st.canvasLocked?'#e7f4f2':PANEL), fg=it.danger?'#c0492f':(it.lock&&st.canvasLocked?TEAL:INK);
        block(x,y,w,h,12,fill,stroke,2.5); ctx.fillStyle=fg; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=B(12.5); ctx.fillText(it.ic+' '+it.t,x+w/2,y+h/2+.5);
        if(it.gold){ const rw=Math.min(226,x-24); if(st.recentCombinesVisible){ if(rw>=154){ const rh=72, px=Math.max(12,x-rw-12), py=clamp(y+h-rh,st.TICK_H+8,H-rh-8); drawRecentCombines(px,py,rw,rh); } } else { const tw=74,th=28; if(x-24>=tw){ drawRecentToggle(x-tw-12,y+h-th,tw,th); } } }
        if(controlsFree()) pushHot(x,y,w,h,()=>{ sfxClick(); it.fn(); }); });   // 弹窗打开时不可点
      return; }
    const compact=st.PLAY_W<480,h=compact?162:82,y=H-h,x=0,w=compact?W:st.PLAY_W;st._combineGeometry={open:true,compact,rect:{x,y,w,h}};
    // 两排托盘覆盖原HUD及词典下沿，先退出被遮住的热区，保持画面与命中一致。
    if(compact)for(let i=st.hot.length-1;i>=0;i--){const r=st.hot[i];if(r.x<x+w&&r.x+r.w>x&&r.y<y+h&&r.y+r.h>y)st.hot.splice(i,1);}
    ctx.fillStyle='rgba(250,246,238,.98)'; ctx.fillRect(x,y,w,h); ctx.fillStyle=INK; ctx.fillRect(x,y,w,2.5);
    ctx.font=B(11); ctx.fillStyle=MUTE; ctx.textAlign='center'; ctx.textBaseline='middle'; if(compact){ctx.textAlign='left';ctx.fillText('🔧 多卡合成台',x+12,y+14);}else ctx.fillText('🔧 多卡合成台 · 把画布上的卡拖进格子（最多 4 张）',x+w/2,y+14);
    // 收起(右上角)
    { const cbw=58,cbh=26,cbx=x+w-cbw-12,cby=y+8; block(cbx,cby,cbw,cbh,9,PANEL,INK,1.8,2); ctx.font=B(11); ctx.fillStyle=INK; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('收起 ▾',cbx+cbw/2,cby+cbh/2+.5); st._combineGeometry.toggle={x:cbx,y:cby,w:cbw,h:cbh};pushHot(cbx,cby,cbw,cbh,()=>{ st.drawerOpen=false; sfxClick(); }); }
    // 居中一排:槽×4 ＝ 结果 [合成]
    const sw=46,sh=46,sg=10,ow=54;let rowY=y+(compact?50:30); ctx.font=B(13.5); const slotCount=st.slots.filter(Boolean).length, gt=slotCount>=2?'合成':'放入材料', gtw=ctx.measureText(gt).width, gbw=gtw+24, gbh=46;
    const clusterW=4*sw+3*sg + 32 + ow + 18 + gbw;
    const recentGap=12, recentMin=154, showRecent=!compact&&st.recentCombinesVisible&&w>=clusterW+recentMin+recentGap+28, showRecentToggle=!compact&&!st.recentCombinesVisible&&w>=clusterW+98+recentGap+28;
    let cur=compact?x+(w-(4*sw+3*sg))/2:x+Math.max(14,(w-clusterW)/2);
    if(showRecent){
      const rw=Math.min(226,Math.max(recentMin,w-clusterW-recentGap-28));
      drawRecentCombines(x+12,y+24,rw,52);
      cur=x+12+rw+recentGap;
      if(cur+clusterW>w-14) cur=w-14-clusterW;
    } else if(showRecentToggle){
      drawRecentToggle(x+12,y+39,74,28);
      cur=x+12+74+recentGap;
      if(cur+clusterW>w-14) cur=w-14-clusterW;
    }
    st._slotRects=[];
    st.slots.forEach((s,i)=>{ const filled=!!s;
      if(filled) block(cur,rowY,sw,sh,12,PAPER,INK,2.5,2); else { rr(cur,rowY,sw,sh,12); ctx.fillStyle='#fdfbf6'; ctx.fill(); ctx.setLineDash([5,4]); ctx.lineWidth=2.5; ctx.strokeStyle='rgba(35,48,58,.5)'; ctx.stroke(); ctx.setLineDash([]); }
      ctx.textAlign='center'; ctx.textBaseline='middle'; if(filled){ drawEmoji(s.e,cur+sw/2,rowY+sh/2-4,22); ctx.font=B(9); ctx.fillStyle=INK; ctx.fillText(s.n,cur+sw/2,rowY+sh-8); } else { ctx.font=B(20); ctx.fillStyle=MUTE; ctx.fillText('＋',cur+sw/2,rowY+sh/2); }
      st._slotRects[i]={x:cur,y:rowY,w:sw,h:sh}; if(filled){ const bx=cur+sw-7,by=rowY-7; ctx.beginPath(); ctx.arc(bx,by,8,0,7); ctx.fillStyle=PANEL; ctx.fill(); ctx.lineWidth=1.5; ctx.strokeStyle=INK; ctx.stroke(); ctx.font=B(10); ctx.fillStyle=INK; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('×',bx,by+.5); pushHot(bx-8,by-8,16,16,()=>{ st.slots[i]=null; }); } cur+=sw+sg; });
    cur-=sg;
    if(compact){cur=x+(w-(32+ow+18+gbw))/2;rowY+=56;}
    ctx.font=B(20); ctx.fillStyle=MUTE; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('=',cur+16,rowY+sh/2); cur+=32;
    block(cur,rowY,ow,sh,12,CREAM,GOLD,2.5,2); ctx.font=B(13); ctx.fillStyle=GOLD2; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('？？',cur+ow/2,rowY+sh/2); cur+=ow+18;
    block(cur,rowY,gbw,gbh,12,GOLD,INK,2.5); ctx.fillStyle=INK; ctx.font=B(13.5); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(gt,cur+gbw/2,rowY+gbh/2+.5);st._combineGeometry.submit={x:cur,y:rowY,w:gbw,h:gbh};pushHot(cur,rowY,gbw,gbh,()=>combineSlots()); }

  /* ---------- 右上竖排（2026-07-14 · 用户重排后：整理画布 → 固定画布 → 清空画布）：右下太挤·把画布类操作全归右上 ----------
     rx=DICT_X-12 跟词典抽屉抽拉(同右下惯例)·合成台展开不影响·清空为危险次级(暖红)·固定为状态钮(开启态青色高亮同"钉住"惯例) */
  function drawTopRightBar(){
    const items=[
      {ic:'🧽',t:'整理画布',fn:tidyCanvas},
      {ic:st.canvasLocked?'🔓':'📌',t:st.canvasLocked?'解除固定':'固定画布', lock:true, fn:()=>setCanvasLock(!st.canvasLocked)},
      {ic:'🧹',t:'清空画布', danger:true, fn:openClearConfirm}
    ];
    const h=34, gap=8, rx=st.DICT_X-12, baseY=st.TICK_H+12;
    ctx.font=B(12.5); let mw=0; items.forEach(it=>{ const tw=ctx.measureText(it.ic+' '+it.t).width; if(tw>mw) mw=tw; }); const w=mw+24;
    items.forEach((it,i)=>{ const x=rx-w, y=baseY+i*(h+gap);
      const stroke=it.danger?'#c0492f':(it.lock&&st.canvasLocked?TEAL:INK), fill=(it.lock&&st.canvasLocked)?'#e7f4f2':PANEL, fg=it.danger?'#c0492f':(it.lock&&st.canvasLocked?TEAL:INK);
      block(x,y,w,h,12,fill,stroke,2.5); ctx.fillStyle=fg; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=B(12.5); ctx.fillText(it.ic+' '+it.t,x+w/2,y+h/2+.5);
      if(controlsFree()) pushHot(x,y,w,h,()=>{ sfxClick(); it.fn(); }); });   // 弹窗打开=不可点(同右下惯例)
  }

  function drawDictSkeleton(sx,y,sw,visH,now){
    const cols=(FXSET&&FXSET.dictBig)?4:5,gap=5,gw=(sw-gap*(cols-1))/cols,gh=Math.round(58*((FXSET&&FXSET.dictBig)?1.35:1));
    const pulse=.36+.14*(1+Math.sin(now/360))/2;
    ctx.save(); ctx.globalAlpha=pulse;
    for(let i=0;i<Math.min(cols*3,15);i++){ const x=sx+(i%cols)*(gw+gap), yy=y+8+Math.floor(i/cols)*(gh+gap);
      if(yy+gh>y+visH)break; block(x,yy,gw,gh,10,PAPER2,'rgba(35,48,58,.22)',1.2,0);
      ctx.beginPath(); ctx.arc(x+gw/2,yy+gh*.36,Math.max(6,gw*.14),0,7); ctx.fillStyle='rgba(55,139,139,.18)'; ctx.fill();
      rr(x+gw*.18,yy+gh*.72,gw*.64,5,2.5); ctx.fillStyle='rgba(47,58,74,.16)'; ctx.fill(); }
    ctx.restore();
    ctx.font=SB(11.5); ctx.fillStyle=MUTE; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('正在装入本季词库',sx+sw/2,Math.min(y+visH-16,y+3*(gh+gap)+18));
  }
  /* ---------- 右侧词典(大图弱字·可搜索/分类/查看模式切换/滚动) ---------- */
  function drawDict(now){ const px=st.panelX, W2=st.DICT_W;
    const DZ=(FXSET&&FXSET.dictBig)?1.35:1;   // 词典大字模式(设置里开·手机看标签/卡牌太小用)·只放大词典内部·面板宽度/画布不动
    ctx.save(); ctx.beginPath(); ctx.rect(px,st.TICK_H,W-px,st.PLAY_H); ctx.clip();   // 只画露出来的部分
    ctx.fillStyle=PANEL; ctx.fillRect(px,st.TICK_H,W2,st.PLAY_H); ctx.fillStyle=INK; ctx.fillRect(px,st.TICK_H,2.5,st.PLAY_H);
    if(st.dictT>0.05){ const sx=px+8, sw=W2-16; let y=st.TICK_H+8;
      /* 搜索框：🔎 图标 + 输入文字/占位 + 闪烁光标 + 有内容时的 ✕ 清除 */
      const boxH=Math.round(28*DZ); st._dictBoxH=boxH; block(sx,y,sw,boxH,9,'#fdfbf6',INK,2,2);
      ctx.textBaseline='middle'; ctx.textAlign='left'; drawEmoji('🔎',sx+14*DZ,y+boxH/2,13*DZ);
      const tx=sx+Math.round(30*DZ), hasQ=!!st.dictQuery;
      if(hasQ){ ctx.font=SB(12.5*DZ); ctx.fillStyle=INK; let t=st.dictQuery; while(ctx.measureText(t).width>sw-58*DZ&&t.length>1) t=t.slice(0,-1); ctx.fillText(t,tx,y+boxH/2+.5); }
      else { ctx.font=SB(11.5*DZ); ctx.fillStyle=MUTE; ctx.fillText('搜我的卡牌…',tx,y+boxH/2+.5); }
      if(st.dictSearchActive && Math.floor(now/500)%2===0){ ctx.font=SB(12.5*DZ); const tw=hasQ?ctx.measureText(st.dictQuery).width:0; ctx.fillStyle=INK; ctx.fillRect(tx+tw+2,y+7*DZ,1.6,boxH-14*DZ); }
      if(hasQ){ const cbx=sx+sw-16*DZ; ctx.beginPath(); ctx.arc(cbx,y+boxH/2,8*DZ,0,7); ctx.fillStyle='#cfd6df'; ctx.fill(); ctx.fillStyle='#fff'; ctx.font=B(10*DZ); ctx.textAlign='center'; ctx.fillText('✕',cbx,y+boxH/2+.5);
        if(st.dictT>0.9) pushHot(cbx-11*DZ,y+2,22*DZ,boxH-4,()=>{ dq.value=''; st.dictQuery=''; st.dictScroll=0; triggerDictServerSearch(); dq.focus(); sfxClick(); }); }
      if(st.dictT>0.9) pushHot(sx,y,sw-(hasQ?22*DZ:0),boxH,()=>{ dq.focus(); sfxClick(); });
      y+=boxH+8;
      /* 查看模式 + 分类 标签（可点切换） */
      y=chips(['我的卡牌','收藏'],sx,y,'view');
      y=chips(['全部'].concat(cardCategoryNames()),sx,y,'cat');
      y=chips(['全部','1字','2字','3字','4字'],sx,y,'len');
      /* 当前模式标签 + 计数 */
      const res=computeDict(), list=res.list;
      ctx.font=SB(11*DZ); ctx.textBaseline='middle'; ctx.fillStyle='#aeb6c0'; ctx.textAlign='left'; ctx.fillText(VIEWLABEL[st.dictView]||'',sx,y+6*DZ);
      ctx.fillStyle=MUTE;ctx.textAlign='right';ctx.fillText(list.length+(res.qActive?' 个结果':' 种'),sx+sw,y+6*DZ);
      y+=Math.round(20*DZ); st._dictGridTop=y;
        const gridBottom=st.TICK_H+st.PLAY_H-8, visH=gridBottom-y, padT=8, cols=(DZ>1?4:5),gap=5,gw=(sw-gap*(cols-1))/cols,gh=Math.round(58*DZ);   // padT=首行顶部留白·防卡顶到裁剪上沿被切掉边框；大字模式一行 4 张(格子更大·卡名字号随格子自动变大)
      let rlist=list;   // #5 纯上架制：词典直接显示真实卡(公共=已上架·个人=我的)·不再尾随"未发现"占位
      if(list.length===0){
        st._dictCells=[]; st._dictMaxScroll=0; st.dictScroll=0;
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.globalAlpha=.5;drawEmoji(res.qActive?'🔍':'📭',px+W2/2,y+visH*.34,30);ctx.globalAlpha=1;
        const emptyMain=res.qActive?('没找到「'+st.dictQuery+'」'):res.filterActive?'没有符合筛选的卡牌':st.dictView==='collected'?'还没有收藏卡牌':'还没有发现卡牌';
        const emptySub=res.qActive?'换个词试试':res.filterActive?'换个分类或字数试试':st.dictView==='collected'?'点开卡牌详情，收藏喜欢的卡牌':'从五行开始合成吧';
        ctx.font=SB(12.5);ctx.fillStyle=MUTE;ctx.fillText(emptyMain,px+W2/2,y+visH*.34+34);
        ctx.font=SB(11);ctx.fillStyle='#aeb6c0';ctx.fillText(emptySub,px+W2/2,y+visH*.34+54);
      } else {
        const rows=Math.ceil(rlist.length/cols), contentH=padT+rows*(gh+gap)-gap;
        st._dictMaxScroll=Math.max(0,contentH-visH); st.dictScroll=clamp(st.dictScroll,0,st._dictMaxScroll);
        ctx.save(); ctx.beginPath(); ctx.rect(px,y,W2,visH); ctx.clip();
        st._dictCells=[];
        rlist.forEach((d,i)=>{ const gx=sx+(i%cols)*(gw+gap), gy=y+padT+Math.floor(i/cols)*(gh+gap)-st.dictScroll;
          if(gy+gh<y||gy>gridBottom) return; dcell(gx,gy,gw,gh,d,now);
          if(!d.locked&&st.dictT>0.92) st._dictCells.push({x:gx,y:gy,w:gw,h:gh,d}); });
        ctx.restore();
        if(st._dictMaxScroll>0){ const trackH=visH-4, thumbH=Math.max(28,trackH*visH/contentH), thumbY=y+2+(trackH-thumbH)*(st.dictScroll/st._dictMaxScroll);
          rr(px+W2-5,thumbY,3,thumbH,1.5); ctx.fillStyle='rgba(47,58,74,.25)'; ctx.fill(); }
      }
    }
    ctx.restore();
    // 小开关:做成"贴着词典的标签"——左侧圆角、右侧平着并入词典(不再是悬空的四角圆小块)
    const r=st.toggleRect, rad=12, x0=r.x, x1=r.x+r.w, y0=r.y, y1=r.y+r.h, cx=r.x+13;
    function tabPath(){ ctx.beginPath(); ctx.moveTo(x1,y0); ctx.lineTo(x0+rad,y0); ctx.arcTo(x0,y0,x0,y0+rad,rad); ctx.lineTo(x0,y1-rad); ctx.arcTo(x0,y1,x0+rad,y1,rad); ctx.lineTo(x1,y1); }   // 右上(直角)→左上(圆)→左下(圆)→右下(直角)
    ctx.save(); ctx.shadowColor='rgba(40,55,70,.20)'; ctx.shadowBlur=8; ctx.shadowOffsetX=-1.5; ctx.shadowOffsetY=2; tabPath(); ctx.closePath(); ctx.fillStyle=PANEL; ctx.fill(); ctx.restore();   // 纸底闭合·盖住词典左边框→连成一体
    tabPath(); ctx.lineWidth=2.2; ctx.strokeStyle=INK; ctx.lineJoin='round'; ctx.stroke();   // 只描 上/左/下·右侧不描(贴着词典)
    ctx.textAlign='center'; ctx.textBaseline='middle';
    drawEmoji('📖', cx, y0+r.h*0.33,15);
    ctx.font=B(16); ctx.fillStyle=INK; ctx.fillText(st.dictOpen?'›':'‹', cx, y0+r.h*0.69);
    pushHot(r.x,r.y,r.w,r.h,()=>{ st.dictOpen=!st.dictOpen; sfxClick(); }); }
  /* 标签条：kind='view' 查看模式 / kind='cat' 分类 / kind='len' 卡名字数；三个维度取交集 */
  function chips(arr,x,y,kind){ const DZ=(FXSET&&FXSET.dictBig)?1.35:1;   // 词典大字模式：标签字号/高度一起放大(玩家反馈手机上标签太小)
    ctx.font=B(9.5*DZ); const h=Math.round(18*DZ); let cx=x; const maxR=x+(st.dictContentW-16);
    arr.forEach(t=>{ const tw=ctx.measureText(t).width,w=tw+Math.round(14*DZ); if(cx+w>maxR){ cx=x; y+=h+5; }
      const active = kind==='view' ? (VIEWKEY[t]===st.dictView) : (kind==='cat' ? t===st.dictCat : ((t==='全部'?0:parseInt(t,10))===st.dictLen));
      rr(cx,y,w,h,7*DZ); ctx.fillStyle=active?GOLD:'#fff'; ctx.fill(); ctx.lineWidth=1.5; ctx.strokeStyle=INK; ctx.stroke();
      ctx.fillStyle=INK; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=B(9.5*DZ); ctx.fillText(t,cx+w/2,y+h/2+.5);
      if(st.dictT>0.9){ const hx=cx,hy=y,hw=w; pushHot(hx,hy,hw,h,()=>{
        if(kind==='view') st.dictView=VIEWKEY[t];
        else if(kind==='cat') st.dictCat=t;
        else st.dictLen=t==='全部'?0:parseInt(t,10);
        st.dictScroll=0; _dictCache=null;
        triggerDictServerSearch();
        sfxClick();
      }); }
      cx+=w+5; });
    return y+h+8; }
  function dcell(x,y,w,h,d,now){ if(d.locked){ block(x,y,w,h,10,PAPER2,'rgba(35,48,58,.4)',1.6,2); ctx.globalAlpha=.5; ctx.textAlign='center'; ctx.textBaseline='middle'; drawEmoji('❔',x+w/2,y+h*0.4,w*0.34); ctx.font=B(w*0.13); ctx.fillStyle=MUTE; ctx.fillText('未发现',x+w/2,y+h*0.82); ctx.globalAlpha=1; return; }
    const faded=!d.owned;   // 未拥有=别人首发我还没合到 → 保留外观·只降透明度(规范≈0.75)
    ctx.save(); if(faded) ctx.globalAlpha=0.75;
    const isMyFirst=(d.by===PLAYER&&d.owned);
    const custom=WXGC3_UI.getAppearance&&WXGC3_UI.getAppearance('skins',d.lim||FXSET.skinId);
    block(x,y,w,h,10,custom&&custom.face||PAPER,null,0,2);
    if(custom&&custom.image)legacyImageLayer(custom.image,x,y,w,h,10);   // 卡身(柔影纸面)
    const dlim=d.lim||((d.creatorDawn||(d.owned&&dawnAllOn()))?'dawn':'');   // 沿用内置卡面底纹。
    const dhonor=!!(d.sponsor||d.only||d.broken);   // 有荣誉边框→dawn 只画底纹不画边(治叠边太粗·2026-07-10)
    if(dlim) limOverlay(x,y,w,h,10,dlim,now,false,dlim==='dawn'&&dhonor);   // 卡面皮肤(静态·防卡顿)
    // 边框(静态·按新稀有度梯度·词典里一律不流动)
    if(d.sponsor) rainbow(x,y,w,h,10,0.6,2);   // 赞助者·彩虹边(静态)
    else if(d.only) goldEdge(x,y,w,h,10,0.5,2);   // 首发仅此一张·金色流光(静态)
    else if(d.broken){ rr(x,y,w,h,10); ctx.lineWidth=2.2; ctx.strokeStyle=BLUE; ctx.stroke(); }   // 首发已被打破·蓝边
    else if(dlim!=='dawn'){ rr(x,y,w,h,10); ctx.lineWidth=d.lim?1.8:1.6; ctx.strokeStyle=custom&&custom.border||(d.lim?INK:'rgba(35,48,58,.55)'); ctx.stroke(); }   // 普通·墨边（dawn 普通卡=单层细金边替代·不叠墨边）
    // 标本光圈 + emoji
    ctx.save(); const sg=ctx.createRadialGradient(x+w/2,y+h*0.38,1,x+w/2,y+h*0.38,w*0.38); sg.addColorStop(0,'rgba(120,150,150,.12)'); sg.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(x+w/2,y+h*0.38,w*0.38,0,7); ctx.fill(); ctx.restore();
    ctx.textAlign='center'; ctx.textBaseline='middle'; drawEmoji(d.e,x+w/2,y+h*0.38,w*0.40);
    rr(x+3,y+h-h*0.34,w-6,h*0.30,7); ctx.fillStyle=custom&&custom.face||'rgba(244,239,230,.92)'; ctx.fill(); ctx.font=B(w*0.18); ctx.fillStyle=custom&&custom.ink||INK; let nm=d.n; while(ctx.measureText(nm).width>w-7&&nm.length>1) nm=nm.slice(0,-1); ctx.fillText(nm===d.n?d.n:nm+'…',x+w/2,y+h-h*0.155);   // 卡名字号加大·底纸条托住
    ctx.restore();
    // 拥有✓（左上外角·满不透明）
    if(d.owned){ const gx=x+8,gy=y+8; ctx.beginPath(); ctx.arc(gx,gy,8,0,7); ctx.fillStyle=GREEN; ctx.fill(); ctx.lineWidth=1.6; ctx.strokeStyle=PAPER; ctx.stroke(); ctx.fillStyle='#fff'; ctx.font=B(9); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('✓',gx,gy+.5); }
    else if(d.listed===false && !d.origin){ ctx.font=B(w*0.115); const t='未上架',tw=ctx.measureText(t).width,bw=tw+8,bx=x+w/2-bw/2,by=y-6; block(bx,by,bw,w*0.17,w*0.085,MUTE,'#fff',1.1,0); ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(t,x+w/2,by+w*0.17/2+.5); }   // @全库搜到的"别人未上架卡"：顶部灰标"未上架"(存在但拿不到·合成会被后端拒)
  }

  /* ---------- 钉住卡牌（2026-07-12·做法A）：详情右上角钉子胶囊 + 台面固定 ---------- */
  // 详情里这张卡当前是否已钉在台面（详情对象本身在台面就看它·否则看同名的台面实例）
  function isCardPinnedOnBoard(c){ if(!c) return false; if(st.cards.indexOf(c)>=0) return !!c.pinned; const inst=(st.cards||[]).find(x=>x.n===c.n); return !!(inst&&inst.pinned); }
  // 详情右上角"钉住/已钉住"胶囊（选型B·右对齐到 rightX）：未钉=纸底墨字·已钉=浅青底青字（套"固定画布"开启态青色惯例）
  function drawPinPill(rightX,py,pinned){ const txt=pinned?'已钉住':'钉住'; ctx.font=B(11.5); const tw=ctx.measureText(txt).width, w=tw+34, h=26, px=rightX-w;
    block(px,py,w,h,h/2, pinned?'#e6f7f4':PANEL, pinned?TEAL:INK, pinned?2.2:1.8, 2);
    drawEmoji('📌',px+15,py+h/2+1,13); ctx.font=B(11.5); ctx.fillStyle=pinned?TEAL:INK; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(txt,px+25,py+h/2+.5);
    return {x:px,y:py,w,h}; }
  // 点钉子：把这张卡钉在台面（不在台面就放一张上去再钉）/ 再点=取消。任意张·不设上限。
  function toggleDetailPin(){ const c=st.detail; if(!c) return; sfxClick();
    let inst=(st.cards.indexOf(c)>=0)?c:(st.cards||[]).find(x=>x.n===c.n);
    if(!inst){ const d=DICT.find(x=>x.n===c.n)||Object.assign({n:c.n,e:c.e||'⭐',cat:c.cat,seq:c.seq,by:c.by,q:c.q,origin:c.origin,only:c.only},c); if(!spawnFromDict(d))return; inst=(st.cards||[]).slice().reverse().find(x=>x.n===c.n); }
    if(inst){ inst.pinned=!inst.pinned; c.pinned=inst.pinned; toast(inst.pinned?'📌 已钉在台面 · 合成也不会消失':'已取消钉住 · 恢复普通卡'); }
    saveFactoryCanvas(true); }

  /* ---------- 详情弹窗(信息卡 A·点卡打开) ---------- */
  function detailCardStatus(c){return c.origin?'世界本源':'已发现';}
  function drawDetail(){ const c=st.detail; if(!c)return; const dd=(st.myCards||[]).find(x=>x.n===c.n)||DICT.find(x=>x.n===c.n)||COLL_META[c.n]||{}; ctx.fillStyle='rgba(47,58,74,.5)'; ctx.fillRect(0,0,W,H);   // 好友卡详情优先保留当前来源；公共/个人/本地词库继续作完整信息回退
    const mineFirst=!c.origin&&(st.myFirsts.has(c.n)||!!c.mineFirst||!!dd.mineFirst||!!dd.mine_first||c.by===PLAYER), ownFirst=mineFirst&&(isFirstCardData(c)||isFirstCardData(dd)||c.only||c.broken);
    const w=Math.min(ownFirst?382:360,W*0.9), h=Math.min(ownFirst?510:502,H*0.94), x=W/2-w/2, y=H/2-h/2;   // 普通版 456→502：砍两行信息+加高·底部腾给内嵌评论区（2026-07-12）
    st._dtHotStart=st.hot.length; st._dtRect={x:x,y:y,w:w,h:h};   // 穿透防护：详情自己的热区从这个下标开始·点击只认它们（⚠必须记场景私有 st.hot——引擎全局 HOT 在本场景恒空·build80 曾误用导致详情按钮全点不动·2026-07-12 修）

    block(x,y,w,h,20,PANEL,INK,3);
    // 固定头部（图标+名字+编号类别·不随滚动）
    const icon=56;
    block(x+18,y+18,icon,icon,16,PAPER,INK,2.3,2);
    if(c.sponsor) rainbow(x+18,y+18,icon,icon,16,0.6,2); else if(c.only) goldEdge(x+18,y+18,icon,icon,16,0.5,2); else if(c.broken){ rr(x+18,y+18,icon,icon,16); ctx.lineWidth=2; ctx.strokeStyle=BLUE; ctx.stroke(); }
    drawEmoji(c.e,x+18+icon/2,y+18+icon/2,32);
    ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.font=B(21); ctx.fillStyle=INK; ctx.fillText(fitText(c.n,w-180,''),x+88,y+28);   // 名字宽度留出右上角钉子胶囊的位置（w-104→w-180）
    ctx.font=SB(11); ctx.fillStyle=MUTE; ctx.fillText((c.seq?('#'+c.seq):'世界本源')+' · '+(c.cat||'抽象'),x+88,y+50);
    { const pr=drawPinPill(x+w-14,y+14,isCardPinnedOnBoard(c)); pushHot(pr.x,pr.y,pr.w,pr.h,toggleDetailPin); }   // 右上角钉子（2026-07-12·钉住卡牌）
    // 滚动内容区（2026-07-12 详情滚动化：旁白+信息+收藏+举报+荣誉履历+评论装不下一屏·头部/关闭固定·中间滚轮/上下滑）
    const closeY2=y+h-46, clipTop=y+84, clipBot=closeY2-8, viewH=clipBot-clipTop, bw=w-36;
    if(st._dtName!==c.n){ st._dtName=c.n; st.detailScroll=0; st._dtDrag=null; }
    st.detailScroll=clamp(st.detailScroll||0,0,st.detailMax||0);
    st._dtClip={x:x+2,top:clipTop,bot:clipBot,w:w-4};   // 给 pointerdown 判"按在滚动区内=起拖"用
    const vis=(top,hh)=>top+hh>clipTop&&top<clipBot;    // 元素与可视区相交才注册热区（防点到被裁掉的按钮）
    ctx.save(); ctx.beginPath(); ctx.rect(x+2,clipTop,w-4,viewH); ctx.clip();
    let cy=clipTop+8-st.detailScroll;
    const q=c.q||dd.q||'';
    if(q){ if(vis(cy,44)){ rr(x+18,cy,w-36,44,12); ctx.fillStyle='#fff7e6'; ctx.fill(); ctx.setLineDash([5,4]); ctx.lineWidth=1.8; ctx.strokeStyle='rgba(199,154,62,.85)'; ctx.stroke(); ctx.setLineDash([]); ctx.font=SB(12.2); ctx.fillStyle=GOLD2; wrap('「'+q+'」',x+w/2,cy+16,w-54,15); } cy+=56; }
    // 当前存档内的信息。
    const rows=[
      ['类别',c.cat||'抽象'],
      ['我的状态',detailCardStatus(c,dd)],
      ['卡牌外观',((localState&&localState.save.preferences)||{}).skinId==='default'?'素纸':'自选外观']
    ];
    ctx.textBaseline='middle'; ctx.font=SB(12.3); rows.forEach(r=>{ const yy=cy; ctx.textAlign='left'; ctx.fillStyle='#7a8696'; ctx.fillText(r[0],x+20,yy); ctx.textAlign='right'; ctx.fillStyle=INK; ctx.font=B(12.3); ctx.fillText(fitText(r[1],w-122,''),x+w-20,yy); ctx.font=SB(12.3); cy+=21; });
    cy+=5;
    cy+=7; const isColl=!!(st.collected&&st.collected.has(c.n)), collN=(dd.collectCnt!=null?dd.collectCnt:0), favIdx=isColl?favFolderOf(c.n):-1, favName=(favIdx>=0?(favEnsure()[favIdx].name||'已收藏'):'已收藏');
    block(x+18,cy,bw,38,12,PINK,PINKB,2.5); ctx.fillStyle=PINKB; ctx.font=B(13.5); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText((isColl?('💖 '+favName+' · 点取消/转移'):'🤍 收藏'),x+w/2,cy+19); pushHotDt(x+18,cy,bw,38,()=>doCollectCard(c)); cy+=47;
    if(c.seq){ cy=drawDetailLore(c,x,w,cy); }   // 荣誉履历(诞生/不再唯一/打破者·1代同款) → 内嵌评论（用户定序：履历在上评论在下）
    st.detailMax=Math.max(0,(cy+st.detailScroll)-(clipTop+8)-viewH+10);
    ctx.restore();
    if(st.detailMax>0){ const trH=viewH-8, thH=Math.max(26,trH*viewH/(viewH+st.detailMax)), thY=clipTop+4+(trH-thH)*(st.detailScroll/st.detailMax);
      ctx.fillStyle='rgba(35,48,58,.12)'; rr(x+w-8,clipTop+4,4,trH,2); ctx.fill();
      ctx.fillStyle='rgba(35,48,58,.34)'; rr(x+w-8,thY,4,thH,2); ctx.fill(); }
    const footer=[['加入合成台',()=>{const index=st.slots.findIndex(slot=>!slot);if(index<0){toast('合成台已放满。');return;}st.slots[index]={n:c.n,e:c.e};st.drawerOpen=true;st.detail=null;sfxClick();}],
      ['分享卡牌',()=>{st.share=Object.assign({},c,{bornAt:(nativeCard(c.n)||{}).discoveredAt});st.detail=null;sfxClick();}],
      ['关闭',()=>{st.detail=null;sfxClick();}]];
    const footW=(bw-12)/3;footer.forEach((item,index)=>{const fx=x+18+index*(footW+6);block(fx,closeY2,footW,34,11,CREAM,INK,2.2);ctx.fillStyle=INK;ctx.font=B(11.5);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(item[0],fx+footW/2,closeY2+17);pushHot(fx,closeY2,footW,34,item[1]);}); }
  /* ---------- 详情荣誉履历（2026-07-12·1代同款文案）：仅此一张=👑诞生日；被打破=🕯️曾是仅此一张+诞生/不再唯一日+⚡打破者；普通=诞生日。数据=评论接口顺带的 lore（progress 最早两条=首发/打破） ---------- */
  function fmtMD2(s){ try{ const d=new Date(s); return (d.getMonth()+1)+'月'+d.getDate()+'日'; }catch(_){ return ''; } }
  function drawDetailLore(c,x,w,cy){
    const data=nativeCard(c.n),at=data&&data.discoveredAt;if(!at)return cy;
    ctx.font=SB(10.5);ctx.fillStyle=MUTE;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('发现于 '+fmtMD2(at),x+w/2,cy+4);return cy+22;
  }
  function canvasClearStats(){
    const cards=st.cards||[], pinned=cards.filter(c=>c&&c.pinned).length;
    return { clearable:cards.length-pinned+(st.slots?st.slots.filter(Boolean).length:0), pinned };
  }
  function openClearConfirm(){
    const stats=canvasClearStats();
    if(!stats.clearable){ toast(stats.pinned?('没有可清空的普通卡 · 已保留 '+stats.pinned+' 张钉住卡'):'画布已经是空的'); return; }
    st.confirmClear={ count:stats.clearable, pinned:stats.pinned }; st.menuOpen=false;
  }
  function doClearCanvas(){
    const pinned=(st.cards||[]).filter(c=>c&&c.pinned);
    st.cards=pinned; st.slots=[null,null,null,null]; st.drag=null; st.pan=null; st.dictPan=null; st.favPan=null; st.drawerOpen=false; st.confirmClear=null; st._seeded=pinned.length>0;
    if(pinned.length) saveFactoryCanvas(true);
    else try{ localStorage.removeItem(FACTORY_CANVAS_STORE); }catch(_){}
    toast(pinned.length?('已清空普通卡 · 📌保留 '+pinned.length+' 张钉住卡'):'已清空画布');
  }
  function drawClearConfirm(){ const m=st.confirmClear; if(!m)return; st._ccHotStart=st.hot.length; ctx.fillStyle='rgba(47,58,74,.6)'; ctx.fillRect(0,0,W,H);
    const w=Math.min(336,W*0.86), h=238, x=W/2-w/2, y=H/2-h/2; block(x,y,w,h,18,PANEL,'#c0492f',3);
    ctx.textAlign='center'; ctx.textBaseline='middle';
    drawEmoji('🧹',x+w/2,y+42,34);
    ctx.font=B(18); ctx.fillStyle=INK; ctx.fillText('清空当前画布？',x+w/2,y+82);
    ctx.font=SB(12); ctx.fillStyle=MUTE; ctx.fillText('会移走画布和合成台里的 '+(m.count||0)+' 张普通卡',x+w/2,y+112);
    ctx.fillStyle=m.pinned?TEAL:MUTE; ctx.fillText('📌 已钉住的 '+(m.pinned||0)+' 张会留在原位',x+w/2,y+134);
    ctx.fillStyle=MUTE; ctx.fillText('不会删除词典、收藏、已拥有卡',x+w/2,y+156);
    const bw=(w-54)/2, by=y+h-50;
    block(x+18,by,bw,38,11,CREAM,INK,2.5); ctx.fillStyle=INK; ctx.font=B(14); ctx.fillText('取消',x+18+bw/2,by+19); pushHot(x+18,by,bw,38,()=>{ st.confirmClear=null; sfxClick(); });
    block(x+w-18-bw,by,bw,38,11,'#c0492f',INK,2.5); ctx.fillStyle='#fff'; ctx.font=B(14); ctx.fillText('确认清空',x+w-18-bw/2,by+19); pushHot(x+w-18-bw,by,bw,38,()=>doClearCanvas());
  }

  /* ---------- 待领/通知弹窗（登录拉 /notices·逐个弹）：举报奖励 / 安检下架 / 上架审核未通过 / 已公开上架被撤下 ---------- */
  /* ---------- 合成：请求、等待、提交完成后揭晓；失败按原操作恢复材料 ---------- */
  // 把后端返回的卡（命中配方 / AI 造卡两种形态都归一过）变成画布立牌 + 触发对应庆典 + 同步本地集合
  function applyResult(norm,wx,wy){
    const data=nativeCard(norm.name),c=mk(norm.name,norm.e,norm.cat||'抽象','',norm.seq||0,wx,wy,!!(data&&data.isBase),false,norm.q||'',false);
    c.cardId=data&&data.id;c.instanceId=newInstanceId();c.lim=cardLim(norm);c.bornAt=data&&data.discoveredAt;c.scale=.2;
    st.cards.push(c);st.owned.add(norm.name);st.seen.add(norm.name);touchMyRecent(norm.name);
    META[norm.name]=Object.assign({},META[norm.name]||{},{n:c.n,e:c.e,cat:c.cat,q:c.q,seq:c.seq,lim:c.lim,bornAt:c.bornAt});
    upsertDict(norm);markOwnership();saveFactoryCanvas(true);
    const position=worldToScreen(wx,wy);
    if(norm.isNew){vibe(30);if(FXSET.celebrate)bigDisc(c);else{floatUp(position.x,position.y-50,'首次发现！'+norm.name,GOLD2,1600);sfxBig();}}
    else{floatUp(position.x,position.y-50,'合成完成',MUTE,900);sfxRepeat();}
  }
  function upsertDict(norm){ _dataStamp++; st._favItemCache=null;   // 数据变了→词典/收藏缓存作废（M5）
    let d=DICT.find(x=>x.n===norm.name);   // 新合出的卡补进词典(本地·下次登录 browse 也会带它)
    if(!d){ d={n:norm.name,e:norm.e,cat:norm.cat||'抽象',seq:norm.seq||0,rar:Number(norm.rar)||0,likes:0,usage:0,holder:Number(norm.holder||norm.holder_cnt)||1,q:norm.q||'',season:0,origin:0,byName:(norm.by||''),lim:cardLim(norm),creatorFrame:!!(norm.creatorFrame||norm.creator_first_frame_active),creatorDawn:!!(norm.creatorDawn||norm.creator_dawn_active),foodTaste:norm.foodTaste||null}; DICT.push(d); }
    else { if(norm.seq) d.seq=norm.seq; if(norm.q) d.q=norm.q; if(norm.by) d.byName=norm.by; if(norm.holder||norm.holder_cnt) d.holder=Number(norm.holder||norm.holder_cnt)||d.holder; if(norm.rar!=null) d.rar=Number(norm.rar)||0; if(cardLim(norm)) d.lim=cardLim(norm); if(norm.creatorFrame||norm.creator_first_frame_active) d.creatorFrame=true; if(norm.creatorDawn||norm.creator_dawn_active) d.creatorDawn=true; if(norm.foodTaste)d.foodTaste=norm.foodTaste; } }
  // 一次合成的完整流程：发请求 → 画"造物中"气泡 → 拿结果 → 出卡 → 刷 HUD/集合；出错则提示并回滚卡片
  async function doCombine(items,wx,wy,restore){
    if(externalBlocked||(WXGC3_UI.isModalOpen&&WXGC3_UI.isModalOpen())){if(restore)restore();return;}
    // 沿用原卡背舞台。仅已有待存占住同一点时散开，拖叠产生的独立锚点保持原位。
    const occupied=(x,y)=>st.pending.some(item=>Math.abs(item.x-x)<CW*1.08&&Math.abs(item.y-y)<CH*1.1);
    if(occupied(wx,wy)){
      const origin={x:wx,y:wy},offsets=[[1,0],[-1,0],[0,1],[1,1],[-1,1],[0,-1],[1,-1],[-1,-1],[2,0],[-2,0]];
      for(const [dx,dy] of offsets){
        const x=origin.x+dx*CW*1.35,y=origin.y+dy*CH*1.4,point=worldToScreen(x,y);
        if(!occupied(x,y)&&point.x>CW*view.s*.6&&point.x<st.PLAY_W-CW*view.s*.6&&point.y>CH*view.s*.7&&point.y<H-CH*view.s*.7-50){wx=x;wy=y;break;}
      }
    }
    const pending={x:wx,y:wy,global:false,operationId:null};st.pending.push(pending);sfxThink();
    const identity=localIdentity;
    const keepAwake=setInterval(()=>{try{if(typeof resetIdle==='function')resetIdle();}catch(_){}},20000);
    let result;
    try{
      const promise=WXGC2_API.combineAndWait(items,id=>{pending.global=true;if(id)pending.operationId=id;});
      pending.operationId=promise.operationId||pending.operationId;
      result=await promise;
    }catch(_){result={ok:false,message:'这次合成没有完成，请重试。'};}
    finally{clearInterval(keepAwake);const index=st.pending.indexOf(pending);if(index>=0)st.pending.splice(index,1);}
    if(identity!==localIdentity)return;
    if(!result||!result.ok){
      const point=worldToScreen(wx,wy);floatUp(point.x,point.y-40,(result&&result.message)||'合成没有完成。',PINKB,2000);sfxFailure();if(restore)restore();return;
    }
    const card=result.card||{};
    const norm={id:card.id,name:card.name,e:card.emoji,cat:card.cat,seq:card.seq||0,q:card.descr||'',isNew:!!result.isNew,lim:cardLim(card)};
    applyResult(norm,wx,wy);rememberRecentCombine(items,norm);
  }
  /* ---------- 整理画布（2026-07-14·方案 A：吸附最近网格·碰撞往右下推）----------
     用户痛点=分享截图对不齐。点右上"🧽 整理"→ 每张卡各自吸附到最近网格·多张卡挤同一格时按顺序向右下推。
     目标位置写进 c.tx/c.ty·主循环已有的缓动(c.x+=(c.tx-c.x)*0.3·每帧)自然带卡飞过去(≈0.5秒到位)。
     ⚠ 钉住卡(📌)保留原位不动(心智=钉在台面)·但先把它当前所在格标记占用·防其它卡吸到它上面。
     ⚠ Lv.45 后宽高各扩大 25%，旧网格点不位移；卡多超出世界内网格时仍继续向下扩展行(不 wrap 回堆叠)。 */
  function tidyCanvas(){
    if(!st.cards||!st.cards.length){ toast('画布空空的·放几张卡再整理'); return; }
    // ⚠ 卡是长方形(CW=84 CH=108)·网格步长 X/Y 必须分开算·否则纵向叠 16px(2026-07-14 用户线上截图报的bug)
    const grid=worldGrid(), stepX=grid.stepX, stepY=grid.stepY, firstX=grid.firstX, firstY=grid.firstY;
    const cols=grid.cols;   // Lv.1~44=16列，Lv.45+=20列；行数不设上限
    const occ=new Set();
    // 钉住卡：位置不动、只标记它现在最近的格子已被占用（防其它卡覆盖到它上面）
    const pinned=st.cards.filter(c=>c.pinned);
    pinned.forEach(c=>{
      const col=clamp(Math.round((c.x-firstX)/stepX),0,cols-1);
      const row=Math.max(0,Math.round((c.y-firstY)/stepY));
      occ.add(row+'.'+col);
    });
    // 非钉住卡：按当前从左上到右下排序·让偏左上的卡优先占最近的网格
    const sorted=st.cards.filter(c=>!c.pinned).sort((a,b)=>(a.y-b.y)||(a.x-b.x));
    sorted.forEach(c=>{
      let col=clamp(Math.round((c.x-firstX)/stepX),0,cols-1);
      let row=Math.max(0,Math.round((c.y-firstY)/stepY));
      let tries=0, cap=sorted.length*2+cols*2;   // 硬上限=总数*2·防病态循环
      while(occ.has(row+'.'+col)&&tries<cap){
        col++; if(col>=cols){ col=0; row++; }   // 不 wrap row·允许向下扩展(卡多时挤到下方·可拖动画布看到)
        tries++;
      }
      occ.add(row+'.'+col);
      c.tx=firstX+col*stepX; c.ty=firstY+row*stepY;   // 原网格点在扩建后仍保持原坐标；新增格只出现在四周
    });
    saveFactoryCanvas(true);   // 存的 slim 现在带 tx/ty(2026-07-14 加)·动画中途关游戏重开仍继续走到目标
    const pinNote=pinned.length?('·📌钉住 '+pinned.length+' 张原位不动'):'';
    toast('已整理·'+sorted.length+' 张卡对齐网格'+pinNote);   // sfxClick 由按钮层统一发声·避免双响
  }

  // 钉住的卡（📌·2026-07-12「钉住卡牌」做法A）合成时不消耗、留在台面原地；结果冒到它旁边空位。
  //   都没钉=老行为（两张都吃掉·结果冒中点）；一张钉=只吃没钉那张·结果冒钉住卡右边；两张都钉=都留下·结果冒旁边。
  function combineCards(a,b){
    const consume=[a,b].filter(c=>!c.pinned), kept=[a,b].filter(c=>c.pinned);
    let wx,wy;
    // 有钉住卡时结果冒到它旁边·并加随机散开——反复刷同一对钉住卡时结果不会精确叠在同一点(否则10张叠一张·像丢卡·审查G-1)
    const jx=()=>CW*(1.0+Math.random()*0.55), jy=()=>(Math.random()*2-1)*CH*0.6;
    if(kept.length===0){ wx=(a.x+b.x)/2; wy=(a.y+b.y)/2; }
    else if(kept.length===1){ wx=kept[0].x+jx(); wy=kept[0].y+jy(); }
    else { wx=(a.x+b.x)/2+jx(); wy=(a.y+b.y)/2+jy(); }
    if(consume.length) st.cards=st.cards.filter(c=>consume.indexOf(c)<0);   // 只移除没钉的（钉住的留在台面）
    saveFactoryCanvas(true);
    doCombine([a.n,b.n],wx,wy,()=>{ consume.forEach(c=>{ c.scale=0.4; c.tx=c.x; c.ty=c.y; }); st.cards.push(...consume); saveFactoryCanvas(true); }); }   // 出错只把"被吃掉的那些"放回（钉住的从没动过）
  function combineSlots(){ const f=st.slots.filter(Boolean); if(f.length<2){ floatUp(st.PLAY_W/2,H-110,'至少放 2 张卡',PINKB,1000); return; }
    const cw=screenToWorld(st.PLAY_W/2,st.TICK_H+st.PLAY_H*0.4), items=f.map(s=>s.n), snap=f.slice(); st.slots=[null,null,null,null]; saveFactoryCanvas(true);
    doCombine(items,cw.x,cw.y,()=>{ for(let i=0;i<4;i++) st.slots[i]=snap[i]||null; saveFactoryCanvas(true); }); }   // 出错把卡放回合成台格子
  function spawnFromDict(d){
    const data=d&&nativeCard(d.n);if(!data)return false;
    sfxClick();const cw=screenToWorld(st.PLAY_W*.5,st.TICK_H+st.PLAY_H*.45),m=META[d.n]||{};
    const c=mk(data.name,data.emoji,m.cat||d.cat||'抽象','',m.seq||d.seq||0,cw.x+(Math.random()*120-60),cw.y+(Math.random()*80-40),!!data.isBase,false,m.q||d.q||'',false);
    c.cardId=data.id;c.instanceId=newInstanceId();c.bornAt=data.discoveredAt;c.lim=cardLim(data);c.owned=true;c.scale=.3;
    st.cards.push(c);saveFactoryCanvas();return true;
  }
  function floatUp(x,y,t,color,ms){ st.floats.push({x,y,text:t,color,until:performance.now()+(ms||1000),born:performance.now()}); }
  function refreshBattleTaskPocket(){}
  // 收藏/取消收藏一张卡（详情面板🤍按钮·接 ③ /cards/collect·收藏满足每日任务4）
  async function doCollectCard(card){
    if(!card)return;sfxClick();
    if(!st.collected||!st.collected.has(card.n)){st.favPick={card,busy:false};return;}
    const folders=favEnsure().map(folder=>({id:folder.id,name:folder.name,cards:folder.cards.filter(name=>name!==card.n)}));
    try{const result=await WXGC2_API.updateFavorites(folders);if(result&&result.ok===false){toast(result.message||'收藏没有保存成功。');return;}setLocalSnapshot(WXGC3_UI.getState());toast('已取消收藏「'+card.n+'」');}
    catch(_){toast('收藏没有保存成功，请重试。');}
  }
  async function confirmCollectToFolder(card,index){
    if(!card)return;if(st.favPick)st.favPick.busy=true;
    const folders=favEnsure().map((folder,i)=>({id:folder.id,name:folder.name,cards:folder.cards.filter(name=>name!==card.n)}));
    if(!folders[index]){if(st.favPick)st.favPick.busy=false;return;}
    folders[index].cards.unshift(card.n);
    try{const result=await WXGC2_API.updateFavorites(folders);if(result&&result.ok===false){if(st.favPick)st.favPick.busy=false;toast(result.message||'收藏没有保存成功。');return;}
      setLocalSnapshot(WXGC3_UI.getState());st.favPick=null;st.favTab=index;st.favScroll=0;st.favOpen=true;toast('已收藏到「'+folders[index].name+'」');}
    catch(_){if(st.favPick)st.favPick.busy=false;toast('收藏没有保存成功，请重试。');}
  }
  function drawFavPickModal(){ const m=st.favPick; if(!m)return; st._fpHotStart=st.hot.length; const c=m.card, fs=favEnsure();
    ctx.fillStyle='rgba(47,58,74,.58)'; ctx.fillRect(0,0,W,H);
    const w=Math.min(330,W*0.86), h=Math.min(H-24,Math.max(276,174+Math.min(fs.length,6)*50)), x=W/2-w/2, y=H/2-h/2;
    block(x,y,w,h,20,PANEL,INK,3);
    ctx.textAlign='center'; ctx.textBaseline='middle'; drawEmoji('⭐',x+w/2,y+32,28);
    ctx.font=B(18); ctx.fillStyle=INK; ctx.fillText('收藏到哪个栏位？',x+w/2,y+65);
    ctx.font=SB(12); ctx.fillStyle=GOLD2; ctx.fillText('「'+fitText(c.n,w-72)+'」',x+w/2,y+89);
    const top=y+111, bottom=y+h-62, vh=Math.max(40,bottom-top), contentH=fs.length*50-10;
    m.max=Math.max(0,contentH-vh);m.scroll=clamp(m.scroll||0,0,m.max);m.rect={x:x+16,y:top,w:w-32,h:vh};m.rows=[];
    // 文件夹来自存档，不能按旧固定三栏裁掉；只裁剪显示和命中范围，滑动不触发收藏。
    ctx.save();ctx.beginPath();ctx.rect(m.rect.x,top,m.rect.w,vh);ctx.clip();
    fs.forEach((fd,i)=>{ const by=top+i*50-m.scroll,bh=40,on=i===favFolderOf(c.n);
      if(by+bh<top||by>bottom)return;
      block(x+22,by,w-44,bh,12,on?'#ffe9f0':CREAM,on?PINKB:INK,2.2,2);
      ctx.textAlign='left';drawEmoji(i===0?'⭐':'🗂️',x+42,by+bh/2,15);ctx.font=B(13);ctx.fillStyle=on?PINKB:INK;
      ctx.fillText(fitText(fd.name,w-132),x+64,by+bh/2+.5);
      ctx.textAlign='right';ctx.font=SB(11);ctx.fillStyle=on?PINKB:MUTE;ctx.fillText(fd.cards.length+' 张',x+w-36,by+bh/2+.5);
      const ry=Math.max(top,by),rb=Math.min(bottom,by+bh),rect={x:x+22,y:ry,w:w-44,h:rb-ry,index:i};
      if(rect.h>0){m.rows.push(rect);if(!m.busy)pushHot(rect.x,rect.y,rect.w,rect.h,()=>confirmCollectToFolder(c,i));}
    });ctx.restore();
    if(m.max>0){const track=vh-4,thumb=Math.max(24,track*vh/contentH),ty=top+2+(track-thumb)*m.scroll/m.max;
      rr(x+w-11,ty,3,thumb,1.5);ctx.fillStyle='rgba(47,58,74,.35)';ctx.fill();}
    block(x+22,y+h-50,w-44,34,11,CREAM,INK,2.2);ctx.fillStyle=INK;ctx.font=B(13);ctx.textAlign='center';
    ctx.fillText(m.busy?'收藏中…':'取消',x+w/2,y+h-33);if(!m.busy)pushHot(x+22,y+h-50,w-44,34,()=>{st.favPick=null;sfxClick();});
  }

  function wrap(text,cx,y,maxW,lh){ const a=[...text]; let line='',ls=[]; for(const ch of a){ if(ctx.measureText(line+ch).width>maxW){ ls.push(line); line=ch; } else line+=ch; } if(line)ls.push(line); ctx.textAlign='center'; ls.forEach((l,i)=>ctx.fillText(l,cx,y+i*lh)); }

  /* ---------- 首发动画 ---------- */
  function confetti(n){ const a=[]; for(let i=0;i<n;i++){ const an=Math.random()*6.28,sp=180+Math.random()*260; a.push({x:0,y:0,vx:Math.cos(an)*sp,vy:Math.sin(an)*sp-160,rot:Math.random()*6.28,vr:(Math.random()-.5)*12,c:RAINBOW[i%6],w:7+Math.random()*5,h:11+Math.random()*6}); } return a; }
  function bigDisc(c){ st.effects.push({type:'big',card:c,t0:performance.now(),conf:confetti(46),dismiss:null,shareReady:false}); sfxBig(); }
  function smallDisc(c){ st.effects.push({type:'small',card:c,t0:performance.now(),store:{}}); sfxSmall(); }
  function drawEffects(now){ for(let i=st.effects.length-1;i>=0;i--){ const ef=st.effects[i], t=(now-ef.t0)/1000;
    if(ef.type==='small'){ drawSmall(ef,t,now); if(t>1.5) st.effects.splice(i,1); }
    else { drawBig(ef,t,now); if(ef.dismiss&&now>ef.dismiss&&!ef.fading) ef.fading=now; if(ef.fading&&now-ef.fading>360) st.effects.splice(i,1); } } }
  function drawBig(ef,t,now){ const cx=W/2,cy=H/2-4; const fin=Math.min(1,t/.25), out=ef.fading?Math.max(0,1-(now-ef.fading)/360):1, a=fin*out;
    ctx.fillStyle='rgba(26,34,42,'+(.62*a)+')'; ctx.fillRect(0,0,W,H); if(t<.4){ ctx.fillStyle='rgba(255,250,235,'+(.6*(1-t/.4))+')'; ctx.fillRect(0,0,W,H); }
    ctx.save(); ctx.globalAlpha=a; ctx.translate(cx,cy); ctx.rotate(now/1400); const R=Math.min(W,H)*0.62*Math.min(1,t/.9+.2);
    for(let k=0;k<22;k++){ const a0=k*(6.283/22); ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,R,a0,a0+(6.283/22)*.5); ctx.closePath(); ctx.fillStyle=(k%2?'rgba(199,154,62,.18)':'rgba(127,233,221,.10)'); ctx.fill(); } ctx.restore();
    ctx.save(); ctx.globalAlpha=a; const ring=ease.outCubic(Math.min(1,t/.8)); ctx.beginPath(); ctx.arc(cx,cy,40+ring*170,0,7); ctx.strokeStyle='rgba(255,236,180,'+(.5*(1-ring))+')'; ctx.lineWidth=10*(1-ring)+2; ctx.stroke();
    const cs=.3+ease.outBack(Math.min(1,t/.6))*.7; card(cx,cy+8,150*cs,196*cs,Object.assign({},ef.card,{only:false}),{now,caption:ef.card.q||ef.card.descr||''});
    if(t>.5&&t<1.4){ const sw=(t-.5)/.9; ctx.save(); rr(cx-75,cy+8-98,150,196,18); ctx.clip(); const gx=cx-90+sw*180; const g=ctx.createLinearGradient(gx-14,0,gx+14,0); g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(.5,'rgba(255,255,255,.55)'); g.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle=g; ctx.fillRect(cx-90,cy-110,180,230); ctx.restore(); }
    // 首次发现横幅，沿用原弹跳登场。
    const bt=ease.outBack(Math.min(1,Math.max(0,(t-.1)/.5))); let byc=Math.max(cy-182, st.TICK_H+56);   // 横幅上移·和卡片留空隙·但不顶到屏幕顶部
    const line1='首次发现！'; ctx.font=B(25); const w1=ctx.measureText(line1).width+28;
    const maxBW=Math.min(W*0.72,560), innerMax=maxBW-56;
    let nameFs=31; ctx.font=B(nameFs); while(ctx.measureText(ef.card.n).width>innerMax && nameFs>17){ nameFs--; ctx.font=B(nameFs); }
    let nbm=ef.card.n; if(ctx.measureText(nbm).width>innerMax){ while(ctx.measureText(nbm+'…').width>innerMax && nbm.length>1) nbm=nbm.slice(0,-1); nbm+='…'; }
    const nameW=ctx.measureText(nbm).width, bbw=clamp(Math.max(w1,nameW)+56,Math.min(300,maxBW),maxBW), bbh=100, bbx=cx-bbw/2, bby=byc-bbh/2;
    ctx.save(); ctx.globalAlpha=a; const sc=Math.max(0.01,bt); ctx.translate(cx,byc); ctx.scale(sc,sc); ctx.translate(-cx,-byc);
    const bg=ctx.createLinearGradient(0,bby,0,bby+bbh); bg.addColorStop(0,'#eccb78'); bg.addColorStop(1,'#c79a3e');
    ctx.save(); ctx.shadowColor='rgba(40,55,70,.38)'; ctx.shadowBlur=20; ctx.shadowOffsetY=7; rr(bbx,bby,bbw,bbh,22); ctx.fillStyle=bg; ctx.fill(); ctx.restore();
    ctx.lineWidth=4; ctx.strokeStyle=INK; rr(bbx,bby,bbw,bbh,22); ctx.stroke();
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.save(); ctx.shadowColor='rgba(40,55,70,.45)'; ctx.shadowBlur=4; ctx.shadowOffsetY=2;
    ctx.fillStyle='#fff'; ctx.font=B(25); drawEmoji('🌍',cx-w1/2+12,bby+bbh*0.32,23); ctx.fillText(line1,cx+10,bby+bbh*0.32);
    ctx.font=B(nameFs); ctx.fillText(nbm,cx,bby+bbh*0.66); ctx.restore();
    ctx.restore();
    ctx.globalAlpha=a*Math.min(1,Math.max(0,(t-.3)/.4)); ctx.font=B(14); ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(W<400?('本档发现 · #'+ef.card.seq):('你在这份存档中发现了【'+ef.card.n+'】· #'+ef.card.seq),cx,cy+132); ctx.globalAlpha=a;
    const dt=.016; ef.conf.forEach(p=>{ p.vy+=520*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.rot+=p.vr*dt; ctx.save(); ctx.translate(cx+p.x,cy+p.y); ctx.rotate(p.rot); ctx.globalAlpha=a*Math.max(0,1-t/2.6); ctx.fillStyle=p.c; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore(); });
    ctx.restore();
    if(t>1&&!ef.fading){ ctx.globalAlpha=a*Math.min(1,(t-1)/.4); ctx.textAlign='center'; ctx.textBaseline='middle';
      const sbt='查看分享图';ctx.font=B(13);
      const sw2=ctx.measureText(sbt).width+48,syb=cy+160,sxb=cx-sw2/2;
      block(sxb,syb,sw2,38,14,GOLD,INK,2.5);drawEmoji('📤',sxb+22,syb+19,15);ctx.fillStyle=INK;ctx.font=B(13);ctx.fillText(sbt,sxb+sw2/2+8,syb+19);
      ctx.globalAlpha=a*.7;ctx.font=SB(11);ctx.fillStyle='#fff';ctx.fillText('点空白处继续',cx,H-24);ctx.globalAlpha=1;
      ef.shareBtn={x:sxb,y:syb,w:sw2,h:38};ef.reportBtn=null;
    }
  }
  function drawSmall(ef,t,now){ const cx=W/2,cy=H*0.44, inn=Math.min(1,t/.5), out=t>1?Math.max(0,1-(t-1)/.5):1, a=inn*out;
    ctx.save(); ctx.globalAlpha=a; if(!ef.store.s){ ef.store.s=[]; for(let i=0;i<12;i++) ef.store.s.push({a:Math.random()*6.28,sp:46+Math.random()*56}); }
    const p=ease.outCubic(Math.min(1,t/.7)); ctx.save(); ctx.globalAlpha=a*(1-p); ctx.setLineDash([7,7]); ctx.strokeStyle=TEAL; ctx.lineWidth=4; ctx.beginPath(); ctx.arc(cx,cy-6,38+p*84,0,7); ctx.stroke(); ctx.restore();
    ef.store.s.forEach((s,i)=>spark(cx+Math.cos(s.a)*s.sp*p,cy-6+Math.sin(s.a)*s.sp*p,7,(1-p)*a,RAINBOW[i%6]));
    const cs=.4+ease.outBack(Math.min(1,t/.55))*.6; card(cx,cy-6,90*cs,118*cs,Object.assign({},ef.card,{owned:true}),{now});   // 个人首发卡放大(58→90)
    ctx.font=B(15); const lab='个人首次发现 ✦',lw=ctx.measureText(lab).width,pw=lw+26,ph=30,lx=cx-pw/2,ly=cy+66; rr(lx+2,ly+2,pw,ph,ph/2); ctx.fillStyle=SH; ctx.fill(); rr(lx,ly,pw,ph,ph/2); ctx.fillStyle=GREEN; ctx.fill(); ctx.lineWidth=2.5; ctx.strokeStyle='#fff'; ctx.stroke(); ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(lab,cx,ly+ph/2+.5);
    ctx.restore(); }

  /* ---------- 发现海报 ---------- */
  // 证书「诞生于」日期：用卡真实诞生时刻(抢首发那一刻打的 bornAt)·换算北京时间·缺就退当天。
  //   （2026-07-04 修：原写死 '2026 年 6 月 26 日'=开发期占位假数据·所有卡都一样）
  function fmtBirthDate(c){
    var t=c&&(c.bornAt||c.unlockedAt); var d=t?new Date(t):new Date(); if(isNaN(d.getTime())) d=new Date();
    var bj=new Date(d.getTime()+8*3600*1000);   // 转北京时(UTC+8)·再取 UTC 分量=北京当天的年月日
    return bj.getUTCFullYear()+' 年 '+(bj.getUTCMonth()+1)+' 月 '+bj.getUTCDate()+' 日';
  }
  function drawShare(){ const c=st.share; if(!c)return; const g=ctx.createLinearGradient(0,0,W,H); g.addColorStop(0,'#fbf7ef'); g.addColorStop(1,'#ece5d8'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    ['✨','🎉','🎊','✨'].forEach((s,i)=>drawEmoji(s,[0.08,0.34,0.06,0.92][i]*W,[0.16,0.1,0.66,0.82][i]*H,W*0.022,.85));
    const hx=W*0.27, hy=H*0.52; card(hx,hy,W*0.17,W*0.17*1.33,Object.assign({},c,{only:false}),{}); 
    const rx=W*0.5; let ry=H*0.22; ctx.textAlign='left';
    ctx.font=B(W*0.016); ctx.fillStyle=GOLD2; ctx.fillText('✦ MY DISCOVERY · 我的发现 ✦',rx,ry); ry+=H*0.1;
    ctx.font=SB(W*0.014); ctx.fillStyle='#7a8696'; drawEmoji('🎉',rx+W*0.012,ry-W*0.004,W*0.018); ctx.fillText('恭喜！你刚刚完成了一次——',rx+W*0.032,ry); ry+=H*0.08;
    ctx.font=B(W*0.028); ctx.fillStyle=INK; ctx.fillText('一张新发现',rx,ry); ry+=H*0.07; ctx.fillStyle=GOLD2; ctx.fillText('「'+c.n+'」由你亲手创造',rx,ry); ry+=H*0.085;
    ctx.font=SB(W*0.013); const dl=[['本档编号','第 '+c.seq+' 号造物'],['存档',PLAYER],['诞生于',fmtBirthDate(c)],['类别',c.cat||'抽象']];
    dl.forEach(d=>{ ctx.fillStyle='#7a8696'; ctx.textAlign='left'; ctx.fillText(d[0],rx,ry); ctx.fillStyle=INK; ctx.font=B(W*0.013); ctx.fillText(d[1],rx+W*0.1,ry); ctx.font=SB(W*0.013); ry+=H*0.055; });
    const desc=c.q||c.descr||''; if(desc){ ctx.fillStyle='#7a8696'; ctx.textAlign='left'; ctx.font=SB(W*0.013); ctx.fillText('卡牌简介',rx,ry);
      ctx.fillStyle=GOLD2; ctx.font=B(W*0.013); const maxW=W*0.34, chars=[...('「'+desc+'」')]; let line='', lines=[];
      chars.forEach(ch=>{ if(ctx.measureText(line+ch).width>maxW&&line){ lines.push(line); line=ch; } else line+=ch; }); if(line) lines.push(line);
      lines.slice(0,3).forEach((ln,i)=>ctx.fillText(ln,rx+W*0.1,ry+i*H*0.035)); ry+=H*(0.04*Math.min(lines.length,3)+0.02); }
    ctx.font=B(W*0.016); ctx.fillStyle=INK; ctx.textAlign='right'; ctx.fillText('∞  无限工厂 3',W*0.94,H*0.9);
    ctx.font=SB(12); ctx.fillStyle=MUTE; ctx.textAlign='center'; ctx.fillText('点任意处返回',W/2,H-20); }

  /* ---------- 可点区域 ---------- */
  function pushHot(x,y,w,h,fn){ st.hot.push({x,y,w,h,fn}); }
  function hitHot(p){ for(let i=st.hot.length-1;i>=0;i--){ const r=st.hot[i]; if(p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h) return r; } return null; }
  // 弹窗专用命中（2026-07-12 防穿透统一机制）：只认下标 ≥ start 的热区（start=该弹窗 draw 开头记下的 st.hot 长度）。
  //   命中更早注册的（=压在弹窗底下的详情/词典/场景）一律判 null 不执行；命中更晚的（=叠在更上层的弹窗按钮）执行=行为正确。
  //   ⚠ 已知取舍：三层弹窗叠加时·点最上层弹窗的空白若压着中间层按钮仍会误触（罕见·rect 三态化改动大·暂不做）。
  function hitHotFrom(p,start){ for(let i=st.hot.length-1;i>=0;i--){ const r=st.hot[i]; if(p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h) return (i>=(start||0))?r:null; } return null; }
  // 详情滚动区专用注册（2026-07-12 治"半露按钮热区越界"）：按当前 st._dtClip 上下沿裁剪后再注册·全被裁掉=不注册（自带相交判断）。
  function pushHotDt(x,y,w,h,fn){ const cl=st._dtClip; if(!cl) return; const y1=Math.max(y,cl.top), y2=Math.min(y+h,cl.bot); if(y2>y1) st.hot.push({x,y:y1,w,h:y2-y1,fn}); }



  /* ---------- 主渲染（由引擎主循环每帧调用·原 loop 拆壳·内容一字未动） ---------- */
  function drawFrame(){
    const now=performance.now(), clean=updatePhotoMode(now); ctx.fillStyle='#eef3f8'; ctx.fillRect(0,0,W,H);
    st.floats=st.floats.filter(f=>f.until>now);
    st.cards.forEach(c=>{ c.scale+=(c.tscale-c.scale)*0.22; if(c!==(st.drag&&st.drag.card)){ c.x+=(c.tx-c.x)*0.3; c.y+=(c.ty-c.y)*0.3; } });
    st.dictT += ((st.dictOpen?1:0)-st.dictT)*0.2; computeGeom(); clampView(); syncSearchBox(); st.hot.length=0;
    drawPlay(now,clean);
    if(clean){ if(FRAMEN%45===0) saveFactoryCanvas(); return; }   // 真净屏：只留工作台、卡牌与背景；其它 UI/提示/玩法输入全部暂停
    drawFavDrawer(now); drawDict(now); drawHUD(); drawCombine(); drawTopRightBar(); drawMenu(); drawEffects(now);
    if(st.comboFx) drawComboFx(now);   // 彩蛋⑦：流水线全开庆祝（一次性动画·播完自动清空·平时零开销）
    if(st.cardBubble) drawCardBubble(now);   // 彩蛋②：卡牌旁白气泡（画在弹层之前·开详情等弹层时自然被盖住）
    if(st.detail)drawDetail();if(st.favPick)drawFavPickModal();if(st.share)drawShare();if(st.confirmClear)drawClearConfirm();
    if(st.photoMode) drawPhotoCountdown(now);
    if(FRAMEN%45===0) saveFactoryCanvas();
  }
  const loop=()=>{ if(STILL) stillPaint(); };   // 兼容原代码各处 if(STILL) loop() 的静帧补画调用

  /* ---------- 指针 ---------- */
  function hitCard(p){ const wp=screenToWorld(p.x,p.y); for(let i=st.cards.length-1;i>=0;i--){ const c=st.cards[i]; if(Math.abs(wp.x-c.x)<=CW/2&&Math.abs(wp.y-c.y)<=CH/2) return c; } return null; }
  function overlap(c){ for(const o of st.cards){ if(o===c)continue; if(Math.abs(c.x-o.x)<CW*0.6&&Math.abs(c.y-o.y)<CH*0.6) return o; } return null; }
  function outsideWorld(c){ const b=worldBounds(); return c.x<b.minX||c.x>b.maxX||c.y<b.minY||c.y>b.maxY; }
  function backToDict(c,p,msg){ st.cards=st.cards.filter(x=>x!==c); saveFactoryCanvas(true); floatUp(clamp(p.x,30,Math.max(32,st.PLAY_W-30)),clamp(p.y,st.TICK_H+28,st.TICK_H+st.PLAY_H-28),msg||'已放回词典',MUTE,900); }
  const inPlay=p=>p.x>=0&&p.x<st.toggleRect.x&&p.y>=st.TICK_H, overDict=p=>p.x>=st.toggleRect.x;

  // 多指追踪：双指捏合缩放(#8·触屏没鼠标滚轮·容器里靠两指捏合缩放画布)
  const ptrs=new Map();
  function pinchDist(){ const a=[...ptrs.values()]; if(a.length<2)return 0; return Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y); }
  function pinchMid(){ const a=[...ptrs.values()]; return {x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2}; }
  // 清空多指追踪 + 所有手势状态·切场景进/出时各调一次·根治"幽灵手指"：
  //   切场景那一下，某根手指的 pointerup 可能被跳过（引擎 GO 已把 CUR_NAME 切走→工厂的 pointerup 守卫 return 掉、没 delete），
  //   该指就残留在 ptrs 里；下次单指触摸凑成两点→被误判双指捏合→画布乱缩放（玩家反馈的严重 bug）。
  function clearGestures(){ if(st.favPick)st.favPick.pan=null; ptrs.clear(); st.pinch=null; st.pan=null; st.dictPan=null; st.favPan=null; if(st.drag){ try{ st.drag.card.tscale=1; }catch(_){} st.drag=null; } try{ clearTimeout(st._pressHint); clearTimeout(st._hoverHint); }catch(_){} st.cardBubble=null; }

  /* 彩蛋②：长按/悬停 → 卡上冒气泡（单击仍是看详情·不冲突）。
     内容：有旁白的卡 = 40% 显示自己的旁白 / 60% 随机吐槽（用户 2026-07-03 定比例）；没旁白的卡 = 100% 吐槽。
     暖底金边金字·与详情页旁白框同款配色（B 造物工坊：造物有生命的小惊喜）。
     ⚠ 吐槽语录 CARD_QUIPS：每句都要"放在任何卡上都成立"·短(气泡装得下)·不碰真实IP/敏感词；以后加新句=往数组尾部加一行。 */
  var CARD_QUIPS=[
    '看什么看，没见过卡牌呀~','再盯着我，我可要脸红了','别戳了别戳了，怪痒的','盯…盯…盯什么盯！',
    '你的手放我头上多久了，心里没数吗','长按我干嘛，我又不是电梯按钮','被你发现我会说话了','嘘——我在思考造物的奥秘',
    '厂长，今天合点什么好？','今天也是元气满满的一张卡','我在词典里排队排了好久呢','厂里今天风平浪静',
    '摸鱼被我看到了哦','画布这么大，偏偏坐我这','把我和谁合一下，说不定出奇迹','有本事把我合成新卡呀',
    '想知道我的配方？不告诉你~','我和隔壁那张卡不熟','举高高可以，别把我摔了','别拖来拖去，我会晕的',
    '放我下去，我晕高','我要是会动，早跑了','快去试个新组合，别蹭我了','新发现的味道，你也想尝尝吧',
    '我可是你亲手合出来的……吧？','悄悄告诉你：多放张材料，也许会不一样','合我之前不用想名字，AI 会起的','天气这么热，来点冰的？',
    '我的旁白呢？哦，在这儿呢','下次能换张帅点的卡摸吗…哦是我啊，那没事了'
  ];
  function showCardBubble(c,p){ var q=(c&&c.q)||'';
    var quip=CARD_QUIPS[Math.floor(Math.random()*CARD_QUIPS.length)];
    var txt=(q&&Math.random()<0.4)?q:quip;   // 40% 旁白 / 60% 吐槽·没旁白全吐槽
    st.cardBubble={ txt:txt, x:p.x, y:p.y, until:performance.now()+2600 }; }

  /* 彩蛋⑦：流水线全开（短时间连合 5 次 → 齿轮彩带庆祝·方案C·2026-07-03 用户选定）
     · 设置开关 FXSET.comboFx（默认开·设置→画面与性能·关了完全不触发）
     · 一次性动画（性能红线F3）：平时 st.comboFx=null=每帧只多一个空判断·零开销；
       触发时一次性生成彩带参数 → 播 2.6 秒自动清空（数组释放·无残留状态无独立循环）；
       彩带位置按 age 公式解析算（不逐帧积分）；齿轮预渲染离屏贴图（不每帧画 emoji 字体）。 */
  const COMBO_GAP=20000, COMBO_NEED=5;   // 两次合成间隔<20秒算连击·连满5次触发·触发后重新数
  let _comboN=0,_comboLast=0,_gearImg=null;
  function noteCombo(){ if(!(FXSET&&FXSET.comboFx!==false)) return; const n=performance.now();
    _comboN=(n-_comboLast<COMBO_GAP)?_comboN+1:1; _comboLast=n;
    if(_comboN>=COMBO_NEED){ _comboN=0; startComboFx(); } }
  function gearImg(){ if(_gearImg) return _gearImg; const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d');
    g.font='96px "Segoe UI Emoji","Apple Color Emoji",system-ui'; g.textAlign='center'; g.textBaseline='middle'; g.fillText('⚙️',64,70); _gearImg=c; return c; }
  function startComboFx(){ const parts=[]; const px0=st.PLAY_W*0.15, pxw=st.PLAY_W*0.7;
    for(let i=0;i<46;i++) parts.push({ x:px0+Math.random()*pxw, vx:(Math.random()-0.5)*0.16, vy:-(0.22+Math.random()*0.16),
      rot:Math.random()*7, vr:(Math.random()-0.5)*0.01, c:['#c79a3e','#1fb6a6','#d99a2e','#c2557a','#3a72b8'][i%5], w:7+Math.random()*6 });
    st.comboFx={ t0:performance.now(), parts:parts }; try{ sfxClaim(); }catch(_){} }
  function drawComboFx(now){ const fx=st.comboFx; if(!fx) return; const t=now-fx.t0; if(t>2600){ st.comboFx=null; if(st._comboDemoLoop){ startComboFx(); } return; }   // demo 模式循环回放(仅 ?combodemo=1·线上不会)
    const img=gearImg(), spin=t*0.004, gy=st.TICK_H+st.PLAY_H-46;
    [[46,1],[st.PLAY_W-46,-1]].forEach(g=>{ ctx.save(); ctx.translate(g[0],gy); ctx.rotate(spin*g[1]); ctx.drawImage(img,-32,-32,64,64); ctx.restore(); });
    ctx.save(); ctx.beginPath(); ctx.rect(0,st.TICK_H,st.PLAY_W,st.PLAY_H); ctx.clip();   // 彩带只落在画布区·不压词典
    for(let i=0;i<fx.parts.length;i++){ const p=fx.parts[i], x=p.x+p.vx*t, y=H+10+p.vy*t+0.00022*t*t; if(y>H+16) continue;
      ctx.save(); ctx.translate(x,y); ctx.rotate(p.rot+p.vr*t); ctx.fillStyle=p.c; ctx.fillRect(-p.w/2,-p.w/4,p.w,p.w/2); ctx.restore(); }
    ctx.restore();
    const bp=ease.outBack(clamp(t/340,0,1)), a=clamp((2600-t)/300,0,1);
    ctx.save(); ctx.globalAlpha=Math.min(1,a); ctx.translate(st.PLAY_W/2,gy-52); ctx.scale(bp,bp);
    block(-128,-26,256,52,16,'#fff9ec',GOLD,3,4); ctx.font=B(20); ctx.fillStyle=GOLD2; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('🔥 流水线全开 ×5',0,.5); ctx.restore(); }
  function drawCardBubble(now){ if(!st.cardBubble) return; if(now>st.cardBubble.until){ st.cardBubble=null; return; }
    var b=st.cardBubble, t='「'+b.txt+'」'; ctx.font=SB(12.5); var w=Math.min(ctx.measureText(t).width+22, W*0.72), h=32, x=clamp(b.x-w/2,6,W-w-6), y=clamp(b.y-70,st.TICK_H+6,H-h-14);
    block(x,y,w,h,12,'#fff7e6',GOLD,2,3);
    ctx.beginPath(); ctx.moveTo(x+w/2-6,y+h-1); ctx.lineTo(x+w/2+6,y+h-1); ctx.lineTo(x+w/2,y+h+8); ctx.closePath(); ctx.fillStyle='#fff7e6'; ctx.fill(); ctx.strokeStyle=GOLD; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle=GOLD2; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=SB(12.5); while(ctx.measureText(t).width>w-16&&t.length>3) t=t.slice(0,-2)+'…」'; ctx.fillText(t,x+w/2,y+h/2+.5); }

  legacyListen(cv,'pointerdown',e=>{ if(CUR_NAME!=='工厂界面'||externalBlocked||(window.WXGC3_UI&&WXGC3_UI.isModalOpen&&WXGC3_UI.isModalOpen()))return;
    if(st.photoMode){ initAudio(); const reason=photoHidden()?'touch':'cancel'; finishPhotoMode(reason); try{sfxClick();}catch(_){} return; }   // 净屏时首个触摸只负责恢复；倒计时内触摸=取消，不会穿透拖卡/合成
    initAudio(); try{ parent.postMessage('wxgc-activity','*'); }catch(_){}   // #13 通知外壳"有交互"→重置挂机计时
    if(OVERLAY) return;   // 引擎弹层(评论窗/新手教程/@提示)开着=输入全权归引擎的 OVERLAY.hit·场景一概不碰——否则同一次点击被处理两遍·会误触/误关弹层底下的详情和场景（2026-07-12 对抗审查抓出·与 st.hot 修复配套）
    const p=toS(e);
    if(e.isPrimary) ptrs.clear();   // 主指(第一根手指)落下时·场上本不该有别的手指→先清掉可能残留的"幽灵手指"(切场景返回后遗留在 ptrs 里的触摸点)·防单指滑动被误判成双指捏合缩放·绝不影响真正的双指(第二指 isPrimary=false 不清)
    ptrs.set(e.pointerId,p);
    if(ptrs.size===2 && st.canvasLocked){ if(st.drag){ st.drag.card.tscale=1; st.drag=null; } st.pan=null; st.pinch=null; return; }
    if(ptrs.size===2 && !st.canvasLocked && !st.share && !st.detail && !st.favPick && !st.menuOpen && !st.confirmClear){   // 第二指落下=进入双指捏合(普通画布交互时)·中止拖卡/平移
      if(st.drag){ st.drag.card.tscale=1; st.drag=null; } st.pan=null; st.dictPan=null; st.favPan=null; st.pinch={d0:pinchDist(),s0:view.s}; return; }
    if(ptrs.size>2) return;
    if(st.favPick){ const m=st.favPick,r=m.rect;
      if(!m.busy&&r&&p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h){m.pan={y:p.y,scroll:m.scroll||0,moved:false};return;}
      const h=hitHotFrom(p,st._fpHotStart);if(h)h.fn();return;}   // 收藏选夹弹窗·点框外不关，避免误取消（2026-07-12 起各弹窗分支全用 hitHotFrom=只认自己的按钮·防误触压在底下的详情/场景热区）
    if(st.confirmClear){ const h=hitHotFrom(p,st._ccHotStart); if(h){ h.fn(); } return; }   // 清空画布二次确认·点按钮·点框外不关(防误清)
    if(st.share){ st.share=null; return; }
    const big=st.effects.find(x=>x.type==='big'&&!x.fading);
    if(big){
      if(big.shareBtn&&p.x>=big.shareBtn.x&&p.x<=big.shareBtn.x+big.shareBtn.w&&p.y>=big.shareBtn.y&&p.y<=big.shareBtn.y+big.shareBtn.h){ st.share=big.card; sfxClick(); return; }
      big.fading=performance.now(); return; }
    // 2026-07-17 换季拆除：里程碑弹窗 pointerdown 分支已摘。
    if(st.detail&&!st.favPick){   // favPick(收藏选夹)叠在详情上时让位给它自己的分支
      const R=st._dtRect, inPanel=!!(R&&p.x>=R.x&&p.x<=R.x+R.w&&p.y>=R.y&&p.y<=R.y+R.h);
      const h=hitHotFrom(p,st._dtHotStart);   // 2026-07-12 修点击穿透：只认详情弹窗自己的热区（下标≥_dtHotStart）·压在弹窗底下的词典标签/按钮一律无效（⚠扫场景私有 st.hot——build80 曾误扫恒空的引擎 HOT=按钮全失效+防护失效）
      if(h){ h.fn(); }
      else if(inPanel&&st._dtClip&&p.y>=st._dtClip.top&&p.y<=st._dtClip.bot&&(st.detailMax||0)>0){ st._dtDrag={y:p.y,s:st.detailScroll||0}; }   // 弹窗内滚动区空白=起拖
      else if(!inPanel){ st.detail=null; }   // 弹窗外=只关闭·绝不触发下层任何东西
      return; }   // 弹窗内其余空白=吞掉点击
    const h=hitHot(p); if(st.menuOpen&&!h){ st.menuOpen=false; return; } if(h){ h.fn(); return; }
    const tray=st._combineGeometry;if(st.drawerOpen&&tray&&tray.compact&&p.x>=tray.rect.x&&p.x<=tray.rect.x+tray.rect.w&&p.y>=tray.rect.y&&p.y<=tray.rect.y+tray.rect.h)return;
    if(overFavList(p)){ st.favPan={sy:p.y,v:st.favScroll,moved:false}; return; }
    if(overFavPanel(p)){ return; }
    if(st.dictOpen&&st.dictT>0.9&&p.x>=st.panelX&&p.y>=st._dictGridTop){ st.dictPan={sy:p.y,v:st.dictScroll,moved:false}; return; }   // 词典网格区:按下=准备滚动/点卡(松手不动才算点)
    if(inPlay(p)){   // 2026-07-17 换季拆除：漂浮采集物命中判定已摘（不再做工厂漂浮物类活动·用户拍板）
      const c=hitCard(p); if(c){ const wp=screenToWorld(p.x,p.y); st.drag={card:c,ox:wp.x-c.x,oy:wp.y-c.y,homeX:c.tx,homeY:c.ty,downX:p.x,downY:p.y,moved:false}; st.cards.splice(st.cards.indexOf(c),1); st.cards.push(c); c.tscale=1.1; c.scale=1.1; sfxLift(); cv.setPointerCapture(e.pointerId);
        try{ clearTimeout(st._hoverHint); clearTimeout(st._pressHint); st._pressHint=setTimeout(function(){ if(st.drag&&st.drag.card===c&&!st.drag.moved){ showCardBubble(c,p); st.drag._hinted=true; } },1000); }catch(_){} }   // 彩蛋②：长按1秒(没拖动)→冒这张卡旁白
      else if(!st.canvasLocked) st.pan={sx:p.x,sy:p.y,vx:view.x,vy:view.y}; } });
  legacyListen(cv,'pointermove',e=>{ if(CUR_NAME!=='工厂界面'||externalBlocked||st.photoMode||(window.WXGC3_UI&&WXGC3_UI.isModalOpen&&WXGC3_UI.isModalOpen()))return; if(OVERLAY) return; const p=toS(e); if(ptrs.has(e.pointerId)) ptrs.set(e.pointerId,p);   // OVERLAY 守卫：弹层开着时拖动归引擎 OVERLAY.move·防底下详情跟着滚（2026-07-12）
    if(st.favPick){const m=st.favPick;if(m.pan){const dy=m.pan.y-p.y;if(Math.abs(dy)>5)m.pan.moved=true;m.scroll=clamp(m.pan.scroll+dy,0,m.max||0);}return;}
    if(st._dtDrag){ st.detailScroll=clamp(st._dtDrag.s-(p.y-st._dtDrag.y),0,st.detailMax||0); return; }   // 详情滚动拖动中
    if(!st.drag&&!st.pan&&!st.dictPan&&!st.favPan&&!st.pinch&&e.pointerType!=='touch'){ try{ clearTimeout(st._hoverHint); st._hoverHint=setTimeout(function(){ if(controlsFree()&&!st.drag){ var cc=hitCard(p); if(cc) showCardBubble(cc,p); } },2000); }catch(_){} }   // 彩蛋②：鼠标悬停卡上不动2秒→旁白气泡(手机无hover·靠长按)
    if(st.pinch && ptrs.size>=2){ const d=pinchDist(); if(d>0&&st.pinch.d0>0){ const m=pinchMid(), ns=clamp(st.pinch.s0*(d/st.pinch.d0),Z_MIN,Z_MAX), f=ns/view.s; view.x=m.x-(m.x-view.x)*f; view.y=(m.y-st.TICK_H)-((m.y-st.TICK_H)-view.y)*f; view.s=ns; } return; }   // 双指捏合=缩放(锚在两指中点)
    if(st.drag){ if(Math.abs(p.x-st.drag.downX)+Math.abs(p.y-st.drag.downY)>6){ st.drag.moved=true; try{ clearTimeout(st._pressHint); }catch(_){} } const wp=screenToWorld(p.x,p.y); st.drag.card.x=wp.x-st.drag.ox; st.drag.card.y=wp.y-st.drag.oy; st.drag.card.tx=st.drag.card.x; st.drag.card.ty=st.drag.card.y; }
    else if(st.favPan){ const dy=st.favPan.sy-p.y; if(Math.abs(dy)>5) st.favPan.moved=true; st.favScroll=clamp(st.favPan.v+dy,0,st._favMaxScroll||0); }
    else if(st.dictPan){ const dy=st.dictPan.sy-p.y; if(Math.abs(dy)>5) st.dictPan.moved=true; st.dictScroll=clamp(st.dictPan.v+dy,0,st._dictMaxScroll||0); }
    else if(st.pan){ view.x=st.pan.vx+(p.x-st.pan.sx); view.y=st.pan.vy+(p.y-st.pan.sy); } });
  legacyListen(cv,'pointerup',e=>{ if(CUR_NAME!=='工厂界面'||externalBlocked||(window.WXGC3_UI&&WXGC3_UI.isModalOpen&&WXGC3_UI.isModalOpen()))return; const p=toS(e); ptrs.delete(e.pointerId);
    if(st.favPick){const m=st.favPick,pan=m.pan;m.pan=null;if(pan&&!pan.moved&&!m.busy){const row=(m.rows||[]).find(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h);if(row)confirmCollectToFolder(m.card,row.index);}return;}
    if(st._dtDrag){ st._dtDrag=null; return; }   // 详情滚动拖动结束
    if(st.pinch){ if(ptrs.size<2) st.pinch=null; return; }   // 捏合中松手=结束捏合·不触发点击/合成
    if(st.drag){ const c=st.drag.card, d=st.drag; st.drag=null; c.tscale=1; try{ clearTimeout(st._pressHint); }catch(_){}
      if(!d.moved){ if(d._hinted){ c.tx=d.homeX; c.ty=d.homeY; return; } st.detail=c; sfxClick(); c.tx=d.homeX; c.ty=d.homeY; return; }   // 没拖动：长按已冒过旁白(_hinted)→只归位不弹详情；否则=点击→看详情
      if(st.drawerOpen&&st._slotRects){ for(let i=0;i<4;i++){ const r=st._slotRects[i]; if(r&&!st.slots[i]&&p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h){ st.slots[i]={n:c.n,e:c.e}; c.tx=d.homeX; c.ty=d.homeY; sfxClick(); return; } } }
      if(overDict(p)){ backToDict(c,p,'已放回词典'); return; }
      if(outsideWorld(c)){ backToDict(c,p,'超出画布·已放回词典'); return; }
      const t=overlap(c); if(t){ combineCards(c,t); return; } c.tx=c.x; c.ty=c.y; return; }
    if(st.favPan){ const d=st.favPan; st.favPan=null; if(!d.moved){ const c=(st._favCells||[]).find(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h); if(c&&spawnFromDict(c.d)) toast('已从收藏取出「'+c.d.n+'」'); } return; }   // 收藏抽屉:松手没滚动=取一张到画布；真正使用好友权限时由 spawnFromDict 显示免费提示
    if(st.dictPan){ const d=st.dictPan; st.dictPan=null; if(!d.moved){ const c=(st._dictCells||[]).find(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h); if(c) spawnFromDict(c.d); } return; }   // 词典:松手没滚动=点了某张卡→补到画布
    st.pan=null; });
  legacyListen(cv,'pointercancel',e=>{ if(CUR_NAME!=='工厂界面'||externalBlocked||(window.WXGC3_UI&&WXGC3_UI.isModalOpen&&WXGC3_UI.isModalOpen()))return; if(e)ptrs.delete(e.pointerId); if(st.favPick)st.favPick.pan=null; if(ptrs.size<2) st.pinch=null; if(st.drag){ st.drag.card.tscale=1; st.drag=null; } st.pan=null; st.dictPan=null; st.favPan=null; st._dtDrag=null; });
  legacyListen(cv,'wheel',e=>{ if(CUR_NAME!=='工厂界面'||externalBlocked||(window.WXGC3_UI&&WXGC3_UI.isModalOpen&&WXGC3_UI.isModalOpen()))return; if(st.photoMode){ e.preventDefault(); return; } if(OVERLAY) return; const p=toS(e);   // OVERLAY 守卫：弹层开着时滚轮归引擎 OVERLAY.wheel·防底下详情跟着滚（2026-07-12）
    if(st.favPick){e.preventDefault();const m=st.favPick;if(!m.busy)m.scroll=clamp((m.scroll||0)+e.deltaY*.6,0,m.max||0);return;}
    if(st.detail){ e.preventDefault(); st.detailScroll=clamp((st.detailScroll||0)+e.deltaY*0.6,0,st.detailMax||0); return; }   // 详情开着=滚轮滚详情内容（2026-07-12 滚动化）
    if(overFavList(p)){ e.preventDefault(); st.favScroll=clamp(st.favScroll+e.deltaY*0.6,0,st._favMaxScroll||0); return; }   // 滚轮在收藏抽屉里=滚收藏
    if(st.dictOpen&&st.dictT>0.9&&p.x>=st.panelX&&p.y>=st._dictGridTop){ e.preventDefault(); st.dictScroll=clamp(st.dictScroll+e.deltaY*0.6,0,st._dictMaxScroll||0); return; }   // 滚轮在词典网格区=滚词典
    if(!inPlay(p))return; e.preventDefault(); if(st.canvasLocked) return; const ns=clamp(view.s*(e.deltaY<0?1.1:1/1.1),Z_MIN,Z_MAX),f=ns/view.s; view.x=p.x-(p.x-view.x)*f; view.y=(p.y-st.TICK_H)-((p.y-st.TICK_H)-view.y)*f; view.s=ns; },{passive:false});
  legacyListen(window,'pagehide',()=>saveFactoryCanvas(true));
  legacyListen(window,'beforeunload',()=>saveFactoryCanvas(true));
  legacyListen(document,'visibilitychange',()=>{ if(document.visibilityState==='hidden') saveFactoryCanvas(true); });
  legacyListen(document,'keydown',e=>{ if(CUR_NAME!=='工厂界面'||!st.photoMode||e.key!=='Escape')return; e.preventDefault(); e.stopImmediatePropagation(); finishPhotoMode(photoHidden()?'key':'cancel'); try{sfxClick();}catch(_){}; },true);

  /* ---------- 接真后端：登录后拉一次快照(账号 + 词典 + 我的卡牌)·铺本源·按本地集合标记拥有/首发 ---------- */
  // 按卡本身的首发状态打外观：别人首发的卡在词典里也保留金/蓝/彩边；我是否拥有只决定✓和透明度。
  // 单张卡打外观标（拥有✓/仅此一张金边/被打破蓝边/彩边/署名）——词典 DICT 与本地词库 LDICT 共用同一份逻辑
  function decorateCard(card){
    card.owned=true;card.only=false;card.broken=false;card.sponsor=false;card.mineFirst=false;card.creatorDawn=false;card.lim=cardLim(card);
  }
  function markOwnership(){
    _dataStamp++;_dictCache=null;st._favItemCache=null;
    [st.cards,st.myCards,DICT,BASES].forEach(cards=>(cards||[]).forEach(decorateCard));
  }
  async function bootData(){
    layout();setLocalSnapshot(WXGC3_UI.getState());
    if(localHydrationNeeded){loadFactoryCanvas();localHydrationNeeded=false;}if(!st._seeded&&BASES.length){resetBaseView();seedBases(BASES);st._seeded=true;saveFactoryCanvas(true);}
    if(STILL)loop();
  }

  /* 2026-07-17 换季拆除：活动漂浮采集层（⑦·贝壳/萤火/采集/爆点/COL 整套）已整体摘除。
     用户拍板：今后不再设计「工厂画布漂浮物点击收集」类活动·此坑位永久关闭。 */

  /* ---------- 场景注册（重制版新增·原启动尾逻辑挪进 enter） ---------- */
  registerScene('工厂界面', {
    // 本页原样板参数：block阴影=引擎基准(47,58,74/.20)·toast 2000ms 顶部·热区裸注册(音效各处手动调)
    conf: { blockShadow:'rgba(47,58,74,.20)', toastDur:2000, toastY:function(){ return st.TICK_H+10; }, toastPad:28, toastAlpha:.96, hotSfx:false },
    enter: function(){
      clearGestures();if(W<650){st.dictOpen=false;st.dictT=0;}layout();setLocalSnapshot(WXGC3_UI.getState());bootData();
    },
    leave: function(){
      if(st.photoMode) finishPhotoMode('leave',true);   // 切页时必恢复，不把“隐藏UI”状态带进别的页面
      clearGestures();              // 离工厂也清一次手势残留（与 enter 双保险·防幽灵手指）
      saveFactoryCanvas(true);      // SPA 切页不触发 beforeunload——手动强存画布（清点风险#3 的修复）
      st.menuOpen=false;
      try{ dq.blur(); fq.blur(); }catch(_){}
    },
    addCard: function(id){
      const data=localState&&localState.save&&localState.save.cards.find(card=>card.id===id);
      if(!data)return false;return spawnFromDict(localCardData(data,localState.save.cards.indexOf(data)));
    },
    onResize: function(){ layout(); },
    draw: function(t){ drawFrame(); }
  });

  const scene=SCENES['工厂界面'];
  function inspectFactory(){
    return {width:W,height:H,scale:S,view:{x:view.x,y:view.y,s:view.s},play:{width:st.PLAY_W,height:st.PLAY_H},
      cards:st.cards.map(card=>({id:card.instanceId,cardId:card.cardId||(nativeCard(card.n)||{}).id,name:card.n,x:card.x,y:card.y,pinned:!!card.pinned,screen:worldToScreen(card.x,card.y)})),
      dictionary:(st._dictCells||[]).map(cell=>({x:cell.x,y:cell.y,w:cell.w,h:cell.h,name:cell.d&&cell.d.n})),
      tray:st._combineGeometry&&JSON.parse(JSON.stringify(st._combineGeometry)),
      slots:(st._slotRects||[]).map(rect=>rect&&Object.assign({},rect)),selected:st.slots.map(slot=>slot&&slot.n),
      pending:st.pending.map(item=>({id:item.operationId,x:item.x,y:item.y,screen:worldToScreen(item.x,item.y),cancel:item.cancel?{rect:Object.assign({},item.cancel)}:null})),
      effects:st.effects.map(item=>({type:item.type,name:item.card&&item.card.n,ready:!!item.shareBtn})),
      hot:st.hot.map(rect=>({x:rect.x,y:rect.y,w:rect.w,h:rect.h})),drawerOpen:st.drawerOpen,dictOpen:st.dictOpen,
      favorites:{open:st.favOpen,tab:st.favTab,drawer:st._favDrawer,tabs:(st._favTabs||[]).map(r=>Object.assign({},r)),pages:st._favPages&&{previous:st._favPages.previous&&Object.assign({},st._favPages.previous),next:st._favPages.next&&Object.assign({},st._favPages.next)},cards:(st._favCells||[]).map(r=>({x:r.x,y:r.y,w:r.w,h:r.h,name:r.d.n}))},
      favoritePicker:st.favPick?{scroll:st.favPick.scroll||0,max:st.favPick.max||0,rect:st.favPick.rect,rows:(st.favPick.rows||[]).map(row=>Object.assign({},row))}:null,
      detail:st.detail?{name:st.detail.n,rect:st._dtRect,scroll:st.detailScroll,max:st.detailMax}:null};
  }
  scene.setSnapshot=setLocalSnapshot;scene.inspect=inspectFactory;
  const factoryBinding={setSnapshot:setLocalSnapshot,addCardById:scene.addCard,inspect:inspectFactory,
    blockInput(value){externalBlocked=!!value;if(externalBlocked)clearGestures();},
    destroy(){clearGestures();clearTimeout(st._hoverHint);clearTimeout(st._pressHint);
      [dq,fq].forEach(input=>{try{input.remove();}catch(_){}});
    }};
  scene.destroy=factoryBinding.destroy;
  WXGC3_UI.bindFactory(factoryBinding);
  if(typeof legacyCleanup==='function')legacyCleanup(factoryBinding.destroy);

})();
