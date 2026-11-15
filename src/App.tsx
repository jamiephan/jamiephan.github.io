import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { ContentSection } from "./components/ContentSection.tsx";
import { ExploreDialog } from "./components/ExploreDialog.tsx";
import { ExploreToolbar, type ZoomControls } from "./components/ExploreToolbar.tsx";
import { FlightControls } from "./components/FlightControls.tsx";
import { SpaceBackground, type SpaceBackgroundHandle } from "./components/SpaceBackground.tsx";
import { sections, site } from "./content.tsx";
import { useExploreMode } from "./hooks/useExploreMode.ts";
import { DEFAULT_BODY, type BodyId } from "./scene/bodies.ts";

const firstSection = sections[0]?.id ?? "";

/**
 * iOS only reports device tilt after the visitor allows it, and the request must come straight
 * from a tap. Elsewhere this does nothing. If it's refused, dragging still steers.
 */
const requestTiltPermission = (): void => {
  if (typeof DeviceOrientationEvent === "undefined") return;
  const { requestPermission } = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };
  requestPermission?.call(DeviceOrientationEvent).catch(() => {});
};

/**
 * Scroll to the first section without adding `#about` to the URL, so a refresh starts at the
 * top again. The `href` stays as a fallback before the page has hydrated.
 */
const scrollToContent = (event: MouseEvent<HTMLAnchorElement>) => {
  const target = document.getElementById(firstSection);
  if (!target) return;
  event.preventDefault();
  // Smooth or instant follows the CSS `scroll-behavior`, which respects reduced motion.
  target.scrollIntoView();
  // Move keyboard and screen reader focus along with the scroll, like a normal in-page link.
  target.focus({ preventScroll: true });
};

export function App() {
  const backgroundRef = useRef<SpaceBackgroundHandle>(null);
  const [sunAngle, setSunAngle] = useState(0);
  const moveSun = useCallback((degrees: number) => {
    setSunAngle(degrees);
    backgroundRef.current?.setSunAngle(degrees);
  }, []);
  const resetView = useCallback(() => {
    backgroundRef.current?.resetView();
    moveSun(0);
  }, [moveSun]);
  const { exploring, helpOpen, flying, enter, exit, openHelp, closeHelp, startFlight, endFlight } =
    useExploreMode({ onResetView: resetView });
  const beginFlight = useCallback(() => {
    requestTiltPermission();
    startFlight();
  }, [startFlight]);
  const rollLeft = useCallback((on: boolean) => backgroundRef.current?.setRoll(-1, on), []);
  const rollRight = useCallback((on: boolean) => backgroundRef.current?.setRoll(1, on), []);
  // Leaving explore mode puts the Sun back (the scene does the same), so the slider starts
  // from the default next time.
  const [wasExploring, setWasExploring] = useState(exploring);
  if (exploring !== wasExploring) {
    setWasExploring(exploring);
    if (!exploring) setSunAngle(0);
  }
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
      <SpaceBackground
        ref={backgroundRef}
        exploring={exploring}
        flying={flying}
        onFocusChange={setFocused}
      />

      <div className="page" inert={exploring}>
        <header className="hero">
          <h1>
            <span className="hero__name">{site.name}</span>
          </h1>
          <p className="hero__tagline">{site.tagline}</p>
          <a className="hero__scroll" href={`#${firstSection}`} onClick={scrollToContent}>
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
      {flying && <FlightControls onRollLeft={rollLeft} onRollRight={rollRight} onEnd={endFlight} />}
      {exploring && !helpOpen && !flying && (
        <ExploreToolbar
          focused={focused}
          onFocus={focus}
          zoom={zoom}
          sunAngle={sunAngle}
          onSunAngle={moveSun}
          onStartFlight={beginFlight}
          onReset={resetView}
          onHelp={openHelp}
          onExit={exit}
        />
      )}
    </>
  );
}
