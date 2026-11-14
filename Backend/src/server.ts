import { createServer } from 'node:http';
import { analyzeStudyArea, getAvailability, getProcessedObservations, getStudy } from './service.js';
import { GeometryValidationError } from './geometry.js';

const port = Number(process.env.PORT ?? 8787);
const config = {
  baseUrl: process.env.CMR_BASE_URL ?? 'https://cmr.earthdata.nasa.gov',
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 20_000),
  pageSize: Number(process.env.CMR_PAGE_SIZE ?? 100),
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
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { ok: true, service: 'dancing-with-sar-backend' });
    return;
  }
  const studyRoute = request.url?.match(/^\/api\/studies\/([^/]+)(?:\/(.+))?$/);
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
    else if (suffix === 'timeseries') sendJson(response, 200, { studyId, series: [], warnings: ['No processed raster measurements are available.'] });
    else if (suffix === 'layers') sendJson(response, 200, { studyId, layers: [], warnings: ['No GeoTIFF or tile layers have been generated.'] });
    else if (suffix === 'analysis') sendJson(response, 200, { studyId, analysis: null, warnings: ['Backscatter analysis requires a processed raster.'] });
    else if (suffix === 'context') sendJson(response, 200, { studyId, context: [], warnings: ['Ancillary datasets are not configured.'] });
    else if (suffix === 'story') sendJson(response, 200, { studyId, story: null, warnings: ['Story generation requires processed measurements and supporting context.'] });
    else if (suffix === 'observations') sendJson(response, 200, { studyId, observations: study.analysis.observations });
    else if (suffix === 'collections') sendJson(response, 200, { studyId, collections: study.analysis.collections });
    else if (suffix?.startsWith('observations/')) {
      const observationPath = suffix.slice('observations/'.length);
      const observationId = observationPath.endsWith('/metadata') ? observationPath.slice(0, -'/metadata'.length) : observationPath;
      const observation = study.analysis.observations.find((item) => item.id === observationId);
      if (!observation) sendJson(response, 404, { error: 'Observation not found.' });
      else if (observationPath.endsWith('/metadata')) sendJson(response, 200, { ...observation, sourceMetadata: observation.sourceMetadata, processingStatus: 'not_processed', methodology: null });
      else sendJson(response, 200, { ...observation, processingStatus: 'not_processed', layers: [], statistics: null });
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
