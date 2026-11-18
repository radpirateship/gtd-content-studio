// lib/collection-category.ts
// Single source of truth for hub assignment. Used by /api/collections/sync-shopify
// and anywhere else a collection needs a category.
//
// Order matters: the first matching rule wins, so the most specific patterns
// (clinical modalities, named equipment classes) are tested before the broad
// ones. There is no silent default — anything unmatched returns 'Unsorted' so
// it surfaces in the queue instead of being buried in Wellness.

export type Category = 'Saunas' | 'Recovery' | 'Fitness' | 'Clinical' | 'Wellness' | 'Unsorted'

/** The five real hubs. Anything else in ppw_collections.category ("Type Parents"
 *  has been seen) is a grouping label, not a hub, and must not be used as one. */
export const VALID_HUBS: ReadonlySet<string> = new Set(['Saunas', 'Recovery', 'Fitness', 'Clinical', 'Wellness'])
export function asHub(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim()
  const hit = Array.from(VALID_HUBS).find((h) => h.toLowerCase() === v.toLowerCase())
  return hit ?? null
}

const RULES: Array<[Category, RegExp]> = [
  // Operational — not content destinations
  ['Unsorted', /^(non-bb|truemed-eligible|optimization|all|frontpage)$/],

  // Saunas — before Recovery so "sauna-steam" style handles land here
  ['Saunas', /sauna|steam|banya|hammam|loyly|infrared|barrel|emf-(?!protection)|chimney|outdoor-shower/],

  // Clinical — rehab, therapy modalities, diagnostics, mobility, patient equipment
  ['Clinical', /clinical|treatment-table|dynamometer|force-plate|traction|electrotherapy|therapeutic-ultrasound|electromyograph|shockwave|laser-therapy|iastm|range-of-motion|cpm-machine|standing-frame|rollator|wheelchair|mobility-aid|adjustable-bed|blood-flow-restriction|athlete-(management|optimization|performance)|prosthe|orthotic|patient|rehab/],

  // Recovery
  ['Recovery', /plunge|chiller|cryo|hyperbaric|sensory|float|massage|percussion|red-light|compression|contrast-therapy|hot-tub|heating-pad|therapy-sleeve|neck-training|back-stretcher|recovery/],

  // Fitness — cardio, strength, accessories, sports
  ['Fitness', /treadmill|elliptical|exercise-bike|climber|climbing|rowing|stair|cardio|jump|pilates|reformer|cadillac|trapeze|rack|cage|bench|barbell|dumbbell|kettlebell|plate|cable|gym|weight|sled|plyo|swedish|ladder|lacrosse|pickleball|reaction|timing|sport|fitness|martial|specialty-training|ergometer|stepper|lateral-trainer|balance|exercise-mat|pedometer|arms-|core-|leg-|chest-|back-shoulder|hip-glute|equipment/],

  // Wellness — explicit, never a catch-all
  ['Wellness', /water|air-purif|filter|ioniz|hydrogen|reverse-osmosis|purif|emf-protection|home-wellness|disinfectant|smart-scale|supplement|echo-water|tyent|sleep|mattress|chilipad/],
]

export function guessCategory(handle: string): Category {
  const h = handle.toLowerCase()
  for (const [category, pattern] of RULES) {
    if (pattern.test(h)) return category
  }
  return 'Unsorted'
}
