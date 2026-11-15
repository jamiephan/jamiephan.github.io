# jamiephan.net

Source for [jamiephan.net](https://jamiephan.net/), Jamie Phan's personal website: a React page over a real-time Three.js solar system (Earth, Moon, the other planets, an asteroid belt and a comet) against the Milky Way, with a hidden "explore the universe" easter egg (press <kbd>Shift</kbd> + <kbd>Q</kbd>).

## Stack

- [Vite+](https://viteplus.dev/) (`vp`): dev server, build (Vite + Rolldown), lint (Oxlint), format (Oxfmt), type check and tests (Vitest)
- React 19 + TypeScript
- Three.js, lazy-loaded so it never blocks the page content
- Build-time prerendering (`react-dom/static`), so the HTML is fully rendered for search engines and first paint
- Deployed to GitHub Pages by GitHub Actions

## Getting started

Requires Node.js 24 (see `.node-version`) and pnpm (the version is pinned in `package.json` → `devEngines`). With the [global `vp` CLI](https://viteplus.dev/guide/) installed, `vp install` handles both.

```sh
pnpm install     # or: vp install
pnpm dev         # start the dev server
pnpm check       # format check, lint and type check
pnpm test        # run unit tests
pnpm build       # production build + prerender into dist/
pnpm preview     # serve the production build
```

## Project layout

```
index.html                 HTML shell, SEO metadata and JSON-LD
public/                    Static files copied as-is (favicon, robots.txt, sitemap, CNAME…)
scripts/prerender.ts       Injects the server-rendered app into dist/index.html
src/
  content.tsx              All page copy and project lists: edit this to update the site
  App.tsx                  Page layout
  components/              UI components (sections, 3D background, explore-mode UI)
  hooks/useExploreMode.ts  Easter egg state and keyboard shortcuts
  scene/SpaceScene.ts      Three.js scene (framework-agnostic): layout, animation, adaptive resolution
  scene/materials.ts       GLSL shaders: Earth, clouds, atmospheric scattering, Moon, Saturn, sky, stars
  scene/solarSystem.ts     Other planets, asteroid belt and comet
  scene/stars.ts           Procedural starfield (magnitudes, black-body colours)
  assets/textures/         Planet and sky textures (see Credits)
  assets/textures/preview/ Low-res copies loaded first; full size loads on entering explore mode
  assets/textures/hd/      Up-to-8K maps, loaded only for the body being explored or flown close to
  styles/global.css        Global styles
vite.config.ts             Vite+ config (build, lint, fmt, test)
```

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`. It checks, tests and builds the site, then publishes `dist/` to GitHub Pages. Pull requests run the same checks without deploying.

> In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

## Credits

Planet and Milky Way textures are from [Solar System Scope](https://www.solarsystemscope.com/textures/) (based on NASA imagery), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). They were resized and re-encoded to WebP. Where no larger original exists, the HD maps were upscaled with [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) (`realesrgan-x4plus`, wrap-padded so the seam stays continuous): Jupiter and Saturn from 4K to 8K, Uranus and Neptune from 2K to 4K. Mercury's HD map was lightly denoised and its seam blended.
