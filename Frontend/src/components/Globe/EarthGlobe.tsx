import { useEffect, useRef, useState } from 'react';
import { BoundingSphere, CameraEventType, Cartesian2, Cartesian3, Cartographic, Color, defined, EllipsoidTerrainProvider, HeightReference, ImageryLayer, PolygonHierarchy, Rectangle, ScreenSpaceEventHandler, ScreenSpaceEventType, SingleTileImageryProvider, Viewer, Math as CesiumMath } from 'cesium';
import type { RefObject } from 'react';
import { createBaseMapProvider } from '../../config/mapProvider';
import { StoryMarkerLayer } from './StoryMarkerLayer';
import type { StoryPick } from './StoryMarkerLayer';
import { StoryPreview } from './StoryPreview';
import type { StoryIndexItem } from '../../types/stories';
import type { GeoJsonFeature, Position } from '../../types/geojson';
import type { LocationResult } from '../../services/locationSearchService';
import type { RasterOverlay } from '../../types/visualization';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './storyMarkers.css';

export type GlobeCameraState = { position: Cartesian3; direction: Cartesian3; up: Cartesian3 };
type Props = { stories: StoryIndexItem[]; storiesVisible: boolean; onOpenStory: (slug: string) => void;
  cameraMemory: RefObject<GlobeCameraState | null>; selectionActive: boolean; draftVertexCount: number; location?: LocationResult; clearSignal: number; undoSignal: number; homeSignal: number; focusRequest: { selection: GeoJsonFeature; id: number } | null; rasterOverlay?: RasterOverlay | null; onRasterClick?: (coordinates: [number, number]) => void; onDraftChange: (count: number) => void; onSelectionChange: (selection: GeoJsonFeature | null) => void; onCursorChange: (cursor: [number, number] | null) => void };

const MINIMUM_ZOOM_DISTANCE = 35_000;

export function EarthGlobe({ stories, storiesVisible, onOpenStory, cameraMemory, selectionActive, draftVertexCount, location, clearSignal, undoSignal, homeSignal, focusRequest, rasterOverlay, onRasterClick, onDraftChange, onSelectionChange, onCursorChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const markerLayerRef = useRef<StoryMarkerLayer | null>(null);
  const [storyPick, setStoryPick] = useState<StoryPick>({ choices: [], selected: null });
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const positionsRef = useRef<Position[]>([]);
  const activeRef = useRef(selectionActive);
  const rasterClickRef = useRef(onRasterClick);
  const [viewerReady, setViewerReady] = useState(false);
  const [overlayError, setOverlayError] = useState<string | null>(null);

  useEffect(() => { activeRef.current = selectionActive; }, [selectionActive]);
  useEffect(() => { rasterClickRef.current = onRasterClick; }, [onRasterClick]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.add(new ImageryLayer(createBaseMapProvider()));
    let cancelled = false;
    setOverlayError(null);
    if (rasterOverlay) {
      const [west, south, east, north] = rasterOverlay.boundsWgs84;
      // The current Cesium constructor requires image dimensions. Its factory
      // loads the existing preview and obtains those dimensions without guesses.
      void SingleTileImageryProvider.fromUrl(rasterOverlay.url, {
        rectangle: Rectangle.fromDegrees(west, south, east, north),
      }).then(provider => {
        if (cancelled || viewer.isDestroyed()) return;
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = rasterOverlay.opacity ?? 0.9;
      }).catch(() => {
        if (!cancelled && !viewer.isDestroyed()) setOverlayError('The saved raster overlay could not be displayed.');
      });
    }
    return () => { cancelled = true; };
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
      baseLayer: new ImageryLayer(createBaseMapProvider()),
      terrainProvider: new EllipsoidTerrainProvider(),
      animation: false, timeline: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, fullscreenButton: false, baseLayerPicker: false, infoBox: false, selectionIndicator: false,
    });
    viewerRef.current = viewer;
    setViewerReady(true);
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.requestRenderMode = false;
    viewer.camera.setView(cameraMemory.current ? { destination: cameraMemory.current.position,
      orientation: { direction: cameraMemory.current.direction, up: cameraMemory.current.up } } : {
      destination: Cartesian3.fromDegrees(-18, 18, 7_200_000),
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-90),
        roll: 0,
      },
    });
    const markers = new StoryMarkerLayer(viewer, setStoryPick);
    markerLayerRef.current = markers;
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
      markers.cancelFlight();
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
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      if (!activeRef.current && markers.click(movement.position)) return;
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
    for (const type of [ScreenSpaceEventType.LEFT_DOWN, ScreenSpaceEventType.RIGHT_DOWN, ScreenSpaceEventType.PINCH_START]) {
      handler.setInputAction(() => markers.cancelFlight(), type);
    }
    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      if (!activeRef.current) markers.move(movement.endPosition);
      const cartesian = pickSurface(movement.endPosition);
      if (!defined(cartesian)) { onCursorChange(null); return; }
      const cartographic = Cartographic.fromCartesian(cartesian);
      onCursorChange([CesiumMath.toDegrees(cartographic.longitude), CesiumMath.toDegrees(cartographic.latitude)]);
    }, ScreenSpaceEventType.MOUSE_MOVE);
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape' && markers.hasPreview) { markers.clear(); canvas.focus({ preventScroll: true }); } };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.globe-story-preview') && event.target !== canvas) markers.clear();
    };
    const leave = () => markers.clearHover();
    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', outside);
    canvas.addEventListener('pointerleave', leave);
    return () => {
      cameraMemory.current = { position: Cartesian3.clone(viewer.camera.positionWC), direction: Cartesian3.clone(viewer.camera.directionWC), up: Cartesian3.clone(viewer.camera.upWC) };
      document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', outside);
      canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('wheel', handleTrackpadZoom);
      markers.destroy(); markerLayerRef.current = null; handler.destroy(); viewer.destroy(); setViewerReady(false);
    };
  }, [onCursorChange, onDraftChange, onSelectionChange]);

  useEffect(() => { markerLayerRef.current?.update(stories); }, [stories, viewerReady]);
  useEffect(() => { markerLayerRef.current?.setVisible(storiesVisible, selectionActive); }, [storiesVisible, selectionActive, viewerReady]);

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
      polyline: { positions: closedRing.map(([longitude, latitude]) => Cartesian3.fromDegrees(longitude, latitude)), width: 3, material: Color.fromCssColorString('#64e1d6'), clampToGround: true },
      polygon: ring.length >= 3 ? { hierarchy: new PolygonHierarchy(ring.map(([longitude, latitude]) => Cartesian3.fromDegrees(longitude, latitude))), material: Color.fromCssColorString('#49cfc855'), height: 0, heightReference: HeightReference.CLAMP_TO_GROUND } : undefined,
    });
    ring.forEach(([longitude, latitude], index) => viewer.entities.add({
      name: 'study-area-drawing',
      position: Cartesian3.fromDegrees(longitude, latitude),
      point: { pixelSize: index === 0 ? 11 : 8, color: index === 0 ? Color.WHITE : Color.fromCssColorString('#64e1d6'), outlineColor: Color.fromCssColorString('#0b222d'), outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND },
      label: { text: `${index + 1}`, font: '10px DM Mono', fillColor: Color.WHITE, pixelOffset: new Cartesian2(0, -18), showBackground: true, backgroundColor: Color.fromCssColorString('#0b222dcc') },
    }));
  }, [draftVertexCount]);

  return <>
    <div ref={containerRef} className="cesium-container" />
    {overlayError && <div className="globe-overlay-error" role="alert">{overlayError}</div>}
    {storiesVisible && !selectionActive && storyPick.choices.length > 0 && <StoryPreview pick={storyPick}
      onChoose={slug => markerLayerRef.current?.select(slug)}
      onClose={() => { markerLayerRef.current?.clear(); viewerRef.current?.canvas.focus({ preventScroll: true }); }}
      onExplore={onOpenStory} />}
  </>;
}

function createFeature(points: Position[]): GeoJsonFeature {
  const ring = [...points, points[0]];
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { name: 'Selected Study Area', coordinateSystem: 'EPSG:4326' } };
}
