import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampConfig, computeCounts, DIFFICULTIES, ensureSafe, generate, neighbors, solve } from '../public/js/minesweeper.js';

const mineTotal = (b) => b.isMine.reduce((a, v) => a + v, 0);

test('same seed and config give the same board', () => {
  const a = generate('abc', DIFFICULTIES.expert, true);
  const b = generate('abc', DIFFICULTIES.expert, true);
  assert.deepEqual(a.isMine, b.isMine);
  assert.equal(a.start, b.start);
  assert.notDeepEqual(generate('abd', DIFFICULTIES.expert, true).isMine, a.isMine);
  assert.notDeepEqual(generate('abc', DIFFICULTIES.expert, false).isMine, a.isMine);
});

test('mine count, counts and safe start opening', () => {
  for (const cfg of Object.values(DIFFICULTIES)) {
    for (const noGuess of [false, true]) {
      for (let s = 0; s < 10; s++) {
        const b = generate(`seed${s}`, cfg, noGuess);
        assert.equal(mineTotal(b), cfg.mines);
        assert.deepEqual(b.counts, computeCounts(b.w, b.h, b.isMine));
        assert.equal(b.counts[b.start], 0);
        assert.equal(b.isMine[b.start], 0);
      }
    }
  }
});

test('no-guess boards are solvable from the start cell by logic alone', () => {
  for (const cfg of Object.values(DIFFICULTIES)) {
    for (let s = 0; s < 15; s++) {
      const b = generate(`ng${s}`, cfg, true);
      assert.ok(b.guaranteed, `${cfg.w}x${cfg.h} seed ng${s}`);
      const { solved, state } = solve(b);
      assert.ok(solved);
      // Every safe cell was opened and no mine ever was.
      state.forEach((v, i) => assert.equal(v === 1, b.isMine[i] === 0));
    }
  }
});

test('solver refuses a 50/50', () => {
  // Mines at 2 and 7 wall off cells 0 and 1; one of them holds the third
  // mine and no openable cell can tell which.
  const w = 5, h = 5;
  const isMine = new Uint8Array(w * h);
  for (const i of [0, 2, 7]) isMine[i] = 1;
  const board = { w, h, mines: 3, isMine, counts: computeCounts(w, h, isMine), start: 24 };
  assert.equal(solve(board).solved, false);
  // Moving the pocket mine next to a revealable cell makes it decidable.
  const forced = new Uint8Array(w * h);
  forced[0] = 1;
  assert.equal(solve({ ...board, mines: 1, isMine: forced, counts: computeCounts(w, h, forced) }).solved, true);
});

test('dense boards fall back without a guarantee', () => {
  const b = generate('dense', { w: 8, h: 8, mines: 40 }, true);
  assert.equal(b.guaranteed, false);
  assert.equal(mineTotal(b), 40);
});

test('ensureSafe moves a mine away from the first click', () => {
  const b = generate('x', DIFFICULTIES.beginner, false);
  const mine = b.isMine.indexOf(1);
  const safe = ensureSafe(b, mine);
  assert.equal(safe.isMine[mine], 0);
  assert.equal(mineTotal(safe), b.mines);
  assert.deepEqual(safe.counts, computeCounts(b.w, b.h, safe.isMine));
  assert.equal(ensureSafe(b, b.start), b);
});

test('config is clamped', () => {
  assert.deepEqual(clampConfig({ w: 1, h: 999, mines: -5 }), { w: 5, h: 50, mines: 1 });
  assert.deepEqual(clampConfig({ w: 5, h: 5, mines: 999 }), { w: 5, h: 5, mines: 16 });
  assert.equal(neighbors(3, 3)[4].length, 8);
  assert.equal(neighbors(3, 3)[0].length, 3);
});
