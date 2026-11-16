/** Keep camera state between comparison modes without coupling their data layers. */
export class MapViewSync {
  camera?: { center: number[]; zoom: number };
  private maps = new Set<any>();
  private leader: any;
  private frame = 0;
  activate(map: any) { this.leader = map; }
  register(map: any) {
    this.maps.add(map);
    if (!this.leader) this.leader = map;
    const activate = () => this.activate(map);
    const element = map.container.getElement();
    element.addEventListener('pointerdown', activate, true);
    element.addEventListener('wheel', activate, { capture: true, passive: true });
    const changed = (event: any) => {
      if (map !== this.leader) return;
      const center = event.get('newCenter') || map.getCenter(), zoom = event.get('newZoom') ?? map.getZoom();
      this.camera = { center: [...center], zoom };
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0; if (!this.camera) return;
        for (const target of this.maps) if (target !== this.leader) {
          const c = target.getCenter();
          if (Math.abs(c[0] - this.camera.center[0]) < 1e-9 && Math.abs(c[1] - this.camera.center[1]) < 1e-9 && target.getZoom() === this.camera.zoom) continue;
          void Promise.resolve(target.setCenter(this.camera.center, this.camera.zoom, { duration: 0, checkZoomRange: false })).catch(() => {});
        }
      });
    };
    map.events.add('boundschange', changed);
    return () => {
      map.events.remove('boundschange', changed);
      element.removeEventListener('pointerdown', activate, true); element.removeEventListener('wheel', activate, true);
      this.maps.delete(map); if (this.leader === map) this.leader = this.maps.values().next().value;
      if (!this.maps.size && this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    };
  }
}
