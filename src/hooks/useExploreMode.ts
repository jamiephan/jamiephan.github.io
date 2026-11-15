import { useCallback, useEffect, useRef, useState } from "react";

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

interface ExploreModeOptions {
  onResetView: () => void;
}

/**
 * State and keyboard shortcuts for the "explore the universe" easter egg.
 *
 * - Shift + Q: enter explore mode (or re-open the help dialog)
 * - R: reset the camera
 * - Esc: leave explore mode
 */
export function useExploreMode({ onResetView }: ExploreModeOptions) {
  const [exploring, setExploring] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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
  }, []);

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
  }, [exploring, helpOpen, enter, exit, onResetView]);

  return {
    exploring,
    helpOpen,
    enter,
    exit,
    openHelp: useCallback(() => setHelpOpen(true), []),
    closeHelp: useCallback(() => setHelpOpen(false), []),
  };
}
