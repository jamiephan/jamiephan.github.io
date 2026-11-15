import { useEffect, useId, useRef, type PointerEvent } from "react";
import { BODIES, type BodyId } from "../scene/bodies.ts";

export interface ZoomControls {
  /** Begin a continuous zoom while a button is held: +1 in, -1 out. */
  start: (direction: 1 | -1) => void;
  stop: () => void;
  /** One discrete step (keyboard activation). */
  step: (direction: 1 | -1) => void;
}

interface ExploreToolbarProps {
  focused: BodyId;
  onFocus: (id: BodyId) => void;
  zoom: ZoomControls;
  /** Degrees the Sun has been moved round from its default position (−180 to 180). */
  sunAngle: number;
  onSunAngle: (degrees: number) => void;
  onStartFlight: () => void;
  onReset: () => void;
  onHelp: () => void;
  onExit: () => void;
}

/**
 * On-screen controls while exploring: pick a body to fly to, hold-to-zoom buttons, and the
 * usual reset / help / exit. Sized for touch so the easter egg works just as well on phones.
 */
export function ExploreToolbar({
  focused,
  onFocus,
  zoom,
  sunAngle,
  onSunAngle,
  onStartFlight,
  onReset,
  onHelp,
  onExit,
}: ExploreToolbarProps) {
  const exitRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLFieldSetElement>(null);
  const name = useId();

  // The page content is inert while exploring, so move focus somewhere useful.
  useEffect(() => exitRef.current?.focus(), []);

  // Keep the selected body visible in the scrolling list (e.g. after tapping a planet).
  useEffect(() => {
    pickerRef.current
      ?.querySelector(`input[value="${focused}"]`)
      ?.closest("label")
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [focused]);

  return (
    <div className="explore-controls">
      {/* Top corners, first in the DOM so they come first for focus too. */}
      <button
        ref={exitRef}
        type="button"
        className="button button--primary corner-button corner-button--start"
        onClick={onExit}
      >
        Back to page
      </button>
      {/* Same spot as "End flight", so the two swap places. */}
      <button type="button" className="button corner-button" onClick={onStartFlight}>
        Flight mode
      </button>

      <fieldset ref={pickerRef} className="focus-picker">
        <legend className="visually-hidden">Fly to</legend>
        {BODIES.map(({ id, label }) => (
          <label key={id} className="focus-picker__option">
            <input
              type="radio"
              name={name}
              value={id}
              checked={focused === id}
              onChange={() => onFocus(id)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      <label className="sun-control">
        <span className="sun-control__label">Sun position</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={sunAngle}
          aria-valuetext={describeSunAngle(sunAngle)}
          onChange={(event) => onSunAngle(event.currentTarget.valueAsNumber)}
        />
        <output className="sun-control__value" aria-hidden="true">
          {sunAngle > 0 ? "+" : ""}
          {sunAngle}°
        </output>
      </label>

      <div className="explore-actions">
        <ZoomButton zoom={zoom} direction={-1} label="Zoom out" />
        <ZoomButton zoom={zoom} direction={1} label="Zoom in" />
        <button type="button" className="button" onClick={onReset}>
          Reset
        </button>
        <button type="button" className="button" onClick={onHelp}>
          Controls
        </button>
      </div>
    </div>
  );
}

/** Spoken value for the Sun slider, e.g. "45 degrees clockwise". */
const describeSunAngle = (degrees: number): string =>
  degrees === 0
    ? "Default position"
    : `${Math.abs(degrees)} degrees ${degrees > 0 ? "anticlockwise" : "clockwise"}`;

interface ZoomButtonProps {
  zoom: ZoomControls;
  direction: 1 | -1;
  label: string;
}

/** Press and hold to keep zooming; a tap, click or keypress zooms one step. */
function ZoomButton({ zoom, direction, label }: ZoomButtonProps) {
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // Keep receiving events (and so stop zooming) even if the finger slides off the button.
    event.currentTarget.setPointerCapture(event.pointerId);
    zoom.start(direction);
  };

  return (
    <button
      type="button"
      className="button button--icon explore-zoom"
      aria-label={label}
      onPointerDown={start}
      onPointerUp={zoom.stop}
      onPointerCancel={zoom.stop}
      onLostPointerCapture={zoom.stop}
      // Keyboard activation has no pointer events (`detail` is 0): zoom one step instead.
      onClick={(event) => event.detail === 0 && zoom.step(direction)}
    >
      {/* Drawn rather than typed: text glyphs sit wherever the font's metrics put them. */}
      <svg className="explore-zoom__icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d={direction === 1 ? "M3 8h10M8 3v10" : "M3 8h10"} />
      </svg>
    </button>
  );
}
