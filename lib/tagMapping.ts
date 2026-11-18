/**
 * PPW Tag Mapping – Single source of truth for Shopify article tags
 * Maps collection slugs and articleType values to human-readable display tags
 */

/** Maps collection slug → array of display tags to apply in Shopify */
export const COLLECTION_DISPLAY_TAGS: Record<string, string[]> = {
  "infrared-saunas": ["Saunas", "Infrared"],
  "barrel-saunas": ["Saunas", "Barrel Saunas"],
  "traditional-saunas": ["Saunas", "Traditional Saunas"],
  "sauna-heaters": ["Saunas", "Sauna Heaters"],
  "sauna-accessories": ["Saunas", "Sauna Accessories"],
  "steam": ["Saunas", "Steam"],
  "saunas": ["Saunas"],
  "cold-plunges": ["Recovery", "Cold Plunges"],
  "red-light-therapy": ["Recovery", "Red Light Therapy"],
  "hyperbaric-chambers": ["Recovery", "Hyperbaric Chambers"],
  "sensory-deprivation-tanks": ["Recovery", "Sensory Deprivation Tanks"],
  "massage-equipment": ["Recovery", "Massage"],
  "compression-boots": ["Recovery", "Compression Boots"],
  "neck-training": ["Recovery", "Neck Training"],
  "hot-tubs": ["Recovery", "Hot Tubs"],
  "hydrogen-water": ["Wellness", "Hydrogen Water"],
  "water-ionizers": ["Wellness", "Water Ionizers"],
  "treadmills": ["Fitness", "Treadmills"],
  "elliptical-machines": ["Fitness", "Elliptical Machines"],
  "exercise-bikes": ["Fitness", "Exercise Bikes"],
  "stair-climbers": ["Fitness", "Stair Climbers"],
  "vertical-climbing-machines": ["Fitness", "Vertical Climbers"],
  "pilates": ["Fitness", "Pilates"],
  // Home Gym — Strength
  "racks-cages": ["Fitness", "Power Racks"],
  "weight-benches": ["Fitness", "Weight Benches"],
  "bars-barbells": ["Fitness", "Barbells"],
  "plates-dumbbells": ["Fitness", "Dumbbells"],
  "cable-machines": ["Fitness", "Cable Machines"],
  "leg-equipment": ["Fitness", "Leg Equipment"],
  "chest-equipment": ["Fitness", "Chest Equipment"],
  "back-shoulder-equipment": ["Fitness", "Back & Shoulder Equipment"],
  // Home Gym — 2026 additions
  "home-gym-equipment": ["Fitness", "Home Gym Equipment"],
  "home-gym-equipment-for-every-workout": ["Fitness", "Home Gym Equipment"],  // live umbrella handle, same tags
  "hip-glute-equipment": ["Fitness", "Hip & Glute Equipment"],
  "core-equipment": ["Fitness", "Core Equipment"],
  "home-gym-machines": ["Fitness", "Home Gym Machines"],
  "plyo-boxes": ["Fitness", "Plyo Boxes"],
  "exercise-mats": ["Fitness", "Exercise Mats"],
  "balance-equipment": ["Fitness", "Balance Equipment"],
  "kettlebells": ["Fitness", "Kettlebells"],
  "specialty-training": ["Fitness", "Specialty Training"],
  "martial-arts": ["Fitness", "Martial Arts"],
  // Home Gym — Specialty & Accessories
  "swedish-ladders": ["Fitness", "Swedish Ladders"],
  "gym-storage": ["Fitness", "Gym Accessories"],
  "gym-accessories": ["Fitness", "Gym Accessories"],
  "weightlifting-belts": ["Fitness", "Weightlifting Belts"],
  "air-purifiers": ["Wellness", "Air Purifiers"],
  // Saunas — kits
  "sauna-kits": ["Saunas", "Sauna Kits"],
  // Wellness — EMF
  "emf-protection": ["Wellness", "EMF Protection"],
  // Sports
  "lacrosse-equipment": ["Fitness", "Lacrosse Equipment"],
  "pickleball-paddles": ["Fitness", "Pickleball"],
  "reaction-training": ["Fitness", "Reaction Training"],
  "timing-systems": ["Fitness", "Timing Systems"],
  "air-filters": ["Wellness", "Air Purifiers"],   // legacy alias — keep resolving
}

/** Maps articleType CSV/UI value → Shopify display tag */
export const ARTICLE_TYPE_DISPLAY_TAGS: Record<string, string> = {
  "buyers-guide": "Buyer's Guide",
  "comparison": "Comparison",
  "how-to": "How-To",
  "deep-dive": "Deep Dive",
  "ultimate-guide": "Ultimate Guide",
  "listicle": "Listicle",
  "brand-review": "Brand Review",
  "celebrity": "Celebrity",
  "exercise-science": "Exercise Science",
  "benefit-deep-dive": "Deep Dive",
  "faq": "FAQ",
  "troubleshooting": "How-To",
}

/**
 * Build a comma-separated Shopify tag string from category and article type.
 * @param categorySlug - The wellness category (collection slug)
 * @param articleType - The article's type (from CSV or UI selector)
 * @returns Comma-separated tag string ready for Shopify API, e.g. "Saunas, Infrared, Buyer's Guide"
 */
/** Forgiving aliases: maps display names, old names, and lowercase variants to canonical slugs */
export const COLLECTION_ALIASES: Record<string, string> = {
  'massage equipment': 'massage-equipment',
  'massage chairs': 'massage-equipment',
  'massage': 'massage-equipment',
  'compression boots': 'compression-boots',
  // Vertical climbers — the live handle is vertical-climbing-machines
  'vertical-climbers': 'vertical-climbing-machines',
  'vertical climbers': 'vertical-climbing-machines',
  'vertical climbing machines': 'vertical-climbing-machines',
  // Air Purifiers — canonical + legacy aliases
  'air purifiers': 'air-purifiers',
  'air-purifiers': 'air-purifiers',
  'air filters': 'air-purifiers',
  'air-filters': 'air-purifiers',
  'filters': 'air-purifiers',
}

/** Resolve a potentially messy collection name to a canonical slug */
export function resolveCollectionSlug(raw: string): string {
  if (!raw) return raw
  const lower = raw.trim().toLowerCase()
  return COLLECTION_ALIASES[lower] || COLLECTION_DISPLAY_TAGS[raw] ? raw : lower.replace(/\s+/g, '-')
}

export function buildShopifyTags(
  categorySlug: string,
  articleType?: string
): string {
  const tags: string[] = []

  // Resolve aliases before lookup
  const resolved = COLLECTION_ALIASES[categorySlug.toLowerCase()] || categorySlug
  const categoryTags = COLLECTION_DISPLAY_TAGS[resolved] ?? []
  tags.push(...categoryTags)

  // Add article type tag
  if (articleType) {
    const typeTag = ARTICLE_TYPE_DISPLAY_TAGS[articleType] ?? ""
    if (typeTag) tags.push(typeTag)
  }

  // Dedupe and join for Shopify API
  return [...new Set(tags)].join(", ")
}
