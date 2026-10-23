import type { LiftSet } from "./types.ts";

/** Parses "8x60, 8x60, 7x62.5" (also "8@60", "8*60", decimal comma) into sets. Returns null if any token is invalid. */
export function parseSets(text: string): LiftSet[] | null {
  const tokens = text.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const out: LiftSet[] = [];
  for (const tok of tokens) {
    const m = tok.match(/^(\d{1,3})\s*[x×@*]\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:kg)?$/i);
    if (!m) return null;
    const reps = Number(m[1]);
    const kg = Number(m[2].replace(",", "."));
    if (reps < 1 || reps > 100 || kg < 0 || kg > 500) return null;
    out.push({ reps, kg });
  }
  return out;
}

export const COMMON_EXERCISES = ["Back squat", "Bench press", "Barbell row", "Romanian deadlift", "Overhead press", "Pull-up", "Lunge", "Dumbbell curl", "Triceps pushdown", "Plank"];

const GROUP_RULES: [RegExp, string][] = [
  [/tricep|\bdips?\b|pushdown|skull/i, "Arms"],
  [/\bleg\b|squat|lunge|calf|calves|deadlift|\brdl\b|romanian|hack|glute|hip thrust/i, "Legs"],
  [/bicep|curl/i, "Arms"],
  [/rear delt|face pull|lateral|front raise|shoulder|overhead press|\bohp\b|military/i, "Shoulders"],
  [/\bpec\b|chest|bench|\bfly\b|flye|push-?up|incline/i, "Chest"],
  [/\brow|pulldown|pull-?up|pull up|\blat\b|chin-?up|shrug/i, "Back"],
  [/plank|crunch|\babs?\b|core/i, "Core"],
];
/** Best-guess muscle group for an exercise name. Used when the name is not in the built-in list. */
export function muscleGroup(name: string): string {
  for (const [re, g] of GROUP_RULES) if (re.test(name)) return g;
  return "Other";
}
