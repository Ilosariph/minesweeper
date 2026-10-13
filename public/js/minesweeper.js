// Pure minesweeper logic: seeded board generation and a no-guess solver.
// Boards are flat arrays indexed i = r * w + c.

export const DIFFICULTIES = {
  beginner: { w: 9, h: 9, mines: 10 },
  intermediate: { w: 16, h: 16, mines: 40 },
  expert: { w: 30, h: 16, mines: 99 },
};
export const MIN_SIZE = 5;
export const MAX_SIZE = 50;
export const MAX_ATTEMPTS = 2000;

// Hashes a seed string into a 32-bit integer (FNV-1a + final avalanche).
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

// Small seedable PRNG so the same seed always yields the same board.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 0x100000000).toString(16);
}

// Width/height within limits; mines leave room for a 3×3 opening.
export function clampConfig({ w, h, mines }) {
  const clamp = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Math.floor(v) || d));
  w = clamp(w, MIN_SIZE, MAX_SIZE, 9);
  h = clamp(h, MIN_SIZE, MAX_SIZE, 9);
  mines = clamp(mines, 1, w * h - 9, 10);
  return { w, h, mines };
}

const neighborCache = new Map();
export function neighbors(w, h) {
  const key = `${w}x${h}`;
  if (neighborCache.has(key)) return neighborCache.get(key);
  const nb = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const list = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if ((dr || dc) && rr >= 0 && rr < h && cc >= 0 && cc < w) list.push(rr * w + cc);
        }
      }
      nb.push(list);
    }
  }
  neighborCache.set(key, nb);
  return nb;
}

// Mine counts around every cell (value for mine cells is unused).
export function computeCounts(w, h, isMine) {
  const nb = neighbors(w, h);
  return Int8Array.from(nb, (list) => list.reduce((n, j) => n + isMine[j], 0));
}

// Generates a board deterministically from (seed, config, noGuess).
// `start` is a guaranteed zero cell; in no-guess mode the whole board can be
// cleared from it by logic alone (`guaranteed` is false only if no such board
// was found within MAX_ATTEMPTS, e.g. for very dense custom boards).
export function generate(seed, config, noGuess = false) {
  const { w, h, mines } = clampConfig(config);
  const rng = mulberry32(hashSeed(`${seed}:${w}x${h}:${mines}:${noGuess ? 'ng' : 'classic'}`));
  const nb = neighbors(w, h);
  const n = w * h;
  let board;
  for (let attempt = 1; attempt <= (noGuess ? MAX_ATTEMPTS : 1); attempt++) {
    const start = Math.floor(rng() * n);
    const blocked = new Set([start, ...nb[start]]);
    const pool = [];
    for (let i = 0; i < n; i++) if (!blocked.has(i)) pool.push(i);
    const isMine = new Uint8Array(n);
    for (let k = 0; k < mines; k++) {
      const j = k + Math.floor(rng() * (pool.length - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
      isMine[pool[k]] = 1;
    }
    board = { seed, w, h, mines, noGuess, start, isMine, counts: computeCounts(w, h, isMine), attempts: attempt };
    if (!noGuess) return { ...board, guaranteed: false };
    if (solve(board).solved) return { ...board, guaranteed: true };
  }
  return { ...board, guaranteed: false };
}

// Classic first-click safety: move a mine under the first click to the first
// free cell (scanning from the top-left), then recompute counts.
export function ensureSafe(board, i) {
  if (!board.isMine[i]) return board;
  const isMine = board.isMine.slice();
  isMine[i] = 0;
  for (let j = 0; j < isMine.length; j++) {
    if (j !== i && !isMine[j]) { isMine[j] = 1; break; }
  }
  return { ...board, isMine, counts: computeCounts(board.w, board.h, isMine) };
}

// Cells opened by revealing i: i itself, flooding outward through zeros.
export function floodReveal(board, open, i) {
  const nb = neighbors(board.w, board.h);
  const opened = [];
  const stack = [i];
  while (stack.length) {
    const j = stack.pop();
    if (open[j] || board.isMine[j]) continue;
    open[j] = 1;
    opened.push(j);
    if (board.counts[j] === 0) for (const k of nb[j]) if (!open[k]) stack.push(k);
  }
  return opened;
}

const HIDDEN = 0, OPEN = 1, MINE = 2;

// Plays the board from `start` using deductions only, never guessing.
// Rules: single-number constraints, pairwise constraint differences, the
// global mine count, and exhaustive enumeration of small frontier groups.
export function solve(board) {
  const { w, h, mines, isMine, counts, start } = board;
  const nb = neighbors(w, h);
  const n = w * h;
  const state = new Uint8Array(n);
  const open = new Uint8Array(n);
  let opened = 0, flagged = 0;

  const reveal = (i) => {
    if (state[i] !== HIDDEN) return true;
    if (isMine[i]) return false; // only reachable if a deduction were wrong
    for (const j of floodReveal(board, open, i)) { state[j] = OPEN; opened++; }
    return true;
  };
  const flag = (i) => { if (state[i] === HIDDEN) { state[i] = MINE; flagged++; } };

  reveal(start);
  const safeTotal = n - mines;

  while (opened < safeTotal) {
    // Constraints: hidden neighbours of each open number and their remaining mines.
    const cons = [];
    for (let i = 0; i < n; i++) {
      if (state[i] !== OPEN || counts[i] === 0) continue;
      const cells = [];
      let need = counts[i];
      for (const j of nb[i]) {
        if (state[j] === HIDDEN) cells.push(j);
        else if (state[j] === MINE) need--;
      }
      if (cells.length) cons.push({ cells, need });
    }

    const safe = new Set(), bomb = new Set();
    for (const { cells, need } of cons) {
      if (need === 0) cells.forEach((j) => safe.add(j));
      else if (need === cells.length) cells.forEach((j) => bomb.add(j));
    }

    if (!safe.size && !bomb.size) pairRule(cons, safe, bomb);

    if (!safe.size && !bomb.size) {
      let hidden = 0;
      for (let i = 0; i < n; i++) if (state[i] === HIDDEN) hidden++;
      const left = mines - flagged;
      for (let i = 0; i < n; i++) {
        if (state[i] !== HIDDEN) continue;
        if (left === 0) safe.add(i);
        else if (left === hidden) bomb.add(i);
      }
    }

    if (!safe.size && !bomb.size) enumerate(cons, state, mines - flagged, safe, bomb);

    if (!safe.size && !bomb.size) return { solved: false, state };
    bomb.forEach(flag);
    for (const i of safe) if (!reveal(i)) return { solved: false, state };
  }
  return { solved: true, state };
}

// For constraints A and B: mines(B\A) - mines(A\B) = B.need - A.need. If that
// difference equals |B\A|, B\A is all mines and A\B is all safe.
function pairRule(cons, safe, bomb) {
  const byCell = new Map();
  cons.forEach((con, k) => con.cells.forEach((j) => {
    if (!byCell.has(j)) byCell.set(j, []);
    byCell.get(j).push(k);
  }));
  for (let a = 0; a < cons.length; a++) {
    const A = cons[a];
    const setA = new Set(A.cells);
    const seen = new Set();
    for (const j of A.cells) {
      for (const b of byCell.get(j)) {
        if (b === a || seen.has(b)) continue;
        seen.add(b);
        const B = cons[b];
        const setB = new Set(B.cells);
        const bOnly = B.cells.filter((x) => !setA.has(x));
        const aOnly = A.cells.filter((x) => !setB.has(x));
        const d = B.need - A.need;
        if (bOnly.length && d === bOnly.length) {
          bOnly.forEach((x) => bomb.add(x));
          aOnly.forEach((x) => safe.add(x));
        } else if (!aOnly.length && d === 0) {
          bOnly.forEach((x) => safe.add(x));
        }
      }
    }
  }
}

const ENUM_LIMIT = 24; // max frontier cells per group to brute-force

// Splits the frontier into independent groups and enumerates every mine
// assignment of each small group; cells that agree in all of them are known.
// The global mine count prunes assignments when there are few mines left.
function enumerate(cons, state, minesLeft, safe, bomb) {
  const groups = frontierGroups(cons);
  let interior = 0;
  const inFrontier = new Set(groups.flatMap((g) => g.cells));
  for (let i = 0; i < state.length; i++) if (state[i] === HIDDEN && !inFrontier.has(i)) interior++;

  for (const g of groups) {
    if (g.cells.length > ENUM_LIMIT) continue;
    const idx = new Map(g.cells.map((x, k) => [x, k]));
    const gc = g.cons.map((c) => ({ cells: c.cells.map((x) => idx.get(x)), need: c.need }));
    const byCell = g.cells.map(() => []);
    gc.forEach((c, k) => c.cells.forEach((x) => byCell[x].push(k)));
    const assign = new Int8Array(g.cells.length).fill(-1);
    const mineCount = new Int32Array(g.cells.length);
    let solutions = 0;
    // Other groups can absorb mines, so only bound by what is left overall.
    const maxMines = minesLeft;
    const minMines = Math.max(0, minesLeft - interior - (inFrontier.size - g.cells.length));

    const ok = (k) => {
      for (const ci of byCell[k]) {
        const c = gc[ci];
        let m = 0, u = 0;
        for (const x of c.cells) { if (assign[x] === 1) m++; else if (assign[x] === -1) u++; }
        if (m > c.need || m + u < c.need) return false;
      }
      return true;
    };
    let placed = 0;
    const rec = (k) => {
      if (placed > maxMines) return;
      if (k === g.cells.length) {
        if (placed < minMines) return;
        solutions++;
        for (let x = 0; x < assign.length; x++) if (assign[x] === 1) mineCount[x]++;
        return;
      }
      for (const v of [0, 1]) {
        assign[k] = v;
        placed += v;
        if (ok(k)) rec(k + 1);
        placed -= v;
      }
      assign[k] = -1;
    };
    rec(0);
    if (!solutions) continue;
    g.cells.forEach((x, k) => {
      if (mineCount[k] === 0) safe.add(x);
      else if (mineCount[k] === solutions) bomb.add(x);
    });
  }
}

function frontierGroups(cons) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const c of cons) for (const x of c.cells) if (!parent.has(x)) parent.set(x, x);
  for (const c of cons) for (const x of c.cells.slice(1)) parent.set(find(x), find(c.cells[0]));
  const groups = new Map();
  for (const x of parent.keys()) {
    const root = find(x);
    if (!groups.has(root)) groups.set(root, { cells: [], cons: [] });
    groups.get(root).cells.push(x);
  }
  for (const c of cons) groups.get(find(c.cells[0])).cons.push(c);
  return [...groups.values()];
}
