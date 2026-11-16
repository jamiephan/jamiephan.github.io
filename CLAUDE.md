# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Source for jamiephan.net: a React 19 + TypeScript personal site rendered over a real-time Three.js solar system. Includes a hidden "explore the universe" mode (<kbd>Shift</kbd>+<kbd>Q</kbd>) with focus/zoom, free flight and WebXR (VR). Deployed to GitHub Pages.

## Commands

Tooling is [Vite+](https://viteplus.dev/) (`vp`), which wraps Vite/Rolldown, Oxlint, Oxfmt, the type checker and Vitest. Package manager is pnpm (version pinned in `package.json` → `devEngines`), Node 24 (`.node-version`).

```sh
pnpm dev                              # dev server
pnpm check                            # format check + lint + type check (vp check) — what CI runs
pnpm test                             # all unit tests (vp test)
pnpm exec vp test src/scene/orbit.test.ts   # single test file
pnpm exec vp test -t "test name"      # filter by test name
pnpm build                            # client build + SSR build + prerender into dist/
pnpm preview                          # serve the production build
```

CI (`.github/workflows/deploy.yml`) runs `vp check`, `vp test`, `vp run build` on every push/PR and deploys `dist/` on `main`.

## Conventions enforced by config (`vite.config.ts`)

- Import test APIs and Vite config helpers from `vite-plus` (e.g. `import { describe, it, expect } from "vite-plus/test"`), not `vitest`/`vite` — the `vite-plus/prefer-vite-plus-imports` lint rule errors otherwise.
- Lint is type-aware and includes `jsx-a11y`; relative imports use explicit `.ts`/`.tsx` extensions.
- Tests live beside sources as `src/**/*.test.{ts,tsx}`.

## Architecture

**Rendering pipeline.** The page is prerendered at build time: `vp build` produces the client bundle, `vp build --ssr src/entry-server.tsx` produces a renderer using `react-dom/static`, and `scripts/prerender.ts` (run directly by Node) injects that HTML into `dist/index.html` at the `<!--app-html-->` placeholder and adds a font preload. `src/main.tsx` hydrates if `#root` has content, otherwise does a client render (dev). Anything rendered by `App` must therefore be SSR-safe — no `window`/`document` access during render.

**Content vs. 3D.** `src/content.tsx` holds all page copy and project lists. `App.test.tsx` statically renders the app and asserts invariants (single `h1`, labelled sections, only `https:`/`mailto:`/`#` links, no emoji characters) — keep content changes compatible with these.

**React ↔ Three.js boundary.** `components/SpaceBackground.tsx` lazily `import()`s `scene/SpaceScene.ts` after hydration so three.js lives in its own chunk and never blocks content; a CSS gradient shows until ready or if WebGL2 is unavailable. It exposes an imperative handle (`SpaceBackgroundHandle`: focus, zoom, sun angle, roll, VR, speed subscription) that `App.tsx` and the explore UI call, and passes `exploring`/`flying` props through to `SpaceScene.setExploring`/`setFlying`. Callbacks from the scene go through refs since the scene is created once.

**Keep UI-facing modules free of three.js.** `scene/bodies.ts` (focusable body list) and `scene/units.ts` (world units → km/s, light-seconds) are deliberately three-free so UI components can import them without pulling in the 3D chunk. Follow that pattern for anything the UI needs from the scene layer.

**Scene (`src/scene/`).** `SpaceScene.ts` is a framework-agnostic class owning its canvas, renderer, listeners and render loop (`dispose()` releases everything). Supporting modules split by concern: `layout.ts` (planet positions relative to Earth at the origin; Sun is a directional light along `SUN_DIRECTION`; distances compressed, sizes to scale with Earth radius = 4 units), `scrollOrbit.ts` (camera swing around Earth driven by page scroll, with distinct landscape/portrait endings), `flight.ts` (free-flight controller and obstacle avoidance), `xr.ts` (WebXR support/input), `materials.ts` (custom shader materials: uniforms and render state; the GLSL itself lives in `shaders/*.{vert,frag}.glsl`, imported with `?raw`, and shared snippets in `shaders/chunks/` are prepended via `glsl(...)` from `shaders/chunks.ts`), `postprocessing.ts`, `solarSystem.ts`, plus procedural `stars`, `nebula`, `nebulaClouds`, `galaxies`, `meteors`. Pure math pieces have unit tests.

**Scroll-driven camera.** The camera follows scroll position, so `main.tsx` forces scroll to the top on load and strips the URL hash; `hooks/useSmoothSnap.ts` handles section snapping.

**Textures.** `scene/textures.ts` maps each full texture in `assets/textures/` to a same-named low-res copy in `assets/textures/preview/` (via `import.meta.glob`). Previews load first; full-res swaps in on entering explore mode. An optional third tier in `assets/textures/hd/` (same file name, up to 8K) loads only for the body that's large on screen in explore/flight mode (`hdTextures.ts`; register it by passing `body` to `load`). A fourth, ultra tier (16384×8192, upscaled with Real-ESRGAN by `scripts/make-ultra-textures.py`) lives as 1024² tiles in `public/textures/ultra/<name>/<col>-<row>.webp` (listed in `ULTRA_MAPS` in `textures.ts`). When the HD body gets bigger still on screen (flying low, zooming right in), `ultraTextures.ts` streams a 4×4-tile window around the point being looked at; shaders lay it over the usual map with `ultraTexture(...)` from `shaders/chunks/ultra.glsl`, and each map's material needs the matching `ultraUniforms(name, texture)`. When adding a large texture, add a preview (and, for a body's surface, HD and ultra versions) with the same file name.

**Explore mode state.** `hooks/useExploreMode.ts` owns explore/help/flight state and shortcuts (Shift+Q, R reset, Esc exit). Flight requests fullscreen; leaving fullscreen ends flight.
