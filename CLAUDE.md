# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

- `npm start` — static server at http://localhost:8000 (python3 http.server on `public/`).
- `npm test` — generator/solver tests via `node --test` (no dependencies).
- `docker compose up` — nginx serving `public/` on port 5000.

## Architecture

Static site, no backend, no build step:

- **`public/js/minesweeper.js`** — pure logic: `generate(seed, {w,h,mines}, noGuess)` (deterministic via FNV-hashed seed + mulberry32), `solve(board)`, `ensureSafe`, `floodReveal`, `neighbors`.
- **`public/js/main.js`** — all UI/game code (ES module).
- **`public/index.html`**, **`public/styles.css`** — markup and styles.

**Key design decisions:**
- Same seed + config + mode always produces the same board; mode is part of the hash, so a seed gives different boards in classic and no-guess.
- Classic is the default mode; no-guess is an opt-in toggle in the settings menu (stored in `localStorage` as `noGuess`).
- Every board has a `start` cell with a 3×3 mine-free area. No-guess mode only accepts the first reveal there; classic mode lets the first click go anywhere and moves a mine away if needed (`ensureSafe`).
- No-guess generation retries (up to `MAX_ATTEMPTS`) until `solve` clears the board using single constraints, pairwise constraint differences, the global mine count and brute-force enumeration of small frontier groups. If nothing is found (very dense custom boards), `guaranteed` is false and the UI says so.
- Wide boards are rendered transposed on portrait screens; cells keep their logical index in `data-i`.

**Frontend state (module globals in main.js):**
- `board` — `{ seed, w, h, mines, noGuess, start, isMine, counts, guaranteed }`
- `state[i]` — `0`=hidden, `1`=open, `2`=flagged
- `status` — `"ready" | "playing" | "won" | "lost"`; `flagMode` — tap flags instead of reveals
