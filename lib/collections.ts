/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MASTER COLLECTIONS LIST — single source of truth
 * ─────────────────────────────────────────────────────────────────────────────
 * To add a new collection: add ONE entry to MASTER_COLLECTIONS below.
 * All dropdowns, API maps, and slug lookups derive from this automatically.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Hub = 'Saunas' | 'Recovery' | 'Fitness' | 'Wellness'

export interface CollectionDef {
  slug: string
  label: string
  shopifyHandle: string
  hub: Hub
}

export const MASTER_COLLECTIONS: CollectionDef[] = [
  // Saunas
  { slug: 'saunas',                    label: 'Saunas',                    shopifyHandle: 'saunas',                    hub: 'Saunas' },
  { slug: 'infrared-saunas',           label: 'Infrared Saunas',           shopifyHandle: 'infrared-saunas',           hub: 'Saunas' },
  { slug: 'barrel-saunas',             label: 'Barrel Saunas',             shopifyHandle: 'barrel-saunas',             hub: 'Saunas' },
  { slug: 'traditional-saunas',        label: 'Traditional Saunas',        shopifyHandle: 'traditional-saunas',        hub: 'Saunas' },
  { slug: 'outdoor-saunas',            label: 'Outdoor Saunas',            shopifyHandle: 'outdoor-saunas',            hub: 'Saunas' },
  { slug: 'sauna-heaters',             label: 'Sauna Heaters',             shopifyHandle: 'sauna-heaters',             hub: 'Saunas' },
  { slug: 'sauna-accessories',         label: 'Sauna Accessories',         shopifyHandle: 'sauna-accessories',         hub: 'Saunas' },
  { slug: 'sauna-kits',                label: 'Sauna Kits',                shopifyHandle: 'sauna-kits',                hub: 'Saunas' },
  { slug: 'hybrid-saunas',             label: 'Hybrid Saunas',             shopifyHandle: 'hybrid-saunas',             hub: 'Saunas' },
  { slug: 'steam',                     label: 'Steam',                     shopifyHandle: 'steam',                     hub: 'Saunas' },
  // Recovery
  { slug: 'cold-plunges',              label: 'Cold Plunges',              shopifyHandle: 'cold-plunges',              hub: 'Recovery' },
  { slug: 'red-light-therapy',         label: 'Red Light Therapy',         shopifyHandle: 'red-light-therapy',         hub: 'Recovery' },
  { slug: 'hyperbaric-chambers',       label: 'Hyperbaric Chambers',       shopifyHandle: 'hyperbaric-chambers',       hub: 'Recovery' },
  { slug: 'sensory-deprivation-tanks', label: 'Sensory Deprivation Tanks', shopifyHandle: 'sensory-deprivation-tanks', hub: 'Recovery' },
  { slug: 'massage-equipment',         label: 'Massage Equipment',         shopifyHandle: 'massage-equipment',         hub: 'Recovery' },
  { slug: 'massage-guns',              label: 'Massage Guns',              shopifyHandle: 'massage-guns',              hub: 'Recovery' },
  { slug: 'massage-chairs',            label: 'Massage Chairs',            shopifyHandle: 'massage-chairs',            hub: 'Recovery' },
  { slug: 'foot-massagers',            label: 'Foot Massagers',            shopifyHandle: 'foot-massagers',            hub: 'Recovery' },
  { slug: 'hand-massagers',            label: 'Hand Massagers',            shopifyHandle: 'hand-massagers',            hub: 'Recovery' },
  { slug: 'neck-massagers',            label: 'Neck Massagers',            shopifyHandle: 'neck-massagers',            hub: 'Recovery' },
  { slug: 'compression-boots',         label: 'Compression Boots',         shopifyHandle: 'compression-boots',         hub: 'Recovery' },
  { slug: 'neck-training',             label: 'Neck Training',             shopifyHandle: 'neck-training',             hub: 'Recovery' },
  { slug: 'hot-tubs',                  label: 'Hot Tubs',                  shopifyHandle: 'hot-tubs',                  hub: 'Recovery' },
  // Wellness
  { slug: 'hydrogen-water',            label: 'Hydrogen Water',            shopifyHandle: 'hydrogen-water',            hub: 'Wellness' },
  { slug: 'water-ionizers',            label: 'Water Ionizers',            shopifyHandle: 'water-ionizers',            hub: 'Wellness' },
  { slug: 'air-purifiers',             label: 'Air Purifiers',             shopifyHandle: 'air-purifiers',             hub: 'Wellness' },
  { slug: 'emf-protection',           label: 'EMF Protection',            shopifyHandle: 'emf-protection',            hub: 'Wellness' },
  // Fitness
  { slug: 'elliptical-machines',       label: 'Elliptical Machines',       shopifyHandle: 'elliptical-machines',       hub: 'Fitness' },
  { slug: 'exercise-bikes',            label: 'Exercise Bikes',            shopifyHandle: 'exercise-bikes',            hub: 'Fitness' },
  { slug: 'treadmills',                label: 'Treadmills',                shopifyHandle: 'treadmills',                hub: 'Fitness' },
  { slug: 'walking-pads',              label: 'Walking Pads',              shopifyHandle: 'walking-pads',              hub: 'Fitness' },
  { slug: 'stair-climbers',            label: 'Stair Climbers',            shopifyHandle: 'stair-climbers',            hub: 'Fitness' },
  { slug: 'vertical-climbers',         label: 'Vertical Climbers',         shopifyHandle: 'vertical-climbing-machines', hub: 'Fitness' },
  { slug: 'rowing-machines',           label: 'Rowing Machines',           shopifyHandle: 'rowing-machines',           hub: 'Fitness' },
  { slug: 'jump-ropes',                label: 'Jump Ropes',                shopifyHandle: 'jump-ropes',                hub: 'Fitness' },
  { slug: 'pilates',                   label: 'Pilates',                   shopifyHandle: 'pilates',                   hub: 'Fitness' },
  // Home Gym — Strength
  { slug: 'racks-cages',              label: 'Power Racks & Cages',       shopifyHandle: 'racks-cages',               hub: 'Fitness' },
  { slug: 'weight-benches',           label: 'Weight Benches',            shopifyHandle: 'weight-benches',            hub: 'Fitness' },
  { slug: 'bars-barbells',            label: 'Bars & Barbells',           shopifyHandle: 'bars-barbells',             hub: 'Fitness' },
  { slug: 'plates-dumbbells',         label: 'Weight Plates & Dumbbells', shopifyHandle: 'plates-dumbbells',          hub: 'Fitness' },
  { slug: 'cable-machines',           label: 'Cable Machines',            shopifyHandle: 'cable-machines',            hub: 'Fitness' },
  { slug: 'leg-equipment',            label: 'Leg Equipment',             shopifyHandle: 'leg-equipment',             hub: 'Fitness' },
  { slug: 'chest-equipment',          label: 'Chest Press Machines',      shopifyHandle: 'chest-equipment',           hub: 'Fitness' },
  { slug: 'back-shoulder-equipment',  label: 'Back & Shoulder Equipment', shopifyHandle: 'back-shoulder-equipment',   hub: 'Fitness' },
  // Home Gym — Specialty & Accessories
  { slug: 'swedish-ladders',          label: 'Swedish Ladders',           shopifyHandle: 'swedish-ladders',           hub: 'Fitness' },
  { slug: 'gym-storage',              label: 'Storage & Organization',    shopifyHandle: 'gym-storage',               hub: 'Fitness' },
  { slug: 'gym-accessories',          label: 'Gym Accessories',           shopifyHandle: 'gym-accessories',           hub: 'Fitness' },
  { slug: 'weightlifting-belts',      label: 'Weightlifting Belts',       shopifyHandle: 'weightlifting-belts',       hub: 'Fitness' },
  // Sports
  { slug: 'lacrosse-equipment',       label: 'Lacrosse Equipment',        shopifyHandle: 'lacrosse-equipment',        hub: 'Fitness' },
  { slug: 'pickleball-paddles',       label: 'Pickleball Paddles',        shopifyHandle: 'pickleball-paddles',        hub: 'Fitness' },
  { slug: 'reaction-training',        label: 'Reaction Training',         shopifyHandle: 'reaction-training',         hub: 'Fitness' },
  { slug: 'timing-systems',           label: 'Timing Systems',            shopifyHandle: 'timing-systems',            hub: 'Fitness' },
  // Cross-topic (multi-topic legacy articles — routes to general wellness on Shopify)
  { slug: 'cross-topic',               label: 'Cross-Topic',               shopifyHandle: 'home-wellness',             hub: 'Wellness' },
]

// ── Derived maps — import these instead of redefining locally ─────────────────

/** slug → display label */
export const CATEGORY_LABELS: Record<string, string> =
  Object.fromEntries(MASTER_COLLECTIONS.map(c => [c.slug, c.label]))

/** slug → Shopify collection handle */
export const CATEGORY_TO_COLLECTION: Record<string, string> = {
  ...Object.fromEntries(MASTER_COLLECTIONS.map(c => [c.slug, c.shopifyHandle])),
  // Legacy / alias slugs
  'infrared-saunas':    'infrared-saunas',
  'traditional-saunas': 'traditional-saunas',
  'cold-plunge':        'cold-plunges',   // legacy singular
}

/** display label OR slug → canonical slug (for forms and CSV parsing) */
export const COLLECTION_TO_CATEGORY: Record<string, string> = {
  ...Object.fromEntries(MASTER_COLLECTIONS.map(c => [c.label, c.slug])),
  ...Object.fromEntries(MASTER_COLLECTIONS.map(c => [c.slug, c.slug])),
  // Aliases
  'Infrared Saunas':  'infrared-saunas',
  'infrared-saunas':  'infrared-saunas',
  'cold-plunge':      'cold-plunges',
  'Massage':          'massage-equipment',
  // Air Purifiers legacy aliases
  'Air Filters':      'air-purifiers',
  'air-filters':      'air-purifiers',
}

/** Ordered display labels for dropdowns */
export const COLLECTION_NAMES: string[] = MASTER_COLLECTIONS.map(c => c.label)

/** All slugs — for API route initialization */
export const COLLECTION_SLUGS: string[] = MASTER_COLLECTIONS.map(c => c.slug)

/** Hub → array of collection labels (for grouped dropdowns / subcategory filters) */
export const COLLECTIONS_BY_HUB: Record<Hub, string[]> = MASTER_COLLECTIONS.reduce(
  (acc, c) => {
    if (!acc[c.hub]) acc[c.hub] = []
    acc[c.hub].push(c.label)
    return acc
  },
  {} as Record<Hub, string[]>
)

/**
 * Which collection a reader of one category is most likely to cross-shop.
 *
 * Text similarity cannot find these: "hot tubs" shares no words with "cold
 * plunge", yet contrast therapy makes it the obvious second link on any cold
 * plunge article. Ranking by label overlap alone left every cold plunge piece
 * linking massage equipment as filler.
 *
 * Handles, in preference order. Cross-hub entries are deliberate: sauna is the
 * other half of contrast therapy and hub filtering would otherwise hide it.
 */
export const COLLECTION_AFFINITY: Record<string, string[]> = {
  // ── Recovery ──────────────────────────────────────────────────────────────
  'cold-plunges':              ['hot-tubs', 'saunas', 'compression-boots', 'red-light-therapy'],
  'hot-tubs':                  ['cold-plunges', 'saunas', 'steam'],
  'red-light-therapy':         ['cold-plunges', 'infrared-saunas', 'hyperbaric-chambers'],
  'hyperbaric-chambers':       ['red-light-therapy', 'cold-plunges', 'compression-boots'],
  'sensory-deprivation-tanks': ['cold-plunges', 'red-light-therapy', 'hyperbaric-chambers'],
  'compression-boots':         ['massage-guns', 'cold-plunges', 'massage-equipment'],
  'massage-equipment':         ['massage-guns', 'massage-chairs', 'compression-boots'],
  'massage-guns':              ['massage-equipment', 'compression-boots', 'cold-plunges'],
  'massage-chairs':            ['massage-equipment', 'foot-massagers', 'neck-massagers'],
  'foot-massagers':            ['massage-chairs', 'massage-equipment', 'hand-massagers'],
  'hand-massagers':            ['massage-equipment', 'foot-massagers', 'neck-massagers'],
  'neck-massagers':            ['neck-training', 'massage-equipment', 'massage-chairs'],
  'neck-training':             ['neck-massagers', 'massage-equipment', 'back-shoulder-equipment'],

  // ── Saunas ────────────────────────────────────────────────────────────────
  'saunas':                    ['cold-plunges', 'steam', 'hot-tubs', 'infrared-saunas'],
  'infrared-saunas':           ['cold-plunges', 'saunas', 'red-light-therapy'],
  'traditional-saunas':        ['sauna-heaters', 'cold-plunges', 'saunas'],
  'barrel-saunas':             ['outdoor-saunas', 'cold-plunges', 'sauna-heaters'],
  'outdoor-saunas':            ['barrel-saunas', 'cold-plunges', 'hot-tubs'],
  'hybrid-saunas':             ['infrared-saunas', 'traditional-saunas', 'cold-plunges'],
  'sauna-heaters':             ['traditional-saunas', 'sauna-accessories', 'saunas'],
  'sauna-accessories':         ['sauna-heaters', 'saunas', 'traditional-saunas'],
  'sauna-kits':                ['saunas', 'sauna-heaters', 'traditional-saunas'],
  'steam':                     ['saunas', 'cold-plunges', 'hot-tubs'],

  // ── Wellness ──────────────────────────────────────────────────────────────
  // Two clusters: what you drink, and what your house does to you. They overlap,
  // so each points at its own cluster first and the other second.
  'hydrogen-water':            ['water-ionizers', 'home-wellness', 'air-purifiers'],
  'water-ionizers':            ['hydrogen-water', 'home-wellness', 'air-purifiers'],
  'air-purifiers':             ['emf-protection', 'water-ionizers', 'hydrogen-water'],
  'emf-protection':            ['air-purifiers', 'home-wellness', 'hydrogen-water'],
  'home-wellness':             ['hydrogen-water', 'air-purifiers', 'cold-plunges'],

  // ── Fitness ───────────────────────────────────────────────────────────────
  // Cardio, strength and sport are three separate shopping trips. Each points
  // inside its own cluster first, then at recovery, which is the genuine
  // cross-hub cross-sell for anyone training hard.
  'treadmills':                ['walking-pads', 'exercise-bikes', 'elliptical-machines', 'rowing-machines'],
  'walking-pads':              ['treadmills', 'exercise-bikes', 'elliptical-machines'],
  'exercise-bikes':            ['treadmills', 'elliptical-machines', 'rowing-machines', 'compression-boots'],
  'elliptical-machines':       ['treadmills', 'exercise-bikes', 'stair-climbers'],
  'rowing-machines':           ['exercise-bikes', 'treadmills', 'vertical-climbing-machines'],
  'stair-climbers':            ['vertical-climbing-machines', 'treadmills', 'elliptical-machines'],
  'vertical-climbing-machines': ['stair-climbers', 'rowing-machines', 'treadmills'],
  'racks-cages':               ['weight-benches', 'bars-barbells', 'plates-dumbbells'],
  'weight-benches':            ['racks-cages', 'plates-dumbbells', 'bars-barbells'],
  'bars-barbells':             ['plates-dumbbells', 'racks-cages', 'weightlifting-belts'],
  'plates-dumbbells':          ['bars-barbells', 'racks-cages', 'weight-benches'],
  'cable-machines':            ['racks-cages', 'chest-equipment', 'back-shoulder-equipment'],
  'leg-equipment':             ['cable-machines', 'chest-equipment', 'back-shoulder-equipment'],
  'chest-equipment':           ['back-shoulder-equipment', 'cable-machines', 'leg-equipment'],
  'back-shoulder-equipment':   ['chest-equipment', 'cable-machines', 'neck-training'],
  'weightlifting-belts':       ['bars-barbells', 'plates-dumbbells', 'gym-accessories'],
  'gym-accessories':           ['gym-storage', 'jump-ropes', 'weightlifting-belts'],
  'gym-storage':               ['gym-accessories', 'plates-dumbbells', 'racks-cages'],
  'jump-ropes':                ['gym-accessories', 'reaction-training', 'weightlifting-belts'],
  'pilates':                   ['swedish-ladders', 'gym-accessories', 'neck-training'],
  'swedish-ladders':           ['pilates', 'gym-storage', 'gym-accessories'],
  'lacrosse-equipment':        ['reaction-training', 'timing-systems', 'gym-accessories'],
  'pickleball-paddles':        ['reaction-training', 'gym-accessories', 'jump-ropes'],
  'reaction-training':         ['timing-systems', 'lacrosse-equipment', 'jump-ropes'],
  'timing-systems':            ['reaction-training', 'lacrosse-equipment', 'jump-ropes'],
}

/** Ordered hub names */
export const HUBS: Hub[] = ['Saunas', 'Recovery', 'Fitness', 'Wellness']
