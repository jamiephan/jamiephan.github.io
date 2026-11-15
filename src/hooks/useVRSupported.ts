import { useEffect, useState } from "react";
import { isVRSupported } from "../scene/xr.ts";

/**
 * Whether immersive VR is available, re-checked when a headset is connected or removed.
 *
 * Only asks while `enabled`: touching `navigator.xr` at all makes the browser keep the page out
 * of the back/forward cache, so a normal visit shouldn't. Once asked, the answer is kept.
 */
export function useVRSupported(enabled: boolean): boolean {
  const [supported, setSupported] = useState(false);
  const [asked, setAsked] = useState(false);
  if (enabled && !asked) setAsked(true);

  useEffect(() => {
    if (!asked) return;
    const xr = navigator.xr;
    if (!xr) return;
    let current = true;
    const check = () => void isVRSupported().then((value) => current && setSupported(value));
    check();
    xr.addEventListener("devicechange", check);
    return () => {
      current = false;
      xr.removeEventListener("devicechange", check);
    };
  }, [asked]);

  return supported;
}
