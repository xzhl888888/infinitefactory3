'use strict';
/* 主页沿用二代的版式与彩蛋，显示当前存档的发现数量。 */
(function(){
  /* ---------- 数据/状态（场景私有） ---------- */
  var FALLEMOJI = true;   // 背景飘落emoji开关（enter 时重读设置）
  var FIRSTS = 0;   // 当前档的已发现数量，沿用二代数字动画。
  var _numStart=null, _numTarget=0;   // 大数字 count-up 动画状态（进页从0跳到 FIRSTS·enter 重置·只由主页 draw 驱动→离页自然停）
  var FALL = ['☀️','🌊','🍉','❄️','🏊','🍦','🦗','🏖️','🐢','🧂','🏝️','🥤','💦','🎵'];
  var drops = FALL.map(function(e,i){ return { e:e, x:(i*0.137+0.05)%1, sp:8+(i%5)*3, ph:i*1.3, sz:18+(i%4)*4, a:.16+(i%3)*0.05 }; });

  /* 主页彩蛋包括可拖回的厂牌、可点的金色工厂和夜间问候。 */

  var _lastT=0, _dt=16;   // 帧间隔(ms)·给彩蛋物理/计时用（t 驱动·静帧也能推进）
  var EGG={ taps:0, state:'normal', tx:0, ty:0, tvy:0, trot:0, shake:0, drag:null, bubble:null, parts:[] };
  //   state: normal(可敲) | falling(掉落中) | fallen(躺底·可拖) | restoring(归位中)；tx/ty=厂牌相对原位偏移(设计px)
  var GF={ x:0, y:0, flash:0 };
  var EGG_LINES=['你干嘛~','不要敲啦~','真的要掉啦~','再敲就要掉下来啦~，你也不想砸厂牌吧~~~','再敲就要掉下来啦~，你也不想砸厂牌吧~~~','啊！我的厂牌！'];   // 敲第 1~6 下的话（4/5 重复同一句警告·第 6 下才掉）
  var EGG_TB={ cx:0, y:0, w:0, h:0 };   // 厂牌当前包围盒(每帧更新·给点击/拖拽判定)
  var EGG_BURST=['☀️','🌊','🍉','🍦','💦','🎵','🏖️','🐢','🥤','❄️'];

  function eggReset(){ EGG.taps=0; EGG.state='normal'; EGG.tx=0; EGG.ty=0; EGG.tvy=0; EGG.trot=0; EGG.shake=0; EGG.drag=null; EGG.bubble=null; EGG.parts.length=0; GF.flash=0; try{ NOTE.open=false; NOTE.taps=0; }catch(_){} }

  function eggBurst(x,y){   // 冒一小把夏日 emoji：向上散开 + 微重力落下 + 淡出（位置按 t 解析·无需逐帧积分）
    var n=5+Math.floor(Math.random()*3);
    for(var i=0;i<n;i++){ var a=-Math.PI/2 + (Math.random()-0.5)*2.2, sp=0.05+Math.random()*0.07;
      EGG.parts.push({ e:EGG_BURST[Math.floor(Math.random()*EGG_BURST.length)], x0:x, y0:y,
        vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, born:STILL?_lastT:performance.now(), life:850+Math.random()*450, sz:15+Math.random()*10 }); }
  }
  function drawEggParts(t){ for(var i=EGG.parts.length-1;i>=0;i--){ var p=EGG.parts[i], age=t-p.born;
      if(age>=p.life){ EGG.parts.splice(i,1); continue; }
      if(age<0) continue;
      var x=p.x0+p.vx*age, y=p.y0+p.vy*age+0.00034*age*age, al=1-age/p.life;
      drawEmoji(p.e, x, y, p.sz, Math.max(0,al)); } }

  function eggBubble(txt,tapN){ var jx=(tapN>=2)?(Math.random()*110-55):(Math.random()*36-18), jy=(tapN>=2)?(Math.random()*18-9):0;
    EGG.bubble={ txt:txt, x:EGG_TB.cx+jx, y:EGG_TB.y-46+jy, until:(STILL?_lastT:performance.now())+1700 }; }
  function drawEggBubble(){ if(!EGG.bubble) return; if(_lastT>=EGG.bubble.until){ EGG.bubble=null; return; }
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
      var floorY=H*0.57-y0; if(EGG.ty>=floorY){ EGG.ty=floorY; EGG.tvy*=-0.3; if(Math.abs(EGG.tvy)<0.05){ EGG.tvy=0; EGG.state='fallen'; } } }   // 厂牌落在按钮上方，按钮仍然可以正常点击。
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

  function drawGoldFlash(){   // 金色工厂的落点由点击时的动画坐标决定
    if(GF.flash<=0) return;
    GF.flash=Math.max(0,GF.flash-_dt);
    var fa=GF.flash/600, r=30+(1-fa)*42;
    ctx.save(); ctx.globalAlpha=fa;
    var rg=ctx.createRadialGradient(GF.x,GF.y,2,GF.x,GF.y,r); rg.addColorStop(0,'rgba(255,225,150,.9)'); rg.addColorStop(1,'rgba(255,225,150,0)');
    ctx.fillStyle=rg; ctx.beginPath(); ctx.arc(GF.x,GF.y,r,0,7); ctx.fill(); ctx.restore();
  }

  function eggNight(){   // ⑤ 只在问候文字需要切换时唤醒
    var date=new Date(), hr=(STILL&&/[?&]night=1/.test(location.search))?1:date.getHours();
    if(hr<4){ ctx.font=SB(W<440?9:12); ctx.fillStyle=MUTE; ctx.textAlign=W<440?'right':'center'; ctx.textBaseline='alphabetic'; ctx.fillText('🌙 这么晚还在造物呀~', W<440?W-12:W/2, H-15); }
    return (hr<4?date.setHours(4,0,0,0):date.setHours(24,0,0,0))-Date.now();
  }

  var decor=null;
  function createDecor(){
    // 顺序沿用二代：纸面、飘落图案、可交互的主页，再叠加主按钮扫光。
    var backdrop=document.createElement('div'), fallLayer=document.createElement('div'), gold=document.createElement('span'), sweep=document.createElement('div');
    backdrop.className='wx-legacy-home-backdrop';
    fallLayer.className='wx-legacy-home-falls';
    backdrop.setAttribute('aria-hidden','true');
    sweep.className='wx-legacy-home-sweep';
    sweep.setAttribute('aria-hidden','true');
    drops.forEach(function(drop){
      var span=document.createElement('span'), loop=(540+60)*1000/(drop.sp*16);
      span.className='wx-legacy-home-fall';
      span.textContent=drop.e;
      span.style.left=(drop.x*100)+'%';
      span.style.opacity=drop.a;
      span.style.setProperty('--drop-size',drop.sz+'px');
      span.style.animationDuration=loop+'ms';
      span.style.animationDelay=-(drop.ph*120%(540+60))*1000/(drop.sp*16)+'ms';
      fallLayer.append(span);
    });
    gold.className='wx-legacy-home-gold';
    gold.textContent='🏭';
    fallLayer.append(gold);
    backdrop.append(fallLayer);
    cv.before(backdrop);
    cv.after(sweep);
    return {backdrop:backdrop,fallLayer:fallLayer,gold:gold,sweep:sweep};
  }
  function homeButtonWidth(){ return Math.min(170,(W-24-(W<580?8:16)*2)/3); }
  function drawBackdrop(){
    var layer=cachedLayer('bg:主页',function(){
      var g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,'#f6f1e8'); g.addColorStop(1,'#e9e1d3'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
      drawDots('rgba(60,80,95,.06)');
      var lg=ctx.createRadialGradient(W/2,H*0.42,10,W/2,H*0.42,W*0.5); lg.addColorStop(0,'rgba(255,252,240,.75)'); lg.addColorStop(1,'rgba(255,252,240,0)'); ctx.fillStyle=lg; ctx.fillRect(0,0,W,H);
    });
    if(STILL){
      ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.drawImage(layer,0,0); ctx.restore();
      return;
    }
    var scale=cvRect().height/H, box=decor.backdrop.style, sweep=decor.sweep.style;
    if(layer.parentElement!==decor.backdrop){
      if(decor.backdrop.firstChild!==decor.fallLayer) decor.backdrop.firstChild.remove();
      decor.backdrop.prepend(layer);
    }
    box.setProperty('--ui-scale',scale);
    box.setProperty('--fall-travel',(H+60)*scale+'px');
    box.setProperty('--gold-travel',(H+68)*scale+'px');
    sweep.width=homeButtonWidth()*scale+'px';
    sweep.height=52*scale+'px';
    sweep.borderRadius=14*scale+'px';
  }
  function tapGold(p,e){
    if(!decor||decor.fallLayer.hidden||p.x<W*.83-55||p.x>W*.83+55) return;
    var r=decor.gold.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) return;
    var center=toS({clientX:r.left+r.width/2,clientY:r.top+r.height/2});
    GF.x=center.x; GF.y=center.y; GF.flash=600; eggBurst(GF.x,GF.y); sfxClick();
    toast('🏭 你发现了藏起来的金色工厂！');
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
    var pulse=1, num;
    if(FIRSTS==null){ num='—'; _numStart=null; }   // 数据没到→显—·等到位后从0起跳
    else { if(_numStart==null){ _numStart=t; _numTarget=FIRSTS; }   // FIRSTS 到位那刻起跳
      var _p=FXSET.fx?clamp((t-_numStart)/1400,0,1):1, _cur=(_p>=1)?FIRSTS:Math.round(_numTarget*ease.outCubic(_p));
      pulse=1+Math.sin(_p*2*Math.PI)*(1-_p)*0.012;
      num=_cur.toLocaleString('en-US'); }
    ctx.save(); ctx.translate(cx,H*0.47); ctx.scale(pulse,pulse);
    ctx.font=B(124);var numberWidth=ctx.measureText(num).width;ctx.font=B(Math.min(124,124*(W-30)/Math.max(1,numberWidth))); ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.save(); ctx.shadowColor='rgba(199,154,62,.4)'; ctx.shadowBlur=24; ctx.fillStyle=GOLD; ctx.fillText(num,0,0); ctx.restore();   // 金填充 + 柔光
    ctx.lineWidth=3; ctx.strokeStyle=INK; ctx.strokeText(num,0,0);   // 墨描边(1代式大数字·B 配色·放大)
    ctx.restore();
    // 三大入口
    var by=H*0.64,gap=W<580?8:16,bw=homeButtonWidth(),bh=52,narrow=W<440,labelSize=narrow?12:17,iconSpace=narrow?18:28;
    var labels=[['📁','存档',PANEL],['🏭','进入工厂',GOLD],['🧩','Mod',PANEL]];   // 主入口"进入工厂"放中间·金色突出
    var totW=bw*3+gap*2, sx0=cx-totW/2;
    labels.forEach(function(L,i){ var bx=sx0+i*(bw+gap); block(bx,by,bw,bh,14,L[2],INK,2.6);
      ctx.font=B(labelSize); var tlw=ctx.measureText(L[1]).width, grpW=iconSpace+tlw, gx0=bx+bw/2-grpW/2;
      ctx.textAlign='left'; ctx.textBaseline='middle'; drawEmoji(L[0],gx0+(narrow?6:9),by+bh/2,narrow?14:19); ctx.font=B(labelSize); ctx.fillStyle=INK; ctx.fillText(L[1],gx0+iconSpace,by+bh/2+.5);
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
      eggReset();
      if(!STILL){
        if(!decor) decor=createDecor();
        decor.backdrop.hidden=false; decor.gold.style.animationDelay=-(performance.now()%34000)+'ms';
        drawBackdrop();
      }
    },
    onResize:function(){ if(decor) drawBackdrop(); },
    leave:function(){ if(decor){ decor.backdrop.hidden=true; decor.sweep.hidden=true; } },
    destroy:function(){ if(decor){ decor.backdrop.remove(); decor.sweep.remove(); decor=null; } },
    draw:function(t){
      _dt=Math.max(1,Math.min(50,(t-_lastT)||16)); _lastT=t;
      if(STILL) drawBackdrop();
      else {
        decor.fallLayer.hidden=!FALLEMOJI;
        decor.sweep.hidden=!FXSET.fx||NOTE.open;
        decor.backdrop.classList.toggle('wx-legacy-paused',NOTE.open);
      }
      topBar(); center(t); corners(); var next=eggNight();
      drawGoldFlash(); drawEggBubble(); drawEggParts(t); drawNote(t);
      if((FXSET.fx&&t-_numStart<1400)||EGG.shake>0||EGG.parts.length||GF.flash>0||
         EGG.state==='falling'||EGG.state==='restoring'||(NOTE.open&&t-NOTE.t0<380)) return 0;
      return EGG.bubble?Math.min(next,EGG.bubble.until-t):next;
    },
    emptyTap:tapGold,
    // 彩蛋①：厂牌掉落后可拖回——只在 fallen 态命中厂牌才消费事件(返回 true)；其余返回 false，让引擎照常走热区/按钮
    pointerdown: function(p){ if(EGG.state==='fallen'){ if(p.x>=EGG_TB.cx-EGG_TB.w/2&&p.x<=EGG_TB.cx+EGG_TB.w/2&&p.y>=EGG_TB.y-EGG_TB.h/2&&p.y<=EGG_TB.y+EGG_TB.h/2){ EGG.drag={dx:p.x-(W/2+EGG.tx), dy:p.y-(H*0.16+EGG.ty)}; return true; } } return false; },
    pointermove: function(p){ if(EGG.drag){ EGG.tx=p.x-W/2-EGG.drag.dx; EGG.ty=p.y-H*0.16-EGG.drag.dy; noteActivity(); invalidate(); } },
    pointercancel:function(){ EGG.drag=null; },
    pointerup: function(p){ if(EGG.drag){ EGG.drag=null; if(Math.abs(EGG.tx)<72&&Math.abs(EGG.ty)<58){ EGG.state='restoring'; EGG.taps=0; eggBubble('谢谢你~祝您游戏愉快~',1); } else EGG.state='fallen'; } }
  });
})();
