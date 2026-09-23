/*
 * 《跳跳鸟》V1.0 —— 抖音小游戏
 * 玩法：点一下屏幕，小鸟往上跳一下，穿过管道缝隙得分，碰到管道或地面结束。
 * 兼容两种环境：抖音小游戏（tt API）与浏览器（用于开发调试）。
 */

(function () {
  'use strict';

  // ---------- 环境适配 ----------
  var isTT = typeof tt !== 'undefined';

  var canvas, ctx, sysW, sysH, dpr;
  var safeTop = 0; // 顶部安全区高度（状态栏/刘海），顶部 UI 需整体下移
  if (isTT) {
    var info = tt.getSystemInfoSync();
    sysW = info.windowWidth;
    sysH = info.windowHeight;
    dpr = info.pixelRatio || 1;
    if (info.safeArea && typeof info.safeArea.top === 'number') safeTop = info.safeArea.top;
    else if (info.statusBarHeight) safeTop = info.statusBarHeight;
    canvas = tt.createCanvas();
    canvas.width = sysW * dpr;
    canvas.height = sysH * dpr;
  } else {
    canvas = document.getElementById('game');
    sysW = window.innerWidth;
    sysH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = sysW * dpr;
    canvas.height = sysH * dpr;
    canvas.style.width = sysW + 'px';
    canvas.style.height = sysH + 'px';
  }
  ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // ---------- 尺寸体系：以 375 宽为设计基准，u 为缩放单位 ----------
  var U = sysW / 375;
  var H = sysH;
  var W = sysW;

  var CFG = {
    gravity: 1500 * U,        // 重力加速度 px/s^2
    flapVel: -430 * U,        // 点按跳跃速度
    pipeSpeed: 145 * U,       // 管道左移速度 px/s
    pipeGap: 175 * U,         // 管道缝隙高度
    pipeW: 62 * U,            // 管道宽度
    pipeSpacing: 195 * U,     // 相邻管道水平间距
    groundH: 64 * U,          // 地面高度
    birdR: 15 * U,            // 小鸟半径
    birdX: W * 0.28,          // 小鸟水平位置
    gapMargin: 80 * U         // 缝隙中心距顶部/地面的最小距离
  };

  var COLOR = {
    pipe: '#3ecf5a',
    pipeDark: '#2ba344',
    bird: '#ffd23e',
    birdWing: '#ff9f1c',
    text: '#ffffff',
    panel: 'rgba(0, 0, 0, 0.45)'
  };

  // 里程碑鼓励语：命中分数时弹出
  var MILESTONES = {
    10: '太棒了！',
    20: '真厉害！',
    30: '势不可挡！',
    40: '飞一般的感觉！',
    50: '大神附体！',
    100: '传奇诞生！'
  };

  // 四季背景：每 10 分一季，季末 2 分内平滑渐变到下一季
  var SEASONS = [
    { name: '春', bgTop: '#7cc4e8', bgBottom: '#d3f0fa', ground: '#8fce6b', groundDark: '#6db54e', cloud: [255, 255, 255, 0.4], flake: '#ffb7c5', kind: 'circle', rMin: 2.5, rMax: 4, interval: 0.45, vyMin: 35, vyMax: 70 },
    { name: '夏', bgTop: '#2f9fdf', bgBottom: '#a6def5', ground: '#57a94f', groundDark: '#3f8a3a', cloud: [255, 255, 255, 0.55], flake: null, kind: 'circle', rMin: 0, rMax: 0, interval: 0, vyMin: 0, vyMax: 0 },
    { name: '秋', bgTop: '#e8a25e', bgBottom: '#f7dfae', ground: '#d19a3f', groundDark: '#a9782c', cloud: [255, 255, 255, 0.3], flake: '#e07b39', kind: 'leaf', rMin: 3, rMax: 5, interval: 0.5, vyMin: 40, vyMax: 75 },
    { name: '冬', bgTop: '#66788f', bgBottom: '#c3d2de', ground: '#eef3f7', groundDark: '#c9d6df', cloud: [240, 244, 248, 0.5], flake: '#ffffff', kind: 'circle', rMin: 1.5, rMax: 3, interval: 0.12, vyMin: 55, vyMax: 95 }
  ];
  SEASONS.forEach(function (s) {
    s.bgTopH = hex2hsl(s.bgTop);
    s.bgBottomH = hex2hsl(s.bgBottom);
    s.groundH2 = hex2hsl(s.ground);
    s.groundDarkH = hex2hsl(s.groundDark);
  });

  function hex2hsl(h) {
    var r = parseInt(h.slice(1, 3), 16) / 255;
    var g = parseInt(h.slice(3, 5), 16) / 255;
    var b = parseInt(h.slice(5, 7), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var hh = 0, s = 0, l = (max + min) / 2;
    if (d) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) hh = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
      hh *= 60;
    }
    return [hh, s, l];
  }

  // HSL 插值：色相超过 90° 的差异走"日落式"长路径（蓝→紫红→橙），避免互补色混成灰色
  function mixHSL(a, b, t) {
    var dh = b[0] - a[0];
    if (dh > 90) dh -= 360;
    else if (dh < -90) dh += 360;
    var h = (a[0] + dh * t + 360) % 360;
    var s = a[1] + (b[1] - a[1]) * t;
    var l = a[2] + (b[2] - a[2]) * t;
    return 'hsl(' + Math.round(h) + ',' + Math.round(s * 100) + '%,' + Math.round(l * 100) + '%)';
  }

  function mixA(a, b, t) {
    return 'rgba(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * t) + ',' +
      (a[3] + (b[3] - a[3]) * t).toFixed(3) + ')';
  }

  // 当前分数对应的四季混合状态：整个 10 分区间内平滑渐变
  // 季节进度（单位：分）：由下一根未通过管道的剩余距离实时推导，随飞行连续变化
  function seasonProg() {
    for (var i = 0; i < pipes.length; i++) {
      if (!pipes[i].passed) {
        var d = (pipes[i].x + CFG.pipeW) - (CFG.birdX - CFG.birdR);
        var fr = 1 - d / CFG.pipeSpacing;
        if (fr < 0) fr = 0;
        if (fr > 1) fr = 1;
        return score + fr;
      }
    }
    return score;
  }

  function seasonMix() {
    var prog = seasonProg();
    var seg = Math.floor(prog / 10);
    var i = seg % 4;
    var j = (seg + 1) % 4;
    var t = (prog - seg * 10) / 10;
    var bt = t * t * (3 - 2 * t); // smoothstep：季初季末变化慢，中段快
    var A = SEASONS[i], B = SEASONS[j];
    // 积雪量：入冬渐增，开春渐消
    var snow = 0;
    if (i === 3) snow = 1 - bt;
    else if (i === 2) snow = bt;
    return {
      bgTop: mixHSL(A.bgTopH, B.bgTopH, bt),
      bgBottom: mixHSL(A.bgBottomH, B.bgBottomH, bt),
      ground: mixHSL(A.groundH2, B.groundH2, bt),
      groundDark: mixHSL(A.groundDarkH, B.groundDarkH, bt),
      cloud: mixA(A.cloud, B.cloud, bt),
      snow: snow,
      from: bt < 0.5 ? A : B,
      name: bt < 0.5 ? A.name : B.name
    };
  }

  var flakes = []; // 天气粒子 { x, y, vy, phase, r, rot, vr, kind, color }
  var flakeT = 0;

  // ---------- 存储适配 ----------
  function loadVal(key) {
    try {
      return isTT ? tt.getStorageSync(key) : localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function saveVal(key, val) {
    try {
      if (isTT) tt.setStorageSync(key, String(val));
      else localStorage.setItem(key, String(val));
    } catch (e) {}
  }
  function loadBest() {
    return parseInt(loadVal('ttn_best'), 10) || 0;
  }
  function saveBest(score) {
    saveVal('ttn_best', score);
  }

  // ---------- 音效（WebAudio 合成，无需素材文件） ----------
  var audioCtx = null, masterGain = null;
  function initAudio() {
    if (audioCtx) return;
    try {
      var AC = (typeof window !== 'undefined') ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!AC) return;
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.connect(audioCtx.destination);
      applyVolume();
    } catch (e) {
      audioCtx = null;
    }
  }
  function applyVolume() {
    if (masterGain) masterGain.gain.value = sfxOn ? volume * 0.35 : 0;
  }
  function tone(freq, dur, type, delay, freqEnd) {
    var t0 = audioCtx.currentTime + (delay || 0);
    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    g.gain.setValueAtTime(1, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(masterGain);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  function sfx(name) {
    if (!sfxOn) return;
    initAudio();
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      if (name === 'flap') tone(600, 0.08, 'square', 0, 900);
      else if (name === 'score') tone(880, 0.1, 'sine');
      else if (name === 'milestone') { tone(660, 0.1, 'sine'); tone(990, 0.14, 'sine', 0.1); }
      else if (name === 'die') tone(280, 0.4, 'sawtooth', 0, 70);
      else if (name === 'record') { tone(523, 0.12, 'sine'); tone(659, 0.12, 'sine', 0.12); tone(784, 0.2, 'sine', 0.24); }
    } catch (e) {}
  }

  // ---------- 游戏状态 ----------
  var STATE_READY = 0, STATE_PLAYING = 1, STATE_OVER = 2;
  var state = STATE_READY;
  var score = 0;
  var best = loadBest();
  var overAt = 0; // 结束时刻，防止误触立刻重开
  var introT = 0; // 重开缓启动剩余秒数：重力减半且不出管道
  var toast = { text: '', t: 0 }; // 里程碑鼓励语：t 为剩余存活秒数
  var paused = false;   // 暂停状态
  var beatBest = false; // 本局是否已破纪录（庆祝只触发一次）
  var confetti = [];    // 破纪录庆祝彩纸 { x, y, vx, vy, rot, vr, color, life }
  var countdown = 0;        // 恢复倒计时剩余秒数
  var settingsOpen = false; // 设置面板开关
  var diffLevel = parseInt(loadVal('ttn_diff'), 10);
  if (!(diffLevel >= 0 && diffLevel <= 2)) diffLevel = 1;
  var sfxOn = loadVal('ttn_sfx') !== '0';
  var vibrationOn = loadVal('ttn_vib') !== '0';
  var volume = parseFloat(loadVal('ttn_vol'));
  if (!(volume >= 0 && volume <= 1)) volume = 0.7;

  var bird = { y: H * 0.4, vy: 0, wing: 0, squash: 0 };
  var pipes = []; // { x, gapY, gap } gapY 为缝隙中心
  var lines = []; // 点按气流速度线 { x, y, vx, vy, life }

  // 难度曲线：随分数渐进提升，25 分封顶；三档难度改变基础速度、缝隙与爬升率
  var DIFF_NAMES = ['简单', '中等', '困难'];
  var DIFF_PARAMS = [
    { speedMul: 0.85, gapAdd: 25, ramp: 0.012 },
    { speedMul: 1, gapAdd: 0, ramp: 0.022 },
    { speedMul: 1.15, gapAdd: -15, ramp: 0.03 }
  ];
  function difficulty() {
    var dp = DIFF_PARAMS[diffLevel];
    var t = Math.min(score, 25);
    return {
      speed: CFG.pipeSpeed * dp.speedMul * (1 + t * dp.ramp),
      gap: (CFG.pipeGap + dp.gapAdd * U) * (1 - t * 0.01)
    };
  }

  function vibrate() {
    if (!vibrationOn) return;
    if (isTT && tt.vibrateShort) {
      try { tt.vibrateShort(); } catch (e) {}
    }
  }

  var CONFETTI_COLORS = ['#ffd23e', '#ff6b35', '#3ecf5a', '#4ecdc4', '#ff8fab', '#7cc4e8'];

  function spawnConfetti() {
    for (var i = 0; i < 24; i++) {
      confetti.push({
        x: W / 2 + (Math.random() - 0.5) * 120 * U,
        y: H * 0.16,
        vx: (Math.random() - 0.5) * 300 * U,
        vy: (-200 - Math.random() * 250) * U,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 10,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        life: 1.2 + Math.random() * 0.6
      });
    }
  }

  function resetGame() {
    bird.y = H * 0.4;
    bird.vy = CFG.flapVel * 0.9; // 重开瞬间自带一次跳跃，避免直接下坠
    bird.wing = 0.35;
    bird.squash = 0.22;
    pipes = [];
    lines = [];
    confetti = [];
    score = 0;
    introT = 0.9;
    paused = false;
    beatBest = false;
    countdown = 0;
    settingsOpen = false;
    state = STATE_PLAYING;
  }

  // ---------- 结算界面按钮 ----------
  function overRects() {
    var bw2 = 220 * U, bh2 = 52 * U;
    return {
      restart: { x: W / 2 - bw2 / 2, y: H * 0.6, w: bw2, h: bh2, label: '重新开始' },
      home: { x: W / 2 - bw2 / 2, y: H * 0.6 + bh2 + 16 * U, w: bw2, h: bh2, label: '返回首页' }
    };
  }

  function goHome() {
    state = STATE_READY;
    bird.y = H * 0.4;
    bird.vy = 0;
    bird.wing = 0;
    bird.squash = 0;
    pipes = [];
    lines = [];
    confetti = [];
    score = 0;
    introT = 0;
    paused = false;
    countdown = 0;
    beatBest = false;
    settingsOpen = false;
    toast = { text: '', t: 0 };
  }

  function spawnLines() {
    for (var i = 0; i < 3; i++) {
      lines.push({
        x: CFG.birdX - CFG.birdR * (0.4 + i * 0.45),
        y: bird.y + CFG.birdR * (0.4 + Math.random() * 0.7),
        vx: -CFG.pipeSpeed * 0.9,
        vy: (50 + Math.random() * 60) * U,
        life: 0.2 + Math.random() * 0.12
      });
    }
  }

  function spawnPipe(gap) {
    var minC = CFG.gapMargin + gap / 2;
    var maxC = H - CFG.groundH - CFG.gapMargin - gap / 2;
    var gapY = minC + Math.random() * (maxC - minC);
    pipes.push({ x: W + CFG.pipeW, gapY: gapY, gap: gap });
  }

  function flap() {
    if (state === STATE_READY) {
      resetGame();
    } else if (state === STATE_PLAYING) {
      bird.vy = CFG.flapVel;
      bird.wing = 0.35;   // 连续扇动约 2.5 下
      bird.squash = 0.22; // 挤压变形时长
      spawnLines();
      sfx('flap');
    } else if (state === STATE_OVER) {
      if (Date.now() - overAt > 500) {
        resetGame();
      }
    }
  }

  function die() {
    state = STATE_OVER;
    overAt = Date.now();
    vibrate();
    sfx('die');
    if (score > best) {
      best = score;
      saveBest(best);
    }
  }

  function circleRectHit(cx, cy, r, rx, ry, rw, rh) {
    var nx = Math.max(rx, Math.min(cx, rx + rw));
    var ny = Math.max(ry, Math.min(cy, ry + rh));
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function birdBoxHit(p) {
    // 与上下管道（矩形）做圆-矩形碰撞
    var topH = p.gapY - p.gap / 2;
    var botY = p.gapY + p.gap / 2;
    var botH = H - CFG.groundH - botY;
    return circleRectHit(CFG.birdX, bird.y, CFG.birdR * 0.85, p.x, 0, CFG.pipeW, topH) ||
           circleRectHit(CFG.birdX, bird.y, CFG.birdR * 0.85, p.x, botY, CFG.pipeW, botH);
  }

  // ---------- 更新逻辑 ----------
  function update(dt) {
    if (paused) return;
    if (countdown > 0) {
      countdown = Math.max(0, countdown - dt);
      return;
    }
    bird.wing = Math.max(0, bird.wing - dt);
    bird.squash = Math.max(0, bird.squash - dt);
    toast.t = Math.max(0, toast.t - dt);
    for (var s = lines.length - 1; s >= 0; s--) {
      var l = lines[s];
      l.x += l.vx * dt;
      l.y += l.vy * dt;
      l.life -= dt;
      if (l.life <= 0) lines.splice(s, 1);
    }
    for (var c = confetti.length - 1; c >= 0; c--) {
      var cf = confetti[c];
      cf.vy += 900 * U * dt;
      cf.x += cf.vx * dt;
      cf.y += cf.vy * dt;
      cf.rot += cf.vr * dt;
      cf.life -= dt;
      if (cf.life <= 0 || cf.y > H) confetti.splice(c, 1);
    }

    // 天气粒子：生成与飘落（四季都持续更新，含待机画面）
    var sn = seasonMix().from;
    flakeT += dt;
    if (sn.flake && flakeT >= sn.interval && flakes.length < 60) {
      flakeT = 0;
      flakes.push({
        x: Math.random() * W,
        y: -10,
        vy: (sn.vyMin + Math.random() * (sn.vyMax - sn.vyMin)) * U,
        phase: Math.random() * Math.PI * 2,
        r: (sn.rMin + Math.random() * (sn.rMax - sn.rMin)) * U,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 4,
        kind: sn.kind,
        color: sn.flake
      });
    }
    for (var f = flakes.length - 1; f >= 0; f--) {
      var fl = flakes[f];
      fl.y += fl.vy * dt;
      fl.x += Math.sin(Date.now() / 700 + fl.phase) * 22 * U * dt;
      fl.rot += fl.vr * dt;
      if (fl.y > H - CFG.groundH) flakes.splice(f, 1);
    }

    if (state === STATE_READY) {
      bird.y = H * 0.4 + Math.sin(Date.now() / 250) * 10 * U;
      return;
    }
    if (state === STATE_OVER) return;

    var diff = difficulty();
    var g = CFG.gravity;
    if (introT > 0) {
      introT = Math.max(0, introT - dt);
      g = CFG.gravity * 0.4; // 缓启动：重力减半，防止重开后急坠
    }

    bird.vy += g * dt;
    bird.y += bird.vy * dt;

    // 飞出顶部即死（缓启动保护期内只贴顶悬停，防止重开连点秒死）
    if (bird.y < CFG.birdR) {
      bird.y = CFG.birdR;
      if (introT > 0) {
        bird.vy = 0;
      } else {
        die();
        return;
      }
    }

    for (var i = 0; i < pipes.length; i++) {
      pipes[i].x -= diff.speed * dt;
    }
    // 移除越界管道
    if (pipes.length && pipes[0].x < -CFG.pipeW) pipes.shift();
    // 补充新管道（缓启动期间不出管）
    if (introT <= 0) {
      if (pipes.length === 0) {
        spawnPipe(diff.gap);
      } else if (W - pipes[pipes.length - 1].x >= CFG.pipeSpacing) {
        spawnPipe(diff.gap);
      }
    }

    // 计分
    for (var j = 0; j < pipes.length; j++) {
      if (!pipes[j].passed && pipes[j].x + CFG.pipeW < CFG.birdX - CFG.birdR) {
        pipes[j].passed = true;
        score++;
        sfx('score');
        if (MILESTONES[score]) {
          toast = { text: MILESTONES[score], t: 1.4 };
          sfx('milestone');
        } else if (score > 100 && (score - 100) % 50 === 0) {
          toast = { text: '又破极限！' + score + '分', t: 1.4 };
          sfx('milestone');
        }
        if (!beatBest && best > 0 && score > best) {
          beatBest = true;
          toast = { text: '新纪录！', t: 1.6 };
          spawnConfetti();
          vibrate();
          sfx('record');
        }
      }
    }

    // 碰撞判定
    if (bird.y + CFG.birdR >= H - CFG.groundH) {
      bird.y = H - CFG.groundH - CFG.birdR;
      die();
      return;
    }
    for (var k = 0; k < pipes.length; k++) {
      if (birdBoxHit(pipes[k])) {
        die();
        return;
      }
    }
  }

  // ---------- 绘制 ----------
  function drawRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function drawBird() {
    var r = CFG.birdR;
    // 点按瞬间仅竖直方向压扁
    var sq = bird.squash > 0 ? bird.squash / 0.22 : 0;
    var sy = 1 - 0.22 * sq;
    // 翅膀：点按后连续扇动约 2.5 下并衰减
    var wingA = 0;
    if (bird.wing > 0) {
      var q = 1 - bird.wing / 0.35;
      wingA = Math.sin(q * Math.PI * 5) * (bird.wing / 0.35);
    }
    ctx.save();
    ctx.translate(CFG.birdX, bird.y);
    ctx.scale(1, sy);
    // 身体
    ctx.fillStyle = COLOR.bird;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // 翅膀
    ctx.fillStyle = COLOR.birdWing;
    ctx.beginPath();
    ctx.ellipse(-r * 0.25, r * 0.2 + wingA * r * 0.55, r * 0.55, r * 0.35, wingA * 0.9, 0, Math.PI * 2);
    ctx.fill();
    // 眼睛
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(r * 0.45, -r * 0.3, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(r * 0.55, -r * 0.3, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    // 嘴
    ctx.fillStyle = '#ff6b35';
    ctx.beginPath();
    ctx.moveTo(r * 0.7, 0);
    ctx.lineTo(r * 1.35, r * 0.1);
    ctx.lineTo(r * 0.7, r * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawLines() {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2 * U;
    ctx.lineCap = 'round';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      ctx.globalAlpha = Math.max(0, l.life / 0.32);
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(l.x - l.vx * 0.06, l.y - l.vy * 0.06);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawPipes() {
    var sm = seasonMix();
    var snow = sm.snow;
    for (var i = 0; i < pipes.length; i++) {
      var p = pipes[i];
      var topH = p.gapY - p.gap / 2;
      var botY = p.gapY + p.gap / 2;
      var botH = H - CFG.groundH - botY;
      drawRect(p.x, 0, CFG.pipeW, topH, COLOR.pipe);
      drawRect(p.x, botY, CFG.pipeW, botH, COLOR.pipe);
      // 管道口加粗边
      drawRect(p.x - 4 * U, topH - 18 * U, CFG.pipeW + 8 * U, 18 * U, COLOR.pipeDark);
      drawRect(p.x - 4 * U, botY, CFG.pipeW + 8 * U, 18 * U, COLOR.pipeDark);
      // 管道左侧高光
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(p.x + 6 * U, 0, 5 * U, topH - 18 * U);
      ctx.fillRect(p.x + 6 * U, botY + 18 * U, 5 * U, botH);
      // 冬季积雪盖：落在朝上的下管口顶端，堆成小雪丘
      if (snow > 0.05) {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * snow).toFixed(3) + ')';
        ctx.fillRect(p.x - 5 * U, botY - 5 * U, CFG.pipeW + 10 * U, 8 * U);
        ctx.fillRect(p.x + 3 * U, botY - 10 * U, CFG.pipeW - 6 * U, 7 * U);
      }
    }
  }

  function drawGround(offset) {
    var sm = seasonMix();
    var gy = H - CFG.groundH;
    drawRect(0, gy, W, CFG.groundH, sm.ground);
    // 滚动斜纹
    ctx.fillStyle = sm.groundDark;
    var step = 40 * U;
    var off = offset % step;
    for (var x = -step + off; x < W + step; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + 14 * U, gy);
      ctx.lineTo(x + 14 * U - 14 * U, H);
      ctx.lineTo(x - 14 * U, H);
      ctx.closePath();
      ctx.fill();
    }
    // 顶部草沿
    drawRect(0, gy, W, 8 * U, sm.groundDark);
  }

  function drawText(txt, x, y, size, align, color) {
    ctx.font = 'bold ' + size + 'px sans-serif';
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size * 0.12);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.strokeText(txt, x, y);
    ctx.fillStyle = color || COLOR.text;
    ctx.fillText(txt, x, y);
  }

  function drawFlakes() {
    for (var i = 0; i < flakes.length; i++) {
      var fl = flakes[i];
      ctx.save();
      ctx.translate(fl.x, fl.y);
      if (fl.kind === 'leaf') ctx.rotate(fl.rot);
      ctx.fillStyle = fl.color;
      ctx.globalAlpha = 0.85;
      if (fl.kind === 'leaf') {
        ctx.fillRect(-fl.r, -fl.r * 0.6, fl.r * 2, fl.r * 1.2);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, fl.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawConfetti() {
    for (var i = 0; i < confetti.length; i++) {
      var cf = confetti[i];
      ctx.save();
      ctx.translate(cf.x, cf.y);
      ctx.rotate(cf.rot);
      ctx.globalAlpha = Math.min(1, cf.life / 0.5);
      ctx.fillStyle = cf.color;
      ctx.fillRect(-3 * U, -2 * U, 6 * U, 4 * U);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 设置面板 ----------
  function settingsRects() {
    var pw = W * 0.82, px = (W - pw) / 2;
    var rh = 44 * U, gap = 16 * U, head = 56 * U;
    var ph = head + 6 * rh + 5 * gap + 14 * U;
    // 屏幕过矮时整体收缩，保证面板不出屏
    if (ph > H - 24 * U) {
      var f = (H - 24 * U) / ph;
      rh *= f; gap *= f; head *= f;
      ph = H - 24 * U;
    }
    var py = (H - ph) / 2;
    var bx = px + 16 * U, bw = pw - 32 * U;
    var cx = bx + 80 * U, cw = bw - 80 * U;
    function row(k) { return py + head + k * (rh + gap); }
    function rct(x, y, w, h, label) { return { x: x, y: y, w: w, h: h, label: label }; }
    var third = (cw - 2 * 8 * U) / 3;
    return {
      px: px, py: py, pw: pw, ph: ph, rh: rh,
      diff: [
        rct(cx, row(0), third, rh, DIFF_NAMES[0]),
        rct(cx + third + 8 * U, row(0), third, rh, DIFF_NAMES[1]),
        rct(cx + 2 * (third + 8 * U), row(0), third, rh, DIFF_NAMES[2])
      ],
      sfx: rct(cx, row(1), 100 * U, rh, sfxOn ? '开' : '关'),
      volMinus: rct(cx, row(2), 50 * U, rh, '－'),
      volPlus: rct(cx + cw - 50 * U, row(2), 50 * U, rh, '＋'),
      volBar: rct(cx + 60 * U, row(2) + 10 * U, cw - 120 * U, rh - 20 * U, ''),
      vib: rct(cx, row(3), 100 * U, rh, vibrationOn ? '开' : '关'),
      restart: rct(cx, row(4), cw, rh, '重新开始'),
      close: rct(cx, row(5), cw, rh, state === STATE_PLAYING ? '继续游戏' : '关 闭')
    };
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBtn(b, active) {
    // 底部立体边（按下感的厚度）
    ctx.fillStyle = active ? '#b8860b' : 'rgba(0,0,0,0.4)';
    rr(b.x, b.y + 3 * U, b.w, b.h, 8 * U);
    ctx.fill();
    // 主体：上亮下暗渐变
    var g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    if (active) {
      g.addColorStop(0, '#ffe173');
      g.addColorStop(1, '#f7b733');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,0.32)');
      g.addColorStop(1, 'rgba(255,255,255,0.12)');
    }
    ctx.fillStyle = g;
    rr(b.x, b.y, b.w, b.h, 8 * U);
    ctx.fill();
    if (b.label) drawText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1 * U, 15 * U, 'center', active ? '#5a3e00' : '#ffffff');
  }

  function drawGearIcon(cx, cy, R) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#ffffff';
    for (var i = 0; i < 8; i++) {
      ctx.save();
      ctx.rotate(i * Math.PI / 4);
      ctx.fillRect(-R * 0.21, -R * 1.28, R * 0.42, R * 0.72);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.86, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSettings() {
    var r = settingsRects();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    // 面板投影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    rr(r.px - 3 * U, r.py + 7 * U, r.pw + 6 * U, r.ph, 14 * U);
    ctx.fill();
    // 面板主体：上亮下暗渐变
    var pg = ctx.createLinearGradient(0, r.py, 0, r.py + r.ph);
    pg.addColorStop(0, '#354b64');
    pg.addColorStop(1, '#1c2a3c');
    ctx.fillStyle = pg;
    rr(r.px, r.py, r.pw, r.ph, 14 * U);
    ctx.fill();
    // 金色描边 + 内圈高光
    ctx.strokeStyle = '#ffd23e';
    ctx.lineWidth = 2 * U;
    rr(r.px, r.py, r.pw, r.ph, 14 * U);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1 * U;
    rr(r.px + 4 * U, r.py + 4 * U, r.pw - 8 * U, r.ph - 8 * U, 10 * U);
    ctx.stroke();
    drawText('设 置', W / 2, r.py + 30 * U, 26 * U);
    ctx.strokeStyle = 'rgba(255,210,62,0.35)';
    ctx.lineWidth = 1 * U;
    ctx.beginPath();
    ctx.moveTo(r.px + 22 * U, r.py + 50 * U);
    ctx.lineTo(r.px + r.pw - 22 * U, r.py + 50 * U);
    ctx.stroke();
    // 难度
    drawText('难度', r.px + 16 * U, r.diff[0].y + r.rh / 2, 15 * U, 'left');
    for (var i = 0; i < r.diff.length; i++) drawBtn(r.diff[i], i === diffLevel);
    // 音效
    drawText('音效', r.px + 16 * U, r.sfx.y + r.rh / 2, 15 * U, 'left');
    drawBtn(r.sfx, sfxOn);
    // 音量
    drawText('音量', r.px + 16 * U, r.volBar.y + r.volBar.h / 2, 15 * U, 'left');
    drawBtn(r.volMinus, false);
    drawBtn(r.volPlus, false);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    rr(r.volBar.x, r.volBar.y + 2 * U, r.volBar.w, r.volBar.h, 4 * U);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * U;
    rr(r.volBar.x, r.volBar.y, r.volBar.w, r.volBar.h, 4 * U);
    ctx.stroke();
    ctx.fillStyle = '#ffd23e';
    if (volume > 0) {
      rr(r.volBar.x + 3 * U, r.volBar.y + 3 * U, Math.max(6 * U, (r.volBar.w - 6 * U) * volume), r.volBar.h - 6 * U, 3 * U);
      ctx.fill();
    }
    // 震动
    drawText('震动', r.px + 16 * U, r.vib.y + r.rh / 2, 15 * U, 'left');
    drawBtn(r.vib, vibrationOn);
    // 操作
    drawBtn(r.restart, false);
    drawBtn(r.close, false);
  }

  function handleSettingsTap(x, y) {
    var r = settingsRects();
    function hit(rc) { return x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h; }
    for (var i = 0; i < r.diff.length; i++) {
      if (hit(r.diff[i])) { diffLevel = i; saveVal('ttn_diff', i); sfx('score'); return; }
    }
    if (hit(r.sfx)) {
      sfxOn = !sfxOn;
      saveVal('ttn_sfx', sfxOn ? '1' : '0');
      applyVolume();
      if (sfxOn) sfx('score');
      return;
    }
    if (hit(r.volMinus)) { volume = Math.max(0, Math.round((volume - 0.1) * 10) / 10); applyVolume(); saveVal('ttn_vol', volume); return; }
    if (hit(r.volPlus)) { volume = Math.min(1, Math.round((volume + 0.1) * 10) / 10); applyVolume(); saveVal('ttn_vol', volume); return; }
    if (hit(r.vib)) { vibrationOn = !vibrationOn; saveVal('ttn_vib', vibrationOn ? '1' : '0'); if (vibrationOn) vibrate(); return; }
    if (hit(r.restart)) { resetGame(); return; }
    if (hit(r.close)) {
      settingsOpen = false;
      if (state === STATE_PLAYING) { paused = false; countdown = 3; }
      return;
    }
  }

  function draw() {
    var sm = seasonMix();
    // 背景
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, sm.bgTop);
    grad.addColorStop(1, sm.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 装饰云
    ctx.fillStyle = sm.cloud;
    ctx.beginPath();
    ctx.arc(W * 0.2, H * 0.15, 40 * U, 0, Math.PI * 2);
    ctx.arc(W * 0.3, H * 0.18, 30 * U, 0, Math.PI * 2);
    ctx.arc(W * 0.75, H * 0.35, 50 * U, 0, Math.PI * 2);
    ctx.arc(W * 0.85, H * 0.32, 32 * U, 0, Math.PI * 2);
    ctx.fill();

    drawPipes();
    drawGround(scrollOff);
    drawFlakes();
    drawLines();
    drawBird();
    drawConfetti();

    if (state === STATE_READY) {
      // 首页也提供设置入口（面板打开时隐藏，避免从面板边缘露出）
      if (!settingsOpen) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(14 * U, safeTop + 14 * U, 40 * U, 40 * U);
        drawGearIcon(34 * U, safeTop + 34 * U, 9 * U);
      }
      drawText('跳跳鸟', W / 2, H * 0.18, 46 * U);
      drawText('点一下屏幕，小鸟往上跳', W / 2, H * 0.28, 17 * U, 'center', 'rgba(255,255,255,0.85)');
      drawText('穿过管道 +1 分', W / 2, H * 0.33, 17 * U, 'center', 'rgba(255,255,255,0.85)');
      drawText('点击开始', W / 2, H * 0.62, 24 * U);
      if (best > 0) drawText('最高分 ' + best, W / 2, H * 0.7, 18 * U, 'center', '#ffd23e');
    } else if (state === STATE_PLAYING) {
      drawText(String(score), W / 2, H * 0.12, 52 * U);
      // 右上角最高分；超越后变为新纪录提示
      if (score > best) {
        drawText('新纪录！', W - 14 * U, safeTop + 26 * U, 16 * U, 'right', '#ffd23e');
      } else if (best > 0) {
        drawText('最高分 ' + best, W - 14 * U, safeTop + 26 * U, 16 * U, 'right', 'rgba(255,255,255,0.9)');
      }
      if (countdown > 0) {
        // 恢复倒计时：3、2、1 逐秒缩小
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, W, H);
        var frac = countdown - Math.floor(countdown);
        drawText(String(Math.ceil(countdown)), W / 2, H * 0.4, 70 * U * (0.9 + 0.5 * frac));
      } else if (paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, W, H);
        if (!settingsOpen) {
          drawText('已暂停', W / 2, H * 0.42, 32 * U);
          drawText('点击屏幕继续', W / 2, H * 0.52, 18 * U, 'center', 'rgba(255,255,255,0.85)');
        }
      } else {
        // 左上角设置按钮 + 旁边暂停按钮
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(14 * U, safeTop + 14 * U, 40 * U, 40 * U);
        ctx.fillRect(60 * U, safeTop + 14 * U, 40 * U, 40 * U);
        drawGearIcon(34 * U, safeTop + 34 * U, 9 * U);
        // 暂停图标
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(72 * U, safeTop + 24 * U, 6 * U, 20 * U);
        ctx.fillRect(82 * U, safeTop + 24 * U, 6 * U, 20 * U);
      }
      if (toast.t > 0 && toast.text) {
        var e = 1.4 - toast.t;
        var scale = 1;
        if (e < 0.25) {
          var p = e / 0.25;
          scale = 0.5 + 0.58 * (1 - (1 - p) * (1 - p));
        } else if (e < 0.4) {
          scale = 1.08 - 0.08 * (e - 0.25) / 0.15;
        }
        var alpha = e < 0.12 ? e / 0.12 : (e > 1.0 ? Math.max(0, (1.4 - e) / 0.4) : 1);
        var rise = e > 1.0 ? -(e - 1.0) * 50 * U : 0;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = 'bold ' + Math.round(30 * U * scale) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 6 * U * scale;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.strokeText(toast.text, W / 2, H * 0.21 + rise);
        ctx.fillStyle = '#ffd23e';
        ctx.fillText(toast.text, W / 2, H * 0.21 + rise);
        ctx.restore();
      }
    } else if (Date.now() - overAt < 250) {
      // 命中定格：先白闪 0.25 秒再弹结算面板
      ctx.fillStyle = 'rgba(255,255,255,' + (0.8 * (1 - (Date.now() - overAt) / 250)).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = COLOR.panel;
      ctx.fillRect(0, 0, W, H);
      drawText('游戏结束', W / 2, H * 0.3, 38 * U);
      drawText('得分 ' + score, W / 2, H * 0.42, 26 * U);
      drawText(score >= best && score > 0 ? '新纪录!' : '最高分 ' + best, W / 2, H * 0.5, 20 * U, 'center', '#ffd23e');
      var orr = overRects();
      drawBtn(orr.restart, false);
      drawBtn(orr.home, false);
    }
    if (settingsOpen) drawSettings();
  }

  // ---------- 主循环 ----------
  var lastT = 0;
  var scrollOff = 0;

  function loop(t) {
    if (!lastT) lastT = t;
    var dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;
    scrollOff += CFG.pipeSpeed * dt * (state === STATE_PLAYING && !paused && countdown <= 0 ? 1 : 0);
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- 输入 ----------
  function onTap(x, y) {
    // 设置面板打开时，点击只作用于面板
    if (settingsOpen) {
      handleSettingsTap(x, y);
      return;
    }
    // 结算界面：返回首页按钮（重新开始仍可点屏幕任意处）
    if (state === STATE_OVER && Date.now() - overAt > 500) {
      var orh = overRects().home;
      if (x >= orh.x && x <= orh.x + orh.w && y >= orh.y && y <= orh.y + orh.h) {
        goHome();
        return;
      }
    }
    // 倒计时期间忽略点击，防止恢复瞬间误操作
    if (countdown > 0) return;
    // 首页点左上角齿轮开设置
    if (state === STATE_READY) {
      if (x < 60 * U && y < safeTop + 60 * U) {
        settingsOpen = true;
        return;
      }
    }
    // 游戏中点左上角齿轮开设置 / 旁边暂停
    if (state === STATE_PLAYING && !paused) {
      if (x < 60 * U && y < safeTop + 60 * U) {
        settingsOpen = true;
        paused = true;
        return;
      }
      if (x >= 60 * U && x < 106 * U && y < safeTop + 60 * U) {
        paused = true;
        return;
      }
    }
    // 暂停中任意点击进入 3-2-1 倒计时（不触发跳跃，防止恢复瞬间误死）
    if (paused) {
      paused = false;
      countdown = 3;
      return;
    }
    flap();
  }

  if (isTT) {
    tt.onTouchStart(function (e) {
      var t = e && e.touches && e.touches[0];
      onTap(t ? t.clientX : 0, t ? t.clientY : 0);
    });
  } else {
    canvas.addEventListener('pointerdown', function (e) {
      onTap(e.clientX, e.clientY);
    });
  }

  // 浏览器调试钩子（抖音环境不存在 window，不影响线上）
  if (!isTT && typeof window !== 'undefined') {
    window.__ttn = {
      get: function () {
        var info = [];
        for (var i = 0; i < pipes.length; i++) info.push({ x: Math.round(pipes[i].x), gapY: Math.round(pipes[i].gapY), gap: Math.round(pipes[i].gap) });
        return { state: state, score: score, seasonProg: +seasonProg().toFixed(3), best: best, safeTop: safeTop, birdY: Math.round(bird.y), vy: Math.round(bird.vy), pipes: pipes.length, pipesInfo: info, toast: toast.text, toastT: +toast.t.toFixed(2), lines: lines.length, squash: +bird.squash.toFixed(2), season: seasonMix().name, flakes: flakes.length, introT: +introT.toFixed(2), paused: paused, beatBest: beatBest, confetti: confetti.length, settingsOpen: settingsOpen, countdown: +countdown.toFixed(2), diff: DIFF_NAMES[diffLevel], sfxOn: sfxOn, vibrationOn: vibrationOn, volume: volume };
      },
      flap: flap,
      onTap: onTap,
      update: update,
      draw: draw,
      forceToast: function (text) { toast = { text: text, t: 1.4 }; },
      confetti: spawnConfetti,
      reset: resetGame,
      die: die,
      CFG: CFG
    };
  }
})();
