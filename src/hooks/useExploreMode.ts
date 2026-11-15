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
}

/**
 * State and keyboard shortcuts for the "explore the universe" easter egg.
 *
 * - Shift + Q: enter explore mode (or re-open the help dialog)
 * - R: reset the camera
 * - Esc: leave explore mode (or end flight mode, which is started from the help dialog)
 */
export function useExploreMode({ onResetView }: ExploreModeOptions) {
  const [exploring, setExploring] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [flying, setFlying] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

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
  }, []);
  const endFlight = useCallback(() => setFlying(false), []);

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
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [exploring, helpOpen, flying, enter, exit, onResetView]);

  return {
    exploring,
    helpOpen,
    flying,
    enter,
    exit,
    startFlight,
    endFlight,
    openHelp: useCallback(() => setHelpOpen(true), []),
    closeHelp: useCallback(() => setHelpOpen(false), []),
  };
}
