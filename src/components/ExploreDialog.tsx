import { useEffect, useId, useRef } from "react";

interface ExploreDialogProps {
  open: boolean;
  onClose: () => void;
}

const controls: [action: string, how: string][] = [
  ["Rotate", "Drag with mouse or one finger"],
  ["Zoom", "Mouse wheel / pinch / hold − +"],
  ["Pan", "Right-click drag or drag with two fingers"],
  ["Roll", "Hold Q / E or the roll buttons"],
  ["Fly to a planet", "Click or tap it, or pick from the list"],
];

export function ExploreDialog({ open, onClose }: ExploreDialogProps) {
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
      <h2 id={titleId}>Hehe, you found me!</h2>
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
        <button type="submit" className="button button--primary" autoFocus>
          Start exploring
        </button>
      </form>
    </dialog>
  );
}
