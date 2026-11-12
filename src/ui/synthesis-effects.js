// 动画由本模块绘制，调用方管理请求、存档提交和阶段切换。
// 本模块不消费材料、不写入卡牌，也不把请求返回视为已经保存成功。

export const LEGACY_MOTION = Object.freeze({
  cardWidth: 84,
  cardHeight: 108,
  liftScale: 1.1,
  liftRotation: -0.05,
  overlapFactor: 0.6,
  dragThreshold: 6,
  resultInitialScale: 0.2,
  returnInitialScale: 0.4,
  dictionaryInitialScale: 0.3,
  scaleFollow: 0.22,
  positionFollow: 0.3,
  waitingScale: 0.92,
});

export const SYNTHESIS_TIMINGS = Object.freeze({
  frame: 1000 / 60,
  discovery: 1500,
  discoveryIn: 500,
  discoveryRing: 700,
  discoveryCardPop: 550,
  discoveryFadeStart: 1000,
  discoveryFade: 500,
  waitingDots: 300,
  repeatFloat: 900,
  failureFloat: 1600,
});

const COLORS = Object.freeze({
  teal: '#1fb6a6',
  green: '#2fae9b',
  glow: '#7fe9dd',
  panel: '#faf6ee',
  goldDark: '#a9802f',
  shadow: 'rgba(47,58,74,.16)',
});
const RAINBOW = Object.freeze(['#c79a3e', '#1fb6a6', '#7fe9dd', '#e9c98a', '#9bd9cf', '#cda85a']);
const boldFonts = new Map();
function bold(size) {
  if (!boldFonts.has(size)) boldFonts.set(size, `900 ${size}px "PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif`);
  return boldFonts.get(size);
}

// 原引擎 ease.outBack/outCubic 的系数保持不变。
export function easeOutBack(value) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}
export function easeOutCubic(value) { return 1 - Math.pow(1 - value, 3); }

// 按实际经过时间插值，保持不同刷新率下的移动速度一致。
// 拖动时位置仍应直接跟随手指；此函数用于松手后的尺寸恢复、归位和结果弹出。
export function followLegacy(value, target, factor, dtMs = SYNTHESIS_TIMINGS.frame) {
  if (dtMs <= 0) return value;
  const amount = Math.max(0, Math.min(1, factor));
  const follow = dtMs === SYNTHESIS_TIMINGS.frame
    ? amount
    : 1 - Math.pow(1 - amount, dtMs / SYNTHESIS_TIMINGS.frame);
  return value + (target - value) * follow;
}

export function waitingPose(now, { scale = 1, reduceMotion = false } = {}) {
  return {
    cardScale: LEGACY_MOTION.waitingScale,
    rotation: reduceMotion ? 0 : Math.sin(now * 0.0032) * 0.055,
    bob: reduceMotion ? 0 : Math.sin(now * 0.0021) * 3 * scale,
    dotCount: reduceMotion ? 1 : 1 + Math.floor(now / SYNTHESIS_TIMINGS.waitingDots % 3),
  };
}

// x/y 为设计屏坐标，scale 为世界到设计屏的有效缩放；外层不要再次乘相同缩放。
// label由界面传入，避免把合成、联网请求和保存中的状态在绘制层混成同一条提示。
export function drawWaiting(ctx, painter, {
  x, y, scale = 1, now = 0, cardBackId = 'plain', reduceMotion = false, label = '',
}) {
  const pose = waitingPose(now, { scale, reduceMotion });
  const width = LEGACY_MOTION.cardWidth * scale * pose.cardScale;
  const height = LEGACY_MOTION.cardHeight * scale * pose.cardScale;
  ctx.save();
  ctx.translate(0, pose.bob);
  ctx.translate(x, y);
  ctx.rotate(pose.rotation);
  ctx.translate(-x, -y);
  painter.drawBack(x, y, width, height, now, cardBackId === 'rainbow', !reduceMotion, cardBackId);
  ctx.restore();
  if (!label) return;

  const text = label + '·'.repeat(pose.dotCount);
  ctx.save();
  ctx.font = bold(10.5 * scale);
  const textWidth = ctx.measureText(text).width;
  const pillWidth = textWidth + 18 * scale, pillHeight = 22 * scale;
  const top = y - height / 2 - pillHeight - 6 * scale;
  ctx.save();
  ctx.shadowColor = COLORS.glow;
  ctx.shadowBlur = 9 * scale;
  painter.roundRect(x - pillWidth / 2, top, pillWidth, pillHeight, pillHeight / 2);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();
  ctx.restore();
  painter.roundRect(x - pillWidth / 2, top, pillWidth, pillHeight, pillHeight / 2);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = COLORS.teal;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.goldDark;
  ctx.fillText(text, x, top + pillHeight / 2 + 0.5);
  ctx.restore();
}

// 每次首次发现开始时生成一次；绘制阶段复用同一组粒子，不在每帧重新随机。
export function createDiscoveryParticles(random = Math.random) {
  return Array.from({ length: 12 }, () => ({ a: random() * 6.28, sp: 46 + random() * 56 }));
}

// 直接保留旧引擎 spark() 的八尖星轮廓、透明度和色值。
function drawSpark(ctx, x, y, size, alpha, color) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = color;
  ctx.translate(x, y);
  ctx.beginPath();
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4, radius = index % 2 ? size * 0.38 : size;
    if (index) ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    else ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 对应旧 drawSmall()；x=W/2、y=H*.44，内部仍保留旧卡和青环的 y-6 偏移。
// particles由createDiscoveryParticles一次生成；仅用于本档首次发现，已知卡不重复播放。
// 返回false表示时长已结束，调用方可释放此次动画状态。没有全服荣誉、奖励或假身份。
export function drawDiscovery(ctx, painter, {
  x, y, card, particles = [], elapsedMs = 0, now = 0, skinId = 'default', reduceMotion = false, label = '',
}) {
  if (elapsedMs < 0 || elapsedMs > SYNTHESIS_TIMINGS.discovery) return false;
  const t = elapsedMs / 1000;
  const entrance = Math.min(1, t / 0.5);
  const exit = t > 1 ? Math.max(0, 1 - (t - 1) / 0.5) : 1;
  const alpha = reduceMotion ? 1 : entrance * exit;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (!reduceMotion) {
    const progress = easeOutCubic(Math.min(1, t / 0.7));
    ctx.save();
    ctx.globalAlpha = alpha * (1 - progress);
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = COLORS.teal;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y - 6, 38 + progress * 84, 0, 7);
    ctx.stroke();
    ctx.restore();
    particles.forEach((particle, index) => drawSpark(
      ctx, x + Math.cos(particle.a) * particle.sp * progress,
      y - 6 + Math.sin(particle.a) * particle.sp * progress,
      7, (1 - progress) * alpha, RAINBOW[index % 6],
    ));
  }
  const cardScale = reduceMotion ? 1 : 0.4 + easeOutBack(Math.min(1, t / 0.55)) * 0.6;
  painter.drawCard(x, y - 6, 90 * cardScale, 118 * cardScale, card, { now, skinId, animate: !reduceMotion });
  if (label) {
    ctx.font = bold(15);
    const textWidth = ctx.measureText(label).width, pillWidth = textWidth + 26, pillHeight = 30;
    const left = x - pillWidth / 2, top = y + 66;
    painter.roundRect(left + 2, top + 2, pillWidth, pillHeight, pillHeight / 2);
    ctx.fillStyle = COLORS.shadow;
    ctx.fill();
    painter.roundRect(left, top, pillWidth, pillHeight, pillHeight / 2);
    ctx.fillStyle = COLORS.green;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, top + pillHeight / 2 + 0.5);
  }
  ctx.restore();
  return true;
}

// 飘字采用30像素上移和1.6倍余寿透明度；文本与错误含义由界面提供。
export function drawFloatingText(ctx, { x, y, text, color, born, until, reduceMotion=false }, now) {
  if (until <= born || now < born || now >= until) return false;
  const life = (until - now) / (until - born);
  ctx.save();
  ctx.globalAlpha = reduceMotion ? 1 : Math.min(1, life * 1.6);
  ctx.font = bold(13);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, reduceMotion ? y : y - (1 - life) * 30);
  ctx.restore();
  return true;
}

const note = (frequency, duration, type, volume, delay = 0) => Object.freeze({ frequency, duration, type, volume, delay });
const clickNotes = Object.freeze([note(300, 0.06, 'square', 0.05)]);
export const SYNTHESIS_SOUNDS = Object.freeze({
  click: clickNotes,
  lift: Object.freeze([note(520, 0.05, 'sine', 0.05)]),
  think: Object.freeze([note(440, 0.1, 'sine', 0.04)]),
  discovery: Object.freeze([note(880, 0.16, 'sine', 0.12), note(1175, 0.22, 'sine', 0.10, 0.08)]),
  repeat: clickNotes,
  failure: clickNotes,
  claim: Object.freeze([784, 988, 1319].map((frequency, index) => note(frequency, 0.2, 'triangle', 0.11, index * 0.07))),
  big: Object.freeze([523, 659, 784, 1047, 1319].map((frequency, index) => note(frequency, 0.42, 'triangle', 0.14, index * 0.08))),
});

// 调用方在用户手势中创建/恢复AudioContext，并先检查声音偏好；不在这里擅自开声音。
// 音量包络：20ms起音、指数衰减到0.0001、尾部30ms后停止振荡器。
export function playSynthesisSound(audioContext, kind) {
  const notes = SYNTHESIS_SOUNDS[kind];
  if (!audioContext || !notes) return false;
  for (const sound of notes) {
    const start = audioContext.currentTime + sound.delay;
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = sound.type;
    oscillator.frequency.value = sound.frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(sound.volume, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + sound.duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + sound.duration + 0.03);
  }
  return true;
}
