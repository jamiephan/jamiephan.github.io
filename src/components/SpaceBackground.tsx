import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { BodyId } from "../scene/bodies.ts";
import type { SpaceScene } from "../scene/SpaceScene.ts";

export interface SpaceBackgroundHandle {
  resetView: () => void;
  focus: (id: BodyId) => void;
  startZoom: (direction: 1 | -1) => void;
  stopZoom: () => void;
  zoomStep: (direction: 1 | -1) => void;
  setSunAngle: (degrees: number) => void;
  setRoll: (direction: -1 | 1, on: boolean) => void;
  /** Start VR (from a click or tap) / end it. Only while flying. */
  enterVR: () => void;
  exitVR: () => void;
  /** Flight speed updates (world units per second); returns an unsubscribe. */
  subscribeSpeed: (listener: (unitsPerSecond: number) => void) => () => void;
}

interface SpaceBackgroundProps {
  exploring: boolean;
  /** Free flight; only takes effect while exploring. */
  flying: boolean;
  /** Called when the scene changes focus itself (a planet was tapped, or the view was reset). */
  onFocusChange?: (id: BodyId) => void;
  /** Called when a VR session starts or ends. */
  onVRChange?: (inVR: boolean) => void;
  ref?: Ref<SpaceBackgroundHandle>;
}

type Status = "loading" | "ready" | "unsupported";

/**
 * Decorative 3D background. Three.js is loaded lazily after hydration so it never blocks
 * the page content; a CSS gradient is shown until it's ready (or if WebGL is unavailable).
 */
export function SpaceBackground({
  exploring,
  flying,
  onFocusChange,
  onVRChange,
  ref,
}: SpaceBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SpaceScene | null>(null);
  const exploringRef = useRef(exploring);
  // Read through a ref so the scene (created once) always calls the latest callback.
  const onFocusChangeRef = useRef(onFocusChange);
  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);
  const onVRChangeRef = useRef(onVRChange);
  useEffect(() => {
    onVRChangeRef.current = onVRChange;
  }, [onVRChange]);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let disposed = false;
    let scene: SpaceScene | undefined;

    import("../scene/SpaceScene.ts")
      .then(({ SpaceScene, isWebGL2Available }) => {
        const container = containerRef.current;
        if (disposed || !container) return;
        if (!isWebGL2Available()) {
          setStatus("unsupported");
          return;
        }
        scene = new SpaceScene(container, {
          onReady: () => !disposed && setStatus("ready"),
          onFocusChange: (id) => onFocusChangeRef.current?.(id),
          onVRChange: (inVR) => onVRChangeRef.current?.(inVR),
        });
        scene.setExploring(exploringRef.current);
        sceneRef.current = scene;
      })
      .catch((error: unknown) => {
        console.error("Failed to start the 3D background", error);
        if (!disposed) setStatus("unsupported");
      });

    return () => {
      disposed = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    exploringRef.current = exploring;
    sceneRef.current?.setExploring(exploring);
  }, [exploring]);

  // After the exploring effect, so flight never starts before explore mode has.
  useEffect(() => {
    sceneRef.current?.setFlying(flying);
  }, [flying]);

  useImperativeHandle(
    ref,
    () => ({
      resetView: () => sceneRef.current?.resetView(),
      focus: (id) => sceneRef.current?.focus(id),
      startZoom: (direction) => sceneRef.current?.startZoom(direction),
      stopZoom: () => sceneRef.current?.stopZoom(),
      zoomStep: (direction) => sceneRef.current?.zoomStep(direction),
      setSunAngle: (degrees) => sceneRef.current?.setSunAngle(degrees),
      setRoll: (direction, on) => sceneRef.current?.setRoll(direction, on),
      enterVR: () => {
        sceneRef.current
          ?.enterVR()
          .catch((error: unknown) => console.warn("Couldn't start VR", error));
      },
      exitVR: () => sceneRef.current?.exitVR(),
      subscribeSpeed: (listener) => sceneRef.current?.subscribeSpeed(listener) ?? (() => {}),
    }),
    [],
  );

  return <div ref={containerRef} className="space" data-status={status} aria-hidden="true" />;
}
