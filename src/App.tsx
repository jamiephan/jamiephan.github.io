import { useCallback, useMemo, useRef, useState } from "react";
import { ContentSection } from "./components/ContentSection.tsx";
import { ExploreDialog } from "./components/ExploreDialog.tsx";
import { ExploreToolbar, type ZoomControls } from "./components/ExploreToolbar.tsx";
import { FlightControls } from "./components/FlightControls.tsx";
import { FpsCounter } from "./components/FpsCounter.tsx";
import { SpaceBackground, type SpaceBackgroundHandle } from "./components/SpaceBackground.tsx";
import { sections, site } from "./content.tsx";
import { useExploreMode } from "./hooks/useExploreMode.ts";
import { useSmoothSnap } from "./hooks/useSmoothSnap.ts";
import { useVRSupported } from "./hooks/useVRSupported.ts";
import { DEFAULT_BODY, type BodyId } from "./scene/bodies.ts";

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

export function App() {
  const backgroundRef = useRef<SpaceBackgroundHandle>(null);
  const [sunAngle, setSunAngle] = useState(0);
  const moveSun = useCallback((degrees: number) => {
    setSunAngle(degrees);
    backgroundRef.current?.setSunAngle(degrees);
  }, []);
  // The scene glides the Sun home along with the camera on reset; the slider follows it
  // (in whole degrees, matching its step, so the page only re-renders when the value moves).
  const resetView = useCallback(() => backgroundRef.current?.resetView(), []);
  const followSun = useCallback((degrees: number) => setSunAngle(Math.round(degrees)), []);
  // While a reset animates, the toolbar is locked apart from "Back to page" and "Controls".
  const [resetting, setResetting] = useState(false);
  const roll = useCallback(
    (direction: -1 | 1, on: boolean) => backgroundRef.current?.setRoll(direction, on),
    [],
  );
  const {
    exploring,
    helpOpen,
    flying,
    enter,
    exit,
    openHelp,
    closeHelp,
    startFlight,
    endFlight,
    leaveFullscreen,
  } = useExploreMode({ onResetView: resetView, onRoll: roll });
  const beginFlight = useCallback(() => {
    requestTiltPermission();
    startFlight();
  }, [startFlight]);
  // Desktop wheel scrolling glides from section to section (not while the page is hidden).
  useSmoothSnap(".hero, .section", !exploring);
  const vrSupported = useVRSupported(exploring);
  const [inVR, setInVR] = useState(false);
  // Remembered between flights, so hiding the hints once is enough for the visit.
  const [flightHintsHidden, setFlightHintsHidden] = useState(false);
  const enterVR = useCallback(() => {
    // Fullscreen and an immersive session don't mix well: drop out of fullscreen first.
    leaveFullscreen();
    backgroundRef.current?.enterVR();
  }, [leaveFullscreen]);
  const exitVR = useCallback(() => backgroundRef.current?.exitVR(), []);
  const rollLeft = useCallback((on: boolean) => roll(-1, on), [roll]);
  const rollRight = useCallback((on: boolean) => roll(1, on), [roll]);
  const subscribeSpeed = useCallback(
    (listener: (unitsPerSecond: number) => void) =>
      backgroundRef.current?.subscribeSpeed(listener) ?? (() => {}),
    [],
  );
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
        onVRChange={setInVR}
        onSunAngleChange={followSun}
        onResettingChange={setResetting}
      />

      <div className="page" inert={exploring}>
        <header className="hero">
          <h1>
            <span className="hero__name">{site.name}</span>
          </h1>
          <p className="hero__tagline">{site.tagline}</p>
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
          <p>
            Thank you for visiting my website. (<a href={site.links.source}>Source code</a>)
          </p>
          <button type="button" className="easter-egg" onClick={enter}>
            Psst… try pressing <kbd>Shift</kbd> + <kbd>Q</kbd>, or click here!
          </button>
        </footer>
      </div>

      <ExploreDialog open={helpOpen} onClose={closeHelp} />
      {exploring && <FpsCounter />}
      {flying && (
        <FlightControls
          onRollLeft={rollLeft}
          onRollRight={rollRight}
          onEnd={endFlight}
          hintsHidden={flightHintsHidden}
          onHintsHiddenChange={setFlightHintsHidden}
          vr={vrSupported ? { active: inVR, enter: enterVR, exit: exitVR } : null}
          subscribeSpeed={subscribeSpeed}
        />
      )}
      {exploring && !helpOpen && !flying && (
        <ExploreToolbar
          focused={focused}
          onFocus={focus}
          zoom={zoom}
          onRollLeft={rollLeft}
          onRollRight={rollRight}
          sunAngle={sunAngle}
          onSunAngle={moveSun}
          locked={resetting}
          onStartFlight={beginFlight}
          onReset={resetView}
          onHelp={openHelp}
          onExit={exit}
        />
      )}
    </>
  );
}
