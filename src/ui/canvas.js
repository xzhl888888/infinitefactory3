import { createCardPainter } from './card-art.js';
import { followLegacy, drawWaiting, drawDiscovery, drawFloatingText, createDiscoveryParticles, playSynthesisSound } from './synthesis-effects.js';
import { listModAppearances, getModSound } from '../core/mods.js';
import { createModImages, createModAudio } from '../mods/media.js';

const WIDTH = 84, HEIGHT = 108, COLLECT_MS = 180;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const random = i => { const n = Math.sin(i * 127.1 + .73) * 43758.5453; return n - Math.floor(n); };
const waiting = op => op && !op.revealed && !['failed', 'cancelled'].includes(op.phase);

// 存档只记卡牌目标位置；抓取、聚拢、卡背和揭晓均是本次操作的临时表现。
export function createFactoryCanvas(canvas, handlers = {}, { now: clock = () => performance.now() } = {}) {
  const ctx = canvas.getContext('2d'), painter = createCardPainter(ctx,{getMods:()=>save?.mods||[],onAssetReady:()=>{dirty=true;}});
  const modImages=createModImages(()=>{dirty=true;}),modAudio=createModAudio();
  let appearanceMods,tabletops=[];
  let width = 1, height = 1, dpr = 1, save = null, revision = null;
  let nodes = [], selectedIds = [], busy = false, enabled = true, prefs = {}, lastPrefZoom = null, saveId = null, saveEpoch = null, viewTouched = false;
  let zoom = 1, pan = { x: 0, y: 0 }, drag = null, pinch = null, ignoreTap = false;
  let raf = 0, destroyed = false, dirty = true, lastFrame = 0, paintedAt = null, hoverId = null, dotPattern = null, audio = null, zoomTimer = null;
  let operation = null, prepared = null, discovery = null, presentationBusy = false, layoutSignature = null, floats = [];
  const ownLayouts = new Set(), pointers = new Map(), disposers = [];
  let instanceSequence = 0;
  let visible = true;
  const newInstanceId = () => `table:${Date.now().toString(36)}:${++instanceSequence}`;
  const emit = (name, ...args) => handlers[name]?.(...args);
  const on = (target, name, fn, options) => { target.addEventListener(name, fn, options); disposers.push(() => target.removeEventListener(name, fn, options)); };
  const position = event => { const r = canvas.getBoundingClientRect(); return { x: (event.clientX-r.left)*width/r.width, y: (event.clientY-r.top)*height/r.height }; };
  const world = point => ({ x: (point.x-width/2-pan.x)/zoom, y: (point.y-height/2-pan.y)/zoom });
  const screen = point => ({ x: width/2+pan.x+point.x*zoom, y: height/2+pan.y+point.y*zoom });
  const cardFor = id => save?.cards.find(card => card.id === id);
  // 合成只占用本次材料和请求名额，不能让等待模型变成整个台面的输入锁。
  // 文件操作、换档等管理阶段仍由同一入口阻止修改；布局继续走控制器的串行写入。
  const blocked = () => !enabled || (!!busy && !['combine','save','cancel'].includes(busy));
  const synthesisBlocked = () => blocked() || !!busy || !!waiting(operation) || presentationBusy;
  const hiddenNode = n => waiting(operation) && operation.nodeIds.includes(n.id);
  const hit = point => { const p = world(point); return [...nodes].reverse().find(n => !hiddenNode(n) && Math.abs(p.x-n.px)<WIDTH/2 && Math.abs(p.y-n.py)<HEIGHT/2); };
  const decorate = (n, scale=1) => ({ ...n, px:n.x, py:n.y, scale, targetScale:1 });
  // 等待时仍可拖别的卡；结果揭晓/整理触发保存时，不能顺便落盘尚未松手的位置。
  const layout = () => nodes.map(n => {
    const point=drag?.node===n?drag.origin:n;
    return {id:n.id,cardId:n.cardId,x:Math.round(point.x*10)/10,y:Math.round(point.y*10)/10,pinned:!!n.pinned};
  });
  function persist() {
    const value = layout(); ownLayouts.add(JSON.stringify(value));
    if (ownLayouts.size>24) ownLayouts.delete(ownLayouts.values().next().value);
    emit('onLayoutChange', value);
  }
  function setPresentationBusy(value) { if (value!==presentationBusy) { presentationBusy=value; emit('onPresentationBusy',value); } }
  function floatAt(anchor, text, duration=900, color='#8a93a0') {
    const born=clock();floats.push({...anchor,text,color,born,until:born+duration});dirty=true;
  }
  function sound(kind) {
    if (!prefs.soundEnabled) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state==='suspended') audio.resume().catch(()=>{});
      const custom=getModSound(save?.mods,kind),epoch=saveEpoch;
      if(custom) void modAudio.play(audio,custom,()=>!destroyed&&prefs.soundEnabled&&saveEpoch===epoch).then(played=>{if(!played&&!destroyed&&prefs.soundEnabled&&saveEpoch===epoch)playSynthesisSound(audio,kind);});
      else playSynthesisSound(audio,kind);
    } catch { /* 音频不可用时，仍保留完整操作和视觉反馈。 */ }
  }
  function initialNodes(cards) {
    const points=[[-160,-70],[0,-140],[160,-40],[-80,100],[100,140]];
    return cards.filter(c=>c.isBase).map((c,i)=>decorate({id:`table:${c.id}`,cardId:c.id,x:points[i%5][0],y:points[i%5][1],pinned:false}));
  }
  function fitNewSave() { zoom=clamp(Math.min(1,Math.max(130,width-170)/424,(height-112)/412),.45,1.65);pan={x:width<400?0:-28,y:-10}; }
  function fit() {
    const r=canvas.getBoundingClientRect(),previousWidth=width,previousHeight=height;
    // 窄屏词典过渡可暂时挤到零宽；等有效尺寸再重建位图，避免零尺寸纹理中断绘制。
    if(r.width<=0||r.height<=0)return;
    width=Math.max(1,canvas.clientWidth||r.width);height=Math.max(1,canvas.clientHeight||r.height);dpr=Math.min(window.devicePixelRatio||1,2)*r.width/width;
    const pixelWidth=Math.round(width*dpr),pixelHeight=Math.round(height*dpr);
    const bitmapChanged=canvas.width!==pixelWidth||canvas.height!==pixelHeight;
    if(bitmapChanged){canvas.width=pixelWidth;canvas.height=pixelHeight;dotPattern=null;dirty=true;}
    // 抽屉改变可见宽度，不改变世界在屏幕上的原点；新档适配只在载入时进行。
    if(save&&previousWidth>1&&previousHeight>1){pan.x+=(previousWidth-width)/2;pan.y+=(previousHeight-height)/2;}
    // ResizeObserver可能在本帧RAF之后清空位图，不能等下一帧才补卡面。
    // 只重画最近呈现时刻；缓动、揭晓和保存仍仅由正常动画帧推进。
    if(bitmapChanged&&paintedAt!==null&&!document.hidden)paint(paintedAt);
  }
  function changeZoom(value, point={x:width/2,y:height/2}, notify=true) {
    viewTouched=true;const before=world(point);zoom=clamp(value,.45,1.65);pan={x:point.x-width/2-before.x*zoom,y:point.y-height/2-before.y*zoom};dirty=true;
    if(notify){clearTimeout(zoomTimer);zoomTimer=setTimeout(()=>emit('onZoomChange',zoom),180);}
  }
  function returnDrag(active) {
    if(active?.node){Object.assign(active.node,active.origin);active.node.targetScale=1;}
    else if(active)pan=active.origin;
  }
  function down(event) {
    if(blocked()||(event.button!==0&&event.button!==1))return;
    event.preventDefault();const p=position(event);pointers.set(event.pointerId,p);canvas.setPointerCapture(event.pointerId);
    if(pointers.size===2){
      const [a,b]=[...pointers.values()];returnDrag(drag);
      pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom,world:world({x:(a.x+b.x)/2,y:(a.y+b.y)/2})};
      drag=null;hoverId=null;ignoreTap=true;dirty=true;return;
    }
    if(pointers.size>2)return;
    ignoreTap=false;const n=event.button===1?null:hit(p);
    drag={pointerId:event.pointerId,node:n,start:p,origin:n?{x:n.x,y:n.y}:{...pan},grabbed:n?{x:n.px,y:n.py}:null,moved:false};
    if(n){nodes=nodes.filter(x=>x!==n).concat(n);n.x=n.px;n.y=n.py;n.scale=n.targetScale=prefs.reduceMotion?1:1.1;sound('lift');}
    dirty=true;
  }
  function move(event) {
    if(!pointers.has(event.pointerId))return;
    const p=position(event);pointers.set(event.pointerId,p);
    if(pinch&&pointers.size>=2){
      viewTouched=true;const [a,b]=[...pointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      zoom=clamp(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance,.45,1.65);
      pan={x:mid.x-width/2-pinch.world.x*zoom,y:mid.y-height/2-pinch.world.y*zoom};dirty=true;return;
    }
    if(!drag||drag.pointerId!==event.pointerId)return;
    const dx=p.x-drag.start.x,dy=p.y-drag.start.y;drag.moved ||= Math.abs(dx)+Math.abs(dy)>6;
    if(drag.node){
      // 6像素只区分松手后的点击/拖拽；第一像素就跟手，抓取缓动中的卡也从可见位置开始。
      drag.node.x=drag.node.px=clamp(drag.grabbed.x+dx/zoom,-2400,2400);drag.node.y=drag.node.py=clamp(drag.grabbed.y+dy/zoom,-1800,1800);
      hoverId=synthesisBlocked()?null:[...nodes].reverse().find(n=>n!==drag.node&&!hiddenNode(n)&&Math.abs(n.px-drag.node.x)<WIDTH*.6&&Math.abs(n.py-drag.node.y)<HEIGHT*.6)?.id||null;
    }else{pan={x:drag.origin.x+dx,y:drag.origin.y+dy};viewTouched=true;}
    dirty=true;
  }
  function end(event,cancelled=false) {
    if(!pointers.has(event.pointerId))return;pointers.delete(event.pointerId);
    // 先清除手势再释放捕获，避免浏览器同步 lostpointercapture 二次结算。
    const active=drag;drag=null;
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    if(pinch||ignoreTap){if(!pointers.size){pinch=null;ignoreTap=false;emit('onZoomChange',zoom);}hoverId=null;dirty=true;return;}
    if(!active||active.pointerId!==event.pointerId)return;
    if(active.node)active.node.targetScale=1;
    if(cancelled)returnDrag(active);
    else if(active.node&&!active.moved){returnDrag(active);sound('click');emit('onPick',active.node.cardId);}
    else if(active.node){
      // 返回词典只移除这个台面实例，卡牌、配方及其他同名实例均保留。
      if(emit('isDictionaryDrop',{clientX:event.clientX,clientY:event.clientY})){
        nodes=nodes.filter(n=>n!==active.node);persist();sound('click');
        // 该短提示约65逻辑像素宽，中心离边缘需超过半个文字宽度。
        const p=position(event);floatAt(world({x:clamp(p.x,45,width-45),y:clamp(p.y,30,height-30)}),'已放回词典');
        hoverId=null;dirty=true;return;
      }
      const target=synthesisBlocked()?null:nodes.find(n=>n.id===hoverId&&!hiddenNode(n));
      if(target){
        const anchor={x:(target.px+active.node.x)/2,y:(target.py+active.node.y)/2};
        prepared={anchor,nodeIds:[target.id,active.node.id],ghosts:[target,active.node].map(n=>({cardId:n.cardId,x:n.px,y:n.py,scale:n.scale}))};
        Object.assign(active.node,active.origin);
        emit('onCombine',[target.cardId,active.node.cardId]);
        // 控制器同步接受后会消费 prepared；拒绝时恢复台面，不留下悬空动画。
        if(prepared){prepared=null;returnDrag(active);}
      }else persist();
    }
    hoverId=null;dirty=true;
  }
  function prepareSynthesis(ids, screenPoints=[]) {
    if(synthesisBlocked())return false;
    const anchor=world({x:width*.5,y:height*.4});
    prepared={anchor,nodeIds:[],ghosts:ids.map((id,i)=>({cardId:id,...world(screenPoints[i]||{x:width*.5+(i-(ids.length-1)/2)*55,y:height-80}),scale:.55}))};
    return true;
  }
  function beginOperation(next) {
    const origin=prepared||{anchor:world({x:width*.5,y:height*.4}),nodeIds:[],ghosts:[]};prepared=null;
    operation={...next,...origin,started:clock(),revealed:false,result:null};
    setPresentationBusy(true);sound('think');dirty=true;
  }
  function restoreOperation() {
    for(const n of nodes)if(operation.nodeIds.includes(n.id)){n.px=operation.anchor.x;n.py=operation.anchor.y;n.scale=prefs.reduceMotion?1:.4;n.targetScale=1;}
    operation.restored=true;sound('failure');floatAt({...operation.anchor,y:operation.anchor.y-HEIGHT*.6},operation.phase==='cancelled'?'已取消':'合成未完成',1600);setPresentationBusy(false);dirty=true;
  }
  function revealOperation(now) {
    const op=operation;if(!op||op.revealed||op.phase!=='committed'||!op.result?.card)return;
    if(now-op.started<(prefs.reduceMotion?0:op.source==='cache'?260:420))return;
    // 只有提交成功才替换材料实例。失败及重试保存一直保留原布局。
    op.revealed=true;
    nodes=nodes.filter(n=>!op.nodeIds.includes(n.id)||n.pinned);
    const pinned=nodes.some(n=>op.nodeIds.includes(n.id));
    const node=decorate({id:newInstanceId(),cardId:op.result.card.id,x:op.anchor.x+(pinned?WIDTH*.75:0),y:op.anchor.y,pinned:false},prefs.reduceMotion?1:.2);
    nodes.push(node);
    if(op.result.isNewCard){discovery={id:op.id,card:op.result.card,started:now,particles:createDiscoveryParticles()};sound('discovery');}
    else{sound('repeat');floatAt({x:node.x,y:node.y-HEIGHT*.6},'合成完成');}
    persist();emit('onReveal',op.result);setPresentationBusy(false);dirty=true;
  }
  function background() {
    if(appearanceMods!==save?.mods){appearanceMods=save?.mods;tabletops=listModAppearances(appearanceMods||[],'tabletops');}
    const custom=tabletops.find(t=>t.id===prefs.tabletopId);
    const tabletop=custom?custom.id:['paper','deep','cosmos'].includes(prefs.tabletopId)?prefs.tabletopId:'paper',dark=!custom&&tabletop!=='paper';
    const gradient=ctx.createLinearGradient(0,0,tabletop==='cosmos'?width:0,height);
    gradient.addColorStop(0,tabletop==='cosmos'?'#121829':dark?'#0e2340':'#f6f1e8');gradient.addColorStop(1,tabletop==='cosmos'?'#0d1628':dark?'#1a3a63':'#ece5d8');
    ctx.fillStyle=custom?.color||gradient;ctx.fillRect(0,0,width,height);
    const texture=modImages.get(custom?.image);if(texture){ctx.save();ctx.globalAlpha=.35;ctx.drawImage(texture,0,0,width,height);ctx.restore();}
    if(dark){
      for(let i=0;i<48;i++){ctx.beginPath();ctx.arc(random(i+11)*width,random(i+61)*height,i%7?1.1:2,0,7);ctx.fillStyle=i%7?'rgba(180,215,236,.45)':'rgba(244,198,99,.75)';ctx.fill();}
      if(tabletop==='cosmos'){ctx.save();ctx.strokeStyle='rgba(89,195,184,.19)';ctx.lineWidth=1.15;for(let i=0;i<5;i++){ctx.beginPath();ctx.arc(width*(.18+i*.19),height*(.2+(i%3)*.27),70+i*17,-.65,2.75);ctx.stroke();}ctx.setLineDash([5,8]);ctx.strokeStyle='rgba(232,187,90,.22)';ctx.beginPath();ctx.moveTo(-20,height*.72);ctx.bezierCurveTo(width*.28,height*.28,width*.61,height*.9,width+30,height*.34);ctx.stroke();ctx.restore();}
    }
    const step=Math.max(16,28*zoom),key=`${step}:${tabletop}:${custom?.gridColor}`;
    if(!dotPattern||dotPattern.key!==key){const c=document.createElement('canvas');c.width=c.height=Math.ceil(step*dpr);const p=c.getContext('2d');p.fillStyle=custom?.gridColor||(dark?'rgba(150,195,240,.14)':'rgba(60,80,95,.07)');p.fillRect(0,0,1.5*dpr,1.5*dpr);dotPattern={key,pattern:ctx.createPattern(c,'repeat')};}
    ctx.save();ctx.translate(pan.x%step,pan.y%step);ctx.scale(1/dpr,1/dpr);ctx.fillStyle=dotPattern.pattern;ctx.fillRect(-step*dpr,-step*dpr,(width+2*step)*dpr,(height+2*step)*dpr);ctx.restore();
    const light=ctx.createRadialGradient(width*.5,height*.46,8,width*.5,height*.46,width*.52);light.addColorStop(0,dark?'rgba(170,215,255,.13)':'rgba(255,252,240,.72)');light.addColorStop(1,'rgba(255,252,240,0)');ctx.fillStyle=light;ctx.fillRect(0,0,width,height);
  }
  function advancePresentation(now,dt) {
    revealOperation(now);
    for(const n of nodes){
      n.px=prefs.reduceMotion?n.x:followLegacy(n.px,n.x,.3,dt);n.py=prefs.reduceMotion?n.y:followLegacy(n.py,n.y,.3,dt);n.scale=prefs.reduceMotion?n.targetScale:followLegacy(n.scale,n.targetScale,.22,dt);
      if(Math.abs(n.px-n.x)<.01)n.px=n.x;if(Math.abs(n.py-n.y)<.01)n.py=n.y;if(Math.abs(n.scale-n.targetScale)<.001)n.scale=n.targetScale;
    }
    floats=floats.filter(f=>f.until>now);
    if(discovery&&now-discovery.started>=1500)discovery=null;
  }
  function paint(now) {
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);background();
    ctx.save();ctx.translate(width/2+pan.x,height/2+pan.y);ctx.scale(zoom,zoom);
    for(const n of nodes){
      const card=cardFor(n.cardId);if(!card||hiddenNode(n))continue;
      const picked=selectedIds.indexOf(n.cardId),highlight=picked>=0||hoverId===n.id;
      painter.drawCard(n.px,n.py,WIDTH*n.scale,HEIGHT*n.scale,card,{skinId:prefs.skinId,now,animate:!prefs.reduceMotion,lift:drag?.node===n,selected:highlight,selectionIndex:picked>=0?picked+1:null,rotation:drag?.node===n&&!prefs.reduceMotion?-.05:0});
    }
    const op=operation,elapsed=op?now-op.started:0;
    // 补齐材料到卡背的短衔接，不以动画时长猜测网络是否完成。
    if(waiting(op)&&elapsed<COLLECT_MS&&!prefs.reduceMotion){
      const t=clamp(elapsed/COLLECT_MS,0,1),ease=1-(1-t)**3;
      for(const ghost of op.ghosts){const card=cardFor(ghost.cardId);if(!card)continue;ctx.save();ctx.globalAlpha=1-t;
        const scale=ghost.scale*(1-.25*t);painter.drawCard(ghost.x+(op.anchor.x-ghost.x)*ease,ghost.y+(op.anchor.y-ghost.y)*ease,WIDTH*scale,HEIGHT*scale,card,{skinId:prefs.skinId,now,animate:false});ctx.restore();}
    }
    ctx.restore();
    if(waiting(op)){
      const p=screen(op.anchor),label=op.phase==='save-failed'?'等待保存':busy==='cancel'?'正在取消':op.phase==='saving'?'正在保存':op.phase==='committed'?'合成中':'造物中';
      ctx.save();ctx.globalAlpha=prefs.reduceMotion?1:clamp(elapsed/COLLECT_MS,0,1);
      drawWaiting(ctx,painter,{...p,scale:zoom,now,cardBackId:prefs.cardBackId,reduceMotion:prefs.reduceMotion||op.phase==='save-failed',label});ctx.restore();
    }
    for(const f of floats)drawFloatingText(ctx,{...f,...screen(f),reduceMotion:!!prefs.reduceMotion},now);
    if(discovery)drawDiscovery(ctx,painter,{x:width/2,y:height*.44,card:discovery.card,particles:discovery.particles,elapsedMs:now-discovery.started,now,skinId:prefs.skinId,reduceMotion:!!prefs.reduceMotion,label:'首次发现 ✦'});
  }
  function movingNodes(){return nodes.some(n=>Math.abs(n.px-n.x)>.01||Math.abs(n.py-n.y)>.01||Math.abs(n.scale-n.targetScale)>.001);}
  function frame(now){
    if(destroyed||!visible)return;
    const elapsed=operation?now-operation.started:0;
    const waitAnimated=waiting(operation)&&(
      operation.phase==='committed'||(!prefs.reduceMotion&&(operation.phase!=='save-failed'||elapsed<COLLECT_MS))
    );
    // 静态待保存卡背可停留很久；减少动态效果时也不为不变的等待画面整屏重绘。
    const animated=(!prefs.reduceMotion&&['sea','hearth','starfire','firefly','dawn'].includes(prefs.skinId))||waitAnimated||discovery||floats.length||movingNodes();
    // 每次屏幕刷新都可响应输入；按时间换算缓动，不用120Hz门槛丢掉高刷的隔帧。
    // 时钟在静止时也前进，避免长按后松手把整段静止时间算进回落的第一帧。
    const dt=lastFrame?Math.min(64,now-lastFrame):1000/60;lastFrame=now;
    if(!document.hidden&&(dirty||animated)){dirty=false;advancePresentation(now,dt);paint(now);paintedAt=now;}
    raf=requestAnimationFrame(frame);
  }
  on(canvas,'pointerdown',down);on(canvas,'pointermove',move);on(canvas,'pointerup',e=>end(e));on(canvas,'pointercancel',e=>end(e,true));
  on(canvas,'lostpointercapture',e=>{if(pointers.has(e.pointerId))end(e,true);});
  on(canvas,'wheel',e=>{if(blocked())return;e.preventDefault();changeZoom(zoom*Math.exp(-e.deltaY*.001),position(e));},{passive:false});
  // 默认点卡即详情；合成台展开时连续点选允许重复材料，不另抢占双击。
  on(canvas,'contextmenu',e=>{e.preventDefault();const n=hit(position(e));if(n&&!blocked())emit('onCardDetails',n.cardId);});
  on(document,'visibilitychange',()=>{if(document.hidden){pointers.clear();returnDrag(drag);drag=null;pinch=null;hoverId=null;}lastFrame=0;dirty=true;});
  const observer=new ResizeObserver(fit);observer.observe(canvas);fit();raf=requestAnimationFrame(frame);
  return {
    update(state){
      save=state.save;busy=state.busy||false;enabled=state.enabled!==false;selectedIds=state.selectedIds||[];prefs=save?.preferences||{};
      if(save&&revision!==`${save.id}:${state.saveEpoch||0}:${save.revision}`){
        revision=`${save.id}:${state.saveEpoch||0}:${save.revision}`;const known=new Set(save.cards.map(c=>c.id)),sig=JSON.stringify(save.layout||[]),newSave=saveId!==save.id||saveEpoch!==(state.saveEpoch||0);
        if(newSave){operation=null;prepared=null;discovery=null;floats=[];pointers.clear();drag=null;pinch=null;hoverId=null;clearTimeout(zoomTimer);ownLayouts.clear();layoutSignature=null;modAudio.clear();modImages.clear();setPresentationBusy(false);pan={x:0,y:0};}
        // 偏好/统计写入不能重置抓取和动效；本窗口布局的响应也不覆盖更晚的摆放。
        if(sig!==layoutSignature||newSave){
          if(newSave||!ownLayouts.has(sig)){
            const previous=new Map(nodes.map(n=>[n.id,n]));
            nodes=(save.layout?.length||prefs.layoutInitialized)?(save.layout||[]).filter(n=>known.has(n.cardId)).map(n=>{const prior=previous.get(n.id);return prior&&!newSave?{...prior,...n}:decorate(n);}):initialNodes(save.cards);
          }
          layoutSignature=sig;
        }
        if(newSave){viewTouched=!!save.layout?.length||!!prefs.layoutInitialized;if(!viewTouched)fitNewSave();else zoom=clamp(Number(prefs.zoom)||1,.45,1.65);}
        else if(lastPrefZoom!==prefs.zoom){viewTouched=true;zoom=clamp(Number(prefs.zoom)||1,.45,1.65);}
        saveId=save.id;saveEpoch=state.saveEpoch||0;lastPrefZoom=prefs.zoom;
      }
      if(!save){nodes=[];revision=null;operation=null;prepared=null;discovery=null;floats=[];setPresentationBusy(false);}
      const next=state.synthesis;
      if(next){
        if(operation?.id!==next.id)beginOperation(next);
        else Object.assign(operation,{phase:next.phase,source:next.source});
        if(['failed','cancelled'].includes(next.phase)&&!operation.restored)restoreOperation();
        if(state.lastResult?.operationId===next.id&&next.phase==='committed')operation.result=state.lastResult;
      }else if(operation){operation=null;prepared=null;discovery=null;setPresentationBusy(false);}
      dirty=true;
    },
    prepareSynthesis,
    playClick(){sound('click');},
    addCard(cardId){
      if(blocked()||!cardFor(cardId))return;
      const center=world({x:width*.5,y:height*.45});
      nodes.push(decorate({id:newInstanceId(),cardId,x:center.x+Math.random()*120-60,y:center.y+Math.random()*80-40,pinned:false},prefs.reduceMotion?1:.3));
      viewTouched=true;sound('click');persist();dirty=true;
    },
    arrange(){
      if(blocked())return;
      // 固定世界网格只做就近对齐，不按抓取后的绘制顺序重排玩家的分组。
      // 正在合成的实例保留原目标与存档身份，失败恢复和成功揭晓均由原操作处理。
      const stepX=92,stepY=116,occupied=new Set(),key=(x,y)=>`${x}:${y}`;
      const fixed=n=>n.pinned||hiddenNode(n)||drag?.node===n;
      nodes.filter(fixed).forEach(n=>occupied.add(key(Math.round(n.x/stepX),Math.round(n.y/stepY))));
      const movable=nodes.filter(n=>!fixed(n)).sort((a,b)=>a.py-b.py||a.px-b.px||a.id.localeCompare(b.id));
      for(const n of movable){
        const col=Math.round(n.px/stepX),row=Math.round(n.py/stepY);let dest=null;
        // 重叠卡向附近空格散开；搜索范围由已有占用数约束，不设未来玩法的版面限制。
        for(let radius=0;!dest;radius++){
          let best=Infinity;
          for(let dx=-radius;dx<=radius;dx++)for(let dy=-radius;dy<=radius;dy++){
            if(Math.max(Math.abs(dx),Math.abs(dy))!==radius||occupied.has(key(col+dx,row+dy)))continue;
            const distance=((col+dx)*stepX-n.px)**2+((row+dy)*stepY-n.py)**2;
            if(distance<best){best=distance;dest={x:col+dx,y:row+dy};}
          }
        }
        occupied.add(key(dest.x,dest.y));n.x=dest.x*stepX;n.y=dest.y*stepY;
      }
      viewTouched=true;persist();dirty=true;
    },
    zoomBy(factor){if(!blocked())changeZoom(zoom*factor);},
    resize:fit,
    setVisible(value){
      if(visible===value)return;
      visible=value;cancelAnimationFrame(raf);lastFrame=0;dirty=true;
      if(visible&&!destroyed)raf=requestAnimationFrame(frame);
    },
    destroy(){destroyed=true;clearTimeout(zoomTimer);cancelAnimationFrame(raf);observer.disconnect();disposers.forEach(fn=>fn());pointers.clear();modAudio.clear();modImages.clear();audio?.close().catch(()=>{});},
  };
}
