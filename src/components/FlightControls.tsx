import { useEffect, useRef, type KeyboardEvent } from "react";

interface FlightControlsProps {
  onRollLeft: (on: boolean) => void;
  onRollRight: (on: boolean) => void;
  onEnd: () => void;
}

/**
 * Overlay while flying: a short reminder of the controls, and on touch screens hold-to-use
 * roll buttons (pointing the device steers, holding the screen boosts). CSS shows whichever
 * set applies.
 */
export function FlightControls({ onRollLeft, onRollRight, onEnd }: FlightControlsProps) {
  const endRef = useRef<HTMLButtonElement>(null);

  // The page is inert while exploring; give keyboard users somewhere to land.
  useEffect(() => endRef.current?.focus(), []);

  return (
    <div className="flight-controls">
      {/* Top right, out of the way of the thumbs; first in the DOM, so first for focus too. */}
      <button
        ref={endRef}
        type="button"
        className="button button--primary flight-controls__end"
        onClick={onEnd}
      >
        End flight
      </button>

      <p className="flight-controls__hint flight-controls__hint--keyboard">
        <kbd>W</kbd> <kbd>S</kbd> thrust · <kbd>A</kbd> <kbd>D</kbd> strafe · <kbd>Q</kbd>{" "}
        <kbd>E</kbd> roll · mouse or arrow keys steer · <kbd>Shift</kbd> boost · <kbd>Esc</kbd> end
      </p>
      <p className="flight-controls__hint flight-controls__hint--touch">
        Point your phone or drag to look around · hold the screen to boost · arrows roll
      </p>

      <div className="flight-controls__actions">
        <HoldButton
          className="flight-controls__touch flight-controls__roll"
          label="Roll left"
          symbol="↺"
          onChange={onRollLeft}
        />
        <HoldButton
          className="flight-controls__touch flight-controls__roll"
          label="Roll right"
          symbol="↻"
          onChange={onRollRight}
        />
      </div>
    </div>
  );
}

interface HoldButtonProps {
  label: string;
  /** Shown instead of the label (which then becomes the accessible name). */
  symbol?: string;
  className: string;
  onChange: (on: boolean) => void;
}

/** Active only while held down, by finger, mouse, or Space / Enter. */
function HoldButton({ label, symbol, className, onChange }: HoldButtonProps) {
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
      aria-label={symbol ? label : undefined}
    >
      {symbol ? <span aria-hidden="true">{symbol}</span> : label}
    </button>
  );
}
