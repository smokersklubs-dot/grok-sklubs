/*
 * Portions adapted from Anil-matcha/Open-Generative-AI (https://github.com/Anil-matcha/Open-Generative-AI,
 * commit 6f726e6539b06bb2f4288f20480c116e7173a06d), Copyright (c) 2026 Open Generative AI Contributors, MIT License:
 * src/lib/promptUtils.js (CAMERA_MAP, LENS_MAP, FOCAL_PERSPECTIVE, APERTURE_EFFECT, buildNanoBananaPrompt) and the
 * camera-movement names of the "Motion Controls" effect in packages/studio/src/models.js.
 * Modified for Sklubot: keys turned into short ids with French and English labels (the owner's interface is French);
 * movements kept to plain cinematography terms (gimmick entries dropped); the prompt builder only APPENDS words to the
 * bot's own description and adds no "8K / award-winning" quality tags; no picture of the original (public/assets/cinema)
 * is used.
 *
 * Audit Open Generative AI §2 "Cinema Studio" / §5 item 14: words for the camera, lens, focal length, aperture and the
 * camera MOVEMENT, offered to video_generate (`camera_move`, `camera`, `lens`, `focal_mm`, `aperture`) and to the video
 * studio (docs/STUDIO-VIDEO.md). They are words in the prompt, not a provider parameter: every video model reads them.
 */

export interface CameraWord { id: string; fr: string; en: string; prompt: string }

/** Camera movements (plain film terms). */
export const CAMERA_MOVES: readonly CameraWord[] = [
  { id: "static", fr: "Plan fixe", en: "Static shot", prompt: "static locked-off camera" },
  { id: "dolly_in", fr: "Travelling avant", en: "Dolly in", prompt: "slow dolly in toward the subject" },
  { id: "dolly_out", fr: "Travelling arrière", en: "Dolly out", prompt: "slow dolly out away from the subject" },
  { id: "dolly_left", fr: "Travelling latéral gauche", en: "Dolly left", prompt: "lateral dolly moving left" },
  { id: "dolly_right", fr: "Travelling latéral droit", en: "Dolly right", prompt: "lateral dolly moving right" },
  { id: "dolly_zoom_in", fr: "Effet Vertigo (avant)", en: "Dolly zoom in", prompt: "dolly zoom in (vertigo effect)" },
  { id: "dolly_zoom_out", fr: "Effet Vertigo (arrière)", en: "Dolly zoom out", prompt: "dolly zoom out (vertigo effect)" },
  { id: "zoom_in", fr: "Zoom avant", en: "Zoom in", prompt: "smooth zoom in" },
  { id: "zoom_out", fr: "Zoom arrière", en: "Zoom out", prompt: "smooth zoom out" },
  { id: "crash_zoom_in", fr: "Zoom rapide avant", en: "Crash zoom in", prompt: "fast crash zoom in" },
  { id: "pan_left", fr: "Panoramique gauche", en: "Pan left", prompt: "camera pans left" },
  { id: "pan_right", fr: "Panoramique droit", en: "Pan right", prompt: "camera pans right" },
  { id: "whip_pan", fr: "Panoramique filé", en: "Whip pan", prompt: "fast whip pan" },
  { id: "tilt_up", fr: "Panoramique vers le haut", en: "Tilt up", prompt: "camera tilts up" },
  { id: "tilt_down", fr: "Panoramique vers le bas", en: "Tilt down", prompt: "camera tilts down" },
  { id: "crane_up", fr: "Grue montante", en: "Crane up", prompt: "crane shot rising up" },
  { id: "crane_down", fr: "Grue descendante", en: "Crane down", prompt: "crane shot descending" },
  { id: "overhead", fr: "Plongée verticale", en: "Overhead", prompt: "overhead top-down shot" },
  { id: "orbit", fr: "Tour à 360°", en: "360° orbit", prompt: "camera orbits 360 degrees around the subject" },
  { id: "arc", fr: "Arc autour du sujet", en: "Arc shot", prompt: "arc shot circling the subject" },
  { id: "handheld", fr: "Caméra à l'épaule", en: "Handheld", prompt: "handheld camera, natural shake" },
  { id: "tracking", fr: "Suivi du sujet", en: "Tracking shot", prompt: "tracking shot following the subject" },
  { id: "fpv_drone", fr: "Drone FPV", en: "FPV drone", prompt: "FPV drone flying through the scene" },
  { id: "dutch_angle", fr: "Plan incliné", en: "Dutch angle", prompt: "dutch angle, tilted horizon" },
  { id: "focus_shift", fr: "Bascule de mise au point", en: "Focus shift", prompt: "rack focus from foreground to background" },
  { id: "timelapse", fr: "Accéléré", en: "Timelapse", prompt: "timelapse" },
];

/** CAMERA_MAP. */
export const CAMERAS: readonly CameraWord[] = [
  { id: "modular_8k", fr: "Cinéma numérique 8K", en: "Modular 8K digital", prompt: "modular 8K digital cinema camera" },
  { id: "full_frame", fr: "Plein format numérique", en: "Full-frame cine digital", prompt: "full-frame digital cinema camera" },
  { id: "film_70mm", fr: "Pellicule 70 mm", en: "Grand format 70mm film", prompt: "grand format 70mm film camera" },
  { id: "s35", fr: "Studio Super 35", en: "Studio digital S35", prompt: "Super 35 studio digital camera" },
  { id: "film_16mm", fr: "Pellicule 16 mm", en: "Classic 16mm film", prompt: "classic 16mm film camera" },
  { id: "large_format", fr: "Grand format numérique", en: "Premium large format digital", prompt: "premium large-format digital cinema camera" },
];

/** LENS_MAP. */
export const LENSES: readonly CameraWord[] = [
  { id: "tilt", fr: "Objectif à bascule", en: "Creative tilt lens", prompt: "creative tilt lens effect" },
  { id: "compact_anamorphic", fr: "Anamorphique compact", en: "Compact anamorphic", prompt: "compact anamorphic lens" },
  { id: "macro", fr: "Macro extrême", en: "Extreme macro", prompt: "extreme macro lens" },
  { id: "prime_70s", fr: "Focale fixe années 70", en: "70s cinema prime", prompt: "1970s cinema prime lens" },
  { id: "anamorphic", fr: "Anamorphique classique", en: "Classic anamorphic", prompt: "classic anamorphic lens" },
  { id: "modern_prime", fr: "Focale fixe moderne", en: "Premium modern prime", prompt: "premium modern prime lens" },
  { id: "warm_prime", fr: "Focale fixe chaude", en: "Warm cinema prime", prompt: "warm-toned cinema prime lens" },
  { id: "swirl_bokeh", fr: "Bokeh tourbillon", en: "Swirl bokeh portrait", prompt: "swirl bokeh portrait lens" },
  { id: "vintage", fr: "Focale fixe vintage", en: "Vintage prime", prompt: "vintage prime lens" },
  { id: "halation", fr: "Filtre de diffusion", en: "Halation diffusion", prompt: "halation diffusion filter" },
  { id: "sharp", fr: "Focale fixe très nette", en: "Clinical sharp prime", prompt: "ultra-sharp clinical prime lens" },
];

/** FOCAL_PERSPECTIVE (mm). */
export const FOCALS: Readonly<Record<number, string>> = { 8: "ultra-wide perspective", 14: "wide-angle perspective", 24: "wide-angle dynamic perspective", 35: "natural cinematic perspective", 50: "standard portrait perspective", 85: "classic portrait perspective" };
/** APERTURE_EFFECT. */
export const APERTURES: Readonly<Record<string, string>> = { "f/1.4": "shallow depth of field, creamy bokeh", "f/4": "balanced depth of field", "f/11": "deep focus clarity, sharp foreground to background" };

const byId = (list: readonly CameraWord[], id: unknown) => (typeof id === "string" ? list.find((w) => w.id === id.trim().toLowerCase()) ?? null : null);

/**
 * The bot's description with the chosen camera words appended (adapted from buildNanoBananaPrompt). Unknown ids are
 * ignored; with nothing chosen the description comes back unchanged.
 */
export function cameraPrompt(base: string, o: { camera_move?: unknown; camera?: unknown; lens?: unknown; focal_mm?: unknown; aperture?: unknown }): string {
  const move = byId(CAMERA_MOVES, o.camera_move);
  const cam = byId(CAMERAS, o.camera);
  const lens = byId(LENSES, o.lens);
  const focal = Number(o.focal_mm);
  const perspective = FOCALS[focal] ?? "";
  const ap = typeof o.aperture === "string" ? APERTURES[o.aperture.trim()] ?? "" : "";
  const parts = [
    base.trim(),
    move ? `camera movement: ${move.prompt}` : "",
    cam ? `shot on a ${cam.prompt}` : "",
    lens || perspective ? `${lens ? `using a ${lens.prompt}` : "using a lens"}${perspective ? ` at ${focal}mm (${perspective})` : ""}` : "",
    ap ? `aperture ${String(o.aperture).trim()}, ${ap}` : "",
  ];
  return parts.filter((p) => p && p.trim() !== "").join(", ");
}

/** For the tool's schema and the studio: the ids the bot may pass. */
export const CAMERA_MOVE_IDS = CAMERA_MOVES.map((m) => m.id);
export const CAMERA_IDS = CAMERAS.map((m) => m.id);
export const LENS_IDS = LENSES.map((m) => m.id);
