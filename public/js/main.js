import { clampConfig, DIFFICULTIES, ensureSafe, floodReveal, generate, neighbors, randomSeed } from './minesweeper.js';

const $ = s => document.querySelector(s);

const HIDDEN = 0, OPEN = 1, FLAG = 2;
const LONG_PRESS_MS = 380;

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// Dark mode
const darkToggle = $('#darkToggle');
function applyDark(on) {
  document.documentElement.classList.toggle('dark', on);
  darkToggle.textContent = on ? '☀' : '☾';
  store.set('dark', on ? '1' : '');
}
applyDark(store.get('dark') === '1');
darkToggle.addEventListener('click', () => applyDark(!document.documentElement.classList.contains('dark')));

let board = null;      // see generate() in minesweeper.js
let difficulty = 'intermediate';
let state = null;      // Uint8Array: HIDDEN | OPEN | FLAG per cell
let status = 'ready';  // 'ready' | 'playing' | 'won' | 'lost'
let flagMode = false;
let noGuess = store.get('noGuess') !== '0';
let opened = 0;
let flags = 0;
let timerStart = 0;
let timerInterval = null;
let transposed = false;
let cellEls = [];

// ── Controls ──

const savedDiff = store.get('difficulty');
if (savedDiff && $(`#diffSelect option[value="${savedDiff}"]`)) $('#diffSelect').value = savedDiff;
for (const k of ['W', 'H', 'Mines']) {
  const v = store.get(`custom${k}`);
  if (v) $(`#custom${k}`).value = v;
}
$('#customRow').hidden = $('#diffSelect').value !== 'custom';

$('#newBtn').addEventListener('click', () => { $('#seedInput').value = ''; loadGame(); });
$('#retryBtn').addEventListener('click', () => { if (board) $('#seedInput').value = board.seed; loadGame(); });
$('#seedInput').addEventListener('keydown', e => { if (e.key === 'Enter') loadGame(); });
$('#diffSelect').addEventListener('change', () => {
  const custom = $('#diffSelect').value === 'custom';
  $('#customRow').hidden = !custom;
  store.set('difficulty', $('#diffSelect').value);
  if (!custom) { $('#seedInput').value = ''; loadGame(); }
});
$('#customRow').addEventListener('keydown', e => { if (e.key === 'Enter') { $('#seedInput').value = ''; loadGame(); } });

function setFlagMode(on) {
  flagMode = on;
  $('#modeSlider').dataset.mode = on ? 'flag' : 'reveal';
}
$('#modeSlider').addEventListener('click', () => setFlagMode(!flagMode));
document.addEventListener('keydown', e => {
  if (e.key === ' ' && !e.target.closest('input, select, button')) {
    e.preventDefault();
    setFlagMode(!flagMode);
  }
});

const settingsPanel = $('#settingsPanel');
$('#settingsBtn').addEventListener('click', e => { e.stopPropagation(); settingsPanel.hidden = !settingsPanel.hidden; });
document.addEventListener('click', () => { settingsPanel.hidden = true; });
settingsPanel.addEventListener('click', e => e.stopPropagation());

function setNoGuess(on) {
  noGuess = on;
  store.set('noGuess', on ? '1' : '0');
  updateModeItems();
  settingsPanel.hidden = true;
  if (board) $('#seedInput').value = board.seed;
  loadGame();
}
function updateModeItems() {
  $('#noGuessItem').classList.toggle('active', noGuess);
  $('#classicItem').classList.toggle('active', !noGuess);
}
$('#noGuessItem').addEventListener('click', () => setNoGuess(true));
$('#classicItem').addEventListener('click', () => setNoGuess(false));
updateModeItems();

$('#goRetryBtn').addEventListener('click', () => { $('#seedInput').value = board.seed; loadGame(); });
$('#goNewBtn').addEventListener('click', () => { $('#seedInput').value = ''; loadGame(); });
$('#goViewBtn').addEventListener('click', () => { $('#gameOverModal').hidden = true; });

// ── Game setup ──

function currentConfig() {
  difficulty = $('#diffSelect').value;
  if (difficulty !== 'custom') return DIFFICULTIES[difficulty];
  const cfg = clampConfig({ w: +$('#customW').value, h: +$('#customH').value, mines: +$('#customMines').value });
  $('#customW').value = cfg.w;
  $('#customH').value = cfg.h;
  $('#customMines').value = cfg.mines;
  store.set('customW', cfg.w);
  store.set('customH', cfg.h);
  store.set('customMines', cfg.mines);
  return cfg;
}

function loadGame() {
  stopTimer();
  confettiRun++;
  $('#gameOverModal').hidden = true;
  $('#winBanner').classList.remove('show');
  const seed = $('#seedInput').value.trim() || randomSeed();
  board = generate(seed, currentConfig(), noGuess);
  state = new Uint8Array(board.w * board.h);
  status = 'ready';
  opened = 0;
  flags = 0;
  $('#seedInput').value = board.seed;
  const label = difficulty === 'custom' ? `${board.w}&times;${board.h}, ${board.mines}` : $('#diffSelect').selectedOptions[0].text;
  $('#seedDisplay').innerHTML = `seed: <code></code> &middot; ${label} &middot; ${noGuess ? 'no-guess' : 'classic'}`;
  $('#seedDisplay code').textContent = board.seed;
  $('#timerDisplay').textContent = '0:00';
  updateNote();
  updateMinesLeft();
  renderBoard();
}

function updateNote() {
  let note = '';
  if (status === 'ready') {
    if (!noGuess) note = 'first click is always safe';
    else if (board.guaranteed) note = 'start at the circle';
    else note = 'too dense for no-guess — may need a guess';
  }
  $('#noteDisplay').textContent = note;
}

function updateMinesLeft() {
  $('#minesLeft').textContent = board.mines - flags;
}

// ── Rendering ──

// Wide boards turn sideways on portrait screens so cells stay tappable.
function wantTransposed() {
  return board.w > board.h && window.innerWidth < window.innerHeight;
}

function renderBoard() {
  transposed = wantTransposed();
  const rows = transposed ? board.w : board.h;
  const cols = transposed ? board.h : board.w;
  const el = document.createElement('div');
  el.className = 'board';
  el.style.setProperty('--cols', cols);
  cellEls = new Array(board.w * board.h);
  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) {
      const i = transposed ? dc * board.w + dr : dr * board.w + dc;
      const cell = document.createElement('div');
      cell.dataset.i = i;
      cellEls[i] = cell;
      el.appendChild(cell);
    }
  }
  cellEls.forEach((_, i) => paint(i));
  updateBoardClass(el);
  bindBoard(el);
  const scaler = document.createElement('div');
  scaler.className = 'board-scaler';
  scaler.appendChild(el);
  $('#boardWrap').replaceChildren(scaler);
  scaleBoard();
}

function updateBoardClass(el = $('.board')) {
  el?.classList.toggle('playing', status === 'ready' || status === 'playing');
}

function paint(i, pop = false) {
  const el = cellEls[i];
  let cls = 'cell';
  if (state[i] === OPEN) {
    cls += ' open';
    const n = board.counts[i];
    if (n) cls += ` n n${n}`;
    el.textContent = n || '';
  } else {
    el.textContent = '';
    if (state[i] === FLAG) cls += ' flag';
    else if (status === 'ready' && noGuess && i === board.start) cls += ' start';
  }
  if (pop) cls += ' pop';
  el.className = cls;
}

function scaleBoard() {
  const wrap = $('#boardWrap');
  const scaler = wrap.querySelector('.board-scaler');
  if (!scaler) return;
  scaler.style.transform = '';
  scaler.style.marginBottom = '';
  const style = getComputedStyle(wrap);
  const available = wrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const w = scaler.scrollWidth, h = scaler.scrollHeight;
  if (w > available) {
    const ratio = available / w;
    scaler.style.transform = `scale(${ratio})`;
    scaler.style.marginBottom = `-${h * (1 - ratio)}px`;
  }
}

window.addEventListener('resize', () => {
  if (!board) return;
  if (wantTransposed() !== transposed) renderBoard();
  else scaleBoard();
});

// ── Input ──

let press = null; // { i, x, y, timer, long }

function cellIndex(target) {
  const cell = target?.closest?.('.cell');
  return cell ? +cell.dataset.i : -1;
}

function clearPress() {
  if (!press) return;
  clearTimeout(press.timer);
  cellEls[press.i]?.classList.remove('pressed');
  press = null;
}

function bindBoard(el) {
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerdown', e => {
    const i = cellIndex(e.target);
    if (i < 0 || status === 'won' || status === 'lost') return;
    if (e.pointerType === 'mouse' && e.button === 2) { secondary(i); return; }
    if (e.pointerType === 'mouse' && e.button === 1) { e.preventDefault(); chord(i); return; }
    if (e.button !== 0) return;
    clearPress();
    press = { i, x: e.clientX, y: e.clientY, long: false, timer: null };
    if (state[i] === HIDDEN && !flagMode) cellEls[i].classList.add('pressed');
    if (e.pointerType !== 'mouse') {
      press.timer = setTimeout(() => {
        if (!press) return;
        press.long = true;
        cellEls[press.i].classList.remove('pressed');
        navigator.vibrate?.(15);
        // Long press does the opposite of the current mode.
        if (flagMode) primaryReveal(press.i); else secondary(press.i);
      }, LONG_PRESS_MS);
    }
  });
}

document.addEventListener('pointermove', e => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) clearPress();
});
document.addEventListener('pointercancel', clearPress);
document.addEventListener('pointerup', e => {
  if (!press) return;
  const { i, long } = press;
  clearPress();
  if (long || cellIndex(document.elementFromPoint(e.clientX, e.clientY)) !== i) return;
  if (flagMode) secondary(i); else primaryReveal(i);
});

// Reveal a hidden cell or chord an open number.
function primaryReveal(i) {
  if (state[i] === OPEN) chord(i);
  else if (state[i] === HIDDEN) reveal(i);
}

// Flag a hidden cell or chord an open number.
function secondary(i) {
  if (state[i] === OPEN) { chord(i); return; }
  if (status !== 'ready' && status !== 'playing') return;
  state[i] = state[i] === FLAG ? HIDDEN : FLAG;
  flags += state[i] === FLAG ? 1 : -1;
  paint(i, true);
  updateMinesLeft();
}

function reveal(i) {
  if (state[i] !== HIDDEN) return;
  if (status === 'ready') {
    if (noGuess && i !== board.start) {
      const s = cellEls[board.start];
      s.classList.remove('nudge');
      void s.offsetWidth;
      s.classList.add('nudge');
      return;
    }
    if (!noGuess) board = ensureSafe(board, i);
    status = 'playing';
    startTimer();
    updateNote();
    if (noGuess) paint(board.start);
  }
  if (board.isMine[i]) { lose(i); return; }
  openCells([i]);
}

function chord(i) {
  if (status !== 'playing' || state[i] !== OPEN || !board.counts[i]) return;
  const nb = neighbors(board.w, board.h)[i];
  const flagged = nb.filter(j => state[j] === FLAG).length;
  const hidden = nb.filter(j => state[j] === HIDDEN);
  if (flagged !== board.counts[i] || !hidden.length) {
    // Briefly show which cells the number touches.
    hidden.forEach(j => cellEls[j].classList.add('pressed'));
    setTimeout(() => hidden.forEach(j => cellEls[j].classList.remove('pressed')), 140);
    return;
  }
  const mine = hidden.find(j => board.isMine[j]);
  if (mine !== undefined) { lose(mine); return; }
  openCells(hidden);
}

function openCells(list) {
  const mask = state.map(v => (v === HIDDEN ? 0 : 1));
  for (const i of list) {
    for (const j of floodReveal(board, mask, i)) {
      state[j] = OPEN;
      opened++;
      paint(j, true);
    }
  }
  if (opened === board.w * board.h - board.mines) win();
}

function lose(i) {
  status = 'lost';
  stopTimer();
  updateBoardClass();
  for (let j = 0; j < state.length; j++) {
    if (board.isMine[j] && state[j] !== FLAG) cellEls[j].classList.add('mine', 'open');
    else if (!board.isMine[j] && state[j] === FLAG) cellEls[j].classList.add('wrong');
  }
  cellEls[i].classList.add('boom');
  const wrap = $('#boardWrap');
  wrap.classList.remove('shake');
  void wrap.offsetWidth;
  wrap.classList.add('shake');
  $('#gameOverSeedInfo').textContent = `seed: ${board.seed} · ${formatTime(elapsed())}`;
  setTimeout(() => { if (status === 'lost') $('#gameOverModal').hidden = false; }, 700);
}

function win() {
  status = 'won';
  stopTimer();
  updateBoardClass();
  for (let j = 0; j < state.length; j++) {
    if (board.isMine[j] && state[j] !== FLAG) { state[j] = FLAG; flags++; paint(j, true); }
  }
  updateMinesLeft();
  const sec = elapsed();
  let extra = '';
  if (difficulty !== 'custom') {
    const key = `best:${difficulty}:${noGuess ? 'ng' : 'classic'}`;
    const best = parseFloat(store.get(key));
    if (!(best <= sec)) {
      store.set(key, sec);
      extra = Number.isFinite(best) ? ' · new best!' : '';
    } else {
      extra = ` · best ${formatTime(best)}`;
    }
  }
  $('#winBanner').innerHTML = `Cleared!<small>${formatTime(sec)}${extra}</small>`;
  $('#winBanner').classList.add('show');
  launchConfetti();
}

// ── Timer ──

const elapsed = () => (timerStart ? (performance.now() - timerStart) / 1000 : 0);

function formatTime(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function startTimer() {
  timerStart = performance.now();
  clearInterval(timerInterval);
  timerInterval = setInterval(() => { $('#timerDisplay').textContent = formatTime(elapsed()); }, 250);
}

function stopTimer() {
  clearInterval(timerInterval);
  if (status === 'won' || status === 'lost') $('#timerDisplay').textContent = formatTime(elapsed());
  else timerStart = 0;
}

// ── Confetti ──

let confettiRun = 0;

function launchConfetti() {
  const run = ++confettiRun;
  const canvas = $('#confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const W = canvas.width, H = canvas.height;
  const COLORS = ['#c45d3e', '#2c2826', '#f5c842', '#6a9e6a', '#5b8fc9', '#c47db8'];
  const DURATION = 3500;
  const start = performance.now();
  const particles = Array.from({ length: 300 }, () => ({
    x: Math.random() * W,
    y: H + Math.random() * 20,
    vx: (Math.random() - 0.5) * 8,
    vy: -(Math.random() * 18 + 8),
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.3,
    w: Math.random() * 10 + 5,
    h: Math.random() * 5 + 3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  function draw(now) {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    if (t > DURATION || run !== confettiRun) return;
    ctx.globalAlpha = 1 - Math.pow(t / DURATION, 2);
    for (const p of particles) {
      p.x += p.vx;
      p.vy += 0.18;
      p.y += p.vy;
      p.angle += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

loadGame();
