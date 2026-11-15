import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { App } from "./App.tsx";
import { sections } from "./content.tsx";

const html = renderToStaticMarkup(<App />);

describe("App (static render)", () => {
  it("has exactly one h1", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it("renders a labelled section for every content section", () => {
    for (const { id, title } of sections) {
      expect(html).toContain(`<section id="${id}"`);
      expect(html).toContain(`aria-labelledby="${id}-title"`);
      expect(html).toContain(title.replace("&", "&amp;"));
    }
  });

  it("uses secure or in-page links only", () => {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(([, href]) => href);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^(https:\/\/|mailto:|#)/);
  });

  it("hides decorative emoji from assistive technology", () => {
    for (const { emoji } of sections) {
      expect(html).toContain(`<span aria-hidden="true">${emoji}</span>`);
    }
  });
});
