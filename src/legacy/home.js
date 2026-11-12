'use strict';
/* =====================================================================
   场景：主页（搬自 2代 v39《主页-拼装版.html》·视觉逐像素一致）
   ---------------------------------------------------------------------
   搬运改动清单（除此以外的绘制代码一字未动）：
   1. 删掉了自带的画布/适配/配色/基元/音效/toast/指针——全部改用公共引擎（01-引擎.js）。
   2. block 阴影色/toast 时长沿用本页原值（conf 参数），观感与2代一致。
   3. location.href 整页跳转（7处）→ GO() 场景瞬切。
   4. 数据获取 bootAcct() → 数据中心 DC：进页先用口袋现货立刻显示，后台悄悄对账。
      （2代是每次进主页都硬等 /me + /firsts/now 两个请求）
   5. 「背景飘落emoji」开关从"加载时读一次"改为"每次进页重读"——设置改完回来即生效。
   6. 左下角版本号从写死的 'v0.1.0' 改为真实版本号（WXGC2_VERSION_LABEL）。
   ===================================================================== */
(function(){
  /* ---------- 数据/状态（场景私有） ---------- */
  var FALLEMOJI = true;   // 背景飘落emoji开关（enter 时重读设置）
  var FIRSTS = 0;   // 当前档的已发现数量，沿用二代数字动画。
  var _numStart=null, _numTarget=0;   // 大数字 count-up 动画状态（进页从0跳到 FIRSTS·enter 重置·只由主页 draw 驱动→离页自然停）
  var FALL = ['☀️','🌊','🍉','❄️','🏊','🍦','🦗','🏖️','🐢','🧂','🏝️','🥤','💦','🎵'];
  var drops = FALL.map(function(e,i){ return { e:e, x:(i*0.137+0.05)%1, sp:8+(i%5)*3, ph:i*1.3, sz:18+(i%4)*4, a:.16+(i%3)*0.05 }; });

  /* ==================== 彩蛋（纯前端·B造物工坊风·2026-07-02·不碰后端） ====================
     ① 敲厂牌：连点主页大标题 →4 段对话→"掉"到屏幕底→玩家拖回原位→道谢；每敲一下冒一小把夏日 emoji。
     ④ 金色工厂：背景飘落里偶尔混一个放大的金色🏭·点中→金光+一句。
     ⑤ 夜猫子：深夜 0~4 点主页悄悄多一句问候。
     全部只由主页 draw(t) 驱动·离页自然停·不吃后台。 */
  var _lastT=0, _dt=16;   // 帧间隔(ms)·给彩蛋物理/计时用（t 驱动·静帧也能推进）
  var EGG={ taps:0, state:'normal', tx:0, ty:0, tvy:0, trot:0, shake:0, drag:null, bubble:null, parts:[] };
  //   state: normal(可敲) | falling(掉落中) | fallen(躺底·可拖) | restoring(归位中)；tx/ty=厂牌相对原位偏移(设计px)
  var GF={ x:0, y:0, sz:54, on:false, flash:0 };   // ④ 金色工厂当前状态
  var EGG_LINES=['你干嘛~','不要敲啦~','真的要掉啦~','再敲就要掉下来啦~，你也不想砸厂牌吧~~~','再敲就要掉下来啦~，你也不想砸厂牌吧~~~','啊！我的厂牌！'];   // 敲第 1~6 下的话（4/5 重复同一句警告·第 6 下才掉）
  var EGG_TB={ cx:0, y:0, w:0, h:0 };   // 厂牌当前包围盒(每帧更新·给点击/拖拽判定)
  var EGG_BURST=['☀️','🌊','🍉','🍦','💦','🎵','🏖️','🐢','🥤','❄️'];

  function eggReset(){ EGG.taps=0; EGG.state='normal'; EGG.tx=0; EGG.ty=0; EGG.tvy=0; EGG.trot=0; EGG.shake=0; EGG.drag=null; EGG.bubble=null; EGG.parts.length=0; GF.on=false; GF.flash=0; try{ NOTE.open=false; NOTE.taps=0; }catch(_){} }

  function eggBurst(x,y){   // 冒一小把夏日 emoji：向上散开 + 微重力落下 + 淡出（位置按 t 解析·无需逐帧积分）
    var n=5+Math.floor(Math.random()*3);
    for(var i=0;i<n;i++){ var a=-Math.PI/2 + (Math.random()-0.5)*2.2, sp=0.05+Math.random()*0.07;
      EGG.parts.push({ e:EGG_BURST[Math.floor(Math.random()*EGG_BURST.length)], x0:x, y0:y,
        vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, born:_lastT, life:850+Math.random()*450, sz:15+Math.random()*10 }); }
  }
  function drawEggParts(t){ for(var i=EGG.parts.length-1;i>=0;i--){ var p=EGG.parts[i], age=t-p.born;
      if(age>p.life){ EGG.parts.splice(i,1); continue; }
      var x=p.x0+p.vx*age, y=p.y0+p.vy*age+0.00034*age*age, al=1-age/p.life;
      drawEmoji(p.e, x, y, p.sz, Math.max(0,al)); } }

  function eggBubble(txt,tapN){ var jx=(tapN>=2)?(Math.random()*110-55):(Math.random()*36-18), jy=(tapN>=2)?(Math.random()*18-9):0;
    EGG.bubble={ txt:txt, x:EGG_TB.cx+jx, y:EGG_TB.y-46+jy, until:_lastT+1700 }; }
  function drawEggBubble(){ if(!EGG.bubble) return; if(_lastT>EGG.bubble.until){ EGG.bubble=null; return; }
    var b=EGG.bubble; ctx.font=SB(13.5); var tw=ctx.measureText(b.txt).width, w=tw+26, h=33, x=clamp(b.x-w/2,8,W-w-8), y=b.y-h/2;
    block(x,y,w,h,13,PANEL,INK,2,3);
    ctx.beginPath(); ctx.moveTo(x+w/2-7,y+h-1); ctx.lineTo(x+w/2+7,y+h-1); ctx.lineTo(x+w/2,y+h+9); ctx.closePath(); ctx.fillStyle=PANEL; ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle=INK; ctx.stroke();
    ctx.fillStyle=INK; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=SB(13.5); ctx.fillText(b.txt,x+w/2,y+h/2+.5); }

  function eggTapTitle(){ if(EGG.state!=='normal') return; EGG.taps++; EGG.shake=200; eggBurst(EGG_TB.cx,EGG_TB.y);
    eggBubble(EGG_LINES[Math.min(EGG.taps,EGG_LINES.length)-1], EGG.taps);
    if(EGG.taps>=EGG_LINES.length){ EGG.state='falling'; EGG.tvy=0; } }   // 敲满 6 下才掉

  function eggTitle(t){   // 画厂牌（含抖动/掉落/拖动/归位物理）+ normal 态注册可敲热区
    var cx=W/2, y0=H*0.16;
    if(EGG.state==='falling'){ EGG.tvy+=0.00095*_dt; EGG.ty+=EGG.tvy*_dt; EGG.trot+=0.0011*_dt;
      var floorY=H*0.57-y0; if(EGG.ty>=floorY){ EGG.ty=floorY; EGG.tvy*=-0.3; if(Math.abs(EGG.tvy)<0.05){ EGG.tvy=0; EGG.state='fallen'; } } }   // 落点=红线(底部按钮顶部)·厂牌坐按钮上方·不再压住按钮误触
    else if(EGG.state==='restoring'){ var k=Math.min(1,0.009*_dt); EGG.tx+=(0-EGG.tx)*k; EGG.ty+=(0-EGG.ty)*k; EGG.trot+=(0-EGG.trot)*k;
      if(Math.abs(EGG.tx)<1.2&&Math.abs(EGG.ty)<1.2&&Math.abs(EGG.trot)<0.02){ EGG.tx=0; EGG.ty=0; EGG.trot=0; EGG.state='normal'; } }
    var shake=0; if(EGG.shake>0){ EGG.shake-=_dt; shake=Math.sin(t*0.045)*Math.min(6,EGG.shake*0.032); }
    var tx=cx+EGG.tx+shake, ty=y0+EGG.ty;
    ctx.save(); ctx.translate(tx,ty); ctx.rotate(EGG.trot);
    var titleSize=Math.min(52,Math.max(28,(W-28)/5.25));
    ctx.font=B(titleSize); ctx.fillStyle=INK; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('无限工厂 3',0,0); ctx.restore();
    ctx.font=B(titleSize); var twd=ctx.measureText('无限工厂 3').width; EGG_TB.cx=tx; EGG_TB.y=ty; EGG_TB.w=Math.min(W-12,twd+44); EGG_TB.h=66;
    if(EGG.state==='normal') pushHot(tx-EGG_TB.w/2, ty-EGG_TB.h/2, EGG_TB.w, EGG_TB.h, eggTapTitle);
  }

  function eggGold(t){   // ④ 金色工厂：偶尔从顶飘到底（右侧车道·避开中央 UI）·点中→金光+一句
    var period=34000, win=8500, ph=t%period;
    if(ph<win){ var pr=ph/win; GF.on=true; GF.x=W*0.83+Math.sin(t*0.0006)*18; GF.y=-34+(H+68)*pr; GF.sz=54;
      ctx.save(); ctx.shadowColor='rgba(199,154,62,.75)'; ctx.shadowBlur=16; drawEmoji('🏭',GF.x,GF.y,GF.sz); ctx.restore();
      pushHot(GF.x-GF.sz/2, GF.y-GF.sz/2, GF.sz, GF.sz, eggTapGold);
    } else GF.on=false;
    if(GF.flash>0){ GF.flash-=_dt; var fa=GF.flash/600, r=30+(1-fa)*42; ctx.save(); ctx.globalAlpha=Math.max(0,fa);
      var rg=ctx.createRadialGradient(GF.x,GF.y,2,GF.x,GF.y,r); rg.addColorStop(0,'rgba(255,225,150,.9)'); rg.addColorStop(1,'rgba(255,225,150,0)'); ctx.fillStyle=rg; ctx.beginPath(); ctx.arc(GF.x,GF.y,r,0,7); ctx.fill(); ctx.restore(); } }
  function eggTapGold(){ if(!GF.on) return; GF.flash=600; eggBurst(GF.x,GF.y); GF.on=false; toast('🏭 你发现了藏起来的金色工厂！'); }

  function eggNight(){   // ⑤ 深夜 0~4 点悄悄一句（?shot&night=1 可强制显示供自检）
    var hr; try{ hr=(STILL&&/[?&]night=1/.test(location.search))?1:new Date().getHours(); }catch(_){ hr=null; }
    if(hr!=null && hr>=0 && hr<4){ ctx.font=SB(W<440?9:12); ctx.fillStyle=MUTE; ctx.textAlign=W<440?'right':'center'; ctx.textBaseline='alphabetic'; ctx.fillText('🌙 这么晚还在造物呀~', W<440?W-12:W/2, H-15); } }

  /* ---------- 背景:暖纸工作台 + 蓝图点阵 + 射灯 + 飘落 emoji ---------- */
  /* 【性能·2026-07-03 审计头号热点】静态三层(渐变+点阵+射灯)原来每帧重建 2 个全屏渐变+3 次全屏填充——
     现烘进引擎 cachedLayer 离屏(只在首次/resize 重画)·每帧只 drawImage 一次·像素与原来逐点一致。 */
  function drawBg(t){
    cachedLayer('bg:主页', function(){
      var g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,'#f6f1e8'); g.addColorStop(1,'#e9e1d3'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
      drawDots('rgba(60,80,95,.06)');   // 【M5】点阵走引擎离屏缓存·像素与原双重循环逐点一致
      var lg=ctx.createRadialGradient(W/2,H*0.42,10,W/2,H*0.42,W*0.5); lg.addColorStop(0,'rgba(255,252,240,.75)'); lg.addColorStop(1,'rgba(255,252,240,0)'); ctx.fillStyle=lg; ctx.fillRect(0,0,W,H);   // 中央造物射灯
    });
    // 顶部缓慢飘落的夏日 emoji（设置可关·关了更省电）
    if(FALLEMOJI) drops.forEach(function(d){ var span=H+60, yy=((t*0.001*d.sp*16 + d.ph*120)%span) - 40, xx=d.x*W + Math.sin(t*0.0004+d.ph)*16;
      drawEmoji(d.e, xx, yy, d.sz, d.a); });
    if(FALLEMOJI) eggGold(t);   // ④ 彩蛋：飘落里偶尔混一个放大的金色工厂🏭
  }

  /* ---------- 顶部小药丸（登录信息 / 金币 / 设置·读真账号·游客态）（原样，仅跳转改 GO） ---------- */
  function topBar(){
    var state=WXGC3_UI.getState(), save=state&&state.save, name=save&&save.name||'我的世界';
    var ly=14,lh=30,lx=16;
    ctx.font=B(13); var lw=Math.min(230,W-74,ctx.measureText(name).width+40);
    block(lx,ly,lw,lh,12,PANEL,INK,2,3); ctx.textAlign='left'; ctx.textBaseline='middle'; drawEmoji('📁',lx+13,ly+lh/2,13);
    ctx.font=B(13); ctx.fillStyle=INK; ctx.fillText(name,lx+30,ly+lh/2+.5,lw-38);
    pushHot(lx,ly,lw,lh,function(){ WXGC3_UI.open('saves'); }); lx+=lw+8;
    var sw=34; block(lx,ly,sw,lh,9,PANEL,INK,2,3); drawEmoji('⚙️',lx+sw/2,ly+lh/2,15);
    pushHot(lx,ly,sw,lh,function(){ WXGC3_UI.open('settings'); });
  }

  /* ---------- 中央:Logo + 大数字 + 入口 + 赛季条（原样，仅跳转改 GO） ---------- */
  function center(t){
    var cx=W/2;
    // Logo / 标题
    ctx.textAlign='center'; ctx.textBaseline='middle';
    eggTitle(t);   // 彩蛋①：厂牌（可敲·敲4下掉落·拖回原位·道谢）——替代原来直接 fillText('无限工厂 3')
    // 标签 + 大数字
    ctx.font=SB(14); ctx.fillStyle=MUTE; var firstLabel='已发现卡牌', firstW=ctx.measureText(firstLabel).width, firstX=cx-(firstW+20)/2; drawEmoji('✨',firstX+8,H*0.27,14); ctx.fillText(firstLabel,firstX+20+firstW/2,H*0.27);
    // 大数字 count-up：进页从 0 缓动到全球首发总数（营造氛围·outCubic 先快后慢落定·1.4s）。
    //   只由主页 draw(t) 驱动，离页后 draw 不再被引擎调 → 动画自然停、不吃后台资源。
    var pulse=1+Math.sin(t*0.002)*0.012, num;
    if(FIRSTS==null){ num='—'; _numStart=null; }   // 数据没到→显—·等到位后从0起跳
    else { if(_numStart==null){ _numStart=t; _numTarget=FIRSTS; }   // FIRSTS 到位那刻起跳
      var _p=clamp((t-_numStart)/1400,0,1), _cur=(_p>=1)?FIRSTS:Math.round(_numTarget*ease.outCubic(_p));   // 落定后显实时值(后台对账更新也跟上·不重跳)
      num=_cur.toLocaleString('en-US'); }
    ctx.save(); ctx.translate(cx,H*0.47); ctx.scale(pulse,pulse);
    ctx.font=B(124);var numberWidth=ctx.measureText(num).width;ctx.font=B(Math.min(124,124*(W-30)/Math.max(1,numberWidth))); ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.save(); ctx.shadowColor='rgba(199,154,62,.4)'; ctx.shadowBlur=24; ctx.fillStyle=GOLD; ctx.fillText(num,0,0); ctx.restore();   // 金填充 + 柔光
    ctx.lineWidth=3; ctx.strokeStyle=INK; ctx.strokeText(num,0,0);   // 墨描边(1代式大数字·B 配色·放大)
    ctx.restore();
    // 三大入口
    var by=H*0.64,gap=W<580?8:16,bw=Math.min(170,(W-24-gap*2)/3),bh=52,narrow=W<440,labelSize=narrow?12:17,iconSpace=narrow?18:28;
    var labels=[['📁','存档',PANEL,false],['🏭','进入工厂',GOLD,true],['🧩','Mod',PANEL,false]];   // 主入口"进入工厂"放中间·金色突出
    var totW=bw*3+gap*2, sx0=cx-totW/2;
    labels.forEach(function(L,i){ var bx=sx0+i*(bw+gap); block(bx,by,bw,bh,14,L[2],INK,2.6);
      ctx.font=B(labelSize); var tlw=ctx.measureText(L[1]).width, grpW=iconSpace+tlw, gx0=bx+bw/2-grpW/2;
      ctx.textAlign='left'; ctx.textBaseline='middle'; drawEmoji(L[0],gx0+(narrow?6:9),by+bh/2,narrow?14:19); ctx.font=B(labelSize); ctx.fillStyle=INK; ctx.fillText(L[1],gx0+iconSpace,by+bh/2+.5);
      if(L[3]){ var shp=(t%3200)/3200; if(shp<0.28){ var p2=shp/0.28; ctx.save(); rr(bx,by,bw,bh,14); ctx.clip();   // E：主按钮微光·每3.2秒一道斜光扫过(只在扫过的0.9秒内画·其余帧零开销)
        var sx2=bx-50+(bw+100)*p2, g2=ctx.createLinearGradient(sx2-26,by,sx2+26,by+bh);
        g2.addColorStop(0,'rgba(255,255,255,0)'); g2.addColorStop(0.5,'rgba(255,255,255,.45)'); g2.addColorStop(1,'rgba(255,255,255,0)');
        ctx.fillStyle=g2; ctx.fillRect(bx,by,bw,bh); ctx.restore(); } }
      pushHot(bx,by,bw,bh,function(){ if(L[1]==='进入工厂'){ if(WXGC3_UI.ensurePlay()) GO('工厂界面'); } else WXGC3_UI.open(L[1]==='存档'?'saves':'mods'); }); });
    // 原赛季区域留作本地进度条，同一块暖纸和原来的次入口尺寸。
    var state=WXGC3_UI.getState(), save=state&&state.save;
    var cw=totW,cbx=cx-cw/2,cby=by+bh+18,cbh=44; block(cbx,cby,cw,cbh,13,PANEL,INK,2.4);
    ctx.textAlign='left';ctx.textBaseline='middle';ctx.font=B(13.5);ctx.fillStyle=GOLD2;ctx.fillText(save&&save.name||'我的世界',cbx+16,cby+16);
    ctx.font=SB(12);ctx.fillStyle=MUTE;var count=save&&save.stats&&save.stats.synthesisCount||0;ctx.fillText('合成 '+count+' 次',cbx+16,cby+31);
    var e2y=cby+cbh+14,e2bw=(cw-14)/2,e2bh=38;
    var EN=[['📜','合成历史','history'],['📖','配方表','recipes']];
    EN.forEach(function(L,i){var bx=cbx+i*(e2bw+14);block(bx,e2y,e2bw,e2bh,12,PANEL,INK,2.2,3);
      ctx.font=B(14.5);var grpW=24+ctx.measureText(L[1]).width,gx0=bx+e2bw/2-grpW/2;
      ctx.textAlign='left';ctx.textBaseline='middle';drawEmoji(L[0],gx0+8,e2y+e2bh/2,16);ctx.font=B(14.5);ctx.fillStyle=INK;ctx.fillText(L[1],gx0+24,e2y+e2bh/2+.5);
      pushHot(bx,e2y,e2bw,e2bh,function(){WXGC3_UI.open(L[2]);});});

  }

  /* ---------- 角标:版本号（原为写死 v0.1.0·改显真实版本） ---------- */
  /* 彩蛋：左下角版本号 1.5 秒内连点 3 下 → 弹「制作人的小纸条」（B 风格暖纸便签·微倾斜·点任意处收起） */
  var NOTE={ open:false, taps:0, last:0, t0:0 };
  var NOTE_LINES=['谢谢你来玩《无限工厂 3》！','这个工厂是一个人慢慢敲出来的，','每一张新卡诞生时，','我和你一样开心。','愿你总能合出新的惊喜。'];
  function corners(){ ctx.font=SB(W<440?9:11); ctx.fillStyle=MUTE; ctx.textAlign='left'; ctx.textBaseline='alphabetic'; var vl=window.WXGC2_VERSION_LABEL||''; ctx.fillText(vl, 16, H-14);
    var vw=ctx.measureText(vl).width;
    pushHot(6,H-(W<580?26:46),vw+36,W<580?26:42,function(){ var n=performance.now(); if(n-NOTE.last>2000) NOTE.taps=0; NOTE.last=n; NOTE.taps++;
      if(NOTE.taps>=3){ NOTE.taps=0; NOTE.open=true; NOTE.t0=0; } }); }   // 热区放大+窗口2秒(手机底部手势区容易吞点·放宽防触发不了)
  function drawNote(t){ if(!NOTE.open) return; if(!NOTE.t0) NOTE.t0=t; var e2=ease.outCubic(clamp((t-NOTE.t0)/380,0,1));
    ctx.save(); ctx.globalAlpha=clamp((t-NOTE.t0)/240,0,1)*0.5; ctx.fillStyle='#2f3a4a'; ctx.fillRect(0,0,W,H); ctx.restore();   // 遮罩
    var w=Math.min(336,W-24),h=248,x=Math.round(W/2-w/2),y=Math.round(H/2-h/2+(1-e2)*22);
    ctx.save(); ctx.globalAlpha=e2; ctx.translate(x+w/2,y+h/2); ctx.rotate(-0.02); ctx.translate(-(x+w/2),-(y+h/2));   // 微倾斜=手写便签感
    block(x,y,w,h,14,'#fff9ec',INK,2.5,5);
    ctx.textAlign='center'; ctx.textBaseline='middle'; drawEmoji('📜',x+w/2,y+32,22);
    ctx.font=B(16); ctx.fillStyle=INK; ctx.fillText('制作人的小纸条',x+w/2,y+60);
    ctx.strokeStyle='rgba(199,154,62,.45)'; ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(x+30,y+76); ctx.lineTo(x+w-30,y+76); ctx.stroke();
    ctx.font=SB(12.5); ctx.fillStyle=INK;
    for(var i=0;i<NOTE_LINES.length;i++){ ctx.fillText(NOTE_LINES[i], x+w/2, y+98+i*22,w-32); }
    ctx.font=SB(12); ctx.fillStyle=GOLD2; ctx.textAlign='right'; ctx.fillText('—— 制作人 敬上', x+w-30, y+98+NOTE_LINES.length*22+4);
    ctx.font=SB(10.5); ctx.fillStyle=MUTE; ctx.textAlign='center'; ctx.fillText('点任意处收起', x+w/2, y+h-16);
    ctx.restore();
    pushHot(0,0,W,H,function(){ NOTE.open=false; });   // 画在最后→热区最顶层·点哪都是收起(不会误触下面按钮)
  }

  /* ---------- 场景注册 ---------- */
  function syncState(state){ FIRSTS=state&&state.save&&Array.isArray(state.save.cards)?state.save.cards.filter(function(c){return !c.isBase;}).length:0;FALLEMOJI=!!FXSET.fallEmoji; }
  registerScene('主页', {
    syncState:syncState,
    // 本页原来的样板参数（保持2代观感：block阴影 40,55,70/.20；toast 1600ms 底部 H-58）
    conf: { blockShadow:'rgba(40,55,70,.20)', toastDur:1600, toastY:function(){ return H-58; }, hotSfx:true },
    enter: function(){
      FALLEMOJI = !!(window.WXGC2_API && WXGC2_API.settings) ? (WXGC2_API.settings.get('fallEmoji')!==false) : true;   // 每次进页重读设置
      syncState(WXGC3_UI.getState());
      _numStart=null;   // 每次进主页：大数字从 0 重新跳动到当前值（离页后 draw 停·不吃后台资源）
      eggReset();       // 彩蛋状态每次进主页重置（厂牌回原位·清气泡/粒子）
    },
    draw: function(t){ _dt=Math.max(1,Math.min(50,(t-_lastT)||16)); _lastT=t; drawBg(t); topBar(); center(t); corners(); eggNight(); drawEggBubble(); drawEggParts(t); drawNote(t); },
    // 彩蛋①：厂牌掉落后可拖回——只在 fallen 态命中厂牌才消费事件(返回 true)；其余返回 false，让引擎照常走热区/按钮
    pointerdown: function(p){ if(EGG.state==='fallen'){ if(p.x>=EGG_TB.cx-EGG_TB.w/2&&p.x<=EGG_TB.cx+EGG_TB.w/2&&p.y>=EGG_TB.y-EGG_TB.h/2&&p.y<=EGG_TB.y+EGG_TB.h/2){ EGG.drag={dx:p.x-(W/2+EGG.tx), dy:p.y-(H*0.16+EGG.ty)}; return true; } } return false; },
    pointermove: function(p){ if(EGG.drag){ EGG.tx=p.x-W/2-EGG.drag.dx; EGG.ty=p.y-H*0.16-EGG.drag.dy; } },
    pointercancel:function(){ EGG.drag=null; },
    pointerup: function(p){ if(EGG.drag){ EGG.drag=null; if(Math.abs(EGG.tx)<72&&Math.abs(EGG.ty)<58){ EGG.state='restoring'; EGG.taps=0; eggBubble('谢谢你~祝您游戏愉快~',1); } else EGG.state='fallen'; } }
  });
})();
