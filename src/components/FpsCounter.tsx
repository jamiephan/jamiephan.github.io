import { useEffect, useState } from "react";

/** How often the shown frame rate is refreshed (ms). */
const SAMPLE_MS = 500;

/** A tiny frame-rate readout in the bottom-left corner, for debugging explore and flight mode. */
export function FpsCounter() {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    let frames = 0;
    let start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      frames++;
      if (now - start >= SAMPLE_MS) {
        setFps(Math.round((frames * 1000) / (now - start)));
        frames = 0;
        start = now;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <output className="fps-counter" aria-hidden="true">
      {fps ?? "–"} fps
    </output>
  );
}
