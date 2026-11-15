// Rebuilds the saved stories from real NISAR files through the running local backend.
// Usage: start the backend, add your Earthdata token in the app, then: node scripts/build-case-studies.mjs [slug ...]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';

const exec = promisify(execFile);
const api = process.env.BACKEND_URL ?? 'http://127.0.0.1:8787';
const python = process.env.PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3');
const backendDir = resolve(import.meta.dirname, '..');
const outputRoot = resolve(backendDir, '../Frontend/public/case-studies');
const stories = JSON.parse(await readFile(join(backendDir, 'case-studies/stories.json'), 'utf8'));
const only = process.argv.slice(2);

async function call(path, init) {
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${body.error ?? response.status}`);
  return body;
}

async function waitForPreparation(studyId) {
  for (;;) {
    const status = await call(`/api/studies/${studyId}/processing/status`);
    if (!['queued', 'processing'].includes(status.status)) return status;
    await new Promise((done) => setTimeout(done, 3000));
  }
}

for (const story of stories.filter((item) => !only.length || only.includes(item.slug))) {
  console.log(`\n${story.title}`);
  const feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [story.ring] }, properties: { name: story.title, ...(story.channel ? { channel: story.channel } : {}) } };
  const analysis = await call('/api/study-areas/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(feature) });
  const ids = story.observations.map((item) => item.granule);
  for (const id of ids) if (!analysis.observations.some((item) => item.id === id)) throw new Error(`${id} was not returned by NASA for ${story.slug}.`);
  for (let index = 0; index < ids.length - 1; index += 1) {
    await call(`/api/studies/${analysis.studyId}/process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ observationIds: [ids[index], ids[index + 1]] }) });
    const status = await waitForPreparation(analysis.studyId);
    if (status.errors?.length) throw new Error(status.errors.join(' '));
  }
  const processed = (await call(`/api/studies/${analysis.studyId}/processed-observations`)).observations;
  const observations = story.observations.map((item) => {
    const record = processed.find((entry) => entry.id === item.granule);
    if (record?.processingStatus !== 'processed') throw new Error(`${item.granule} is ${record?.processingStatus ?? 'missing'}.`);
    console.log(`  ${record.acquiredAt.slice(0, 10)}  ${(record.bytesTransferred ?? 0) / 1048576 | 0} MB read of ${Math.round(record.sourceMetadata.granuleSizeMb)} MB`);
    return { ...item, tif: resolve(backendDir, record.raster.path), id: record.id, granuleId: record.title, date: record.acquiredAt, sourceUrl: record.downloadUrl, maturity: record.processingMaturity, bytesRead: record.bytesTransferred ?? null, fileSizeMb: record.sourceMetadata.granuleSizeMb ?? null };
  });
  const outputDir = join(outputRoot, story.slug);
  await mkdir(outputDir, { recursive: true });
  const config = { ...story, outputDir, polygon: feature, observations, areaKm2: analysis.area.areaKm2 };
  delete config.ring;
  const configPath = join(backendDir, 'data', `${story.slug}.case-study.json`);
  await writeFile(configPath, JSON.stringify(config, null, 1));
  const { stdout } = await exec(python, [join(backendDir, 'src/processing/process_nisar.py'), '--case-study', configPath], { maxBuffer: 4 * 1024 * 1024, timeout: 900000 });
  console.log(`  ${stdout.trim()}`);
}

const index = [];
for (const story of stories) {
  try { await readFile(join(outputRoot, story.slug, 'result.json')); const xs = story.ring.map((p) => p[0]); const ys = story.ring.map((p) => p[1]); index.push({ slug: story.slug, title: story.title, location: story.location, changeType: story.changeType, center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] }); } catch { /* not built yet */ }
}
await writeFile(join(outputRoot, 'index.json'), JSON.stringify(index, null, 1));
console.log(`\nStories available: ${index.map((item) => item.slug).join(', ')}`);
