import { useEffect, useRef } from 'react';
import { BoundingSphere, CameraEventType, Cartesian2, Cartesian3, Cartographic, Color, defined, EllipsoidTerrainProvider, HeightReference, ImageryLayer, PolygonHierarchy, ScreenSpaceEventHandler, ScreenSpaceEventType, UrlTemplateImageryProvider, Viewer, Math as CesiumMath } from 'cesium';
import type { GeoJsonFeature, Position } from '../../types/geojson';
import type { LocationResult } from '../../services/locationSearchService';
import 'cesium/Build/Cesium/Widgets/widgets.css';

type Props = { selectionActive: boolean; draftVertexCount: number; location?: LocationResult; clearSignal: number; undoSignal: number; homeSignal: number; focusRequest: { selection: GeoJsonFeature; id: number } | null; onDraftChange: (count: number) => void; onSelectionChange: (selection: GeoJsonFeature | null) => void; onCursorChange: (cursor: [number, number] | null) => void };

const MINIMUM_ZOOM_DISTANCE = 35_000;

export function EarthGlobe({ selectionActive, draftVertexCount, location, clearSignal, undoSignal, homeSignal, focusRequest, onDraftChange, onSelectionChange, onCursorChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const positionsRef = useRef<Position[]>([]);
  const activeRef = useRef(selectionActive);

  useEffect(() => { activeRef.current = selectionActive; }, [selectionActive]);
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
      baseLayer: new ImageryLayer(new UrlTemplateImageryProvider({ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', credit: '© OpenStreetMap contributors' })),
      terrainProvider: new EllipsoidTerrainProvider(),
      animation: false, timeline: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, fullscreenButton: false, baseLayerPicker: false, infoBox: false, selectionIndicator: false,
    });
    viewerRef.current = viewer;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.requestRenderMode = false;
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(-18, 18, 7_200_000),
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
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      if (!activeRef.current) return;
      const cartesian = pickSurface(movement.position);
      if (!defined(cartesian)) return;
      const cartographic = Cartographic.fromCartesian(cartesian);
      const point: Position = [CesiumMath.toDegrees(cartographic.longitude), CesiumMath.toDegrees(cartographic.latitude)];
      positionsRef.current = [...positionsRef.current, point];
      onDraftChange(positionsRef.current.length);
      if (positionsRef.current.length >= 3) onSelectionChange(createFeature(positionsRef.current));
    }, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      const cartesian = pickSurface(movement.endPosition);
      if (!defined(cartesian)) { onCursorChange(null); return; }
      const cartographic = Cartographic.fromCartesian(cartesian);
      onCursorChange([CesiumMath.toDegrees(cartographic.longitude), CesiumMath.toDegrees(cartographic.latitude)]);
    }, ScreenSpaceEventType.MOUSE_MOVE);
    return () => { canvas.removeEventListener('wheel', handleTrackpadZoom); handler.destroy(); viewer.destroy(); };
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

  return <div ref={containerRef} className="cesium-container" />;
}

function createFeature(points: Position[]): GeoJsonFeature {
  const ring = [...points, points[0]];
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { name: 'Selected Study Area', coordinateSystem: 'EPSG:4326' } };
}
