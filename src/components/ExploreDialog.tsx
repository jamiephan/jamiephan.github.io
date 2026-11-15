import { useEffect, useId, useRef } from "react";

interface ExploreDialogProps {
  open: boolean;
  onClose: () => void;
  /** Flight mode is only offered here, as a little extra for those who read the controls. */
  onStartFlight: () => void;
}

const controls: [action: string, how: string][] = [
  ["Rotate", "Drag with mouse or one finger"],
  ["Zoom", "Mouse wheel / pinch / hold − +"],
  ["Pan", "Right-click drag or drag with two fingers"],
  ["Fly to a planet", "Click or tap it, or pick from the list"],
  ["Move the Sun", "Drag the Sun position slider"],
  ["Reset view", "R / Reset button"],
  ["Return to the page", "Esc"],
];

export function ExploreDialog({ open, onClose, onStartFlight }: ExploreDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} className="explore-dialog" aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>
        Hehe, you found me! <span aria-hidden="true">👀</span>
      </h2>
      <p>You can now fully control the universe.</p>
      <dl className="explore-dialog__controls">
        {controls.map(([action, how]) => (
          <div key={action}>
            <dt>{action}</dt>
            <dd>{how}</dd>
          </div>
        ))}
      </dl>
      <form method="dialog">
        <button type="button" className="button" onClick={onStartFlight}>
          <span aria-hidden="true">🚀</span> Flight mode
        </button>
        <button type="submit" className="button button--primary" autoFocus>
          Start exploring
        </button>
      </form>
    </dialog>
  );
}
