# Minesweeper

Ad-free minesweeper with seeded boards and an optional **no-guess mode** (off by default; toggle it in the settings menu): every board can be cleared from the marked start cell by logic alone.

Static site (HTML/CSS/vanilla JS, no build step); board generation and the no-guess solver run client-side.

## Run

```sh
docker compose up -d --build   # nginx on port 5000 (expects the external `proxy` network)
npm start                      # → http://localhost:8000 (python3 static server)
```

## Test

```sh
npm test                       # generator + solver tests (node --test, no deps)
```

## Layout

| Path | Purpose |
| --- | --- |
| `public/js/minesweeper.js` | Seeded PRNG, board generator, no-guess solver |
| `public/js/main.js` | Game state, rendering, input, timer |
| `public/styles.css` | All styles |
| `Dockerfile`, `nginx.conf`, `docker-compose.yml` | Container serving the static site via nginx |
