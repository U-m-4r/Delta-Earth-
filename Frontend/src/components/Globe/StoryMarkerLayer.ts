import { CallbackProperty, Cartesian2, Cartesian3, Color, ConstantPositionProperty, ConstantProperty, CustomDataSource, Entity, VerticalOrigin, Math as CesiumMath } from 'cesium';
import type { Billboard, Label, PointPrimitive, Viewer } from 'cesium';
import type { StoryIndexItem } from '../../types/stories';

export type StoryPick = { choices: StoryIndexItem[]; selected: StoryIndexItem | null };
export const validStoryLocation = (story: StoryIndexItem) => {
  const location = story.markerLocation;
  return Boolean(location && Number.isFinite(location.longitude) && Number.isFinite(location.latitude)
    && Math.abs(location.longitude) <= 180 && Math.abs(location.latitude) <= 90);
};
// Flat red dot with a white ring (the original Delta Earth story marker).
const markerImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="#fc3d21" stroke="#fff" stroke-width="4"/></svg>')}`;

/** Owns only the story datasource; drawing entities, imagery and input handlers
 * remain owned by EarthGlobe. Selection is routed through its existing handler. */
export class StoryMarkerLayer {
  readonly source = new CustomDataSource('published-story-markers');
  private stories = new Map<string, StoryIndexItem>();
  private selected: string | null = null;
  private hovered: string | null = null;
  private choices: string[] = [];
  private enabled = true;
  private flying = false;
  private destroyed = false;
  private removeClusterListener: () => void;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private viewer: Viewer, private onChange: (pick: StoryPick) => void) {
    this.source.clustering.enabled = true;
    this.source.clustering.pixelRange = 22;
    this.source.clustering.minimumClusterSize = 2;
    this.source.clustering.clusterLabels = false;
    this.removeClusterListener = this.source.clustering.clusterEvent.addEventListener((entities: Entity[], cluster: { billboard: Billboard; label: Label; point: PointPrimitive }) => {
      cluster.point.show = false;
      cluster.billboard.show = true; cluster.billboard.image = markerImage;
      cluster.billboard.width = 24; cluster.billboard.height = 24; cluster.billboard.id = entities;
      cluster.label.show = true; cluster.label.text = String(entities.length); cluster.label.id = entities;
      cluster.label.font = 'bold 11px Inter, sans-serif'; cluster.label.fillColor = Color.WHITE;
      cluster.label.pixelOffset = new Cartesian2(0, -1);
    });
    void viewer.dataSources.add(this.source).then(() => {
      if (this.destroyed && !viewer.isDestroyed()) viewer.dataSources.remove(this.source, true);
    });
  }

  update(items: StoryIndexItem[]) {
    const next = new Map(items.filter(validStoryLocation).map(story => [story.slug, story]));
    for (const entity of [...this.source.entities.values]) if (!next.has(entity.id)) this.source.entities.remove(entity);
    for (const [id, story] of next) {
      const location = story.markerLocation!;
      let entity = this.source.entities.getById(id);
      if (!entity) entity = this.source.entities.add({ id, name: story.title,
        billboard: { image: markerImage, width: 16, height: 16 },
        label: { text: story.title, show: false, font: '12px sans-serif', fillColor: Color.fromCssColorString('#e4f1ed'),
          showBackground: true, backgroundColor: Color.fromCssColorString('#091b29e8'),
          pixelOffset: new Cartesian2(0,-22), verticalOrigin: VerticalOrigin.BOTTOM },
      });
      entity.position = new ConstantPositionProperty(Cartesian3.fromDegrees(location.longitude, location.latitude, 150));
      entity.name = story.title;
      entity.label!.text = new ConstantProperty(story.title);
    }
    this.stories = next;
    if (this.hovered && !next.has(this.hovered)) this.clearHover();
    if (this.selected && !next.has(this.selected)) this.clear();
    else if (this.selected || this.choices.length) this.emit();
    this.style();
  }

  setVisible(visible: boolean, drawing: boolean) {
    this.source.show = visible;
    this.enabled = visible && !drawing;
    if (!this.enabled) { this.clear(); this.hover(null); this.cancelFlight(); }
  }
  private picked(position: Cartesian2): string[] {
    if (!this.enabled) return [];
    const hit = this.viewer.scene.pick(position) as { id?: Entity | Entity[] } | undefined;
    const entities = Array.isArray(hit?.id) ? hit.id : hit?.id ? [hit.id] : [];
    return entities.filter(entity => entity instanceof Entity && this.source.entities.getById(entity.id) === entity).map(entity => entity.id);
  }
  click(position: Cartesian2) {
    const ids = this.picked(position);
    if (!ids.length) { this.clear(); return false; }
    this.choices = ids;
    if (ids.length === 1) this.select(ids[0]);
    else { this.selected = null; this.style(); this.emit(); }
    return true;
  }
  move(position: Cartesian2) {
    const id = this.picked(position)[0] ?? null;
    this.hover(id);
    return Boolean(id);
  }
  private hover(id: string | null) {
    if (this.hovered === id) return;
    this.hovered = id; this.style();
    this.viewer.canvas.style.cursor = id ? 'pointer' : '';
  }
  get hasPreview() { return this.choices.length > 0; }
  clearHover() { this.hover(null); }
  select(id: string) {
    if (!this.enabled) return;
    const story = this.stories.get(id);
    if (!story) return;
    const changed = this.selected !== id;
    this.selected = id;
    if (!this.choices.includes(id)) this.choices = [id];
    this.style(); this.emit();
    if (changed) {
      const location = story.markerLocation!;
      this.flying = true;
      this.viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(location.longitude, location.latitude, 650_000),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 }, duration: this.reducedMotion.matches ? 0 : 1.5,
        complete: () => { this.flying = false; }, cancel: () => { this.flying = false; } });
    }
  }
  cancelFlight() { if (this.flying) { this.viewer.camera.cancelFlight(); this.flying = false; } }
  clear() { this.cancelFlight(); this.selected = null; this.choices = []; this.style(); this.onChange({ choices: [], selected: null }); }
  private emit() { this.onChange({ choices: this.choices.map(id => this.stories.get(id)).filter((story): story is StoryIndexItem => Boolean(story)), selected: this.stories.get(this.selected ?? '') ?? null }); }
  private style() {
    for (const entity of this.source.entities.values) {
      const selected = entity.id === this.selected;
      entity.billboard!.scale = selected ? new CallbackProperty(() => this.reducedMotion.matches ? 1.2 : 1.2 + .045 * Math.sin(performance.now()/450), false)
        : new ConstantProperty(entity.id === this.hovered ? 1.18 : 1);
      entity.label!.show = new ConstantProperty(selected);
    }
    this.viewer.scene.requestRender();
  }
  destroy() {
    this.destroyed = true; this.cancelFlight(); this.removeClusterListener();
    this.viewer.canvas.style.cursor = '';
    this.viewer.dataSources.remove(this.source, true);
  }
}
