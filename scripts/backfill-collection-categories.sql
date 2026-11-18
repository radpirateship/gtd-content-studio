-- ppw_collections category backfill
-- Generated 2026-08-11 from the All Smart Collections 8-11 Matrixify export (278 live collections).
-- Run AFTER deploying the updated guessCategory() so new syncs stay consistent.
-- Brand collections are intentionally excluded: they are keyed by collection_type = 'brand'.

BEGIN;

-- Widen the category column's accepted values if it is constrained.
-- ALTER TABLE ppw_collections DROP CONSTRAINT IF EXISTS ppw_collections_category_check;

-- Saunas (74)
UPDATE ppw_collections SET category = 'Saunas' WHERE slug IN (
  '1-person-infrared-sauna', '1-person-saunas', '1-person-traditional-sauna', '1-person-traditional-saunas',
  '2-person-barrel-sauna', '2-person-hybrid-sauna', '2-person-infrared-sauna', '2-person-saunas',
  '2-person-traditional-sauna', '3-person-barrel-sauna', '3-person-hybrid-sauna', '3-person-infrared-sauna',
  '3-person-saunas', '3-person-traditional-sauna', '4-person-barrel-sauna', '4-person-hybrid-sauna',
  '4-person-infrared-sauna', '4-person-saunas', '4-person-traditional-sauna', '5-person-saunas',
  '5-person-traditional-sauna', '6-person-barrel-sauna', '6-person-infrared-sauna', '6-person-saunas',
  '6-person-traditional-sauna', '8-person-saunas', '8-person-traditional-sauna', '9-person-saunas',
  'barrel-sauna-with-window', 'barrel-saunas', 'cedar-saunas', 'corner-saunas',
  'cube-saunas', 'dry-saunas', 'electric-sauna-heaters', 'full-spectrum-infrared-saunas',
  'glass-front-barrel-sauna', 'hybrid-saunas', 'indoor-infrared-saunas', 'indoor-saunas',
  'indoor-traditional-saunas', 'infrared-saunas', 'low-emf-saunas', 'near-zero-emf-saunas',
  'outdoor-barrel-saunas', 'outdoor-infrared-saunas', 'outdoor-saunas', 'outdoor-showers',
  'outdoor-traditional-saunas', 'red-light-saunas', 'sauna-accessories', 'sauna-aromatherapy',
  'sauna-buckets-ladles', 'sauna-chimney-kits', 'sauna-doors', 'sauna-doors-glass',
  'sauna-flooring', 'sauna-heater-accessories', 'sauna-heater-controls', 'sauna-heater-parts',
  'sauna-heaters', 'sauna-kits', 'sauna-lighting', 'sauna-salt-bricks',
  'sauna-stones', 'sauna-windows', 'sauna-wood', 'saunas',
  'steam', 'steam-sauna-generators', 'steam-shower', 'traditional-saunas',
  'ultra-low-emf-saunas', 'wood-burning-sauna-heaters'
);

-- Recovery (19)
UPDATE ppw_collections SET category = 'Recovery' WHERE slug IN (
  'back-stretchers', 'cold-plunges', 'compression', 'contrast-therapy-baths',
  'foot-massagers', 'hand-massagers', 'heating-pads', 'hot-tubs',
  'hyperbaric-chambers', 'massage', 'massage-chairs', 'massage-equipment',
  'massage-guns', 'neck-massagers', 'neck-training', 'recovery',
  'red-light-therapy', 'sensory-deprivation-tanks', 'therapy-sleeves'
);

-- Fitness (46)
UPDATE ppw_collections SET category = 'Fitness' WHERE slug IN (
  'arms-equipment', 'back-shoulder-equipment', 'balance-equipment', 'bars-barbells',
  'cable-machines', 'cadillac-trapeze-tables', 'cardio-machines', 'chest-equipment',
  'core-equipment', 'elliptical-machines', 'exercise-bikes', 'exercise-mats',
  'fitness-equipment', 'gym-accessories', 'gym-accessories-1', 'gym-storage',
  'hip-glute-equipment', 'home-gym-equipment', 'home-gym-machines', 'jump-ropes',
  'kettlebells', 'lateral-trainers', 'leg-equipment', 'martial-arts',
  'pedometers', 'pickleball-paddles', 'pilates', 'pilates-chairs',
  'pilates-reformers', 'plates-dumbbells', 'plyo-boxes', 'racks-cages',
  'reaction-training', 'recumbent-steppers', 'rowing-machines', 'specialty-training',
  'sports', 'stair-climbers', 'swedish-ladders', 'timing-systems',
  'treadmills', 'upper-body-ergometers', 'vertical-climbing-machines', 'weight-benches',
  'weight-sleds', 'weightlifting-belts'
);

-- Clinical (22)
UPDATE ppw_collections SET category = 'Clinical' WHERE slug IN (
  'adjustable-beds', 'athlete-management', 'athlete-optimization', 'athlete-performance-measurement',
  'blood-flow-restriction', 'clinical-equipment', 'cpm-machines-accessories', 'dynamometers',
  'electromyography', 'electrotherapy-equipment', 'force-plates', 'iastm-tools',
  'laser-therapy', 'mobility-aids', 'range-of-motion', 'rollators',
  'shockwave-therapy', 'standing-frames', 'therapeutic-ultrasound', 'traction-equipment',
  'treatment-tables', 'wheelchairs'
);

-- Wellness (12)
UPDATE ppw_collections SET category = 'Wellness' WHERE slug IN (
  'air-purifiers', 'disinfectant-generator', 'echo-water', 'emf-protection',
  'filters', 'home-wellness', 'hydrogen-water', 'reverse-osmosis',
  'smart-scales', 'tyent', 'water-bottles', 'water-ionizers'
);

-- Operational collections: hide from the content queue rather than categorising them.
UPDATE ppw_collections SET is_hidden = TRUE WHERE slug IN ('non-bb', 'truemed-eligible', 'optimization');

-- Verify before committing.
SELECT category, collection_type, COUNT(*) FROM ppw_collections GROUP BY 1, 2 ORDER BY 1, 2;
SELECT slug FROM ppw_collections WHERE category IS NULL OR category = '' ORDER BY slug;

COMMIT;
