// build_exercise_index.mjs
// Builds the exercise index served by GET /api/workout/exercise-index — the
// list the tracker (and any future native app) uses for exercise swaps and for
// filling in demo videos a saved program never baked. Moved here from
// WorkoutTracker/scripts/generate-swap-index.mjs so the list lives on the
// server: adding an exercise no longer needs a tracker rebuild (or, for a
// native app, an App Store review). Same output shape as the old swap index.
//
// Approved rows in custom_exercises are merged in at request time by the
// endpoint, so exercises saved from the builder show up without re-running this.
//
// Run from this repo root:  node scripts/build_exercise_index.mjs
// Re-run whenever the builder's bundled libraries change, then deploy
// backend/data/exercise_index.json.
//
// Reads:  ../workoutbuilder/src/data/{exerciseLibrary,mobilityExercises,generalMovements}.js
// Writes: backend/data/exercise_index.json

import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const libPath = resolve(here, '../../workoutbuilder/src/data/exerciseLibrary.js');
const mobPath = resolve(here, '../../workoutbuilder/src/data/mobilityExercises.js');
const gmPath = resolve(here, '../../workoutbuilder/src/data/generalMovements.js');
const outPath = resolve(here, '../backend/data/exercise_index.json');

const uid = (yt) => {
  if (!yt || typeof yt !== 'string') return '';
  const m = yt.match(/([A-Za-z0-9]{20,})\/?$/);
  return m ? m[1] : '';
};

// The builder library uses extensionless relative imports (Vite-style) that
// bare node ESM can't resolve, so bundle it to a temp ESM file with esbuild
// (which inlines ./generalMovements etc.) and import that.
const tmp = mkdtempSync(join(tmpdir(), 'swapidx-'));
async function load(path, name) {
  const bundled = join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path], bundle: true, format: 'esm', outfile: bundled, logLevel: 'silent' });
  return import(pathToFileURL(bundled).href);
}
const mod = await load(libPath, 'lib');
const mobMod = await load(mobPath, 'mob');
const gmMod = await load(gmPath, 'gm');
rmSync(tmp, { recursive: true, force: true });
const categories = mod.exerciseCategories || mod.default?.exerciseCategories;
if (!categories) {
  console.error('Could not find exerciseCategories export in', libPath);
  process.exit(1);
}

const list = [];
const seen = new Set();

// Walks a category map, handling BOTH shapes the libraries use: nested
// subcategories (strength) and a flat exercises array (most mobility and
// movement categories). The original only walked subcategories, which is why
// mobility and conditioning work never made it into the index — and therefore
// why those exercises could never find a "similar" substitute.
function collect(cats) {
  for (const [catKey, catVal] of Object.entries(cats || {})) {
    // [subKey, exercises] — subKey null for a flat category.
    const pools = [];
    if (Array.isArray(catVal)) pools.push([null, catVal]);
    else {
      if (Array.isArray(catVal?.exercises)) pools.push([null, catVal.exercises]);
      for (const [subKey, subVal] of Object.entries(catVal?.subcategories || {})) {
        pools.push([subKey, Array.isArray(subVal) ? subVal : (subVal?.exercises || [])]);
      }
    }
    for (const [subKey, pool] of pools) {
      for (const ex of pool) {
        if (!ex?.name || seen.has(ex.name)) continue;
        seen.add(ex.name);
        list.push({
          name: ex.name,
          category: catKey,
          // Carried so the tracker can narrow swaps for families that have no
          // movement tags. Warm-ups and cool-downs are the case that matters:
          // nothing marks a butt kick as a sprint drill and a foam roll as
          // myofascial EXCEPT which subcategory the coach filed it under, so
          // dropping this left every warm-up matching all 171 of them.
          sub: subKey || '',
          equipment: Array.isArray(ex.equipment) ? ex.equipment : [],
          movement: Array.isArray(ex.movement) ? ex.movement : [],
          video: uid(ex.youtube),
        });
      }
    }
  }
}

collect(categories);
collect(mobMod.mobilityCategories || mobMod.default?.mobilityCategories);
collect(gmMod.generalMovements || gmMod.default?.generalMovements);

list.sort((a, b) => a.name.localeCompare(b.name));
const out = {
  generatedFrom: 'workoutbuilder/src/data/{exerciseLibrary,mobilityExercises,generalMovements}.js',
  count: list.length,
  list,
};
writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${list.length} exercises -> ${outPath}`);
