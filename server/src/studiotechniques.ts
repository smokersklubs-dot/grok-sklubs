/** Stored per shot. An absent technique preserves the original Studio rendering. */
export const studioTechniques = [
  "retro-collage",
  "drawn-stroke",
  "math-geometry",
  "procedural-illustration",
  "motion-timing",
  "canvas-animation",
  "expressive-character",
  "moving-paint",
  "doodle-timelapse",
] as const;

export type StudioTechnique = (typeof studioTechniques)[number];

export function isStudioTechnique(value: unknown): value is StudioTechnique {
  return studioTechniques.some((technique) => technique === value);
}

/** The offline demo only selects an animation when the creation request names it. */
const demoNames: Record<StudioTechnique, RegExp> = {
  "retro-collage": /collage|papier decoupe|paper cutout/,
  "drawn-stroke": /trait par trait|stroke by stroke|handdraw/,
  "math-geometry": /geometr|manim|pythagor/,
  "procedural-illustration": /procedur/,
  "motion-timing": /motion design|motion timing/,
  "canvas-animation": /canvas|canevas|javascript/,
  "expressive-character": /personnage expressif|expressive character/,
  "moving-paint": /peinture animee|tableau anime|moving paint|huashu/,
  "doodle-timelapse": /doodle|croquis accelere|timelapse/,
};
export function demoVideoTechnique(subject: string): StudioTechnique | undefined {
  const normalized = subject.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return studioTechniques.find(id => normalized.includes(id) || demoNames[id].test(normalized));
}
