/**
 * Bodies the camera can focus on in explore mode. Kept free of three.js so the UI can list
 * them without loading the 3D chunk.
 */
export const BODIES = [
  { id: "earth", label: "Earth" },
  { id: "moon", label: "Moon" },
  { id: "mercury", label: "Mercury" },
  { id: "venus", label: "Venus" },
  { id: "mars", label: "Mars" },
  { id: "jupiter", label: "Jupiter" },
  { id: "saturn", label: "Saturn" },
  { id: "uranus", label: "Uranus" },
  { id: "neptune", label: "Neptune" },
  { id: "comet", label: "Comet" },
] as const;

export type BodyId = (typeof BODIES)[number]["id"];

export const DEFAULT_BODY: BodyId = "earth";
