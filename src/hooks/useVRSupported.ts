import { useEffect, useState } from "react";
import { isVRSupported } from "../scene/xr.ts";

/** Whether immersive VR is available, re-checked when a headset is connected or removed. */
export function useVRSupported(): boolean {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
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
  }, []);

  return supported;
}
