/**
 * Injects the server-rendered app into the client build's index.html.
 * Run after `vp build` and `vp build --ssr src/entry-server.tsx --outDir dist-ssr`.
 */
import { readFile, rm, writeFile } from "node:fs/promises";

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

await writeFile(htmlFile, template.replace(placeholder, await render()));
await rm(ssrDir, { recursive: true, force: true });

console.log("✓ Prerendered dist/index.html");
