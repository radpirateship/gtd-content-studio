/**
 * GTD collection link injection map — GENERATED from
 * GTD_Complete_Collection_Optimization_6.xlsx (July 4, 2026), approved by Ryan.
 * URLs are LIVE Shopify handles from the spreadsheet (several differ from the
 * app's internal slugs — see APP_SLUG_TO_LIVE_HANDLE). To adjust a pairing,
 * edit SECONDARY_MAP. To activate a NEW sauna collection once it exists in
 * Shopify, add it to SAUNA_SPECIFIC.
 *
 * 16 Sep 2026: 21 sauna sub-collections were retired behind 301s (sauna
 * consolidation wave 1) and removed from every map here; the N-person-saunas
 * size parents took their place. Do not re-add a retired handle: the link
 * would take a redirect hop. The barrel-by-size group is still live until the
 * December wave.
 */

/** Live collection handle -> its SEO target keyword (drives anchor text). */
export const COLLECTION_KEYWORDS: Record<string, string> = {
  "air-purifiers": "air purifiers",
  "all-ball-pro": "ball rebounder",
  "athlete-management": "athlete management",
  "athlete-optimization": "athlete optimization",
  "athlete-performance-measurement": "performance measurement",
  "back-shoulder-equipment": "lat pulldown machine",
  "bars-barbells": "barbells",
  "cable-machines": "functional trainer",
  "cadillac-trapeze-tables": "pilates cadillac",
  "cardio-machines": "cardio machines",
  "chest-equipment": "chest press machine",
  "cold-plunges": "cold plunge",
  "compression-boots": "compression boots",
  "concussion-prevention-gear": "q collar football",
  "disinfectant-generator": "disinfectant generator",
  "elliptical-machines": "elliptical machine",
  "exercise-bikes": "exercise bike",
  "filters": "replacement filters",
  "fitness-equipment": "home fitness equipment",
  "foot-massagers": "foot massagers",
  "gym-accessories": "gym accessories",
  "gym-storage": "gym storage",
  "hand-massagers": "hand massagers",
  "heating-pads": "heating pads",
  "home-gym-equipment": "home gym equipment",
  "home-gym-machines": "home gym machines",
  "home-wellness": "home wellness products",
  "hydrogen-water": "hydrogen water",
  "hyperbaric-chambers": "hyperbaric chambers",
  "iron-neck": "iron neck",
  "lacrosse-equipment": "lacrosse equipment",
  "leg-equipment": "leg press machine",
  "massage": "massage equipment",
  "massage-chairs": "massage chairs",
  "massage-guns": "massage guns",
  "neck-massagers": "neck massager",
  "neck-training": "neck training",
  "optimization": "performance optimization",
  "pickleball-paddles": "pickleball paddles",
  "pilates": "pilates equipment",
  "pilates-chairs": "pilates chair",
  "pilates-reformers": "pilates reformers",
  "plates-dumbbells": "weight plates",
  "racks-cages": "power rack",
  "reaction-training": "reaction training",
  "recovery": "recovery for athletes",
  "red-light-therapy": "red light therapy",
  "rowing-machines": "rowing machines",
  "sensory-deprivation-tanks": "sensory deprivation tanks",
  "specialty-training": "specialty training equipment",
  "sports": "sports equipment",
  "stair-climbers": "stair climbers",
  "steam": "steam shower generator",
  "swedish-ladders": "swedish ladder",
  "timing-systems": "timing systems",
  "treadmills": "treadmills for home",
  "walking-pads": "walking pad treadmill",
  "vertical-climbing-machines": "vertical climber",
  "water-ionizers": "water ionizers",
  "weight-benches": "weight benches",
  "weightlifting-belts": "weightlifting belt",
  "hot-tubs": "hot tubs",
  "emf-protection": "emf protection",
  "jump-ropes": "best jump rope",
  "saunas": "saunas for sale",
  "indoor-saunas": "indoor saunas",
  "traditional-saunas": "traditional sauna",
  "infrared-saunas": "infrared saunas",
  "outdoor-saunas": "outdoor saunas",
  "barrel-saunas": "barrel sauna",
  "hybrid-saunas": "hybrid sauna",
  "cube-saunas": "cube sauna",
  "corner-saunas": "corner sauna",
  "1-person-saunas": "1 person sauna",
  "2-person-saunas": "2 person sauna",
  "3-person-saunas": "3 person sauna",
  "4-person-saunas": "4 person sauna",
  "5-person-saunas": "5 person sauna",
  "6-person-saunas": "6 person sauna",
  "8-person-saunas": "8 person sauna",
  "9-person-saunas": "9 person sauna",
  "sauna-doors": "sauna door",
  "sauna-kits": "sauna kit",
  "1-person-infrared-sauna": "1 person infrared sauna",
  "2-person-infrared-sauna": "2 person infrared sauna",
  "3-person-infrared-sauna": "3 person infrared sauna",
  "4-person-infrared-sauna": "4 person infrared sauna",
  "6-person-infrared-sauna": "6 person infrared sauna",
  "2-person-barrel-sauna": "2 person barrel sauna",
  "3-person-barrel-sauna": "3 person barrel sauna",
  "4-person-barrel-sauna": "4 person barrel sauna",
  "6-person-barrel-sauna": "6 person barrel sauna",
  "low-emf-saunas": "low emf sauna",
  "full-spectrum-infrared-saunas": "full spectrum infrared sauna",
  "barrel-sauna-with-window": "barrel sauna with window",
  "glass-front-barrel-sauna": "glass front barrel sauna",
  "outdoor-barrel-saunas": "outdoor barrel sauna",
  "sauna-heaters": "sauna heater",
  "electric-sauna-heaters": "electric sauna heater",
  "wood-burning-sauna-heaters": "wood burning sauna heater",
  "sauna-heater-controls": "sauna heater control panel",
  "sauna-chimney-kits": "sauna chimney kit",
  "steam-sauna-generators": "steam generator for sauna",
  "sauna-heater-parts": "sauna heater parts",
  "sauna-accessories": "sauna accessories",
  "sauna-lighting": "sauna lighting",
  "sauna-buckets-ladles": "sauna bucket and ladle",
  "sauna-stones": "sauna stones",
  "sauna-flooring": "sauna flooring",
  "sauna-aromatherapy": "sauna essential oils",
  "red-light-saunas": "red light sauna",
  "cedar-saunas": "cedar sauna",
  "portable-sauna-tents": "portable sauna tent"
};

/** Post's primary collection -> related secondary collection (approved map). */
export const SECONDARY_MAP: Record<string, string> = {
  "saunas": "infrared-saunas",
  "infrared-saunas": "traditional-saunas",
  "traditional-saunas": "infrared-saunas",
  "barrel-saunas": "outdoor-saunas",
  "outdoor-saunas": "barrel-saunas",
  "hybrid-saunas": "infrared-saunas",
  "indoor-saunas": "infrared-saunas",
  "cube-saunas": "outdoor-saunas",
  "corner-saunas": "indoor-saunas",
  "sauna-heaters": "sauna-accessories",
  "sauna-accessories": "sauna-heaters",
  "electric-sauna-heaters": "sauna-heaters",
  "wood-burning-sauna-heaters": "sauna-heaters",
  "low-emf-saunas": "infrared-saunas",
  "steam": "traditional-saunas",
  "portable-sauna-tents": "saunas",
  "cold-plunges": "saunas",
  "hot-tubs": "cold-plunges",
  "red-light-therapy": "infrared-saunas",
  "hyperbaric-chambers": "sensory-deprivation-tanks",
  "sensory-deprivation-tanks": "hyperbaric-chambers",
  "massage": "massage-guns",
  "massage-guns": "massage",
  "massage-chairs": "massage",
  "foot-massagers": "compression-boots",
  "hand-massagers": "massage",
  "neck-massagers": "massage-chairs",
  "compression-boots": "cold-plunges",
  "neck-training": "neck-massagers",
  "heating-pads": "massage",
  "recovery": "cold-plunges",
  "hydrogen-water": "water-ionizers",
  "water-ionizers": "hydrogen-water",
  "air-purifiers": "emf-protection",
  "emf-protection": "air-purifiers",
  "home-wellness": "air-purifiers",
  "filters": "air-purifiers",
  "disinfectant-generator": "air-purifiers",
  "treadmills": "walking-pads",
  "walking-pads": "treadmills",
  "elliptical-machines": "treadmills",
  "exercise-bikes": "treadmills",
  "stair-climbers": "treadmills",
  "vertical-climbing-machines": "stair-climbers",
  "rowing-machines": "elliptical-machines",
  "jump-ropes": "rowing-machines",
  "cardio-machines": "treadmills",
  "pilates": "pilates-reformers",
  "pilates-reformers": "pilates",
  "pilates-chairs": "pilates-reformers",
  "cadillac-trapeze-tables": "pilates-reformers",
  "racks-cages": "weight-benches",
  "weight-benches": "racks-cages",
  "bars-barbells": "plates-dumbbells",
  "plates-dumbbells": "bars-barbells",
  "cable-machines": "racks-cages",
  "leg-equipment": "cable-machines",
  "chest-equipment": "weight-benches",
  "back-shoulder-equipment": "cable-machines",
  "swedish-ladders": "gym-accessories",
  "gym-storage": "gym-accessories",
  "gym-accessories": "gym-storage",
  "weightlifting-belts": "bars-barbells",
  "home-gym-equipment": "racks-cages",
  "home-gym-machines": "cable-machines",
  "specialty-training": "gym-accessories",
  "iron-neck": "neck-training",
  "fitness-equipment": "home-gym-equipment",
  "lacrosse-equipment": "reaction-training",
  "pickleball-paddles": "reaction-training",
  "reaction-training": "timing-systems",
  "timing-systems": "reaction-training",
  "concussion-prevention-gear": "reaction-training",
  "athlete-management": "timing-systems",
  "athlete-optimization": "recovery",
  "athlete-performance-measurement": "timing-systems",
  "all-ball-pro": "lacrosse-equipment",
  "sports": "reaction-training",
  "optimization": "recovery"
};

/** App master-list slug -> live Shopify handle, where they differ. */
export const APP_SLUG_TO_LIVE_HANDLE: Record<string, string> = {
  "treadmills": "treadmills",
  "elliptical-machines": "elliptical-machines",
  "exercise-bikes": "exercise-bikes",
  "vertical-climbers": "vertical-climbing-machines",
  "pickleball-paddles": "pickleball-paddles",
  "massage-equipment": "massage",
  "cross-topic": "home-wellness"
};

/**
 * Existing sauna collections, most specific first (longest keyword). A sauna
 * post links the FIRST entry whose keyword terms all appear in its
 * keyword/title, falling back to the category parent.
 */
export const SAUNA_SPECIFIC: { handle: string; keyword: string }[] = [
  {
    "handle": "1-person-saunas",
    "keyword": "1 person sauna"
  },
  {
    "handle": "2-person-saunas",
    "keyword": "2 person sauna"
  },
  {
    "handle": "3-person-saunas",
    "keyword": "3 person sauna"
  },
  {
    "handle": "4-person-saunas",
    "keyword": "4 person sauna"
  },
  {
    "handle": "5-person-saunas",
    "keyword": "5 person sauna"
  },
  {
    "handle": "6-person-saunas",
    "keyword": "6 person sauna"
  },
  {
    "handle": "8-person-saunas",
    "keyword": "8 person sauna"
  },
  {
    "handle": "9-person-saunas",
    "keyword": "9 person sauna"
  },
  {
    "handle": "wood-burning-sauna-heaters",
    "keyword": "wood burning sauna heater"
  },
  {
    "handle": "electric-sauna-heaters",
    "keyword": "electric sauna heater"
  },
  {
    "handle": "portable-sauna-tents",
    "keyword": "portable sauna tent"
  },
  {
    "handle": "traditional-saunas",
    "keyword": "traditional sauna"
  },
  {
    "handle": "sauna-accessories",
    "keyword": "sauna accessories"
  },
  {
    "handle": "saunas",
    "keyword": "saunas for sale"
  },
  {
    "handle": "infrared-saunas",
    "keyword": "infrared saunas"
  },
  {
    "handle": "outdoor-saunas",
    "keyword": "outdoor saunas"
  },
  {
    "handle": "indoor-saunas",
    "keyword": "indoor saunas"
  },
  {
    "handle": "low-emf-saunas",
    "keyword": "low emf sauna"
  },
  {
    "handle": "barrel-saunas",
    "keyword": "barrel sauna"
  },
  {
    "handle": "sauna-heaters",
    "keyword": "sauna heater"
  },
  {
    "handle": "cube-saunas",
    "keyword": "cube sauna"
  }
];

/** Carried brands (Finnmark excluded — paused, never link). Brand link is used
 * for the secondary slot ONLY when the brand name appears in title/keyword. */
export const BRAND_COLLECTIONS: { name: string; handle: string; keyword: string }[] = [
  {
    "name": "All Ball Pro",
    "handle": "all-ball-pro",
    "keyword": "all ball pro"
  },
  {
    "name": "Austin",
    "handle": "austin",
    "keyword": "austin air purifier"
  },
  {
    "name": "BASI Systems",
    "handle": "basi-systems",
    "keyword": "basi pilates"
  },
  {
    "name": "BenchK",
    "handle": "benchk",
    "keyword": "benchk"
  },
  {
    "name": "Body Helix",
    "handle": "body-helix",
    "keyword": "body helix"
  },
  {
    "name": "Breath Belt",
    "handle": "breath-belt",
    "keyword": "breath belt"
  },
  {
    "name": "Cozy Heat",
    "handle": "cozy-heat",
    "keyword": "cozy heat sauna heater"
  },
  {
    "name": "Dashr",
    "handle": "dashr",
    "keyword": "dashr"
  },
  {
    "name": "Dreampod",
    "handle": "dreampod",
    "keyword": "dreampod float tank"
  },
  {
    "name": "Dynamic Cold Therapy",
    "handle": "dynamic-cold-therapy",
    "keyword": "dynamic cold plunge"
  },
  {
    "name": "Dynamic Saunas",
    "handle": "dynamic-saunas",
    "keyword": "dynamic sauna"
  },
  {
    "name": "Echo Water",
    "handle": "echo-water",
    "keyword": "echo water"
  },
  {
    "name": "Elina Pilates",
    "handle": "elina-pilates",
    "keyword": "elina pilates"
  },
  {
    "name": "Fitnex",
    "handle": "fitnex",
    "keyword": "fitnex"
  },
  {
    "name": "Gladiator Lacrosse",
    "handle": "gladiator-lacrosse",
    "keyword": "gladiator lacrosse"
  },
  {
    "name": "Golden Designs",
    "handle": "golden-designs-inc",
    "keyword": "golden designs sauna"
  },
  {
    "name": "Harvia",
    "handle": "harvia",
    "keyword": "harvia sauna heater"
  },
  {
    "name": "Hooga",
    "handle": "hooga",
    "keyword": "hooga red light therapy"
  },
  {
    "name": "Huum",
    "handle": "huum",
    "keyword": "huum sauna heater"
  },
  {
    "name": "Iron Neck",
    "handle": "iron-neck",
    "keyword": "iron neck"
  },
  {
    "name": "Kahuna",
    "handle": "kahuna-chair",
    "keyword": "kahuna massage chair"
  },
  {
    "name": "Kineon",
    "handle": "kineon",
    "keyword": "kineon"
  },
  {
    "name": "Kohler",
    "handle": "kohler",
    "keyword": "kohler steam generator"
  },
  {
    "name": "Maxxus Saunas",
    "handle": "maxxus-saunas",
    "keyword": "maxxus saunas"
  },
  {
    "name": "Medical Breakthrough",
    "handle": "medical-breakthrough",
    "keyword": "medical breakthrough"
  },
  {
    "name": "Mr. Steam",
    "handle": "mr-steam",
    "keyword": "mr steam"
  },
  {
    "name": "Narvi",
    "handle": "narvi",
    "keyword": "narvi"
  },
  {
    "name": "Newtowne Hyperbarics",
    "handle": "newtowne-hyperbarics",
    "keyword": "newtowne hyperbarics"
  },
  {
    "name": "Nubis",
    "handle": "nubis",
    "keyword": "nubis"
  },
  {
    "name": "Oro Sports",
    "handle": "oro-sports",
    "keyword": "oro sports"
  },
  {
    "name": "OxyRevo",
    "handle": "oxyrevo",
    "keyword": "oxyrevo"
  },
  {
    "name": "PowerBlock",
    "handle": "powerblock-b2b",
    "keyword": "powerblock adjustable dumbbells"
  },
  {
    "name": "PRx Performance",
    "handle": "prx-performance",
    "keyword": "prx performance folding rack"
  },
  {
    "name": "Pso-Rite",
    "handle": "pso-rite",
    "keyword": "pso rite"
  },
  {
    "name": "Q30",
    "handle": "q30",
    "keyword": "q30"
  },
  {
    "name": "Rapid Reboot",
    "handle": "rapid-reboot",
    "keyword": "rapid reboot"
  },
  {
    "name": "Reathlete",
    "handle": "reathlete",
    "keyword": "reathlete"
  },
  {
    "name": "Revive",
    "handle": "revive",
    "keyword": "revive sauna"
  },
  {
    "name": "Saunalife",
    "handle": "saunalife",
    "keyword": "saunalife"
  },
  {
    "name": "Saunum",
    "handle": "saunum",
    "keyword": "saunum"
  },
  {
    "name": "Steelflex",
    "handle": "steelflex",
    "keyword": "steelflex"
  },
  {
    "name": "StepR",
    "handle": "stepr",
    "keyword": "stepr"
  },
  {
    "name": "Summit to Sea",
    "handle": "summit-to-sea",
    "keyword": "summit to sea"
  },
  {
    "name": "ThermaSol",
    "handle": "thermasol",
    "keyword": "thermasol"
  },
  {
    "name": "Tyent",
    "handle": "tyent",
    "keyword": "tyent"
  },
  {
    "name": "VersaClimber",
    "handle": "versaclimber",
    "keyword": "versaclimber"
  },
  {
    "name": "Leil Saunas",
    "handle": "leil-saunas",
    "keyword": "leil saunas"
  },
  {
    "name": "Fire Cold Plunge",
    "handle": "fire-cold-plunge",
    "keyword": "fire cold plunge"
  },
  {
    "name": "TURBRO",
    "handle": "turbro",
    "keyword": "turbro cold plunge"
  },
  {
    "name": "Waveguard",
    "handle": "waveguard",
    "keyword": "waveguard"
  },
  {
    "name": "Kolo",
    "handle": "kolo",
    "keyword": "kolo sauna accessories"
  },
  {
    "name": "XMARK",
    "handle": "xmark",
    "keyword": "xmark fitness"
  },
  {
    "name": "Auroom Saunas",
    "handle": "auroom-saunas",
    "keyword": "auroom sauna"
  },
  {
    "name": "North Shore Sauna",
    "handle": "north-shore-sauna",
    "keyword": "north shore sauna"
  },
  {
    "name": "WalkingPad",
    "handle": "walkingpad",
    "keyword": "walkingpad"
  },
  {
    "name": "The Core Collab",
    "handle": "the-core-collab",
    "keyword": "the core collab"
  },
  {
    "name": "Crossrope",
    "handle": "crossrope",
    "keyword": "crossrope"
  },
  {
    "name": "Dynamic Fluid Fitness",
    "handle": "dynamic-fluid-fitness",
    "keyword": "dynamic fluid fitness"
  },
  {
    "name": "Glute Slide",
    "handle": "glute-slide",
    "keyword": "glute slide"
  },
  {
    "name": "IceTubs",
    "handle": "icetubs",
    "keyword": "icetubs"
  },
  {
    "name": "KoziSense",
    "handle": "kozisense",
    "keyword": "kozisense massage chair"
  },
  {
    "name": "Embrace The Heat",
    "handle": "embrace-the-heat",
    "keyword": "embrace the heat sauna"
  },
  {
    "name": "Red Nova Lights",
    "handle": "red-nova-lights",
    "keyword": "red nova lights"
  },
  {
    "name": "RLT Home",
    "handle": "rlt-home",
    "keyword": "rlt home"
  },
  {
    "name": "KingSmith",
    "handle": "kingsmith",
    "keyword": "kingsmith"
  }
];

/** Never link these, ever. */
export const EXCLUDED_HANDLES = ["finnmark"];

/** Anchor templates rotated per post; {kw} replaced with collection keyword. */
export const ANCHOR_TEMPLATES = [
  "browse our {kw}",
  "explore our {kw} collection",
  "see our full range of {kw}",
  "compare {kw}"
];
