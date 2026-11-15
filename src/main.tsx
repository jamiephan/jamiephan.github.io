import "@fontsource-variable/open-sans";
import "./styles/global.css";

import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

// Always open at the top of the page, even on refresh or from a link with a #section:
// the 3D camera follows the scroll position, so the story should start from the beginning.
history.scrollRestoration = "manual";
if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
window.scrollTo(0, 0);

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// Production HTML is prerendered at build time (see scripts/prerender.ts); in dev it's empty.
if (container.firstElementChild) hydrateRoot(container, app);
else createRoot(container).render(app);
