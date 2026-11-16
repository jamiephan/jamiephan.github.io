/**
 * Low-resolution previews of the larger textures. The scene loads these first so it can fade in
 * quickly (planets are only a few dozen pixels across in the default view), and swaps in the
 * full-resolution files once the visitor starts exploring and can zoom in.
 *
 * Previews live in `assets/textures/preview/` with the same file name as the full texture.
 */
const full = import.meta.glob<string>("../assets/textures/*.{webp,png}", {
  eager: true,
  query: "?url",
  import: "default",
});
const previews = import.meta.glob<string>("../assets/textures/preview/*.{webp,png}", {
  eager: true,
  query: "?url",
  import: "default",
});

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const previewByName = new Map(Object.entries(previews).map(([path, url]) => [fileName(path), url]));

/** Full-resolution URL → preview URL, for textures that have a preview. */
const previewByUrl = new Map<string, string>();
for (const [path, url] of Object.entries(full)) {
  const preview = previewByName.get(fileName(path));
  if (preview) previewByUrl.set(url, preview);
}

/** The preview to load first for a full-resolution texture URL, if there is one. */
export const previewFor = (url: string): string | undefined => previewByUrl.get(url);

/**
 * Up-to-8K versions in `assets/textures/hd/` (same file name), loaded only for the body being
 * explored or flown close to; see `hdTextures.ts`.
 */
const hd = import.meta.glob<string>("../assets/textures/hd/*.{webp,png}", {
  eager: true,
  query: "?url",
  import: "default",
});
const hdByName = new Map(Object.entries(hd).map(([path, url]) => [fileName(path), url]));
const hdByUrl = new Map<string, string>();
for (const [path, url] of Object.entries(full)) {
  const detail = hdByName.get(fileName(path));
  if (detail) hdByUrl.set(url, detail);
}

/** The HD version of a full-resolution texture URL, if there is one. */
export const hdFor = (url: string): string | undefined => hdByUrl.get(url);

/**
 * Maps with an ultra-HD tier: 16384×8192, upscaled with Real-ESRGAN and cut into 1024² tiles in
 * `public/textures/ultra/<name>/<col>-<row>.webp` (row 0 at the top). Too many files to bundle,
 * so they're served as they are. The scene streams in a few tiles around the point being looked
 * at, close up; see `ultraTextures.ts`.
 */
export const ULTRA_MAPS: readonly string[] = [
  "earth-day",
  "earth-night",
  "earth-clouds",
  "earth-normal",
  "earth-specular",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
];

const ultraByUrl = new Map<string, string>();
for (const [path, url] of Object.entries(full)) {
  const name = fileName(path).replace(/\.\w+$/, "");
  if (ULTRA_MAPS.includes(name)) {
    ultraByUrl.set(url, `${import.meta.env.BASE_URL}textures/ultra/${name}/`);
  }
}

/** The folder (URL ending in `/`) of the ultra-HD tiles for a full-resolution texture URL. */
export const ultraFor = (url: string): string | undefined => ultraByUrl.get(url);
