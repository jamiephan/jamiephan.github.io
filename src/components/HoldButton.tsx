import { useEffect, type KeyboardEvent, type ReactNode } from "react";

interface HoldButtonProps {
  label: string;
  /** Shown instead of the label (which then becomes the accessible name). */
  icon?: ReactNode;
  className: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}

/** Active only while held down, by finger, mouse, or Space / Enter. */
export function HoldButton({ label, icon, className, disabled, onChange }: HoldButtonProps) {
  // Release on unmount (e.g. ending the flight mid-press) so the ship doesn't keep going.
  useEffect(() => () => onChange(false), [onChange]);
  // Disabled mid-press: no more pointer or key events will arrive to release it.
  useEffect(() => {
    if (disabled) onChange(false);
  }, [disabled, onChange]);

  const onKey = (down: boolean) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!event.repeat) onChange(down);
  };

  return (
    <button
      type="button"
      className={`button ${className}`}
      disabled={disabled}
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

/** Curved arrows for the roll buttons: -1 turns anticlockwise (left), +1 clockwise (right). */
export function RollIcon({ direction }: { direction: -1 | 1 }) {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      {direction < 0 ? (
        <>
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </>
      ) : (
        <>
          <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </>
      )}
    </svg>
  );
}
