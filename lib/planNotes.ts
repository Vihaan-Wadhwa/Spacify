// What a visitor writes in their own words ("my mother can't climb stairs, we want an open kitchen"), turned into
// preferences the planner can act on. This keyword reading always runs; the local model adds its own reading on
// top when it's available (lib/server/planAi.ts), and the two are merged.

export const PREF_KEYS = [
  "elderGround",
  "openKitchen",
  "parking",
  "homeOffice",
  "bigLiving",
  "quietBedrooms",
  "kitchenFront",
  "attachedBaths",
  "utility",
  "vastu",
  "noVastu",
] as const;
export type PrefKey = (typeof PREF_KEYS)[number];
export type Prefs = Partial<Record<PrefKey, boolean>>;

/** How each preference is described back to the visitor ("Understood: …"). */
export const PREF_TEXT: Record<PrefKey, string> = {
  elderGround: "A bedroom with its own bathroom on the ground floor, for someone who can't use the stairs",
  openKitchen: "An open kitchen joined to the living or dining room",
  parking: "Car parking at the front",
  homeOffice: "A study to work from",
  bigLiving: "A bigger living room",
  quietBedrooms: "Bedrooms away from the road",
  kitchenFront: "The kitchen near the entrance",
  attachedBaths: "A bathroom attached to every bedroom",
  utility: "A utility area for washing beside the kitchen",
  vastu: "Following Vastu",
  noVastu: "Not following Vastu",
};

const PATTERNS: [PrefKey, RegExp][] = [
  ["elderGround", /\b(parents?|mother|father|mom|mum|dad|elder(ly)?|grand(ma|pa|mother|father|parents)?|senior|old age|knee|wheel ?chair|walker|can'?t climb|cannot climb|unable to climb|no stairs|avoid stairs|ground floor bedroom|amma|appa|ammi|abba|nani|nana|dadi|dada|maa|papa|ajji|thatha|paati|buzurg|bade log|seedhi|sidhi)\b/i],
  ["openKitchen", /\bopen(-| )?(plan )?kitchen|\bkitchen\b[^.,;]{0,15}\bopen\b|american kitchen|island kitchen\b/i],
  ["parking", /\b(car|cars|parking|garage|carport|bike|bikes|scooters?|scooty|two.?wheelers?|four.?wheelers?|vehicles?|gaadi)\b/i],
  ["homeOffice", /\b(home ?office|office|work(ing)? from home|wfh|study room|workspace|work space|library|tuition|(class(es)?|clinic|business|consult(ing|ations)?) from home)\b/i],
  ["bigLiving", /\b(big|bigger|large|larger|spacious|huge|bada|badi)\b[^.,;]{0,12}\b(living|hall|drawing|lounge)\b|\b(living|hall|drawing)\b[^.,;]{0,15}\b(big|bigger|large|spacious|huge)\b|\b(gatherings?|parties|joint family|big family|large family|festivals?|host(ing)?|entertain(ing)?)\b|\b(many|lots of|often have) guests\b/i],
  ["quietBedrooms", /\b(quiet|noise|noisy|traffic|peaceful|calm|light sleepers?|busy (road|street))\b/i],
  ["kitchenFront", /\bkitchen\b.{0,30}\b(front|near (the )?(entrance|door|road|gate))\b/i],
  ["attachedBaths", /\b(attached|en.?suite)\b.{0,30}\b(bath|toilet|washroom|bathroom)s?|\b(every|each|all)\b.{0,20}\b(bed)?rooms?\b.{0,30}\b(bath|toilet|washroom|bathroom)/i],
  ["utility", /\b(utility|wash(ing)? area|washing machine|laundry|dhobi|drying)\b/i],
];

/** Things people ask for that the planner can't draw yet, with how to say so. */
const UNSUPPORTED: [RegExp, string][] = [
  [/\b(swimming )?pool\b/i, "a swimming pool"],
  [/\b(lift|elevator)\b/i, "a lift"],
  [/\bbasement\b/i, "a basement"],
  [/\b(garden|lawn|landscap)/i, "a garden (the open plot around the house is left free for one)"],
  [/\b(gym|home theat(er|re)|cinema)\b/i, "a gym or home theatre"],
  [/\b(courtyard|aangan|angan)\b/i, "a courtyard"],
  [/\b(servant|maid|driver)('?s)? (room|quarter)/i, "a staff room"],
];

export function readNotes(text: string | undefined): { prefs: Prefs; unmet: string[] } {
  const t = (text ?? "").trim();
  const prefs: Prefs = {};
  if (!t) return { prefs, unmet: [] };
  for (const [key, re] of PATTERNS) {
    const m = re.exec(t);
    if (!m) continue;
    // "we don't have a car", "no need for a study": a mention just after a negation doesn't count
    // (except where the negation is the wish itself, as in "no stairs for my mother").
    const before = t.slice(Math.max(0, m.index - 24), m.index);
    if (key !== "elderGround" && /\b(no|not|don'?t|do not|never|without|nor|neither)\b[^.,;]*$/i.test(before)) continue;
    prefs[key] = true;
  }
  if (/\b(no|don'?t|do not|not|without|skip|ignore|avoid)\b.{0,25}\bvaa?stu\b|\bvaa?stu\b.{0,20}\b(not|isn'?t|doesn'?t|no need|optional)\b/i.test(t)) prefs.noVastu = true;
  else if (/\bvaa?stu\b/i.test(t)) prefs.vastu = true;
  const unmet = UNSUPPORTED.filter(([re]) => re.test(t)).map(([, say]) => say);
  return { prefs, unmet };
}

export function mergePrefs(a: Prefs, b: Prefs): Prefs {
  const out: Prefs = { ...a };
  for (const k of PREF_KEYS) if (b[k]) out[k] = true;
  if (out.noVastu) delete out.vastu;
  return out;
}
