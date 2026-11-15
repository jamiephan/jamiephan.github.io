import { useCallback, useEffect, useRef, useState } from "react";

/** Inputs that don't take typed text, so shortcuts still work while they have focus. */
const NON_TEXT_INPUTS = new Set(["range", "radio", "checkbox", "button", "submit", "reset"]);

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target.isContentEditable || ["TEXTAREA", "SELECT"].includes(target.tagName);
};

interface ExploreModeOptions {
  onResetView: () => void;
  /** Q / E held down (or let go): roll the view left (-1) or right (+1). */
  onRoll: (direction: -1 | 1, on: boolean) => void;
}

/** Physical keys, like flight mode's, so they sit in the same place on any layout. */
const ROLL_KEYS: Record<string, -1 | 1> = { KeyQ: -1, KeyE: 1 };

/**
 * State and keyboard shortcuts for the "explore the universe" easter egg.
 *
 * - Shift + Q: enter explore mode (or re-open the help dialog)
 * - R: reset the camera
 * - Q / E (held): roll the view
 * - Esc: leave explore mode (or end flight mode, which is started from the toolbar)
 *
 * Flight goes fullscreen (where the browser allows it). Leaving fullscreen ends the flight,
 * since the browser keeps Esc for itself while fullscreen.
 */
export function useExploreMode({ onResetView, onRoll }: ExploreModeOptions) {
  const [exploring, setExploring] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [flying, setFlying] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** Whether flight mode put the page into fullscreen (so it should take it out again). */
  const fullscreenRef = useRef(false);
  const flyingRef = useRef(false);
  useEffect(() => {
    flyingRef.current = flying;
  }, [flying]);

  const enter = useCallback(() => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      returnFocusRef.current = document.activeElement;
    }
    setExploring(true);
    setHelpOpen(true);
  }, []);

  const exit = useCallback(() => {
    setExploring(false);
    setHelpOpen(false);
    setFlying(false);
  }, []);

  const startFlight = useCallback(() => {
    setHelpOpen(false);
    setFlying(true);
    // Must happen right here, in the click: browsers only allow fullscreen from a gesture.
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
      root
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          // The flight may already be over by the time the browser switches.
          if (flyingRef.current) fullscreenRef.current = true;
          else document.exitFullscreen().catch(() => {});
        })
        .catch(() => {});
    }
  }, []);
  const endFlight = useCallback(() => setFlying(false), []);

  /** Drop out of fullscreen but keep flying (e.g. before handing over to a VR headset). */
  const leaveFullscreen = useCallback(() => {
    // Cleared first so the fullscreenchange handler below doesn't take it as "end the flight".
    fullscreenRef.current = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  // Leave fullscreen when the flight ends, if it was the flight that entered it.
  useEffect(() => {
    if (flying || !fullscreenRef.current) return;
    fullscreenRef.current = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [flying]);

  // Esc while fullscreen only leaves fullscreen (the page never sees it): end the flight too.
  useEffect(() => {
    if (!flying) return;
    const onChange = () => {
      if (document.fullscreenElement || !fullscreenRef.current) return;
      fullscreenRef.current = false;
      setFlying(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [flying]);

  // Restore focus to wherever the user was before exploring.
  useEffect(() => {
    if (exploring) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [exploring]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
      const key = event.key.toLowerCase();

      // While flying, the keyboard drives the ship; only Esc does anything here.
      if (flying) {
        if (key === "escape") {
          event.preventDefault();
          setFlying(false);
        }
        return;
      }

      if (event.shiftKey && !event.altKey && key === "q") {
        event.preventDefault();
        if (exploring) setHelpOpen(true);
        else enter();
        return;
      }

      // Everything else only applies while exploring with the help dialog closed
      // (the native <dialog> handles Esc itself while it's open).
      if (!exploring || helpOpen) return;

      if (key === "escape") {
        event.preventDefault();
        exit();
      } else if (key === "r" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        onResetView();
      } else if (event.code in ROLL_KEYS && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        onRoll(ROLL_KEYS[event.code]!, true);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [exploring, helpOpen, flying, enter, exit, onResetView, onRoll]);

  // Let go of Q / E: on key up, or when the keys stop applying (the help opened, a flight
  // started, explore mode ended, or the window lost focus and won't see the key up).
  const rollActive = exploring && !helpOpen && !flying;
  useEffect(() => {
    if (!rollActive) return;
    const release = () => {
      onRoll(-1, false);
      onRoll(1, false);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const direction = ROLL_KEYS[event.code];
      if (direction) onRoll(direction, false);
    };
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      release();
    };
  }, [rollActive, onRoll]);

  return {
    exploring,
    helpOpen,
    flying,
    enter,
    exit,
    startFlight,
    endFlight,
    leaveFullscreen,
    openHelp: useCallback(() => setHelpOpen(true), []),
    closeHelp: useCallback(() => setHelpOpen(false), []),
  };
}
