/**
 * Injects the server-rendered app into the client build's index.html.
 * Run after `vp build` and `vp build --ssr src/entry-server.tsx --outDir dist-ssr`.
 */
import { readdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const htmlFile = new URL("dist/index.html", root);
const ssrDir = new URL("dist-ssr/", root);
const placeholder = "<!--app-html-->";

const { render } = (await import(new URL("entry-server.js", ssrDir).href)) as {
  render: () => Promise<string>;
};

const template = await readFile(htmlFile, "utf8");
if (!template.includes(placeholder)) {
  throw new Error(`Placeholder ${placeholder} not found in dist/index.html`);
}

// Preload the Latin font so it downloads alongside the CSS instead of after it.
const latinFont = (await readdir(new URL("dist/assets/", root))).find((file) =>
  /^open-sans-latin-wght-normal-.+\.woff2$/.test(file),
);
if (!latinFont) throw new Error("Latin font not found in dist/assets");
const fontPreload = `<link rel="preload" href="/assets/${latinFont}" as="font" type="font/woff2" crossorigin>`;

const html = template
  .replace("</title>", `</title>\n    ${fontPreload}`)
  .replace(placeholder, await render());
await writeFile(htmlFile, html);
await rm(ssrDir, { recursive: true, force: true });

console.log("✓ Prerendered dist/index.html");
