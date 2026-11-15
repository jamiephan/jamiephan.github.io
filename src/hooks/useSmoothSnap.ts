import { useEffect } from "react";

/** The same screens that get CSS scroll snapping (see `global.css`). */
const DESKTOP_QUERY = "(width >= 48rem) and (hover: hover) and (pointer: fine)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** How long one glide from section to section takes. */
const DURATION_MS = 450;
/**
 * A pause longer than this between wheel events starts a new gesture. Short enough that a quick
 * second flick counts, long enough to cover the notches of one flick and trackpad inertia.
 */
const GESTURE_GAP_MS = 120;
/**
 * A jump in wheel speed this big is a new swipe, even mid-inertia (inertia only slows down) —
 * but not in the first moments of a swipe, while it's still speeding up.
 */
const GESTURE_SURGE = 1.5;
const GESTURE_RAMP_MS = 150;
/** Slack for sub-pixel scroll positions. */
const EPSILON = 2;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** For a glide extended mid-flight: it's already moving, so don't ease in from a standstill. */
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** Scroll positions to settle on: the top of the hero and each section, then the page bottom. */
const snapPoints = (selector: string): number[] => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const tops = Array.from(
    document.querySelectorAll<HTMLElement>(selector),
    (el) => el.getBoundingClientRect().top + window.scrollY,
  );
  return [...new Set([...tops, max].map((y) => Math.round(Math.min(Math.max(y, 0), max))))].sort(
    (a, b) => a - b,
  );
};

/**
 * On desktop, each wheel gesture glides the page to the next (or previous) section with an eased
 * animation, instead of the browser's own quick snap. Flicking again mid-glide carries on to the
 * section after. A section taller than the screen scrolls normally until its edge is reached.
 * Keyboard and scrollbar scrolling keep the CSS snap.
 *
 * Middle-click autoscroll moves freely: snapping is off from the middle click until the next
 * wheel scroll or key press, so the page stays wherever the visitor stops it.
 */
export function useSmoothSnap(selector: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window.matchMedia !== "function") return;
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    const root = document.documentElement;

    let frame = 0;
    let lastWheel = 0;
    let lastDelta = 0;
    // The glide in progress, if any.
    let glide: { target: number; down: boolean } | null = null;
    // Whether the current wheel gesture has already started (or extended) a glide.
    let handled = false;
    let handledAt = 0;

    const stop = () => {
      cancelAnimationFrame(frame);
      glide = null;
      root.classList.remove("is-gliding");
    };

    const endFreeScroll = () => root.classList.remove("is-free-scrolling");

    const glideTo = (target: number, down: boolean, ease: (t: number) => number) => {
      cancelAnimationFrame(frame);
      const start = window.scrollY;
      const startTime = performance.now();
      glide = { target, down };
      // CSS snapping and smooth scrolling would fight every frame of the animation.
      root.classList.add("is-gliding");
      const step = (now: number) => {
        const t = Math.min((now - startTime) / DURATION_MS, 1);
        window.scrollTo({ top: start + (target - start) * ease(t), behavior: "instant" });
        if (t < 1) frame = requestAnimationFrame(step);
        else stop();
      };
      frame = requestAnimationFrame(step);
    };

    /** Where a gesture goes from a resting position, or null to leave it to native scrolling. */
    const targetFrom = (y: number, down: boolean, points: number[]): number | null => {
      const next = down
        ? points.find((p) => p > y + EPSILON)
        : points.findLast((p) => p < y - EPSILON);
      if (next === undefined) return null;

      // Inside a section taller than the screen: scroll normally until its edge is on screen.
      const current = points.findLast((p) => p <= y + EPSILON) ?? 0;
      const following = points.find((p) => p > y + EPSILON) ?? current;
      const oversized = following - current > window.innerHeight + EPSILON;
      if (oversized && down && y + window.innerHeight < following - EPSILON) return null;
      if (oversized && !down && y > current + EPSILON) return null;
      return next;
    };

    const onWheel = (event: WheelEvent) => {
      if (!desktop.matches || reducedMotion.matches || event.ctrlKey) return;
      endFreeScroll();
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

      const now = performance.now();
      const delta = Math.abs(event.deltaY);
      const surge = delta > lastDelta * GESTURE_SURGE && now - handledAt > GESTURE_RAMP_MS;
      const newGesture = now - lastWheel > GESTURE_GAP_MS || surge;
      lastWheel = now;
      lastDelta = delta;
      if (newGesture) handled = false;

      // The rest of a gesture that already moved the page (incl. trackpad inertia): swallow it.
      if (handled) {
        if (glide) event.preventDefault();
        return;
      }

      const down = event.deltaY > 0;
      const points = snapPoints(selector);

      const current = glide;
      if (current) {
        event.preventDefault();
        handled = true;
        handledAt = now;
        // Same way: carry on to the section after the one we're heading for. Reversing: turn
        // back to the nearest section that way. Either way, without easing in again.
        const from = current.down === down ? current.target : window.scrollY;
        const next = down
          ? points.find((p) => p > from + EPSILON)
          : points.findLast((p) => p < from - EPSILON);
        if (next === undefined) return;
        // Don't fly past a tall section: stop at its top so it can be read.
        const sectionEnd = points.find((p) => p > current.target + EPSILON);
        const tall =
          sectionEnd !== undefined && sectionEnd - current.target > window.innerHeight + EPSILON;
        if (current.down && down && tall) return;
        glideTo(next, down, easeOutCubic);
        return;
      }

      const target = targetFrom(window.scrollY, down, points);
      if (target === null) return;
      event.preventDefault();
      handled = true;
      handledAt = now;
      glideTo(target, down, easeInOutCubic);
    };

    const onPointerDown = (event: PointerEvent) => {
      // Grabbing the scrollbar takes over from the glide.
      if (glide) stop();
      // Middle click starts autoscroll, which would otherwise be pulled back to a section.
      if (event.button === 1) root.classList.add("is-free-scrolling");
    };
    const onKeyDown = () => {
      if (glide) stop();
      endFreeScroll();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      stop();
      endFreeScroll();
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selector, enabled]);
}
