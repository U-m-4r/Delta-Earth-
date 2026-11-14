import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { compareRasters, inspectPixel } from './processing.js';
import { analyzeStudyArea, getAvailability, getProcessedObservation, getProcessedObservations, getStudy } from './service.js';
import { GeometryValidationError } from './geometry.js';

const port = Number(process.env.PORT ?? 8787);
const config = {
  baseUrl: process.env.CMR_BASE_URL ?? 'https://cmr.earthdata.nasa.gov',
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 20_000),
  pageSize: Number(process.env.CMR_PAGE_SIZE ?? 100),
  dataDir: process.env.DATA_DIR ?? `${process.cwd()}/data`,
};

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    response.end();
    return;
  }
  if (request.method === 'GET' && (request.url === '/health' || request.url === '/api/health')) {
    sendJson(response, 200, { ok: true, service: 'dancing-with-sar-backend' });
    return;
  }
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const studyRoute = requestUrl.pathname.match(/^\/api\/studies\/([^/]+)(?:\/(.+))?$/);
  if (request.method === 'GET' && studyRoute) {
    const [, studyId, suffix] = studyRoute;
    const study = getStudy(studyId);
    if (!study) {
      sendJson(response, 404, { error: 'Study not found. Analyze the polygon first to create a study.' });
      return;
    }
    if (!suffix) sendJson(response, 200, { studyId, polygon: study.polygon, analysis: study.analysis, createdAt: study.createdAt });
    else if (suffix === 'processing/status') sendJson(response, 200, study.processing);
    else if (suffix === 'availability') sendJson(response, 200, getAvailability(studyId));
    else if (suffix === 'processed-observations') sendJson(response, 200, { studyId, observations: getProcessedObservations(studyId) });
    else if (suffix === 'timeseries') sendJson(response, 200, { studyId, series: getProcessedObservations(studyId)?.filter((item) => item.processingStatus === 'processed').map((item) => ({ observationId: item.id, acquiredAt: item.acquiredAt, statistics: item.raster })) ?? [], warnings: [] });
    else if (suffix === 'layers') sendJson(response, 200, { studyId, layers: getProcessedObservations(studyId)?.flatMap((item) => item.raster ? [{ observationId: item.id, ...item.raster }] : []) ?? [], warnings: [] });
    else if (suffix === 'analysis') sendJson(response, 200, { studyId, analysis: null, warnings: ['Backscatter analysis requires a processed raster.'] });
    else if (suffix === 'compare') {
      const baseline = getProcessedObservation(studyId, requestUrl.searchParams.get('baseline') ?? '');
      const current = getProcessedObservation(studyId, requestUrl.searchParams.get('current') ?? '');
      if (!baseline?.raster?.path || !current?.raster?.path) sendJson(response, 409, { error: 'Both observations must be processed before comparison.' });
      else {
        try { sendJson(response, 200, await compareRasters(baseline.raster.path, current.raster.path, config.timeoutMs)); }
        catch (error) { sendJson(response, 422, { error: error instanceof Error ? error.message : 'Unable to compare processed rasters.' }); }
      }
    }
    else if (suffix === 'context') sendJson(response, 200, { studyId, context: [], warnings: ['Ancillary datasets are not configured.'] });
    else if (suffix === 'story') sendJson(response, 200, { studyId, story: null, warnings: ['Story generation requires processed measurements and supporting context.'] });
    else if (suffix === 'observations') sendJson(response, 200, { studyId, observations: study.analysis.observations });
    else if (suffix === 'collections') sendJson(response, 200, { studyId, collections: study.analysis.collections });
    else if (suffix?.startsWith('observations/')) {
      const observationPath = suffix.slice('observations/'.length);
      const assetMatch = observationPath.match(/^(.*)\/(preview|raster|pixel)$/);
      const observationId = assetMatch ? assetMatch[1] : observationPath.endsWith('/metadata') ? observationPath.slice(0, -'/metadata'.length) : observationPath;
      const observation = getProcessedObservation(studyId, observationId);
      if (!observation) sendJson(response, 404, { error: 'Observation not found.' });
      else if (observationPath.endsWith('/pixel')) {
        const longitude = Number(requestUrl.searchParams.get('longitude'));
        const latitude = Number(requestUrl.searchParams.get('latitude'));
        if (!observation.raster?.path || !Number.isFinite(longitude) || !Number.isFinite(latitude)) sendJson(response, 400, { error: 'A processed raster and finite longitude/latitude are required.' });
        else {
          try { sendJson(response, 200, await inspectPixel(observation.raster.path, longitude, latitude, config.timeoutMs)); }
          catch (error) { sendJson(response, 422, { error: error instanceof Error ? error.message : 'Unable to inspect raster pixel.' }); }
        }
      }
      else if (assetMatch) {
        const path = assetMatch[2] === 'preview' ? observation.raster?.previewPath : observation.raster?.path;
        if (!path) sendJson(response, 409, { error: `Observation is not processed: ${observation.processingStatus}.` });
        else {
          try {
            const body = await readFile(path);
            response.writeHead(200, { 'Content-Type': assetMatch[2] === 'preview' ? 'image/png' : 'image/tiff', 'Cache-Control': 'public, max-age=3600' });
            response.end(body);
          } catch (error) {
            sendJson(response, 404, { error: error instanceof Error ? error.message : 'Processed raster asset is unavailable.' });
          }
        }
      }
      else if (observationPath.endsWith('/metadata')) sendJson(response, 200, observation);
      else sendJson(response, 200, observation);
    } else sendJson(response, 404, { error: 'Route not found.' });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/api/study-areas/analyze') {
    sendJson(response, 404, { error: 'Route not found.' });
    return;
  }
  try {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 1_000_000) throw new Error('Request body exceeds the 1 MB limit.');
    }
    const input = JSON.parse(raw);
    const result = await analyzeStudyArea(input, config);
    sendJson(response, 200, result);
  } catch (error) {
    const status = error instanceof GeometryValidationError || error instanceof SyntaxError ? 400 : 502;
    sendJson(response, status, { error: error instanceof Error ? error.message : 'Unable to analyze study area.' });
  }
});

server.listen(port, () => console.log(`Dancing With SAR backend listening on http://localhost:${port}`));
