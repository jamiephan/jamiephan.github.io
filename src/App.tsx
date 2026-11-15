import { useCallback, useMemo, useRef, useState } from "react";
import { ContentSection } from "./components/ContentSection.tsx";
import { ExploreDialog } from "./components/ExploreDialog.tsx";
import { ExploreToolbar, type ZoomControls } from "./components/ExploreToolbar.tsx";
import { SpaceBackground, type SpaceBackgroundHandle } from "./components/SpaceBackground.tsx";
import { sections, site } from "./content.tsx";
import { useExploreMode } from "./hooks/useExploreMode.ts";
import { DEFAULT_BODY, type BodyId } from "./scene/bodies.ts";

export function App() {
  const backgroundRef = useRef<SpaceBackgroundHandle>(null);
  const resetView = useCallback(() => backgroundRef.current?.resetView(), []);
  const { exploring, helpOpen, enter, exit, openHelp, closeHelp } = useExploreMode({
    onResetView: resetView,
  });
  const [focused, setFocused] = useState<BodyId>(DEFAULT_BODY);
  const focus = useCallback((id: BodyId) => {
    setFocused(id);
    backgroundRef.current?.focus(id);
  }, []);
  const zoom = useMemo<ZoomControls>(
    () => ({
      start: (direction) => backgroundRef.current?.startZoom(direction),
      stop: () => backgroundRef.current?.stopZoom(),
      step: (direction) => backgroundRef.current?.zoomStep(direction),
    }),
    [],
  );

  return (
    <>
      <SpaceBackground ref={backgroundRef} exploring={exploring} onFocusChange={setFocused} />

      <div className="page" inert={exploring}>
        <header className="hero">
          <h1>
            {site.name} <span aria-hidden="true">{site.emoji}</span>
          </h1>
          <p className="hero__tagline">{site.tagline}</p>
          <a className="hero__scroll" href={`#${sections[0]?.id ?? ""}`}>
            Scroll to explore <span aria-hidden="true">↓</span>
          </a>
        </header>

        <main>
          {sections.map((section, index) => (
            <ContentSection
              key={section.id}
              section={section}
              align={index % 2 === 0 ? "start" : "end"}
            />
          ))}
        </main>

        <footer className="footer">
          <p>Thank you for visiting my website.</p>
          <button type="button" className="easter-egg" onClick={enter}>
            Psst… try pressing <kbd>Shift</kbd> + <kbd>Q</kbd>, or click here!
          </button>
        </footer>
      </div>

      <ExploreDialog open={helpOpen} onClose={closeHelp} />
      {exploring && !helpOpen && (
        <ExploreToolbar
          focused={focused}
          onFocus={focus}
          zoom={zoom}
          onReset={resetView}
          onHelp={openHelp}
          onExit={exit}
        />
      )}
    </>
  );
}
