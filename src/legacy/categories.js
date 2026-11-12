(function(root,factory){
  'use strict';
  var data=factory();
  if(typeof module==='object'&&module.exports)module.exports=data;
  if(root)root.WXGC2_CARD_CATEGORIES=data;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // 卡牌分类与常驻图鉴系列是两回事。七个常驻分类不变，主题分类按赛季显式配置；
  // 未配置/尚未确认赛季时只返回常驻分类，不能把本机S3主题提前套给S2或未来赛季。
  var base=Object.freeze(['自然','科技','人文','食物','生物','抽象','整活']);
  var seasonal=Object.freeze({'2026_09':Object.freeze(['星空'])});
  var colors={
    自然:['#e6f4ff','#2f6fd0'],生物:['#e8f7e9','#2e8b57'],科技:['#efeaff','#6a4fd0'],
    人文:['#fff0e6','#c0612a'],食物:['#fff3e0','#c9920f'],抽象:['#eef0f2','#5b6b78'],
    整活:['#ffe9f0','#c2557a'],星空:['#e9edff','#5364ab']
  };
  Object.keys(colors).forEach(function(k){Object.freeze(colors[k]);});
  Object.freeze(colors);
  var lists={},displayLists={};
  function seasonKey(season){var key=String(season||'').replace(/^season_/,'');return /^\d{4}_\d{2}$/.test(key)?key:'';}
  function forSeason(season){
    var key=seasonKey(season);
    if(!seasonal[key])return base;
    return lists[key]||(lists[key]=Object.freeze(base.concat(seasonal[key])));
  }
  function displayForSeason(season){
    var key=seasonKey(season);if(!seasonal[key])key='base';
    return displayLists[key]||(displayLists[key]=Object.freeze(Object.keys(colors).filter(function(cat){return forSeason(key).indexOf(cat)>=0;})));
  }
  return Object.freeze({base:base,seasonal:seasonal,colors:colors,forSeason:forSeason,displayForSeason:displayForSeason});
});
