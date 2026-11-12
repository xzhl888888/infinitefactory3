// 卡牌以 84×108 为基准，画布按显示宽度等比缩放。
import { listModAppearances } from '../core/mods.js';
import { createModImages } from '../mods/media.js';
export const PALETTE = Object.freeze({ ink:'#23303a', gold:'#c79a3e', paper:'#f4efe6', panel:'#faf6ee', teal:'#1fb6a6' });
const CATS = {自然:['#e6f4ff','#2f6fd0'],生物:['#e8f7e9','#2e8b57'],科技:['#efeaff','#6a4fd0'],人文:['#fff0e6','#c0612a'],食物:['#fff3e0','#c9920f'],抽象:['#eef0f2','#5b6b78'],整活:['#ffe9f0','#c2557a']};
const SKINS = new Set(['default', 'sea', 'hearth', 'starfire', 'firefly', 'dawn']);
export function createCardPainter(ctx, { getMods = () => [], onAssetReady = () => {}, images = createModImages(onAssetReady) } = {}) {
 let previousMods, appearances;
 function appearance(kind,id) {
   const mods=getMods();
   if(mods!==previousMods){previousMods=mods;appearances={skins:listModAppearances(mods,'skins'),cardBacks:listModAppearances(mods,'cardBacks')};}
   return appearances[kind].find(v=>v.id===id);
 }
 function imageLayer(custom,x,y,w,h,r) {
   const image=images.get(custom?.image);if(!image)return;
   ctx.save();rr(x,y,w,h,r);ctx.clip();ctx.globalAlpha*=.42;ctx.drawImage(image,x,y,w,h);ctx.restore();
 }
 const PAPER=PALETTE.paper, INK=PALETTE.ink, GOLD2='#a9802f', MUTE='#8a93a0', LINE='rgba(40,60,70,.12)';
 const FXSET={fx:true};
 const fonts = { emoji: new Map(), bold: new Map(), semibold: new Map() };
 // 弹出/缩放会产生连续的小数字号；限制缓存，避免长时间合卡后累积无用字体字符串。
 const cachedFont=(cache,px,make)=>{if(!cache.has(px)){if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(px,make(px));}return cache.get(px);};
 const EMO=px=>cachedFont(fonts.emoji,px,n=>`${n}px "Segoe UI Emoji","Apple Color Emoji",system-ui`);
 const B=px=>cachedFont(fonts.bold,px,n=>`900 ${n}px "PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif`);
 const SB=px=>cachedFont(fonts.semibold,px,n=>`700 ${n}px "PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif`);
 function rr(x,y,w,h,r){ctx.beginPath();if(w<=0||h<=0)return;r=Math.max(0,Math.min(r,w/2,h/2));ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
 function drawEmoji(value,x,y,size,alpha=1){ctx.save();ctx.globalAlpha*=alpha;ctx.font=EMO(size);ctx.fillStyle='#000';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(value,x,y);ctx.restore();}
function limRnd(i){ var s=Math.sin(i*127.1+0.73)*43758.5453; return s-Math.floor(s); }
function limOverlay(x,y,w,h,r,kind,now,on,noEdge){ var t=(now||0)/1000, f=w/84;   
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
  if(kind==='hearth'){ 
    var gh=ctx.createLinearGradient(0,y,0,y+h); gh.addColorStop(0,'rgba(138,66,48,.34)'); gh.addColorStop(.52,'rgba(206,113,69,.16)'); gh.addColorStop(1,'rgba(244,239,230,.01)'); ctx.fillStyle=gh; ctx.fillRect(x,y,w,h);
    var rgH=ctx.createRadialGradient(x+w*.5,y+h*.62,1,x+w*.5,y+h*.62,w*.48); rgH.addColorStop(0,'rgba(245,180,82,.10)'); rgH.addColorStop(1,'rgba(197,90,43,0)'); ctx.fillStyle=rgH; ctx.fillRect(x,y,w,h);
    var NH=on?6:4, hcX=x+w*.5, hcY=y+h*.38; for(var hi=0;hi<NH;hi++){ var ha0=(on?t*.18:.62)+hi*(6.283/NH)+limRnd(hi+31)*.16, hx=hcX+Math.cos(ha0)*w*(.29+.04*limRnd(hi+43)), hy=hcY+Math.sin(ha0*1.3)*h*(.17+.035*limRnd(hi+57)), ha=on?(.20+.28*Math.abs(Math.sin(ha0*1.7+hi))):.32;
      ctx.save(); ctx.shadowColor='rgba(245,184,85,.32)'; ctx.shadowBlur=(on?3:2)*f; ctx.beginPath(); ctx.arc(hx,hy,(hi%3?1:1.4)*f,0,6.3); ctx.fillStyle=(hi%2?'rgba(245,198,99,':'rgba(221,109,50,')+ha+')'; ctx.fill(); ctx.restore(); }
    ctx.restore(); if(!noEdge){ rr(x+1.2*f,y+1.2*f,w-2.4*f,h-2.4*f,Math.max(2,r-1.1*f)); ctx.lineWidth=1.5*f; ctx.strokeStyle='rgba(164,66,36,.68)'; ctx.stroke(); } return; }
  if(kind==='starfire'){ 
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
  if(kind==='dawn'){ 
    
    
    var g3=ctx.createLinearGradient(0,y+h,0,y); g3.addColorStop(0,'rgba(255,178,92,.16)'); g3.addColorStop(.5,'rgba(255,218,150,.05)'); g3.addColorStop(1,'rgba(255,235,190,0)'); ctx.fillStyle=g3; ctx.fillRect(x,y,w,h);
    var p3=on?(0.5+0.5*Math.sin(t*0.9)):0.5;   
    var gl=ctx.createRadialGradient(x+w/2,y+h,2,x+w/2,y+h,w*0.42); gl.addColorStop(0,'rgba(255,200,110,'+(0.10+0.05*p3)+')'); gl.addColorStop(1,'rgba(255,200,110,0)');
    ctx.fillStyle=gl; ctx.fillRect(x,y+h*0.6,w,h*0.4);
    ctx.restore();   
    if(!noEdge){ rr(x+1.2*f,y+1.2*f,w-2.4*f,h-2.4*f,Math.max(2,r-1*f)); ctx.lineWidth=1.6*f; ctx.strokeStyle='rgba(199,154,62,.85)'; ctx.stroke(); }   
    return; }
  ctx.restore(); }

function cardBack(cx,cy,w,h,now,rainbow){ var f=w/84, x=-w/2, y=-h/2, r=13*f, t=(FXSET.fx?(now||0):0)/1000;
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
    ctx.font=B(9*f); ctx.fillStyle='rgba(250,246,238,.55)'; ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.fillText('✦ 无限工厂3 ✦',0,y+h-11*f);
    rr(x+5*f,y+5*f,w-10*f,h-10*f,r-4*f); ctx.lineWidth=1*f; ctx.strokeStyle='rgba(250,246,238,.18)'; ctx.stroke();
  } else {
    ctx.save(); rr(x+2*f,y+2*f,w-4*f,h-4*f,r-2*f); ctx.clip();
    ctx.fillStyle='rgba(60,80,95,.08)';
    for(var gx2=x+7*f;gx2<x+w;gx2+=11*f){ for(var gy2=y+7*f;gy2<y+h;gy2+=11*f){ ctx.fillRect(gx2,gy2,1.4*f,1.4*f); } }
    ctx.restore();
    ctx.beginPath(); ctx.arc(0,-h*0.06,w*0.19,0,6.3); ctx.lineWidth=1.6*f; ctx.strokeStyle='rgba(35,48,58,.35)'; ctx.stroke();
    drawEmoji('🏭',0,-h*0.06,Math.round(w*0.22),0.8);
    ctx.font=B(9*f); ctx.fillStyle='rgba(35,48,58,.4)'; ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.fillText('无限工厂3',0,y+h-11*f);
  }
  rr(x,y,w,h,r); ctx.lineWidth=1.8*f; ctx.strokeStyle=rainbow?'rgba(250,246,238,.35)':'rgba(35,48,58,.7)'; ctx.stroke();
  ctx.restore();
}


 function drawCard(cx,cy,w,h,c,opt={}){
  const f=w/84, now=opt.now||0, x=-w/2, y=-h/2, r=13*f;
  const skin=SKINS.has(opt.skinId)?opt.skinId:'default',custom=appearance('skins',opt.skinId);
  FXSET.fx=opt.animate!==false;
  ctx.save(); ctx.translate(cx,cy); if(opt.rotation) ctx.rotate(opt.rotation);
  // 普通卡牌采用纸面、柔影、顶部高光及单层边框。
  ctx.save(); ctx.shadowColor='rgba(40,55,70,'+(opt.lift?0.3:0.18)+')'; ctx.shadowBlur=(opt.lift?18:10)*f; ctx.shadowOffsetY=(opt.lift?9:5)*f; rr(x,y,w,h,r); ctx.fillStyle=custom?.face||PAPER; ctx.fill(); ctx.restore();
  imageLayer(custom,x,y,w,h,r);
  ctx.save(); rr(x,y,w,h,r); ctx.clip(); const tg=ctx.createLinearGradient(0,y,0,y+h*0.4); tg.addColorStop(0,'rgba(255,255,255,.5)'); tg.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle=tg; ctx.fillRect(x,y,w,h*0.4); ctx.restore();
  const aNow=FXSET.fx?now:0;
  if(skin!=='dawn'&&skin!=='hearth'&&skin!=='starfire'){ ctx.lineWidth=1.8*f; ctx.strokeStyle=custom?.border||'rgba(35,48,58,.7)'; rr(x,y,w,h,r); ctx.stroke(); }
  if(skin!=='default') limOverlay(x,y,w,h,r,skin,aNow,FXSET.fx,false);
  const cc=CATS[c.category]||CATS['抽象'];
  ctx.font=SB(9*f); ctx.fillStyle=custom?.accent||cc[1]; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(c.category,0,y+11*f);
  ctx.strokeStyle=LINE; ctx.lineWidth=1*f; ctx.beginPath(); ctx.moveTo(x+w*0.2,y+19*f); ctx.lineTo(x+w*0.8,y+19*f); ctx.stroke();
  ctx.save(); const sg=ctx.createRadialGradient(0,y+h*0.45,2,0,y+h*0.45,w*0.42); sg.addColorStop(0,'rgba(120,150,150,.13)'); sg.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(0,y+h*0.45,w*0.42,0,7); ctx.fill(); ctx.restore();
  drawEmoji(c.emoji,0,y+h*0.45,33*f);
  // 保持原版粗字号和省略方式；底注沿用现有本地文案，不恢复首发者署名。
  ctx.font=B(14*f); ctx.fillStyle=custom?.ink||INK; let nm=c.name;
  while(ctx.measureText(nm).width>w-12*f&&nm.length>1) nm=nm.slice(0,-1);
  ctx.fillText(nm===c.name?c.name:nm+'…',0,y+h*0.73);
  ctx.font=SB(8.5*f); ctx.fillStyle=custom?.accent||(c.isBase?MUTE:GOLD2);
  let cap=c.isBase?'· 本源 ·':'· 我的发现 ·';
  while(ctx.measureText(cap).width>w-10*f&&cap.length>1) cap=cap.slice(0,-1);
  ctx.fillText(cap,0,y+h-10*f);
  // 角标显示材料的选择顺序。
  if(opt.selected){rr(x-4*f,y-4*f,w+8*f,h+8*f,r+3*f);ctx.lineWidth=2.6*f;ctx.strokeStyle='#1fb6a6';ctx.stroke();ctx.beginPath();ctx.arc(x+w-1*f,y+1*f,9*f,0,7);ctx.fillStyle='#1fb6a6';ctx.fill();ctx.fillStyle='#fff';ctx.font=B(10*f);ctx.fillText(String(opt.selectionIndex||'✓'),x+w-1*f,y+1*f);}
  ctx.restore();
 }
 // 词典格单独绘制，行列尺寸跟随词典宽度。
 // x/y 为左上角；典型格高 58，宽度由词典列数决定。格内皮肤始终静态。
 function drawTile(x,y,w,h,c,opt={}){
  const skin=SKINS.has(opt.skinId)?opt.skinId:'default',custom=appearance('skins',opt.skinId);
  ctx.save();
  // 词典格阴影下移两个设计像素。
  ctx.save(); ctx.shadowColor='rgba(47,58,74,.20)'; ctx.shadowBlur=2*1.8+2; ctx.shadowOffsetY=2*0.8+1;
  rr(x,y,w,h,10); ctx.fillStyle=custom?.face||PAPER; ctx.fill(); ctx.restore();
  imageLayer(custom,x,y,w,h,10);
  if(skin!=='default') limOverlay(x,y,w,h,10,skin,opt.now||0,false,false);
  if(skin!=='dawn'){
   rr(x,y,w,h,10); ctx.lineWidth=skin!=='default'?1.8:1.6;
   ctx.strokeStyle=custom?.border||(skin!=='default'?INK:'rgba(35,48,58,.55)'); ctx.stroke();
  }
  ctx.save(); const sg=ctx.createRadialGradient(x+w/2,y+h*0.38,1,x+w/2,y+h*0.38,w*0.38);
  sg.addColorStop(0,'rgba(120,150,150,.12)'); sg.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(x+w/2,y+h*0.38,w*0.38,0,7); ctx.fill(); ctx.restore();
  ctx.textAlign='center'; ctx.textBaseline='middle'; drawEmoji(c.emoji,x+w/2,y+h*0.38,w*0.40);
  rr(x+3,y+h-h*0.34,w-6,h*0.30,7); ctx.fillStyle=custom?.face||'rgba(244,239,230,.92)'; ctx.fill();
  ctx.font=B(w*0.18); ctx.fillStyle=custom?.ink||INK; let nm=c.name;
  while(ctx.measureText(nm).width>w-7&&nm.length>1) nm=nm.slice(0,-1);
  ctx.fillText(nm===c.name?c.name:nm+'…',x+w/2,y+h-h*0.155);
  ctx.restore();
 }
 return {drawCard,drawTile,drawBack(cx,cy,w,h,now,rainbow,animate=true,cardBackId){
   FXSET.fx=animate;const custom=appearance('cardBacks',cardBackId);
   if(!custom){cardBack(cx,cy,w,h,now,rainbow);return;}
   const f=w/84,x=cx-w/2,y=cy-h/2,r=13*f;ctx.save();
   ctx.shadowColor='rgba(35,48,58,.25)';ctx.shadowBlur=10*f;rr(x,y,w,h,r);ctx.fillStyle=custom.face;ctx.fill();ctx.shadowBlur=0;
   imageLayer(custom,x,y,w,h,r);rr(x,y,w,h,r);ctx.lineWidth=1.8*f;ctx.strokeStyle=custom.border;ctx.stroke();
   rr(x+7*f,y+7*f,w-14*f,h-14*f,8*f);ctx.strokeStyle=custom.accent;ctx.lineWidth=1*f;ctx.stroke();
   ctx.translate(cx,cy);ctx.rotate(animate?Math.sin(now*.0012)*.12:0);ctx.strokeStyle=custom.accent;ctx.lineWidth=2*f;
   ctx.beginPath();ctx.arc(0,-h*.04,w*.24,0,Math.PI*2);ctx.stroke();drawEmoji('⚗️',0,-h*.04,27*f);
   ctx.font=SB(8*f);ctx.fillStyle=custom.ink;ctx.textAlign='center';ctx.fillText('无限工厂3',0,h*.33);ctx.restore();
 },roundRect:rr};
}
