import "@fontsource-variable/open-sans";
import "./styles/global.css";

import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// Production HTML is prerendered at build time (see scripts/prerender.ts); in dev it's empty.
if (container.firstElementChild) hydrateRoot(container, app);
else createRoot(container).render(app);
