'use strict';
/* =====================================================================
   无限工厂2重制版 · 公共引擎（01-引擎.js）
   ---------------------------------------------------------------------
   定位：全游戏唯一的一份"画布 + 场景管理 + 输入分发 + 绘图基元 + 音效"。
        2代拼装版里这些代码在 14 个页面里各复制了一份（占包体一半以上），
        重制版收编成这一份，14 个场景共用。
   基准：以 2代 v39《工厂界面-拼装版.html》的实现为基准（它是全站最全版本），
        各页与基准的细微差异（block阴影色 / toast时长位置 / 热区是否自动带音效）
        全部做成【按场景参数】——每个场景沿用自己原来的值，保证视觉/手感一字不变。
   规则：本文件属于"引擎层"，业务/页面逻辑一律写进 场景/*.js，别往这里塞。
   ===================================================================== */

/* ==================== 画布与适配（fit·设计高540·dpr上限2） ==================== */
// 保留二代经典脚本共享变量；仅把监听和循环纳入三代页面生命周期。
var LEGACY_LISTENERS = [], LEGACY_CLEANUPS = [], LEGACY_DESTROYED = false, LEGACY_RAF_ID = 0;
function legacyListen(target, type, fn, options){ target.addEventListener(type, fn, options); LEGACY_LISTENERS.push([target,type,fn,options]); return fn; }
function legacyCleanup(fn){ LEGACY_CLEANUPS.push(fn); return fn; }
var LEGACY_LAST_ERROR = '';
function legacyReportError(stage, error){
  var message = String(error && error.message || error), identity = stage + ':' + message;
  if(identity === LEGACY_LAST_ERROR) return;
  LEGACY_LAST_ERROR = identity;
  window.__WXGC3_LEGACY_ERROR__ = {stage:stage,message:message};
  console.error('[无限工厂3] ' + stage, error);
  window.dispatchEvent(new CustomEvent('wxgc3-legacy-error',{detail:{stage:stage,message:message}}));
}
var cv = document.getElementById('c'), ctx = cv.getContext('2d');
var W = 0, H = 0, S = 1, dpr = 1, FRAMEN = 0;
// 静帧自检：URL 带 ?shot（可配 &page=场景名）→ 固定 960×540、同步跑 48 帧后冻结，供无头截图/读像素自检。
// 注意：只认 search，不认 hash（2代的 /shot/ 连 hash 一起测，单文档若用 hash 路由会误冻结——清点风险#1的修正）
var STILL = /(\?|&)shot(=|&|$)/.test(location.search);
function fit(){ dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (STILL){ W = 960; H = 540; var dw = Math.min(window.innerWidth, 960), dh = dw * H / W; cv.style.width = dw + 'px'; cv.style.height = dh + 'px'; cv.width = Math.round(dw * dpr); cv.height = Math.round(dh * dpr); S = cv.width / W; }
  else { var vw = window.innerWidth, vh = window.innerHeight; H = 540; W = Math.round(H * vw / vh);   // 固定设计高度540·宽随屏幕真实比例·全 UI 按屏高等比缩放→各机型排版一致·填满不留黑边
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px'; cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr); S = cv.height / H; }
  try{ CVR = cv.getBoundingClientRect(); }catch(e){ CVR = null; } }   // 尺寸定了就刷新矩形缓存（M5）
var CVR = null;   // 画布屏幕矩形缓存（M5：只在 fit/resize 时刷新·省掉各场景每帧 getBoundingClientRect 强制布局查询）
function cvRect(){ return CVR || (CVR = cv.getBoundingClientRect()); }
legacyListen(window, 'resize', function(){ fit();
  try { if (CUR && CUR.onResize) CUR.onResize(); } catch(e){}   // 场景自己的布局钩子（工厂 layout()/仓库 syncPickerInput() 等在此挂）
  if (STILL) stillPaint(); });

/* ==================== B 造物工坊 配色/字体/工具（工厂版全集） ==================== */
var INK='#23303a', GOLD='#c79a3e', GOLD2='#a9802f', PINKB='#c2557a', SEASON='#d99a2e', MUTE='#8a93a0', GREEN='#2fae9b', BLUE='#3a72b8',
    CREAM='#f6efe1', CREAM2='#efe6d4', PINK='#f6eef0', PINK2='#f0e6ea', SKY='#f4efe6', SKY2='#fbf8f1', R_ONLY='#c2557a',
    PAPER='#f4efe6', PAPER2='#ece5d8', PANEL='#faf6ee', TEAL='#1fb6a6', GLOW='#7fe9dd', LINE='rgba(40,60,70,.12)',
    WARM='#c0492f';                                             // WARM=仓库/每日福利用的暖红（清点：需并入基准的页面独有色）
var RAINBOW=['#c79a3e','#1fb6a6','#7fe9dd','#e9c98a','#9bd9cf','#cda85a'];   // 首发金箔/青光粒子（工厂语义；商店的粉紫渐变同名不同义→搬商店时改名 RAINBOW_SHOP 留在其场景内）
var IRID=['#7fe9dd','#bfead0','#ffe6a8','#e7c8ff','#a9d4ff','#7fe9dd'];      // 仅此一张：虹彩流体边
var CATS=WXGC2_CARD_CATEGORIES.colors;
// 显示名单与AI识别共用分类真源；只读服务器确认过的赛季，不按本机日期猜测。
function cardCategoryNames(){return WXGC2_CARD_CATEGORIES.displayForSeason(window.WXGC2_API&&WXGC2_API.cachedSeason?WXGC2_API.cachedSeason():'');}
var SH='rgba(47,58,74,.16)';
/* 字体串按字号缓存（性能·2026-07-03 审计：原每次 ctx.font=B(px) 都拼接新字符串·一帧上百次·全站高频） */
var _FEMO={},_FB={},_FSB={};
var EMO=function(px){ return _FEMO[px]||(_FEMO[px]=px + 'px "Segoe UI Emoji","Apple Color Emoji",system-ui'); };
var B=function(px){ return _FB[px]||(_FB[px]='900 ' + px + 'px "PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif'); };
var SB=function(px){ return _FSB[px]||(_FSB[px]='700 ' + px + 'px "PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif'); };
var ease={ outBack:function(x){ var c1=1.70158,c3=c1+1; return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2); },
  outCubic:function(x){ return 1-Math.pow(1-x,3); },
  outElastic:function(x){ var c4=2*Math.PI/3; return x<=0?0:x>=1?1:Math.pow(2,-10*x)*Math.sin((x*10-0.75)*c4)+1; } };
var clamp=function(v,a,b){ return v<a?a:v>b?b:v; };

/* ==================== 静态蓝图点阵（M5 离屏缓存·各页 drawBg 共用） ====================
   原版每页背景都用双重循环画约 500~600 个 1.5px 小点、每帧重画（清点：各页共同的最大固定开销）。
   这里把同样的点阵按当前屏幕尺寸画进一张离屏图（像素结果与原版逐点一致），每帧只做一次位块拷贝；
   只在"窗口尺寸变化"时重画。起点(14,14)·步长30 与全部页面原版一致。 */
var _BGDOTS = null;
function drawDots(color){
  if (!_BGDOTS || _BGDOTS.W !== W || _BGDOTS.H !== H || _BGDOTS.S !== S || _BGDOTS.color !== color){
    var off = document.createElement('canvas'); off.width = Math.max(2, Math.ceil(W * S)); off.height = Math.max(2, Math.ceil(H * S));
    var oc = off.getContext('2d'); oc.scale(S, S); oc.fillStyle = color;
    for (var gx = 14; gx < W; gx += 30){ for (var gy = 14; gy < H; gy += 30){ oc.fillRect(gx, gy, 1.5, 1.5); } }
    _BGDOTS = { c: off, W: W, H: H, S: S, color: color };
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(_BGDOTS.c, 0, 0); ctx.restore();
}

/* ==================== 玩家设置快照（FXSET·活的） ====================
   2代每页"加载时读一次、整页刷新才更新"；重制版没有整页刷新了，
   所以改成：每次切场景都重读一次（refreshFXSET 在 GO() 里调），
   设置页改完设置也会主动调它——改了设置回到任何页立即生效。 */
var FXSET = { fx:true, fallEmoji:true, cardFx:true, celebrate:true, comboFx:true, sfx:true, bgmOn:true, bgmTrack:4, vibrate:false, dictDefault:'mine', dictBig:false, tabletopStar:false, dawnSkin:true, debug:false };
function refreshFXSET(){ try{ if (window.WXGC2_API && WXGC2_API.settings) FXSET = WXGC2_API.settings.all(); if(window.WXGC3_LEGACY_MUSIC) WXGC3_LEGACY_MUSIC.sync(); }catch(e){legacyReportError('读取设置',e);} }
/* 等级外观解锁表（2026-07-10）：kind→true（frame/cardskin/tabletop/cardback）。
   工厂 bootData/refreshAccount 拉 /me 后灌入·全场景共用。 */
var UNLOCKS = {};
function setUnlocks(list){ UNLOCKS={}; (list||[]).forEach(function(u){ if(u&&u.kind) UNLOCKS[u.kind]=true; }); }
// 破晓金边=40级全局主题卡面：解锁+开关开 → "我拥有的所有卡"渲染时自动披上（专属结晶皮肤优先·纯前端·别人不受影响）
function dawnAllOn(){ return FXSET.skinId==='dawn'; }
function vibe(p){ if(!FXSET.vibrate) return; try{ if(navigator.vibrate) navigator.vibrate(p); }catch(e){} }   // 震动反馈

/* ==================== 绘图基元（rr/block/rainbow/goldEdge/spark/pill） ==================== */
function rr(x,y,w,h,r){ ctx.beginPath(); if(w<=0||h<=0) return; r=Math.max(0,Math.min(r,w/2,h/2)); ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
// block 的阴影色 2代各页有三种微差（工厂 47,58,74/.20，主页 40,55,70/.20，部分子页 .18）——
// 按场景参数走 SCENE_CONF.blockShadow，每页保持自己原来的颜色，肉眼观感与2代逐页一致。
function block(x,y,w,h,r,fill,stroke,lw,off){ off = off==null ? 4 : off;
  ctx.save(); if(off>0){ ctx.shadowColor = SCENE_CONF.blockShadow; ctx.shadowBlur = off*1.8+2; ctx.shadowOffsetY = off*0.8+1; }
  rr(x,y,w,h,r); ctx.fillStyle = fill; ctx.fill(); ctx.restore();
  if(stroke){ rr(x,y,w,h,r); ctx.lineWidth = lw||2.5; ctx.strokeStyle = stroke; ctx.stroke(); } }
function rainbow(x,y,w,h,r,ang,width){ ctx.save(); rr(x,y,w,h,r); if(ctx.createConicGradient){ var g=ctx.createConicGradient(ang,x+w/2,y+h/2); for(var i=0;i<=6;i++) g.addColorStop(i/6,IRID[i%6]); ctx.strokeStyle=g; } else ctx.strokeStyle=IRID[0]; ctx.lineWidth=width||2.4; ctx.lineJoin='round'; ctx.stroke(); ctx.restore(); }
function goldEdge(x,y,w,h,r,ang,width){ ctx.save(); rr(x,y,w,h,r); if(ctx.createConicGradient){ var g=ctx.createConicGradient(ang,x+w/2,y+h/2); g.addColorStop(0,'#e9c98a'); g.addColorStop(.28,'#c79a3e'); g.addColorStop(.5,'#fff2cc'); g.addColorStop(.72,'#c79a3e'); g.addColorStop(1,'#e9c98a'); ctx.strokeStyle=g; } else ctx.strokeStyle=GOLD; ctx.lineWidth=width||2.4; ctx.lineJoin='round'; ctx.stroke(); ctx.restore(); }   // 金色流光边(仅此一张·首发独有)
function spark(x,y,s,a,color){ if(a<=0)return; ctx.save(); ctx.globalAlpha=Math.min(1,a); ctx.fillStyle=color||'#ffe14e'; ctx.translate(x,y); ctx.beginPath();
  for(var i=0;i<8;i++){ var an=i*Math.PI/4, rad=(i%2?s*0.38:s); i?ctx.lineTo(Math.cos(an)*rad,Math.sin(an)*rad):ctx.moveTo(Math.cos(an)*rad,Math.sin(an)*rad); } ctx.closePath(); ctx.fill(); ctx.restore(); }
function pill(x,y,text,bg,fg,fs,h){ fs=fs||12; h=h||28; ctx.font=B(fs); var tw=ctx.measureText(text).width,w=tw+18; block(x,y,w,h,h/2,bg,INK,2,2); ctx.fillStyle=fg; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(text,x+9,y+h/2+.5); return w; }

/* ==================== emoji 探测与兜底（全站一次·不再每页重测） ==================== */
function emojiOk(){ try{ var c=document.createElement('canvas'),x=c.getContext('2d'); c.width=c.height=42; x.font=EMO(28); x.textAlign='center'; x.textBaseline='middle'; x.fillText('🎉',21,21); var d=x.getImageData(0,0,42,42).data; for(var i=3;i<d.length;i+=4){ if(d[i]>20) return true; } }catch(_){} return false; }
var EMO_OK = emojiOk();   // 2代每切一页都重测一次（含读像素），重制版全局测一次
// iconMeta = 工厂表 + 主页夏日表的并集（清点模块5）；后续搬页遇到新 emoji 继续往这里补
// 【性能·2026-07-03 审计】映射表提升为模块级常量——原来每次调用都重新分配整张 40 项大表(兜底设备上=每图标每帧一次)
var ICON_META=({
  '🪙':['#f9d66d','#a9802f','#3a2a05','币'],'⚡':['#fff1c9',GOLD2,INK,'点'],'✍':['#f6eef0',PINKB,INK,'签'],'🌍':['#e7f4f2',TEAL,INK,'球'],
  '🏆':['#fff1c9',GOLD2,INK,'冠'],'🏭':['#e7f4f2',TEAL,INK,'厂'],'🎪':['#ffe9f0',PINKB,INK,'乐'],'🎁':['#fff1c9',GOLD2,INK,'礼'],
  '🎖️':['#fff1c9',GOLD2,INK,'章'],'👤':['#e9eef3','#5b6b78',INK,'人'],'🛒':['#e7f4f2',TEAL,INK,'店'],'📤':['#e7f4f2',TEAL,INK,'图'],
  '⚙️':['#e9eef3','#5b6b78',INK,'设'],'⚠':['#fff0e6','#c0492f','#c0492f','!'],'⚠️':['#fff0e6','#c0492f','#c0492f','!'],'✨':['#fff1c9',GOLD2,INK,'*'],'🎉':['#ffe9f0',PINKB,INK,'!'],
  '🎊':['#e7f4f2',TEAL,INK,'!'],'👑':['#fff1c9',GOLD2,INK,'王'],'❔':['#e9eef3','#5b6b78',INK,'?'],'🔍':['#e9eef3','#5b6b78',INK,'搜'],'🔎':['#e9eef3','#5b6b78',INK,'搜'],'📭':['#e9eef3','#5b6b78',INK,'空'],
  '🔑':['#fff1c9',GOLD2,INK,'钥'],'✍️':['#f6eef0',PINKB,INK,'签'],'📖':['#e7f4f2',TEAL,INK,'册'],'📺':['#e9eef3','#5b6b78',INK,'看'],'🏷️':['#fff1c9',GOLD2,INK,'签'],
  '⭐':['#fff1c9',GOLD2,INK,'藏'],'🗂️':['#e7f4f2',TEAL,INK,'夹'],
  '☀️':['#fff1c9',GOLD2,INK,'日'],'🌊':['#e7f4f2',TEAL,INK,'浪'],'🍉':['#e8f7e9','#2e8b57',INK,'瓜'],'❄️':['#e9eef3','#5b6b78',INK,'雪'],
  '🏊':['#e7f4f2',TEAL,INK,'泳'],'🍦':['#fff1c9',GOLD2,INK,'冰'],'🦗':['#e8f7e9','#2e8b57',INK,'虫'],'🏖️':['#fff1c9',GOLD2,INK,'沙'],
  '🐢':['#e8f7e9','#2e8b57',INK,'龟'],'🧂':['#e9eef3','#5b6b78',INK,'盐'],'🏝️':['#e7f4f2',TEAL,INK,'岛'],'🥤':['#ffe9f0',PINKB,INK,'饮'],
  '💦':['#e7f4f2',TEAL,INK,'水'],'🎵':['#e9eef3','#5b6b78',INK,'音'],'📢':['#fff1c9',GOLD2,INK,'告']
});
function iconMeta(s){ return ICON_META[s]||['#f7f0df',GOLD2,INK,'卡']; }
function fallbackIcon(s,x,y,size){ var m=iconMeta(s), r=Math.max(6,size*.52); ctx.save(); ctx.translate(x,y); ctx.beginPath(); ctx.arc(0,0,r,0,6.283); ctx.fillStyle=m[0]; ctx.fill(); ctx.lineWidth=Math.max(1.2,size*.08); ctx.strokeStyle=m[1]; ctx.stroke(); ctx.fillStyle=m[2]; ctx.font=B(Math.max(8,size*.42)); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(m[3],0,size*.02); ctx.restore(); }
function drawEmoji(s,x,y,size,alpha){ ctx.save(); ctx.globalAlpha*=alpha==null?1:alpha; if(EMO_OK){ ctx.font=EMO(size); ctx.fillStyle='#000'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(s,x,y); } else fallbackIcon(s,x,y,size); ctx.restore(); }

/* ==================== 夏日限定卡·视觉叠加（limOverlay·工厂版原样收编） ==================== */
function limRnd(i){ var s=Math.sin(i*127.1+0.73)*43758.5453; return s-Math.floor(s); }
function limOverlay(x,y,w,h,r,kind,now,on,noEdge){ var t=(now||0)/1000, f=w/84;   // noEdge：卡已有荣誉边框时，限定卡面只画底纹、不再叠第二道边
  if(kind==='flow'){ var cx0=x+w/2,cy0=y+h/2,ang=on?(t*0.85)%6.283:0.6; var g;
    if(ctx.createConicGradient){ g=ctx.createConicGradient(ang,cx0,cy0); g.addColorStop(0,'#1fb6c6'); g.addColorStop(0.33,'#ff8a5c'); g.addColorStop(0.66,'#f0c860'); g.addColorStop(1,'#1fb6c6'); }
    else { g=ctx.createLinearGradient(x,y,x+w,y+h); g.addColorStop(0,'#1fb6c6'); g.addColorStop(0.5,'#ff8a5c'); g.addColorStop(1,'#f0c860'); }
    ctx.save(); if(on){ ctx.shadowColor='rgba(255,160,90,.7)'; ctx.shadowBlur=9*f; }
    rr(x+1.4*f,y+1.4*f,w-2.8*f,h-2.8*f,Math.max(2,r-1*f)); ctx.lineWidth=3.2*f; ctx.strokeStyle=g; ctx.stroke(); ctx.restore(); return; }
  ctx.save(); rr(x,y,w,h,r); ctx.clip();
  if(kind==='sea'){ var g1=ctx.createLinearGradient(0,y,0,y+h); g1.addColorStop(0,'rgba(255,150,95,.22)'); g1.addColorStop(.5,'rgba(120,200,212,.16)'); g1.addColorStop(1,'rgba(35,150,200,.32)'); ctx.fillStyle=g1; ctx.fillRect(x,y,w,h);
    var ph=on?t*1.7:0.6; for(var k=0;k<3;k++){ var yy=y+h*(0.58+k*0.13); ctx.beginPath();
      for(var xx=0;xx<=w;xx+=4){ var ry=yy+Math.sin(xx*(9/w)+ph+k)*3*f; xx===0?ctx.moveTo(x+xx,ry):ctx.lineTo(x+xx,ry); }
      ctx.lineWidth=1.4*f; ctx.strokeStyle='rgba(255,255,255,'+(0.22-k*0.05)+')'; ctx.stroke(); }
    ctx.restore(); rr(x+1.6*f,y+1.6*f,w-3.2*f,h-3.2*f,Math.max(2,r-1.6*f)); ctx.lineWidth=1.6*f; ctx.strokeStyle='rgba(31,134,182,.85)'; ctx.stroke(); return; }
  if(kind==='hearth'){ // S2 灶火卡面：浅暖陶红薄釉 + 票根同款柔和环流余烬，下半渐隐保证卡名清楚
    var gh=ctx.createLinearGradient(0,y,0,y+h); gh.addColorStop(0,'rgba(138,66,48,.34)'); gh.addColorStop(.52,'rgba(206,113,69,.16)'); gh.addColorStop(1,'rgba(244,239,230,.01)'); ctx.fillStyle=gh; ctx.fillRect(x,y,w,h);
    var rgH=ctx.createRadialGradient(x+w*.5,y+h*.62,1,x+w*.5,y+h*.62,w*.48); rgH.addColorStop(0,'rgba(245,180,82,.10)'); rgH.addColorStop(1,'rgba(197,90,43,0)'); ctx.fillStyle=rgH; ctx.fillRect(x,y,w,h);
    var NH=on?6:4, hcX=x+w*.5, hcY=y+h*.38; for(var hi=0;hi<NH;hi++){ var ha0=(on?t*.18:.62)+hi*(6.283/NH)+limRnd(hi+31)*.16, hx=hcX+Math.cos(ha0)*w*(.29+.04*limRnd(hi+43)), hy=hcY+Math.sin(ha0*1.3)*h*(.17+.035*limRnd(hi+57)), ha=on?(.20+.28*Math.abs(Math.sin(ha0*1.7+hi))):.32;
      ctx.save(); ctx.shadowColor='rgba(245,184,85,.32)'; ctx.shadowBlur=(on?3:2)*f; ctx.beginPath(); ctx.arc(hx,hy,(hi%3?1:1.4)*f,0,6.3); ctx.fillStyle=(hi%2?'rgba(245,198,99,':'rgba(221,109,50,')+ha+')'; ctx.fill(); ctx.restore(); }
    ctx.restore(); if(!noEdge){ rr(x+1.2*f,y+1.2*f,w-2.4*f,h-2.4*f,Math.max(2,r-1.1*f)); ctx.lineWidth=1.5*f; ctx.strokeStyle='rgba(164,66,36,.68)'; ctx.stroke(); } return; }
  if(kind==='starfire'){ // S3 星砂琉璃：深烟蓝星云薄釉 → 青灰 → 底部暖白，单云带与少量星砂保持简洁
    var sfShift=on ? .025*Math.sin(t*.32) : 0;
    var sf=ctx.createLinearGradient(0,y,0,y+h); sf.addColorStop(0,'rgba(35,53,81,.88)'); sf.addColorStop(.38+sfShift,'rgba(83,101,135,.64)'); sf.addColorStop(.62+sfShift*.45,'rgba(72,125,128,.30)'); sf.addColorStop(.82,'rgba(190,205,203,.09)'); sf.addColorStop(1,'rgba(244,239,230,0)'); ctx.fillStyle=sf; ctx.fillRect(x,y,w,h);
    var sfDrift=on?Math.sin(t*.42)*w*.025:0, sfBand=ctx.createLinearGradient(x,y,x+w,y); sfBand.addColorStop(0,'rgba(119,117,174,.08)'); sfBand.addColorStop(.48,'rgba(144,139,195,.20)'); sfBand.addColorStop(1,'rgba(91,173,167,.08)'); ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(x-w*.08+sfDrift,y+h*.34); ctx.bezierCurveTo(x+w*.26,y+h*.20,x+w*.58,y+h*.30,x+w*1.08,y+h*.22); ctx.strokeStyle=sfBand; ctx.lineWidth=w*.15; ctx.stroke();
    if(on){ var sfP=.22+.76*((Math.sin(t*.55)+1)/2), sfSheen=ctx.createLinearGradient(x-w*.35+sfP*w*1.7,y,x+sfP*w*1.7,y+h); sfSheen.addColorStop(0,'rgba(255,255,255,0)'); sfSheen.addColorStop(.5,'rgba(224,239,235,.10)'); sfSheen.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle=sfSheen; ctx.fillRect(x,y,w,h); }
    for(var si=0;si<6;si++){ var sx=x+(.10+limRnd(si+14)*.80)*w, sy=y+(.07+limRnd(si+29)*.38)*h, sa=on?(.38+.40*Math.abs(Math.sin(t*1.05+si*1.9))):.58; ctx.beginPath(); ctx.arc(sx,sy,(si%3?0.75:1.05)*f,0,6.2832); ctx.fillStyle=si%2?'rgba(234,214,164,'+sa+')':'rgba(183,232,221,'+sa+')'; ctx.fill(); }
    ctx.restore(); if(!noEdge){ rr(x+1.2*f,y+1.2*f,w-2.4*f,h-2.4*f,Math.max(2,r-1.1*f)); ctx.lineWidth=1.6*f; ctx.strokeStyle='rgba(35,48,58,.82)'; ctx.stroke(); } return; }
  if(kind==='spark'){ var p=on?(0.5+0.42*Math.sin(t*1.2)):0.5; ctx.globalAlpha=0.5; var lg=ctx.createLinearGradient(x,y,x+w,y+h);
    lg.addColorStop(Math.max(0,p-0.12),'rgba(255,255,255,0)'); lg.addColorStop(p,'rgba(255,250,228,.5)'); lg.addColorStop(Math.min(1,p+0.12),'rgba(255,255,255,0)'); ctx.fillStyle=lg; ctx.fillRect(x,y,w,h); ctx.globalAlpha=1;
    var N=on?9:5; for(var i=0;i<N;i++){ var base=limRnd(i+7),prog=on?((t*0.12+base)%1):base; var px=x+limRnd(i)*w+Math.sin((on?t:0)*1.5+i)*5*f, py=y+h-prog*h*0.92, a=on?(0.35+0.5*Math.abs(Math.sin(t*2+i))):0.6; var col=(i%2)?'rgba(245,205,110,':'rgba(120,205,225,';
      ctx.save(); ctx.shadowColor=col+'.9)'; ctx.shadowBlur=5*f; ctx.beginPath(); ctx.arc(px,py,(i%3?1.8:2.6)*f,0,6.3); ctx.fillStyle=col+a+')'; ctx.fill(); ctx.restore(); }
    ctx.restore(); return; }
  if(kind==='pearl'){ var off=on?Math.sin(t*0.6)*w*0.4:w*0.1; var pg=ctx.createLinearGradient(x-w*0.5+off,y,x+w*1.5+off,y+h);
    pg.addColorStop(0,'rgba(120,180,235,.30)'); pg.addColorStop(.3,'rgba(190,150,230,.30)'); pg.addColorStop(.5,'rgba(245,170,205,.30)'); pg.addColorStop(.7,'rgba(150,225,210,.30)'); pg.addColorStop(1,'rgba(170,180,240,.30)'); ctx.fillStyle=pg; ctx.fillRect(x,y,w,h);
    if(on){ var sp=0.5+0.45*Math.sin(t*0.9); var sg=ctx.createLinearGradient(x,y,x+w,y+h); sg.addColorStop(Math.max(0,sp-0.08),'rgba(255,255,255,0)'); sg.addColorStop(sp,'rgba(255,255,255,.3)'); sg.addColorStop(Math.min(1,sp+0.08),'rgba(255,255,255,0)'); ctx.fillStyle=sg; ctx.fillRect(x,y,w,h); }
    ctx.restore(); return; }
  if(kind==='firefly'){ var g2=ctx.createLinearGradient(0,y,0,y+h); g2.addColorStop(0,'rgba(20,40,46,.55)'); g2.addColorStop(.6,'rgba(16,34,40,.24)'); g2.addColorStop(1,'rgba(16,34,40,0)'); ctx.fillStyle=g2; ctx.fillRect(x,y,w,h);
    var N2=on?9:6; for(var j=0;j<N2;j++){ var px2=x+(limRnd(j)*0.9+0.05)*w+(on?Math.sin(t*0.8+j)*7*f:0), py2=y+(limRnd(j+9)*0.62+0.05)*h+(on?Math.cos(t*0.6+j)*5*f:0), a2=on?(0.4+0.55*Math.abs(Math.sin(t*1.6+j*1.3))):0.7, col2=(j%2)?'rgba(245,225,120,':'rgba(140,230,200,';
      ctx.save(); ctx.shadowColor=col2+'.9)'; ctx.shadowBlur=(on?7:5)*f; ctx.beginPath(); ctx.arc(px2,py2,(j%3?1.9:2.6)*f,0,6.3); ctx.fillStyle=col2+a2+')'; ctx.fill(); ctx.restore(); }
    ctx.restore(); return; }
  if(kind==='dawn'){ // 破晓金边（40级等级奖励卡面·2026-07-10 淡雅版：底部暖光隐隐约约+单层细金边）
    // 2026-07-10 用户反馈两连修：①日出地平线横线正好穿卡名→太阳/横线/放射光全删；②整体太挡视野→暖光调到"隐约可见"。
    // noEdge=true（第9参）：卡已有荣誉边框(金流光/彩虹/蓝)时只画暖光底纹·边框归边框卡面归卡面。
    var g3=ctx.createLinearGradient(0,y+h,0,y); g3.addColorStop(0,'rgba(255,178,92,.16)'); g3.addColorStop(.5,'rgba(255,218,150,.05)'); g3.addColorStop(1,'rgba(255,235,190,0)'); ctx.fillStyle=g3; ctx.fillRect(x,y,w,h);
    var p3=on?(0.5+0.5*Math.sin(t*0.9)):0.5;   // 底缘一抹极淡的呼吸暖晕(动效关=定格)
    var gl=ctx.createRadialGradient(x+w/2,y+h,2,x+w/2,y+h,w*0.42); gl.addColorStop(0,'rgba(255,200,110,'+(0.10+0.05*p3)+')'); gl.addColorStop(1,'rgba(255,200,110,0)');
    ctx.fillStyle=gl; ctx.fillRect(x,y+h*0.6,w,h*0.4);
    ctx.restore();   // 出裁剪
    if(!noEdge){ rr(x+1.2*f,y+1.2*f,w-2.4*f,h-2.4*f,Math.max(2,r-1*f)); ctx.lineWidth=1.6*f; ctx.strokeStyle='rgba(199,154,62,.85)'; ctx.stroke(); }   // 单层细金边(替代普通卡黑边)
    return; }
  ctx.restore(); }
/* ==================== 卡背（2026-07-10·AI 造物等待翻牌用）====================
   cardBack(cx,cy,w,h,now,rainbow)：画一张"背面朝上"的卡。
   默认=素纸卡背(蓝图点纹+灰厂标)；rainbow=true=60级「彩虹卡背」(选型方案C「虹辉星厂」：
   深底+彩虹光泽游走+星点+金圈厂标)。now 驱动动画·FXSET.fx 关=静态。 */
function legacyAppearance(kind,id){ return window.WXGC3_UI&&WXGC3_UI.getAppearance?WXGC3_UI.getAppearance(kind,id):null; }
function legacyImageLayer(data,x,y,w,h,r){
  var image=window.WXGC3_LEGACY_MEDIA&&WXGC3_LEGACY_MEDIA.images.get(data);
  if(!image) return;
  ctx.save(); rr(x,y,w,h,r); ctx.clip(); ctx.globalAlpha*=.65; ctx.drawImage(image,x,y,w,h); ctx.restore();
}
function cardBack(cx,cy,w,h,now,rainbow){ var f=w/84, x=-w/2, y=-h/2, r=13*f, t=(FXSET.fx?(now||0):0)/1000;
  var custom=legacyAppearance('cardBacks',FXSET.cardBackId);
  if(custom){
    ctx.save();ctx.translate(cx,cy);ctx.shadowColor='rgba(35,48,58,.25)';ctx.shadowBlur=10*f;rr(x,y,w,h,r);ctx.fillStyle=custom.face||PAPER;ctx.fill();ctx.shadowBlur=0;
    legacyImageLayer(custom.image,x,y,w,h,r);rr(x,y,w,h,r);ctx.lineWidth=1.8*f;ctx.strokeStyle=custom.border||INK;ctx.stroke();
    rr(x+7*f,y+7*f,w-14*f,h-14*f,8*f);ctx.strokeStyle=custom.accent||GOLD2;ctx.lineWidth=1*f;ctx.stroke();
    ctx.save();ctx.rotate(FXSET.fx?Math.sin((now||0)*.0012)*.12:0);ctx.strokeStyle=custom.accent||GOLD2;ctx.lineWidth=2*f;
    ctx.beginPath();ctx.moveTo(-14*f,-14*f);ctx.lineTo(14*f,14*f);ctx.moveTo(14*f,-14*f);ctx.lineTo(-14*f,14*f);ctx.stroke();ctx.restore();
    ctx.font=SB(8*f);ctx.fillStyle=custom.ink||INK;ctx.textAlign='center';ctx.fillText('无限工厂3',0,h*.33);ctx.restore();return;
  }
  ctx.save(); ctx.translate(cx,cy);
  ctx.save(); ctx.shadowColor='rgba(40,55,70,.20)'; ctx.shadowBlur=10*f; ctx.shadowOffsetY=5*f; rr(x,y,w,h,r); ctx.fillStyle=rainbow?'#1d2a35':PAPER; ctx.fill(); ctx.restore();
  if(rainbow){
    ctx.save(); rr(x+2*f,y+2*f,w-4*f,h-4*f,r-2*f); ctx.clip();
    var hue=(t*20)%360, gx=Math.sin(t*0.9)*w*0.24, gy=Math.cos(t*0.7)*h*0.2;
    var rg=ctx.createRadialGradient(gx,gy,4*f,gx,gy,w*0.8);
    rg.addColorStop(0,'hsla('+hue+',75%,62%,.34)'); rg.addColorStop(.55,'hsla('+((hue+120)%360)+',70%,58%,.14)'); rg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=rg; ctx.fillRect(x,y,w,h);
    for(var i=0;i<10;i++){ var sx=x+limRnd(i+3)*w, sy=y+limRnd(i+40)*h, sa=0.3+0.6*Math.abs(Math.sin(t*1.5+i));
      ctx.beginPath(); ctx.arc(sx,sy,(i%4?1:1.7)*f,0,6.3); ctx.fillStyle='rgba(235,242,255,'+sa+')'; ctx.fill(); }
    ctx.restore();
    ctx.beginPath(); ctx.arc(0,-h*0.06,w*0.19,0,6.3); ctx.lineWidth=1.6*f; ctx.strokeStyle='rgba(250,246,238,.5)'; ctx.stroke();
    drawEmoji('🏭',0,-h*0.06,Math.round(w*0.22));
    ctx.font=B(9*f); ctx.fillStyle='rgba(250,246,238,.55)'; ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.fillText('✦ 无限工厂 ✦',0,y+h-11*f);
    rr(x+5*f,y+5*f,w-10*f,h-10*f,r-4*f); ctx.lineWidth=1*f; ctx.strokeStyle='rgba(250,246,238,.18)'; ctx.stroke();
  } else {
    ctx.save(); rr(x+2*f,y+2*f,w-4*f,h-4*f,r-2*f); ctx.clip();
    ctx.fillStyle='rgba(60,80,95,.08)';
    for(var gx2=x+7*f;gx2<x+w;gx2+=11*f){ for(var gy2=y+7*f;gy2<y+h;gy2+=11*f){ ctx.fillRect(gx2,gy2,1.4*f,1.4*f); } }
    ctx.restore();
    ctx.beginPath(); ctx.arc(0,-h*0.06,w*0.19,0,6.3); ctx.lineWidth=1.6*f; ctx.strokeStyle='rgba(35,48,58,.35)'; ctx.stroke();
    drawEmoji('🏭',0,-h*0.06,Math.round(w*0.22),0.8);
    ctx.font=B(9*f); ctx.fillStyle='rgba(35,48,58,.4)'; ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.fillText('无限工厂',0,y+h-11*f);
  }
  rr(x,y,w,h,r); ctx.lineWidth=1.8*f; ctx.strokeStyle=rainbow?'rgba(250,246,238,.35)':'rgba(35,48,58,.7)'; ctx.stroke();
  ctx.restore();
}

/* ==================== 经典立牌 card()（工厂版原样收编·设计规范§5 的代码版） ==================== */
function card(cx,cy,w,h,c,opt){ opt=opt||{}; var f=w/84, now=opt.now||0; var x=-w/2,y=-h/2,r=13*f;
  var custom=legacyAppearance('skins',c.lim||FXSET.skinId);
  ctx.save(); ctx.translate(cx,cy); if(opt.rot) ctx.rotate(opt.rot);
  // 纸面卡身 + 柔影
  ctx.save(); ctx.shadowColor='rgba(40,55,70,'+(opt.lift?0.3:0.18)+')'; ctx.shadowBlur=(opt.lift?18:10)*f; ctx.shadowOffsetY=(opt.lift?9:5)*f; rr(x,y,w,h,r); ctx.fillStyle=custom&&custom.face||PAPER; ctx.fill(); ctx.restore();
  if(custom) legacyImageLayer(custom.image,x,y,w,h,r);
  // 顶部细高光(纸的光泽)
  ctx.save(); rr(x,y,w,h,r); ctx.clip(); var tg=ctx.createLinearGradient(0,y,0,y+h*0.4); tg.addColorStop(0,'rgba(255,255,255,.5)'); tg.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle=tg; ctx.fillRect(x,y,w,h*0.4); ctx.restore();
  var aNow=FXSET.fx?now:0;   // 省电模式(动态特效关)=边框不流动·用固定角度·省每帧渐变开销(性能铁律)
  var limK=c.lim||((c.creatorDawn||(c.owned&&dawnAllOn()))?'dawn':'');   // 破晓金边两条路(限定卡面优先·2026-07-10)：①首发者≥40级→全服可见 ②我解锁了→我的所有卡(含本源)
  var honor=!!(c.sponsor||c.only||c.broken);   // 有荣誉边框(彩虹/金流光/蓝)→边框独占卡缘·dawn 只画底纹(治叠边太粗·2026-07-10 用户反馈)
  if(c.sponsor){ if(opt.glow!==false&&FXSET.fx){ ctx.save(); ctx.shadowColor=GLOW; ctx.shadowBlur=15*f; rr(x,y,w,h,r); ctx.strokeStyle='rgba(127,233,221,.01)'; ctx.lineWidth=1; ctx.stroke(); ctx.restore(); } rainbow(x,y,w,h,r,aNow/900,2.4*f); }   // 赞助者专属·彩虹边
  else if(c.only){ if(opt.glow!==false&&FXSET.fx){ ctx.save(); ctx.shadowColor='rgba(199,154,62,.55)'; ctx.shadowBlur=14*f; rr(x,y,w,h,r); ctx.strokeStyle='rgba(199,154,62,.01)'; ctx.lineWidth=1; ctx.stroke(); ctx.restore(); } goldEdge(x,y,w,h,r,aNow/1000,2.6*f); }   // 首发仅此一张·金色流光
  else if(c.broken){ rr(x,y,w,h,r); ctx.lineWidth=2.4*f; ctx.strokeStyle=BLUE; ctx.stroke(); }   // 首发已被打破·蓝边
  else if(limK!=='dawn'&&limK!=='hearth'&&limK!=='starfire'){ ctx.lineWidth=1.8*f; ctx.strokeStyle=custom&&custom.border||'rgba(35,48,58,.7)'; rr(x,y,w,h,r); ctx.stroke(); }   // 普通·黑边；dawn/hearth/starfire 自己独占单层细边，避免黑边+皮肤边叠成多重框
  if(limK) limOverlay(x,y,w,h,r,limK,aNow,FXSET.cardFx,(limK==='dawn'||limK==='hearth'||limK==='starfire')&&honor);   // 限定卡面:卡面动效开=动/关=静；已有荣誉边时只画底纹、不叠第二道边
  var cc=CATS[c.cat]||CATS['抽象'];
  // 类别(顶部·细标签 + 下分隔线·工坊风)
  ctx.font=SB(9*f); ctx.fillStyle=custom&&custom.accent||cc[1]; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(c.cat,0,y+11*f);
  ctx.strokeStyle=LINE; ctx.lineWidth=1*f; ctx.beginPath(); ctx.moveTo(x+w*0.2,y+19*f); ctx.lineTo(x+w*0.8,y+19*f); ctx.stroke();
  // 标本光圈 + emoji(大·上中)
  ctx.save(); var sg=ctx.createRadialGradient(0,y+h*0.45,2,0,y+h*0.45,w*0.42); sg.addColorStop(0,(c.only||c.sponsor)?'rgba(127,233,221,.5)':'rgba(120,150,150,.13)'); sg.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(0,y+h*0.45,w*0.42,0,7); ctx.fill(); ctx.restore();
  drawEmoji(c.e,0,y+h*0.45,33*f);
  // 名(粗) / 署名(底)。首发庆典大卡可临时传 caption，让底部显示卡牌简介；普通场景仍显示署名。
  ctx.font=B(14*f); ctx.fillStyle=custom&&custom.ink||INK; var nm=c.n; while(ctx.measureText(nm).width>w-12*f&&nm.length>1) nm=nm.slice(0,-1); ctx.fillText(nm===c.n?c.n:nm+'…',0,y+h*0.73);
  ctx.font=SB(8.5*f); ctx.fillStyle=custom&&custom.accent||(opt.caption?GOLD2:(c.origin?MUTE:GOLD2));
  var cap=opt.caption || (c.origin?'· 本源 ·':'· 已发现 ·');
  while(ctx.measureText(cap).width>w-10*f&&cap.length>1) cap=cap.slice(0,-1);
  ctx.fillText((cap===opt.caption||!opt.caption)?cap:cap+'…',0,y+h-10*f);
  // 编号徽章(左上外角) + 拥有✓(右上外角·青)
  if(c.seq){ ctx.font=B(9*f); var sq='#'+c.seq, sqw=ctx.measureText(sq).width, bw=sqw+12*f, bh=17*f, bx=x-bw/2, by=y-bh*0.5;   // 编号水平居中骑在左边框上
    ctx.save(); ctx.shadowColor='rgba(40,55,70,.22)'; ctx.shadowBlur=4*f; ctx.shadowOffsetY=2*f; rr(bx,by,bw,bh,bh/2); ctx.fillStyle=isLucky(c.seq)?GOLD:INK; ctx.fill(); ctx.restore(); ctx.lineWidth=2*f; ctx.strokeStyle=PAPER; rr(bx,by,bw,bh,bh/2); ctx.stroke();
    ctx.fillStyle=isLucky(c.seq)?'#3a2a05':'#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(sq,bx+bw/2,by+bh/2+.5); }
  if(c.owned){ var gx=x+w-1*f,gy=y+1*f,rad=9.5*f; ctx.save(); ctx.shadowColor='rgba(40,55,70,.22)'; ctx.shadowBlur=3*f; ctx.shadowOffsetY=2*f; ctx.beginPath(); ctx.arc(gx,gy,rad,0,7); ctx.fillStyle=GREEN; ctx.fill(); ctx.restore(); ctx.lineWidth=2*f; ctx.strokeStyle=PAPER; ctx.beginPath(); ctx.arc(gx,gy,rad,0,7); ctx.stroke(); ctx.fillStyle='#fff'; ctx.font=B(10.5*f); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('✓',gx,gy+.5); }
  // 好友使用权：用户拍板统一显示普通 🤝。只在画布/收藏显示，词典格为了不拥挤不画；自己也拥有时不再标权限。
  var friendMark=!!(c.friendShared&&!c.owned);
  if(friendMark){ var fx2=x+1*f,fy2=y+h-1*f; ctx.save(); ctx.shadowColor='rgba(40,55,70,.18)'; ctx.shadowBlur=3*f; ctx.beginPath(); ctx.arc(fx2,fy2,11*f,0,7); ctx.fillStyle=PAPER; ctx.fill(); ctx.restore(); drawEmoji('🤝',fx2,fy2+.5,16*f); }
  // 钉住角标：普通卡仍在左下；好友卡左下已给 🤝，📌 自动移到右下，两个状态都能看清。
  if(c.pinned){ var px2=friendMark?(x+w-1*f):(x+1*f),py2=y+h-1*f,prad=9.5*f; ctx.save(); ctx.shadowColor='rgba(40,55,70,.22)'; ctx.shadowBlur=3*f; ctx.shadowOffsetY=2*f; ctx.beginPath(); ctx.arc(px2,py2,prad,0,7); ctx.fillStyle=TEAL; ctx.fill(); ctx.restore(); ctx.lineWidth=2*f; ctx.strokeStyle=PAPER; ctx.beginPath(); ctx.arc(px2,py2,prad,0,7); ctx.stroke(); drawEmoji('📌',px2,py2+.5,11*f); }
  ctx.restore();
}
function isLucky(n){ return n%1000===0 || /^(\d)\1+$/.test(''+n); }

/* ==================== 音效（全站共享单个 AudioContext） ====================
   2代每页各 new 一个 AudioContext（有触浏览器实例上限的风险），重制版共享一个。
   tone() 带 FXSET.sfx 开关（工厂版行为）——2代的 13 个子页没接这个开关（设置里
   关音效对子页无效，属原版 bug），重制版统一接上 = 设置真正全局生效。
   sfxClaim：2代工厂页调了 4 次却从未定义（现存 bug·会中断"起名后自动续合成"），
   这里用 8 个子页共有的同一实现收编补上。 */
var AC = null;
function initAudio(){ if(AC) return; try{ AC = new (window.AudioContext||window.webkitAudioContext)(); }catch(_){ AC = null; } try{ parent.postMessage('wxgc-tap','*'); }catch(_){} }   // 首次交互→通知启动层按设置自动开 BGM（单文档里 parent===window，消息发给自己，启动层监听）
function tone(f,dur,type,vol,delay){ if(!AC||!FXSET.sfx) return; var t0=AC.currentTime+(delay||0), o=AC.createOscillator(), g=AC.createGain(); o.type=type||'triangle'; o.frequency.value=f;
  g.gain.setValueAtTime(0,t0); g.gain.linearRampToValueAtTime(vol||.13,t0+.02); g.gain.exponentialRampToValueAtTime(.0001,t0+(dur||.2)); o.connect(g); g.connect(AC.destination); o.start(t0); o.stop(t0+(dur||.2)+.03); }
var sfxBig=function(){ [523,659,784,1047,1319].forEach(function(f,i){ tone(f,.42,'triangle',.14,i*.08); }); };
var sfxSmall=function(){ tone(880,.16,'sine',.12,0); tone(1175,.22,'sine',.10,.08); };
var sfxClick=function(){ tone(300,.06,'square',.05,0); };
var sfxLift=function(){ tone(520,.05,'sine',.05,0); };
var sfxThink=function(){ tone(440,.1,'sine',.04,0); };
var sfxClaim=function(){ [784,988,1319].forEach(function(f,i){ tone(f,.2,'triangle',.11,i*.07); }); };
// Mod 音效替换沿用现有已校验媒体缓存；默认仍是二代原来的音阶与时序。
function legacyModSound(kind,fallback){ return function(){
  if(!FXSET.sfx) return;
  var data=window.WXGC3_UI&&WXGC3_UI.getModSound&&WXGC3_UI.getModSound(kind),media=window.WXGC3_LEGACY_MEDIA;
  if(!data||!media||!AC){ fallback(); return; }
  var current=WXGC3_UI.getState(),slot=current&&current.save&&current.save.id;
  function stillCurrent(){var state=WXGC3_UI.getState();return !LEGACY_DESTROYED&&FXSET.sfx&&state&&state.save&&state.save.id===slot&&WXGC3_UI.getModSound(kind)===data;}
  media.audio.play(AC,data,stillCurrent).then(function(played){if(!played&&stillCurrent())fallback();});
}; }
sfxLift=legacyModSound('lift',sfxLift);sfxThink=legacyModSound('think',sfxThink);
sfxBig=legacyModSound('discovery',sfxBig);sfxSmall=legacyModSound('discovery',sfxSmall);
var sfxRepeat=legacyModSound('repeat',sfxClick),sfxFailure=legacyModSound('failure',function(){tone(180,.18,'sine',.08,0);});

/* ==================== 场景参数（每页保持自己原来的观感） ==================== */
var DEFAULT_CONF = {
  blockShadow: 'rgba(47,58,74,.20)',   // block 阴影色（工厂基准；主页等场景注册时用自己原来的值覆盖）
  toastDur: 1600,                      // toast 显示时长 ms
  toastY: null,                        // toast 纵坐标函数 function(){return y;}；null=默认底部 H-58
  toastPad: 28,                        // toast 文字左右留白（各页 28/30 不一）
  toastMaxW: null,                     // toast 宽度上限函数 function(){return w;}；null=不限（等级奖励页有 W-40 上限）
  toastAlpha: .96,                     // toast 透明度（各页 .96/.97 不一）
  hotSfx: true                         // pushHot 是否自动包"点击音"（子页风格 true；工厂自己管音效=false）
};
var SCENE_CONF = Object.assign({}, DEFAULT_CONF);

/* ==================== toast 提示（参数化·各页保持原观感） ==================== */
var TOAST = null;
function toast(m){ TOAST = { m: m, until: performance.now() + SCENE_CONF.toastDur }; }
function drawToast(){ if(!TOAST) return; var now = performance.now(); if(now > TOAST.until){ TOAST = null; return; }
  ctx.font = B(12.5); var tw = ctx.measureText(TOAST.m).width, w = tw + SCENE_CONF.toastPad, h = 34;
  if (SCENE_CONF.toastMaxW) w = Math.min(w, SCENE_CONF.toastMaxW());
  var x = W/2 - w/2, y = SCENE_CONF.toastY ? SCENE_CONF.toastY() : (H - 58);
  ctx.save(); ctx.globalAlpha = SCENE_CONF.toastAlpha; block(x, y, w, h, 12, INK, null, 0, 3); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(TOAST.m, W/2, y + h/2 + .5); ctx.restore(); }

/* ==================== 全局覆盖层（系统级弹窗插槽） ====================
   OVERLAY = { draw:function(t){}, hit:function(p){} }：设了就画在一切之上（含 toast），
   并拦下全部点击/滚轮（模态语义）；置 null 即关闭。
   引擎只留这个插槽——具体业务（如"版本更新公告"）的数据与绘制放 99-启动.js，不进引擎。 */
var OVERLAY = null;

/* ==================== 热区/命中（每帧重建·倒序命中） ==================== */
var HOT = [];   // 即时模式热区：场景 draw 里 pushHot 注册，主循环每帧清空
function pushHot(x,y,w,h,fn){
  HOT.push({ x:x,y:y,w:w,h:h, fn:fn, sfx:!!SCENE_CONF.hotSfx }); }   // 【性能·2026-07-03 审计】音效改由 hitHot 命中时按标志播——原来 hotSfx 页每帧给每个热区包一层新闭包(每秒数千个短命对象·GC 掉帧)
function pushHotRaw(x,y,w,h,fn){ HOT.push({ x:x,y:y,w:w,h:h, fn:fn }); }   // 永远裸注册（场景自己管音效时用）
// 裁剪热区：热区与裁剪矩形求交，被列表裁掉的部分不可点（等级奖励/战令的滚动列表用）
function pushHotClip(hx,hy,hw,hh,clx,cly,clw,clh,fn){ var x0=Math.max(hx,clx),y0=Math.max(hy,cly),x1=Math.min(hx+hw,clx+clw),y1=Math.min(hy+hh,cly+clh); if(x1>x0&&y1>y0) pushHot(x0,y0,x1-x0,y1-y0,fn); }
function toS(e){ var r = cvRect(); return { x:(e.clientX-r.left)*(W/r.width), y:(e.clientY-r.top)*(H/r.height) }; }   // 【性能·2026-07-03 审计】改用 M5 矩形缓存——原来每个指针事件都强制布局查询(拖拽时每秒60~120次·恰是 M5 想省的·漏改)
function hitHot(p){ for(var i=HOT.length-1;i>=0;i--){ var r=HOT[i]; if(p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h){ if(r.sfx){ initAudio(); sfxClick(); } r.fn(p); return true; } } return false; }

/* ==================== 动画增强包（2026-07-03 用户选定 A/D·全部"一次性/按需"·平时零开销） ====================
   （B 按钮按下反馈曾接入·用户试后觉得观感怪→2026-07-03 已整套移除·无残留。） */

/* —— A 奖励飞行(金币/点数画弧线飞进 HUD)+数字滚动 —— */
var FLYFX = [];   // 一次性粒子·空数组=零开销
function flyReward(x0,y0,x1,y1,emo,n){ var t=performance.now();
  for(var i=0;i<(n||8);i++) FLYFX.push({ x0:x0,y0:y0,x1:x1,y1:y1,e:emo||'🪙',born:t+i*55,dur:620,
    cx:x0+(x1-x0)*0.5+(Math.random()*120-60), cy:Math.min(y0,y1)-60-Math.random()*70 }); }
function drawFlyFx(){ if(!FLYFX.length) return; var t=performance.now();
  for(var i=FLYFX.length-1;i>=0;i--){ var f=FLYFX[i], age=t-f.born; if(age<0) continue;
    var p=age/f.dur; if(p>=1){ FLYFX.splice(i,1); continue; }
    var u=1-p, x=u*u*f.x0+2*u*p*f.cx+p*p*f.x1, y=u*u*f.y0+2*u*p*f.cy+p*p*f.y1;   // 二阶贝塞尔弧线·按 age 解析算不积分
    drawEmoji(f.e, x, y, 14+4*Math.sin(p*Math.PI)); } }
// 数字滚动：显示值 450ms 缓动到真值。用法：把画数字处的 val 换成 rollVal('唯一键', val)。值没变时直接返回=零开销。
var _ROLL = {};
function rollVal(key,val,step){ val=Number(val)||0; step=step||1; var r=_ROLL[key]||(_ROLL[key]={v:val,shown:val,t0:0,from:val});
  if(val!==r.v){ r.from=r.shown; r.v=val; r.t0=performance.now(); }
  if(r.t0){ var p=(performance.now()-r.t0)/450; if(p>=1){ r.t0=0; r.shown=r.v; } else r.shown=Math.round((r.from+(r.v-r.from)*ease.outCubic(p))/step)*step; }
  else r.shown=r.v;
  return r.shown; }

/* —— D 成就解锁横幅：解锁那一刻顶部滑入「🏆 成就达成」·斜光扫过·2.4s 自动收·多个排队逐个弹 —— */
var ACHQ = [], ACHB = null;
function achBanner(name,emoji){ try{ ACHQ.push({ n:String(name||''), e:emoji||'🏆' }); }catch(e){} }
function drawAchBanner(){ if(!ACHB){ if(!ACHQ.length) return; ACHB={ d:ACHQ.shift(), t0:performance.now() }; }
  var el=performance.now()-ACHB.t0; if(el>2400){ ACHB=null; return; }
  var inP=ease.outBack(clamp(el/380,0,1)), outP=el>2000?clamp((el-2000)/350,0,1):0;
  ctx.font=B(15); var label='成就达成 ·「'+ACHB.d.n+'」', bw=Math.min(ctx.measureText(label).width+86,W-30), bx=W/2-bw/2, by=-64+(14+64)*inP-90*outP*outP;
  ctx.save(); ctx.globalAlpha=1-outP;
  block(bx,by,bw,52,14,'#fff9ec',GOLD,2.6,4);
  drawEmoji(ACHB.d.e,bx+30,by+26,22);
  ctx.fillStyle=INK; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.font=B(15); ctx.fillText(label,bx+52,by+26);
  var sh=clamp((el-300)/700,0,1);
  if(sh>0&&sh<1){ ctx.save(); rr(bx,by,bw,52,14); ctx.clip(); var sx2=bx-80+(bw+160)*sh;
    var g=ctx.createLinearGradient(sx2-30,0,sx2+30,0); g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(0.5,'rgba(255,255,255,.55)'); g.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=g; ctx.fillRect(bx,by,bw,52); ctx.restore(); }
  ctx.restore(); }

/* —— 静态整层离屏缓存（性能·给"每帧重建全屏渐变背景"用）：painter 只在首次/尺寸变化时跑一次·
      之后每帧一次 drawImage。最多存 3 层(防内存涨)·切场景自动淘汰最旧。 —— */
var _LAYERS = {};
function cachedLayer(key,painter){ var L=_LAYERS[key];
  if(!L||L.pw!==cv.width||L.ph!==cv.height){
    var ks=Object.keys(_LAYERS); if(ks.length>=3&&!_LAYERS[key]){ var oldest=ks[0]; for(var i=1;i<ks.length;i++) if(_LAYERS[ks[i]].t<_LAYERS[oldest].t) oldest=ks[i]; delete _LAYERS[oldest]; }
    L=_LAYERS[key]={ pw:cv.width, ph:cv.height, c:document.createElement('canvas'), t:0 };
    L.c.width=cv.width; L.c.height=cv.height;
    var old=ctx; ctx=L.c.getContext('2d'); ctx.setTransform(S,0,0,S,0,0);
    try{ painter(); } finally { ctx=old; }
  }
  L.t=performance.now();
  ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.drawImage(L.c,0,0); ctx.restore(); }

/* ==================== 隐藏 input 管理器（M1 骨架·搬输入页时启用） ====================
   2代 5 个页面共 8+ 个隐藏 input 直接 appendChild 到 body、切页不回收（清点风险#6：
   残留会透明盖在画布上截获点击/随机弹软键盘）。重制版统一登记，切场景强制收纳。 */
var INPUTS = [];
function registerInput(el){ INPUTS.push(el); return el; }
// 收纳=失焦+挪到屏外即可（与2代一致）。⚠不要再设 pointerEvents:none——曾因此把词典/收藏
// 搜索框永久变成"点不中"，手机上无法原生弹键盘（v42 修复·2026-07-02 玩家反馈）。
function stashAllInputs(){ for(var i=0;i<INPUTS.length;i++){ var el=INPUTS[i]; try{ el.blur(); el.style.left='-9999px'; el.style.top='-9999px'; }catch(e){} } }

/* ==================== 场景管理与路由（切页=瞬间切换·不销毁不重建） ==================== */
var SCENES = {}, CUR = null, CUR_NAME = '';
function registerScene(name, sc){ SCENES[name] = sc; }
function GO(target){
  var name = String(target).split('/').pop().replace(/-拼装版\.html$/, '').replace(/\.html$/, '');
  var sc = SCENES[name];
  if (!sc){ if(window.WXGC3_UI){ var routes={'设置':'settings','存档':'saves','Mod':'mods','合成历史':'history','配方表':'recipes','提示词':'prompt','API设置':'api'}; if(routes[name]){ WXGC3_UI.open(routes[name]); return true; } } toast('暂时无法打开'); return false; }   // 搬运期兜底：目标场景还没搬完时不跳空
  if (CUR && CUR.leave){ try{ CUR.leave(); }catch(e){ legacyReportError('离开场景',e); } }
  FLYFX.length=0;                         // 切场景清飞行奖励（目标 HUD 已不在·成就横幅队列跨场景保留）
  stashAllInputs();                       // 切场景强制收纳所有隐藏输入框（防残留挡触摸）
  CUR = sc; CUR_NAME = name;
  SCENE_CONF = Object.assign({}, DEFAULT_CONF, sc.conf || {});
  refreshFXSET();                         // 每次进场景重读玩家设置（替代2代"整页刷新才生效"）
  TOAST = null;                           // 不把上一页的 toast 带进新页（与2代整页重建的观感一致）
  try{ if (typeof resetIdle === 'function') resetIdle(); }catch(e){}
  if (sc.enter){ try{ sc.enter(); }catch(e){ legacyReportError('进入场景',e); throw e; } }
  if (STILL) stillPaint();
  return true;
}

/* ==================== 主循环（全游戏唯一的一个渲染循环） ====================
   2代：14 个页面各跑一个 requestAnimationFrame 循环、13 个页面收不到省电冻结指令。
   重制版：只有这一个循环；FROZEN=true（失焦/挂机）时整个循环停摆，一碰即恢复。 */
var FROZEN = false, RAF_ON = false;
function mainLoop(t){
  LEGACY_RAF_ID=0;
  if(LEGACY_DESTROYED){ RAF_ON=false; return; }
  if (FROZEN){ RAF_ON = false; return; }          // 冻结：本帧直接退出且不再自续（leaveLowPower 会重启）
  ctx.setTransform(S, 0, 0, S, 0, 0); ctx.clearRect(0, 0, W, H);
  HOT.length = 0;
  if (CUR){ try{ CUR.draw(t); }catch(e){ legacyReportError('绘制场景',e);          // 单场景绘制出错不崩全局：画出错误便于排查
      try{ ctx.setTransform(S,0,0,S,0,0); ctx.font=B(14); ctx.fillStyle='#c0492f'; ctx.textAlign='center'; ctx.fillText('本页渲染出错：'+(e&&e.message||e), W/2, H/2); }catch(_){}}
  }
  var screenshotClean=false; try{ screenshotClean=!!(window.__WXGC2_SCREENSHOT_CLEAN&&window.__WXGC2_SCREENSHOT_CLEAN()); }catch(e){}
  if (!screenshotClean){   // 工厂“截图模式”要连引擎级 toast / 奖励飞行 / 成就横幅也一起隐藏，才能得到真正净屏
    if (FLYFX.length){ try{ drawFlyFx(); }catch(e){ FLYFX.length=0; } }      // A 奖励飞行(一次性·空数组零开销)
    drawToast();
    if (OVERLAY){ try{ OVERLAY.draw(t); }catch(e){} }   // 覆盖层永远画在最顶层
    if (ACHB || ACHQ.length){ try{ drawAchBanner(); }catch(e){ ACHB=null; ACHQ.length=0; } }   // D 成就横幅(最顶层·一次性)
  }
  FRAMEN++;
  LEGACY_RAF_ID=requestAnimationFrame(mainLoop);
}
function ensureLoop(){ if (RAF_ON || STILL || LEGACY_DESTROYED || FROZEN) return; RAF_ON = true; LEGACY_RAF_ID=requestAnimationFrame(mainLoop); }
function stillPaint(){ for (var k=0; k<48; k++){ ctx.setTransform(S,0,0,S,0,0); ctx.clearRect(0,0,W,H); HOT.length=0; if(CUR){ try{ CUR.draw(k*16); }catch(e){ legacyReportError('静帧绘制',e); throw e; } }
  var screenshotClean=false; try{ screenshotClean=!!(window.__WXGC2_SCREENSHOT_CLEAN&&window.__WXGC2_SCREENSHOT_CLEAN()); }catch(e){}
  if(!screenshotClean){ drawToast(); if (OVERLAY){ try{ OVERLAY.draw(k*16); }catch(e){} } } FRAMEN++; } }   // 静帧自检：同步跑48帧让动画落位；截图模式同样净屏

/* ==================== 输入统一分发（引擎只挂一次监听·分发给当前场景） ==================== */
var LASTP = { x:0, y:0 };   // 最后一次点击位置（给"奖励从点击处飞出"用·A）
legacyListen(cv, 'pointerdown', function(e){
  initAudio(); try{ parent.postMessage('wxgc-activity','*'); }catch(_){}   // 交互→重置挂机计时（启动层监听）
  var p = toS(e); LASTP.x=p.x; LASTP.y=p.y;
  if (OVERLAY){ try{ OVERLAY.hit(p); }catch(err){} return; }   // 覆盖层开着：全部点击归它（模态·下层场景收不到）
  if (CUR && CUR.pointerdown){ if (CUR.pointerdown(p, e) !== false) return; }   // 场景自管指针（工厂拖拽等）·返回 false 表示"没处理，走默认热区"
  hitHot(p);
});
legacyListen(cv, 'pointermove', function(e){ if (OVERLAY){ try{ if(OVERLAY.move) OVERLAY.move(toS(e), e); }catch(_){} return; } if (CUR && CUR.pointermove) CUR.pointermove(toS(e), e); });   // 覆盖层可选接管拖动（教程/长弹层滚动）
legacyListen(cv, 'pointerup',   function(e){ var _pu=toS(e); LASTP.x=_pu.x; LASTP.y=_pu.y; if (OVERLAY){ try{ if(OVERLAY.up) OVERLAY.up(_pu, e); }catch(_){} return; } if (CUR && CUR.pointerup)   CUR.pointerup(_pu, e); });
legacyListen(cv, 'pointercancel', function(e){ if (OVERLAY){ try{ if(OVERLAY.up) OVERLAY.up(toS(e), e); }catch(_){} return; } if (CUR && CUR.pointercancel) CUR.pointercancel(toS(e), e); });
legacyListen(cv, 'wheel', function(e){ if (OVERLAY){ try{ if(OVERLAY.wheel) OVERLAY.wheel(e); }catch(_){} e.preventDefault(); return; } if (CUR && CUR.wheel) CUR.wheel(e); }, { passive:false });   // 覆盖层可选接管滚轮
legacyListen(window, 'keydown', function(e){ try{ parent.postMessage('wxgc-activity','*'); }catch(_){} if (CUR && CUR.key) CUR.key(e); }, true);


// 隐藏时停单一循环和音频，恢复只启动一次，不把管理层或后台窗口再变成第二个动画源。
function legacySetPaused(paused){
  FROZEN=!!paused;
  if(window.WXGC3_LEGACY_MUSIC) WXGC3_LEGACY_MUSIC.pause(FROZEN);
  if(FROZEN){ if(LEGACY_RAF_ID) cancelAnimationFrame(LEGACY_RAF_ID); LEGACY_RAF_ID=0; RAF_ON=false; if(AC&&AC.state==='running') AC.suspend().catch(function(){}); }
  else if(!LEGACY_DESTROYED){ ensureLoop(); if(AC&&AC.state==='suspended') AC.resume().catch(function(){}); }
}
legacyListen(document,'visibilitychange',function(){ legacySetPaused(document.hidden); });
window.WXGC3_LEGACY_ENGINE={
  destroyed:false,
  start:function(scene){ if(LEGACY_DESTROYED) throw new Error('游戏画面已经关闭'); fit(); GO(scene||'主页'); legacySetPaused(document.hidden); },
  render:function(state){ if(LEGACY_DESTROYED) return; refreshFXSET(); if(SCENES['主页']&&SCENES['主页'].syncState) SCENES['主页'].syncState(state); if(CUR&&CUR.render) CUR.render(state); if(STILL) stillPaint(); else if(!FROZEN) ensureLoop(); },
  pause:legacySetPaused,
  destroy:function(){
    if(LEGACY_DESTROYED) return;
    legacySetPaused(true); LEGACY_DESTROYED=true;
    window.WXGC3_LEGACY_ENGINE.destroyed=true;
    if(CUR&&CUR.leave){ try{ CUR.leave(); }catch(e){ legacyReportError('关闭场景',e); } }
    Object.keys(SCENES).forEach(function(key){ if(SCENES[key].destroy){ try{ SCENES[key].destroy(); }catch(e){ legacyReportError('销毁场景',e); } } });
    LEGACY_CLEANUPS.splice(0).forEach(function(fn){ try{ fn(); }catch(e){ legacyReportError('清理画面',e); } });
    LEGACY_LISTENERS.splice(0).forEach(function(row){ row[0].removeEventListener(row[1],row[2],row[3]); });
    stashAllInputs(); INPUTS.splice(0).forEach(function(el){ el.remove(); });
    if(AC){ AC.close().catch(function(){}); AC=null; }
    OVERLAY=null; HOT.length=0; FLYFX.length=0; ACHQ.length=0; ACHB=null; CUR=null; CUR_NAME=''; _LAYERS={}; _BGDOTS=null;
  }
};
