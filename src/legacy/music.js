'use strict';
/* 取自二代正式99-启动.js的①BGM段。曲目、音色与原调度保留，生命周期接三代单引擎。 */
(function(){
var bgmGain=null, NOISE=null, curTrack=-1, STEP=0, BAR=0, SPB=0.13, nextT=0, schedTimer=null;   // 单音频引擎：BGM 与音效共用引擎的 AC(不再自建第二个 AudioContext·治两个引擎同跑互相欠载爆音卡顿·2026-07-03)
var BGM_BOOST=2.4;   // 背景音乐总音量倍数(2026-06-30 用户嫌太小声→调大;音效 sfx 不走这里·不受影响)
function hz(m){ return 440*Math.pow(2,(m-69)/12); }
function vnote(m,t,dur,type,vol,lp,atk){ if(!AC) return; var o=AC.createOscillator(), g=AC.createGain();
  o.type=type||'sine'; o.frequency.value=hz(m);
  if(lp){ var b=AC.createBiquadFilter(); b.type='lowpass'; b.frequency.value=lp; o.connect(b); b.connect(g); } else o.connect(g);
  g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol,t+(atk||0.006)); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  g.connect(bgmGain); o.start(t); o.stop(t+dur+0.04); }
function vpad(ms,t,dur,type,vol,lp){ ms.forEach(function(m){ vnote(m,t,dur,type||'sine',vol||0.05,lp||700,0.6); }); }
function vkick(t,vol){ if(!AC) return; var o=AC.createOscillator(), g=AC.createGain(); o.type='sine';
  o.frequency.setValueAtTime(150,t); o.frequency.exponentialRampToValueAtTime(45,t+0.12);
  g.gain.setValueAtTime(vol||0.45,t); g.gain.exponentialRampToValueAtTime(0.0001,t+0.18); o.connect(g); g.connect(bgmGain); o.start(t); o.stop(t+0.2); }
function vnoise(t,dur,vol,ftype,freq){ if(!AC||!NOISE) return; var s=AC.createBufferSource(); s.buffer=NOISE;
  var f=AC.createBiquadFilter(); f.type=ftype; f.frequency.value=freq; var g=AC.createGain();
  g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.0001,t+dur); s.connect(f); f.connect(g); g.connect(bgmGain); s.start(t); s.stop(t+dur+0.02); }
function vhat(t,vol){ vnoise(t,0.04,vol||0.05,'highpass',7000); }
function vsnare(t,vol){ vnoise(t,0.16,vol||0.12,'bandpass',1800); }
var TRACKS=[
  {id:'ambient',name:'🌙 暖垫 Ambient', bpm:60, steps:16, gain:0.14, play:function(s,bar,t){   // 纯氛围·无鼓·慢
     var R=[57,53,55,50][bar%4]; if(s===0) vpad([R,R+4,R+7,R+11],t,4.0,'sine',0.05,820);
     if(s===8){ var Hn=[64,60,62,59][bar%4]; vnote(Hn+12,t,1.6,'triangle',0.03,1600,0.4); } }},
  {id:'chip',name:'🎮 8-bit 像素', bpm:142, steps:16, gain:0.07, play:function(s,bar,t){   // 方波琶音+鼓·明快复古
     var R=[45,50,48,43][bar%4]; if(s%4===0) vnote(R,t,0.22,'square',0.10,2400);
     var ARP=[0,4,7,12,7,4,0,4,0,4,7,12,7,4,0,4]; vnote(R+12+ARP[s],t,0.10,'square',0.05,3200);
     if(s===0||s===8) vkick(t,0.40); if(s%4===2) vhat(t,0.05); if(s===4||s===12) vsnare(t,0.10); }},
  {id:'lofi',name:'🎧 Lo-Fi 慢拍', bpm:80, steps:16, gain:0.14, play:function(s,bar,t){   // 慢拍 boom-bap+柔和七和弦
     var R=[48,45,50,43][bar%4]; if(s===0) vkick(t,0.42); if(s===6) vkick(t,0.30); if(s===8) vsnare(t,0.11); if(s%2===1) vhat(t,0.03);
     if(s===0) vpad([R,R+3,R+7,R+10],t,3.6,'triangle',0.045,560); if(s===8) vnote(R-12,t,0.5,'sine',0.10,320,0.01); }},
  {id:'synth',name:'🌊 律动 Synth', bpm:116, steps:16, gain:0.08, play:function(s,bar,t){   // 四踩底鼓+推进锯齿低音+主旋琶音
     var R=[40,45,43,38][bar%4]; if(s%4===0) vkick(t,0.40); if(s%4===2) vhat(t,0.05); if(s===8) vsnare(t,0.10);
     if(s%2===0) vnote(R,t,0.16,'sawtooth',0.07,900);
     var LEAD=[12,19,24,19,12,17,24,17,14,21,26,21,16,23,28,23]; vnote(R+LEAD[s],t,0.14,'square',0.04,3600); }},
  {id:'box',name:'🎐 八音盒', bpm:96, steps:16, gain:0.15, play:function(s,bar,t){   // 稀疏铃音小旋律·无鼓·清亮
     var MEL=[[72,-1,76,-1,79,-1,76,-1,74,-1,72,-1,-1,69,-1,-1],[71,-1,74,-1,79,-1,74,-1,72,-1,71,-1,-1,67,-1,-1]];
     var m=MEL[bar%2][s]; if(m>0) vnote(m,t,1.2,'triangle',0.10,2800,0.004);
     if(s===0){ var b=[48,47][bar%2]; vnote(b,t,2.0,'sine',0.05,420,0.4); } }}
];
function bgmEnsureCtx(){ if(!AC){ try{ initAudio(); }catch(e){} }   // 复用引擎的共享 AC(单音频引擎)·没有就让引擎建一个
  if(!AC) return false;
  if(!bgmGain){ bgmGain=AC.createGain(); bgmGain.connect(AC.destination);   // BGM 主音量节点·挂到共享 AC(音效直连 AC.destination·两者在此混音)
    var len=Math.floor(AC.sampleRate*0.3); NOISE=AC.createBuffer(1,len,AC.sampleRate); var d=NOISE.getChannelData(0); for(var i=0;i<len;i++) d[i]=Math.random()*2-1; }
  if(AC.state==='suspended'){ try{ AC.resume(); }catch(e){} } return !!AC; }
function bgmSched(){ var tr=TRACKS[curTrack]; if(!tr){ schedTimer=null; return; }
  while(nextT < AC.currentTime + 0.9){ try{ tr.play(STEP,BAR,nextT); }catch(e){} STEP++; if(STEP>=tr.steps){ STEP=0; BAR++; } nextT+=SPB; }   // 提前量0.9s（2026-07-03 从0.45加大·治低端机卡顿>0.45s的音乐空窗）：卡那一下后续音符也已排好·音乐不断；try包住单个音符=一个音符出异常绝不打死整条音乐
  schedTimer=setTimeout(bgmSched,25); }
function bgmSetTrack(i){ if(!TRACKS[i]||!bgmEnsureCtx()) return; if(schedTimer){ clearTimeout(schedTimer); schedTimer=null; }
  curTrack=i; STEP=0; BAR=0; SPB=60/TRACKS[i].bpm/4; nextT=AC.currentTime+0.06; bgmGain.gain.value=TRACKS[i].gain*BGM_BOOST; bgmSched(); }
function bgmStop(){ if(schedTimer){ clearTimeout(schedTimer); schedTimer=null; } curTrack=-1; if(bgmGain) bgmGain.gain.value=0; }

var requested=false,paused=false,destroyed=false;
function sync(){
  if(destroyed)return;
  if(!FXSET.bgmOn){bgmStop();return;}
  if(paused||!requested)return;
  var track=Number.isInteger(FXSET.bgmTrack)&&TRACKS[FXSET.bgmTrack]?FXSET.bgmTrack:4;
  if(curTrack!==track||!schedTimer)bgmSetTrack(track);
}
function setPaused(value){
  paused=!!value;
  if(paused){if(schedTimer){clearTimeout(schedTimer);schedTimer=null;}}
  else sync();
}
function destroy(){
  if(destroyed)return;destroyed=true;bgmStop();
  if(bgmGain){try{bgmGain.disconnect();}catch(_){}bgmGain=null;}
  NOISE=null;
  if(window.WXGC3_LEGACY_MUSIC===api)delete window.WXGC3_LEGACY_MUSIC;
}
var api={sync:sync,pause:setPaused,destroy:destroy,
  inspect:function(){return {requested:requested,paused:paused,playing:!!schedTimer,track:curTrack,destroyed:destroyed};}};
window.WXGC3_LEGACY_MUSIC=api;
legacyListen(cv,'pointerdown',function(){
  if(window.WXGC3_UI&&WXGC3_UI.isModalOpen&&WXGC3_UI.isModalOpen())return;
  requested=true;sync();
});
legacyCleanup(destroy);
})();
