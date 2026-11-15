import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { formatScientific, toRealSpeed } from "../scene/units.ts";

/** Subscribes to the flight speed (world units per second); returns an unsubscribe. */
export type SpeedSubscription = (listener: (unitsPerSecond: number) => void) => () => void;

interface FlightControlsProps {
  onRollLeft: (on: boolean) => void;
  onRollRight: (on: boolean) => void;
  onEnd: () => void;
  /** Whether the control hints are tucked away behind the (i) button. */
  hintsHidden: boolean;
  onHintsHiddenChange: (hidden: boolean) => void;
  /** VR controls, where a headset is available. */
  vr: { active: boolean; enter: () => void; exit: () => void } | null;
  subscribeSpeed: SpeedSubscription;
}

/**
 * Overlay while flying: a short reminder of the controls, and on touch screens hold-to-use
 * roll buttons (pointing the device steers, holding the screen boosts). CSS shows whichever
 * set applies. Clicking the reminder tucks it away behind an (i) button; H toggles it too.
 */
export function FlightControls({
  onRollLeft,
  onRollRight,
  onEnd,
  hintsHidden,
  onHintsHiddenChange,
  vr,
  subscribeSpeed,
}: FlightControlsProps) {
  const endRef = useRef<HTMLButtonElement>(null);
  const hideRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  /** Set when the focused toggle button is about to be swapped out (not on mount). */
  const moveFocus = useRef(false);

  // The page is inert while exploring; give keyboard users somewhere to land.
  useEffect(() => endRef.current?.focus(), []);

  // The button that was clicked disappears; put focus on the one that replaced it.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (hintsHidden ? showRef : hideRef).current?.focus();
  }, [hintsHidden]);

  // H toggles the hints, for when the mouse is captured and can't click the buttons.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "KeyH" || event.repeat || event.ctrlKey || event.metaKey || event.altKey)
        return;
      event.preventDefault();
      // If the button being swapped out has focus, hand it on rather than drop it.
      const focused = document.activeElement;
      moveFocus.current = focused === hideRef.current || focused === showRef.current;
      onHintsHiddenChange(!hintsHidden);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hintsHidden, onHintsHiddenChange]);

  const toggleHints = (hidden: boolean) => {
    moveFocus.current = true;
    onHintsHiddenChange(hidden);
  };

  return (
    <div className="flight-controls">
      {/* Top right, out of the way of the thumbs; first in the DOM, so first for focus too. */}
      <button
        ref={endRef}
        type="button"
        className="button button--primary corner-button"
        onClick={onEnd}
      >
        End flight
      </button>
      {vr && (
        <button
          type="button"
          className="button corner-button corner-button--start"
          onClick={vr.active ? vr.exit : vr.enter}
        >
          {vr.active ? "Exit VR" : "Enter VR"}
        </button>
      )}

      <Speedometer subscribe={subscribeSpeed} />

      {/* The tips, or the (i) that brings them back, sit between the roll buttons. */}
      <div className="flight-controls__actions">
        <HoldButton
          className="button--icon flight-controls__touch flight-controls__roll"
          label="Roll left"
          icon={
            <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          }
          onChange={onRollLeft}
        />
        {!hintsHidden && (
          // The tips themselves are the button: tap or click them to tuck them away.
          <button
            ref={hideRef}
            type="button"
            className="flight-controls__hints"
            title="Hide these tips"
            onClick={() => toggleHints(true)}
          >
            <span className="flight-controls__hint flight-controls__hint--keyboard">
              <kbd>W</kbd> <kbd>S</kbd> thrust · <kbd>A</kbd> <kbd>D</kbd> strafe · <kbd>Q</kbd>{" "}
              <kbd>E</kbd> roll · mouse or arrow keys steer · <kbd>Shift</kbd> boost · <kbd>H</kbd>{" "}
              hide · <kbd>Esc</kbd> end
            </span>
            <span className="flight-controls__hint flight-controls__hint--touch">
              Point your phone or drag to look around · hold the screen to boost · arrows roll
            </span>
            {vr && (
              <span className="flight-controls__hint">
                In VR: left stick flies where you look · right stick turns · trigger boosts
              </span>
            )}
            <span className="visually-hidden"> (hide these tips)</span>
          </button>
        )}
        {hintsHidden && (
          <button
            ref={showRef}
            type="button"
            className="button button--icon flight-controls__info"
            aria-label="Show flight controls"
            aria-expanded="false"
            onClick={() => toggleHints(false)}
          >
            <svg className="button-icon" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" />
              <path d="M8 7.25v4" />
              <circle className="button-icon__dot" cx="8" cy="4.75" r="0.4" />
            </svg>
          </button>
        )}
        <HoldButton
          className="button--icon flight-controls__touch flight-controls__roll"
          label="Roll right"
          icon={
            <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          }
          onChange={onRollRight}
        />
      </div>
    </div>
  );
}

/**
 * Speed in light-seconds per second (so 1 is the speed of light), with km/s underneath. It
 * updates several times a second, so it writes to the DOM directly instead of re-rendering,
 * and isn't a live region (a screen reader would never stop reading it).
 */
function Speedometer({ subscribe }: { subscribe: SpeedSubscription }) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const detailRef = useRef<HTMLSpanElement>(null);

  useEffect(
    () =>
      subscribe((unitsPerSecond) => {
        const { lightSecondsPerSecond, kmPerSecond } = toRealSpeed(unitsPerSecond);
        if (valueRef.current)
          valueRef.current.textContent = formatScientific(lightSecondsPerSecond);
        if (detailRef.current)
          detailRef.current.textContent = `${Math.round(kmPerSecond).toLocaleString()} km/s`;
      }),
    [subscribe],
  );

  return (
    <p className="speedometer">
      <span className="speedometer__label">Speed</span>
      <span className="speedometer__reading">
        <span ref={valueRef} className="speedometer__value">
          0
        </span>{" "}
        <abbr className="speedometer__unit" title="light-seconds per second">
          ls/s
        </abbr>
      </span>
      <span ref={detailRef} className="speedometer__detail">
        0 km/s
      </span>
    </p>
  );
}

interface HoldButtonProps {
  label: string;
  /** Shown instead of the label (which then becomes the accessible name). */
  icon?: ReactNode;
  className: string;
  onChange: (on: boolean) => void;
}

/** Active only while held down, by finger, mouse, or Space / Enter. */
function HoldButton({ label, icon, className, onChange }: HoldButtonProps) {
  // Release on unmount (e.g. ending the flight mid-press) so the ship doesn't keep going.
  useEffect(() => () => onChange(false), [onChange]);

  const onKey = (down: boolean) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!event.repeat) onChange(down);
  };

  return (
    <button
      type="button"
      className={`button flight-controls__hold ${className}`}
      onPointerDown={(event) => {
        // Keep receiving events even if the finger slides off the button.
        event.currentTarget.setPointerCapture(event.pointerId);
        onChange(true);
      }}
      onPointerUp={() => onChange(false)}
      onPointerCancel={() => onChange(false)}
      onLostPointerCapture={() => onChange(false)}
      onKeyDown={onKey(true)}
      onKeyUp={onKey(false)}
      onBlur={() => onChange(false)}
      aria-label={icon ? label : undefined}
    >
      {icon ?? label}
    </button>
  );
}
