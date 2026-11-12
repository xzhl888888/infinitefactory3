// 首页只读取当前存档；统计值由工厂视图传入，彩蛋不写进度、不触发合成。
export function createHome({ enter, saves, mods }) {
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function button(className, text, action) {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }
  const home = element('section', 'wx-home');
  home.setAttribute('aria-label', '无限工厂3主页');
  const sky = element('div', 'wx-home-sky');
  sky.setAttribute('aria-hidden', 'true');
  ['☀️','🌊','🍉','❄️','🌿','🍦','🦗','🏖️','🐢','🧂','🏝️','🥤','💦','🎵'].forEach((symbol, i) => {
    const drop = element('span', '', symbol);
    drop.style.left = ((i * 13.7 + 5) % 97) + '%';
    drop.style.fontSize = (18 + (i % 4) * 4) + 'px';
    drop.style.animationDuration = (11 + i % 6 * 2) + 's';
    drop.style.animationDelay = (-i * 2.37 - 3) + 's';
    sky.append(drop);
  });
  const heading = element('h1', 'wx-home-heading');
  const title = button('wx-home-title', '无限工厂 3', tapTitle);
  heading.append(title);
  const caption = element('div', 'wx-home-label', '本存档 · 已发现卡牌数');
  const number = element('div', 'wx-home-number', '—');
  number.setAttribute('aria-hidden', 'true');
  const slot = element('div', 'wx-home-slot');
  const nav = element('nav', 'wx-home-nav');
  nav.setAttribute('aria-label', '主页入口');
  const openSaves = button('wx-button', '💾 存档', saves);
  const play = button('wx-button wx-button-primary wx-home-enter', '🏭 进入工厂', enter);
  const openMods = button('wx-button', '🧩 Mod', mods);
  nav.append(openSaves, play, openMods);
  const bubble = element('div', 'wx-home-bubble');
  bubble.hidden = true;
  bubble.setAttribute('role','status');
  const gold = button('wx-home-gold', '🏭', () => {
    say('你发现了藏起来的金色工厂！');
    gold.hidden = true;
  });
  gold.setAttribute('aria-label', '金色工厂');
  const version = button('wx-home-version', 'v0.2.3', tapVersion);
  const note = element('dialog', 'wx-home-note');
  note.setAttribute('aria-label', '制作人的小纸条');
  note.append(element('h2', '', '制作人的小纸条'), element('p','','谢谢你来玩《无限工厂 3》！'),
    element('p','','每一张新卡诞生时，我和你一样开心。'), element('p','','愿你在自己的小工厂里，常常遇到意外之喜。'),
    button('wx-button', '收好纸条', () => note.close()));
  note.addEventListener('click', e => { if (e.target === note) note.close(); });
  const night = element('small', 'wx-home-night');
  home.append(sky, gold, slot, heading, caption, number, nav, version, night, bubble, note);

  let clock = 0, lastCount = null, slotId, bubbleTimer = 0, taps = 0, fallen = false, drag = null;
  let dx = 0, dy = 0, noteTimes = [], reduced = false, suspended = true, draggedClick = false;
  const format = new Intl.NumberFormat('en-US');
  function stopCount() { cancelAnimationFrame(clock); clock = 0; }
  function displayCount(count, animate) {
    stopCount();
    number.textContent = format.format(count);
    if (!animate || !count || reduced) return;
    let start;
    function frame(now) {
      start ??= now;
      const fraction = Math.min(1, (now - start) / 1400);
      number.textContent = format.format(Math.round(count * (1 - (1 - fraction) ** 3)));
      clock = fraction < 1 ? requestAnimationFrame(frame) : 0;
    }
    number.textContent = '0';
    clock = requestAnimationFrame(frame);
  }
  function say(message) {
    clearTimeout(bubbleTimer);
    bubble.textContent = message; bubble.hidden = false;
    bubbleTimer = setTimeout(() => { bubble.hidden = true; }, 1700);
  }
  function translate(x,y) {
    dx = x; dy = y;
    title.style.setProperty('--x', x + 'px');
    title.style.setProperty('--y', y + 'px');
  }
  function restoreTitle() {
    drag = null; fallen = false; taps = 0;
    title.classList.remove('fallen', 'dragging'); translate(0,0);
  }
  function tapTitle(event) {
    if (draggedClick && event.detail > 0) { draggedClick = false; return; }
    if (fallen) {
      if (event.detail === 0) { restoreTitle(); say('谢谢你把厂牌挂回来！'); }
      return;
    }
    const lines = ['你干嘛～','不要敲啦～','真的会掉的！','厂牌已经歪啦！','再敲一下可就……','啊！我的厂牌！'];
    say(lines[taps++]);
    if (taps === lines.length) {
      fallen = true;
      const drop = nav.getBoundingClientRect().top - heading.getBoundingClientRect().bottom - 9;
      title.classList.add('fallen'); translate(0, Math.max(16, drop));
    } else if (!reduced) {
      title.animate?.([{rotate:'-3deg'},{rotate:'2deg'},{rotate:'0deg'}], {duration:180});
    }
  }
  title.addEventListener('pointerdown', event => {
    draggedClick = false;
    if (!fallen || drag || event.button !== 0) return;
    const origin = heading.getBoundingClientRect(), rect = title.getBoundingClientRect();
    drag = { id:event.pointerId, x:event.clientX, y:event.clientY,
      dx:rect.left + rect.width/2 - (origin.left + origin.width/2), dy:rect.top + rect.height/2 - (origin.top + origin.height/2) };
    title.classList.add('dragging');
    title.setPointerCapture(event.pointerId);
  });
  title.addEventListener('pointermove', e => {
    if (drag?.id !== e.pointerId) return;
    const w = home.clientWidth, h = home.clientHeight, origin = heading.getBoundingClientRect();
    const x = Math.min(w/2 - 26, Math.max(26 - w/2, drag.dx + e.clientX - drag.x));
    const y = Math.min(h - origin.bottom - 8, Math.max(-origin.top + 8, drag.dy + e.clientY - drag.y));
    translate(x, y);
  });
  function endDrag(e) {
    if (drag?.id !== e.pointerId) return;
    draggedClick = true; drag = null; title.classList.remove('dragging');
    if (Math.abs(dx)<72 && Math.abs(dy)<55) { restoreTitle(); say('谢谢你把厂牌挂回来！'); }
  }
  for (const event of ['pointerup','pointercancel','lostpointercapture']) title.addEventListener(event,endDrag);
  function tapVersion() {
    const now = Date.now();
    noteTimes = noteTimes.filter(t => now-t < 1500);
    noteTimes.push(now);
    if (noteTimes.length === 3) { noteTimes=[]; note.showModal(); }
  }
  function reset() {
    stopCount(); clearTimeout(bubbleTimer); bubble.hidden = true;
    if (note.open) note.close();
    restoreTitle(); gold.hidden = false; noteTimes = []; lastCount = null; draggedClick = false;
    const hour = new Date().getHours();
    night.textContent = hour < 4 ? '🌙 这么晚还在造物呀～' : '';
  }
  return {
    element:home, play,
    render(state, count, visible, covered) {
      if (!visible) {
        if (!home.hidden) reset();
        home.hidden = true; home.inert = true; suspended = true;
        return;
      }
      home.hidden = !visible;
      home.inert = !visible || covered;
      home.classList.toggle('covered', covered);
      reduced = !!state.save?.preferences.reduceMotion || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      home.classList.toggle('still', reduced);
      if (covered || !state.save) {
        stopCount(); suspended = true;
        // 面板后仍显示当前档的真实值，换档时不能透出旧档的数字。
        number.textContent = state.save ? format.format(count) : '—';
      }
      slot.textContent = state.save?.name || '';
      caption.setAttribute('aria-label', state.save ? '本存档已发现 '+count+' 种卡牌' : '正在读取存档');
      play.disabled = openMods.disabled = !state.save || !!state.busy;
      openSaves.disabled = !state.library || !!state.busy;
      if (!state.save || covered) return;
      if (slotId !== state.save.id) { reset(); slotId = state.save.id; }
      if (lastCount !== count || suspended) displayCount(count,lastCount===null);
      lastCount = count; suspended = false;
    },
    destroy:reset,
  };
}
