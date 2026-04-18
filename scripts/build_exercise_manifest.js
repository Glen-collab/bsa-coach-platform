// build_exercise_manifest.js
// Reads the four bundled exercise libraries from workoutbuilder-tkd and emits
// a flat JSON manifest the coach Media Library UI can render as a checklist.
//
// Output: src/data/exercise_manifest.json
//
// Run: node scripts/build_exercise_manifest.js
//
// Re-run whenever the source libraries gain/lose exercises.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SOURCE_DIR = resolve(REPO_ROOT, '..', 'workoutbuilder-tkd', 'src', 'data');
const OUT_PATH = resolve(REPO_ROOT, 'src', 'data', 'exercise_manifest.json');

const sources = [
  { file: 'exerciseLibrary.js',  exportName: 'exerciseCategories',     libraryId: 'exerciseLibrary'    },
  { file: 'martialArtsLibrary.js', exportName: 'martialArtsCategories', libraryId: 'martialArtsLibrary' },
  { file: 'mobilityExercises.js', exportName: 'mobilityCategories',    libraryId: 'mobilityExercises'  },
  { file: 'warmupExercises.js',   exportName: 'warmupCategories',      libraryId: 'warmupExercises'    },
];

const extractUid = (url) => {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/videodelivery\.net\/([a-f0-9]+)/i);
  return m ? m[1] : null;
};

const manifest = [];

for (const src of sources) {
  const url = pathToFileURL(resolve(SOURCE_DIR, src.file)).href;
  const mod = await import(url);
  const categories = mod[src.exportName];
  if (!categories) {
    console.warn(`⚠ ${src.file}: export "${src.exportName}" not found, skipping`);
    continue;
  }
  let count = 0;
  for (const [catId, cat] of Object.entries(categories)) {
    const categoryLabel = cat.label || catId;
    // Two shapes: cat.exercises[] OR cat.subcategories[].exercises[]
    if (Array.isArray(cat.exercises)) {
      for (const ex of cat.exercises) {
        if (!ex?.name) continue;
        manifest.push({
          name: ex.name,
          category: categoryLabel,
          subcategory: null,
          source_library: src.libraryId,
          has_default_video: Boolean(ex.youtube),
          default_video_uid: extractUid(ex.youtube),
        });
        count++;
      }
    }
    if (cat.subcategories && typeof cat.subcategories === 'object') {
      for (const [subId, sub] of Object.entries(cat.subcategories)) {
        const subLabel = sub.label || subId;
        if (!Array.isArray(sub.exercises)) continue;
        for (const ex of sub.exercises) {
          if (!ex?.name) continue;
          manifest.push({
            name: ex.name,
            category: categoryLabel,
            subcategory: subLabel,
            source_library: src.libraryId,
            has_default_video: Boolean(ex.youtube),
          default_video_uid: extractUid(ex.youtube),
          });
          count++;
        }
      }
    }
  }
  console.log(`  ${src.libraryId}: ${count} exercises`);
}

// Dedupe by (name, source_library) — keep first occurrence
const seen = new Set();
const deduped = manifest.filter((e) => {
  const key = `${e.source_library}::${e.name}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      total: deduped.length,
      exercises: deduped,
    },
    null,
    2
  )
);

console.log(`\nWrote ${deduped.length} exercises → ${OUT_PATH}`);
console.log(`  with default video: ${deduped.filter(e => e.has_default_video).length}`);
console.log(`  without default video: ${deduped.filter(e => !e.has_default_video).length}`);
