import { access, mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GeoJsonPolygon, Observation, ObservationProcessingStatus, ProcessedObservation } from './types.js';

const execFileAsync = promisify(execFile);
const processorScript = resolve(process.cwd(), 'src/processing/process_nisar.py');
const python = process.env.PYTHON_BIN ?? 'python3';

export type ProcessingConfig = {
  dataDir: string;
  timeoutMs: number;
  baseUrl: string;
};

type ProcessorResult = {
  path?: string;
  previewPath?: string;
  url?: string;
  previewUrl?: string;
  measurement: string;
  units?: string;
  bounds: [number, number, number, number];
  crs?: string;
  width: number;
  height: number;
  resolution: [number, number];
  validPixelCount: number;
  nodataPixelCount: number;
};

export type StoredProcessing = {
  status: ObservationProcessingStatus;
  processingError?: string;
  raster?: ProcessorResult;
};

async function downloadObservation(observation: Observation, destination: string, timeoutMs: number): Promise<void> {
  if (!observation.downloadUrl) throw new Error('The CMR record has no downloadable data asset.');
  await mkdir(dirname(destination), { recursive: true });
  const response = await fetch(observation.downloadUrl, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: process.env.EARTHDATA_TOKEN ? { Authorization: `Bearer ${process.env.EARTHDATA_TOKEN}` } : undefined,
    redirect: 'follow',
  });
  if (!response.ok || !response.body) throw new Error(`Granule download returned HTTP ${response.status}.`);
  const stream = createWriteStream(destination);
  for await (const chunk of response.body) {
    if (!stream.write(Buffer.from(chunk))) await once(stream, 'drain');
  }
  stream.end();
  await finished(stream);
}

async function runProcessor(input: string, polygon: GeoJsonPolygon, output: string, preview: string, timeoutMs: number): Promise<ProcessorResult> {
  const polygonPath = `${output}.polygon.json`;
  await writeFile(polygonPath, JSON.stringify(polygon), 'utf8');
  const { stdout } = await execFileAsync(python, [processorScript, '--input', input, '--polygon', polygonPath, '--output', output, '--preview', preview], { timeout: timeoutMs, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout) as ProcessorResult;
}

export async function processObservation(studyId: string, observation: Observation, polygon: GeoJsonPolygon, config: ProcessingConfig): Promise<StoredProcessing> {
  const directory = join(config.dataDir, 'studies', studyId, 'observations', observation.id.replace(/[^A-Za-z0-9._-]/g, '_'));
  const input = join(directory, 'source.h5');
  const output = join(directory, 'clipped.tif');
  const preview = join(directory, 'preview.png');
  await mkdir(directory, { recursive: true });
  try {
    await access(input).catch(() => downloadObservation(observation, input, config.timeoutMs));
    const raster = await runProcessor(input, polygon, output, preview, config.timeoutMs);
    return {
      status: 'processed',
      raster: {
        ...raster,
        path: output,
        previewPath: preview,
        url: `/api/studies/${studyId}/observations/${observation.id}/raster`,
        previewUrl: `/api/studies/${studyId}/observations/${observation.id}/preview`,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown processing error.';
    const status: ObservationProcessingStatus = /unsupported|no suitable|hdf5|rasterio|h5py/i.test(message) ? 'unsupported_product_format' : 'failed';
    return { status, processingError: message };
  }
}

export async function inspectPixel(rasterPath: string, longitude: number, latitude: number, timeoutMs: number): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync(python, [processorScript, '--pixel-raster', rasterPath, '--longitude', String(longitude), '--latitude', String(latitude)], { timeout: timeoutMs, maxBuffer: 128 * 1024 });
  return JSON.parse(stdout) as Record<string, unknown>;
}

export async function compareRasters(baselinePath: string, currentPath: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync(python, [processorScript, '--compare-a', baselinePath, '--compare-b', currentPath], { timeout: timeoutMs, maxBuffer: 128 * 1024 });
  return JSON.parse(stdout) as Record<string, unknown>;
}
