import { useEffect, useRef, useState } from 'react';
import { BoundingSphere, CameraEventType, Cartesian2, Cartesian3, Cartographic, Color, defined, EllipsoidTerrainProvider, HeightReference, JulianDate, NearFarScalar, PolygonHierarchy, Rectangle, ScreenSpaceEventHandler, ScreenSpaceEventType, SingleTileImageryProvider, UrlTemplateImageryProvider, Viewer, Math as CesiumMath } from 'cesium';
import type { GeoJsonFeature, Position } from '../../types/geojson';
import type { LocationResult } from '../../services/locationSearchService';
import type { RasterOverlay } from '../../types/visualization';
import type { StoryIndexItem } from '../../types/stories';
import 'cesium/Build/Cesium/Widgets/widgets.css';

const STORY_PREFIX = 'story:';

type Props = { stories?: StoryIndexItem[]; onStoryClick?: (slug: string) => void; selectionActive: boolean; draftVertexCount: number; location?: LocationResult; clearSignal: number; undoSignal: number; homeSignal: number; focusRequest: { selection: GeoJsonFeature; id: number } | null; rasterOverlay?: RasterOverlay | null; onRasterClick?: (coordinates: [number, number]) => void; onDraftChange: (count: number) => void; onSelectionChange: (selection: GeoJsonFeature | null) => void; onCursorChange?: (cursor: [number, number] | null) => void };

const MINIMUM_ZOOM_DISTANCE = 35_000;

export function EarthGlobe({ stories = [], onStoryClick, selectionActive, draftVertexCount, location, clearSignal, undoSignal, homeSignal, focusRequest, rasterOverlay, onRasterClick, onDraftChange, onSelectionChange, onCursorChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const positionsRef = useRef<Position[]>([]);
  const activeRef = useRef(selectionActive);
  const rasterClickRef = useRef(onRasterClick);
  const storyClickRef = useRef(onStoryClick);
  const [viewerReady, setViewerReady] = useState(false);

  useEffect(() => { activeRef.current = selectionActive; }, [selectionActive]);
  useEffect(() => { rasterClickRef.current = onRasterClick; }, [onRasterClick]);
  useEffect(() => { storyClickRef.current = onStoryClick; }, [onStoryClick]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return undefined;
    const added = stories.filter((story) => story.center).map((story) => viewer.entities.add({
      id: STORY_PREFIX + story.slug,
      position: Cartesian3.fromDegrees(story.center![0], story.center![1]),
      point: { pixelSize: 14, color: Color.fromCssColorString('#fc3d21'), outlineColor: Color.WHITE, outlineWidth: 2 },
      label: { text: story.title, font: '600 12px Inter, sans-serif', fillColor: Color.WHITE, showBackground: true, backgroundColor: Color.fromCssColorString('#18181bcc'), pixelOffset: new Cartesian2(0, -22), translucencyByDistance: new NearFarScalar(1_500_000, 1, 5_000_000, 0) },
    }));
    return () => { if (!viewer.isDestroyed()) added.forEach((entity) => viewer.entities.remove(entity)); };
  }, [stories, viewerReady]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.imageryLayers.removeAll();
    const removeStreetToggle = addBaseLayers(viewer);
    if (rasterOverlay) {
      const [west, south, east, north] = rasterOverlay.boundsWgs84;
      const provider = new SingleTileImageryProvider({
        url: rasterOverlay.url,
        rectangle: Rectangle.fromDegrees(west, south, east, north),
      });
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = rasterOverlay.opacity ?? 0.9;
    }
    return () => { if (!viewer.isDestroyed()) removeStreetToggle(); };
  }, [rasterOverlay, viewerReady]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) {
      viewer.scene.screenSpaceCameraController.enableRotate = !selectionActive;
      viewer.scene.screenSpaceCameraController.enableTranslate = !selectionActive;
    }
  }, [selectionActive]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const viewer = new Viewer(containerRef.current, {
      baseLayer: false, // imagery effect adds the base layers once the viewer is ready
      terrainProvider: new EllipsoidTerrainProvider(),
      animation: false, timeline: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, fullscreenButton: false, baseLayerPicker: false, infoBox: false, selectionIndicator: false,
    });
    viewerRef.current = viewer;
    setViewerReady(true);
    viewer.scene.globe.depthTestAgainstTerrain = false;
    // Ground atmosphere is shaded per tile vertex, so coarse and fine tiles side by side show as light/dark patches.
    viewer.scene.globe.showGroundAtmosphere = false;
    // Fog tints tiles per vertex by distance, which also reads as uneven shading.
    viewer.scene.fog.enabled = false;
    viewer.scene.requestRenderMode = false;
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(80, 26, 7_200_000),
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-90),
        roll: 0,
      },
    });
    const cameraController = viewer.scene.screenSpaceCameraController;
    cameraController.enableInputs = true;
    cameraController.enableRotate = true;
    cameraController.enableTranslate = true;
    cameraController.enableZoom = true;
    cameraController.enableTilt = true;
    cameraController.enableLook = true;
    cameraController.zoomEventTypes = [CameraEventType.PINCH];
    cameraController.rotateEventTypes = [CameraEventType.LEFT_DRAG];
    cameraController.translateEventTypes = [CameraEventType.RIGHT_DRAG, CameraEventType.PINCH];
    cameraController.inertiaSpin = 0.92;
    cameraController.inertiaTranslate = 0.9;
    cameraController.inertiaZoom = 0.92;
    cameraController.zoomFactor = 560;
    cameraController.maximumMovementRatio = 1;
    cameraController.minimumZoomDistance = MINIMUM_ZOOM_DISTANCE;
    cameraController.maximumZoomDistance = 28_000_000;
    cameraController.bounceAnimationTime = 500;
    const canvas = viewer.scene.canvas;
    const handleTrackpadZoom = (event: WheelEvent) => {
      if (!cameraController.enableInputs || activeRef.current) return;
      event.preventDefault();
      const pixels = Math.max(-120, Math.min(120, event.deltaY));
      const currentHeight = viewer.camera.positionCartographic.height;
      const zoomDistance = Math.max(currentHeight * 0.085, 3500);
      const requestedZoom = -pixels * zoomDistance / 100;
      const allowedZoom = Math.max(0, currentHeight - MINIMUM_ZOOM_DISTANCE);
      viewer.camera.zoomIn(Math.min(requestedZoom, allowedZoom));
    };
    canvas.addEventListener('wheel', handleTrackpadZoom, { passive: false });
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current = handler;
    const pickSurface = (windowPosition: Cartesian2) => {
      const ray = viewer.camera.getPickRay(windowPosition);
      return ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
    };
    const pickStory = (windowPosition: Cartesian2): { slug: string; position: Cartesian3 } | null => {
      const entity = viewer.scene.pick(windowPosition)?.id;
      const id: unknown = entity?.id;
      const position = entity?.position?.getValue(JulianDate.now());
      return typeof id === 'string' && id.startsWith(STORY_PREFIX) && position ? { slug: id.slice(STORY_PREFIX.length), position } : null;
    };
    let flying = false;
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      const story = activeRef.current ? null : pickStory(movement.position);
      if (story) {
        if (flying) return;
        flying = true;
        const target = Cartographic.fromCartesian(story.position);
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        viewer.camera.flyTo({
          destination: Cartesian3.fromRadians(target.longitude, target.latitude, 600_000),
          duration: reduceMotion ? 0 : 1.1,
          complete: () => { flying = false; storyClickRef.current?.(story.slug); },
          cancel: () => { flying = false; },
        });
        return;
      }
      const cartesian = pickSurface(movement.position);
      if (!defined(cartesian)) return;
      const cartographic = Cartographic.fromCartesian(cartesian);
      const point: Position = [CesiumMath.toDegrees(cartographic.longitude), CesiumMath.toDegrees(cartographic.latitude)];
      if (!activeRef.current) {
        rasterClickRef.current?.(point);
        return;
      }
      positionsRef.current = [...positionsRef.current, point];
      onDraftChange(positionsRef.current.length);
      if (positionsRef.current.length >= 3) onSelectionChange(createFeature(positionsRef.current));
    }, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      canvas.style.cursor = !activeRef.current && pickStory(movement.endPosition) ? 'pointer' : '';
      const cartesian = pickSurface(movement.endPosition);
      if (!defined(cartesian)) { onCursorChange?.(null); return; }
      const cartographic = Cartographic.fromCartesian(cartesian);
      onCursorChange?.([CesiumMath.toDegrees(cartographic.longitude), CesiumMath.toDegrees(cartographic.latitude)]);
    }, ScreenSpaceEventType.MOUSE_MOVE);
    return () => { canvas.removeEventListener('wheel', handleTrackpadZoom); handler.destroy(); viewer.destroy(); setViewerReady(false); };
  }, [onCursorChange, onDraftChange, onSelectionChange]);

  useEffect(() => {
    if (!viewerRef.current || !location) return;
    viewerRef.current.camera.flyTo({ destination: Cartesian3.fromDegrees(location.longitude, location.latitude, location.boundingBox ? 500000 : 1000000), duration: 1.4 });
  }, [location]);

  useEffect(() => {
    if (homeSignal > 0) viewerRef.current?.camera.flyHome(1.2);
  }, [homeSignal]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !focusRequest) return;
    const positions = focusRequest.selection.geometry.coordinates[0]
      .slice(0, -1)
      .map(([longitude, latitude]) => Cartesian3.fromDegrees(longitude, latitude));
    if (positions.length < 3) return;
    const sphere = BoundingSphere.fromPoints(positions);
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 1.6,
      offset: { heading: 0, pitch: CesiumMath.toRadians(-58), range: Math.max(sphere.radius * 3.2, 35_000) },
    });
  }, [focusRequest]);

  useEffect(() => {
    if (undoSignal === 0) return;
    positionsRef.current = positionsRef.current.slice(0, -1);
    onDraftChange(positionsRef.current.length);
    onSelectionChange(positionsRef.current.length >= 3 ? createFeature(positionsRef.current) : null);
  }, [undoSignal, onDraftChange, onSelectionChange]);

  useEffect(() => {
    if (clearSignal === 0) return;
    positionsRef.current = [];
    onDraftChange(0);
    onSelectionChange(null);
  }, [clearSignal, onDraftChange, onSelectionChange]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.entities.values.filter((entity) => entity.name === 'study-area-drawing').forEach((entity) => viewer.entities.remove(entity));
    const ring = positionsRef.current;
    if (!ring.length) return;
    const closedRing = ring.length > 2 ? [...ring, ring[0]] : ring;
    viewer.entities.add({
      name: 'study-area-drawing',
      polyline: { positions: closedRing.map(([longitude, latitude]) => Cartesian3.fromDegrees(longitude, latitude)), width: 3, material: Color.fromCssColorString('#306bf4'), clampToGround: true },
      polygon: ring.length >= 3 ? { hierarchy: new PolygonHierarchy(ring.map(([longitude, latitude]) => Cartesian3.fromDegrees(longitude, latitude))), material: Color.fromCssColorString('#2563f455'), height: 0, heightReference: HeightReference.CLAMP_TO_GROUND } : undefined,
    });
    ring.forEach(([longitude, latitude], index) => viewer.entities.add({
      name: 'study-area-drawing',
      position: Cartesian3.fromDegrees(longitude, latitude),
      point: { pixelSize: index === 0 ? 11 : 8, color: index === 0 ? Color.WHITE : Color.fromCssColorString('#306bf4'), outlineColor: Color.fromCssColorString('#18181b'), outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND },
      label: { text: `${index + 1}`, font: '10px DM Mono', fillColor: Color.WHITE, pixelOffset: new Cartesian2(0, -18), showBackground: true, backgroundColor: Color.fromCssColorString('#18181bcc') },
    }));
  }, [draftVertexCount]);

  return <div ref={containerRef} className="cesium-container" />;
}

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

// NASA Blue Marble from GIBS for the globe view, and OpenStreetMap only once zoomed past
// Blue Marble's ~600 m resolution (for drawing study areas).
// No GIBS Reference_Features overlay: in EPSG:3857 it serves opaque black tiles, which darkened
// the globe everywhere those tiles had loaded and left bright patches where they hadn't.
function addBaseLayers(viewer: Viewer) {
  viewer.imageryLayers.addImageryProvider(new UrlTemplateImageryProvider({ url: `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`, maximumLevel: 8, credit: 'NASA Blue Marble · GIBS' }));
  // Switch the whole street layer on by camera height, not per tile (minimumTerrainLevel), so street
  // tiles never sit as patches among Blue Marble tiles.
  const streets = viewer.imageryLayers.addImageryProvider(new UrlTemplateImageryProvider({ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', credit: '© OpenStreetMap contributors' }));
  const syncStreets = () => { streets.show = viewer.camera.positionCartographic.height < STREETS_BELOW_M; };
  syncStreets();
  return viewer.scene.preRender.addEventListener(syncStreets);
}

const STREETS_BELOW_M = 250_000; // ~where Blue Marble's 600 m pixels start to blur

function createFeature(points: Position[]): GeoJsonFeature {
  const ring = [...points, points[0]];
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { name: 'Selected Study Area', coordinateSystem: 'EPSG:4326' } };
}
