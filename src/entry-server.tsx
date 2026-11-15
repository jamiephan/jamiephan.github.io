import { StrictMode } from "react";
import { prerender } from "react-dom/static";
import { App } from "./App.tsx";

/** Render the app to static HTML at build time for fast first paint and SEO. */
export async function render(): Promise<string> {
  const { prelude } = await prerender(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return new Response(prelude).text();
}
