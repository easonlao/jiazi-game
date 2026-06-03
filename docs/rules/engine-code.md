---
paths:
  - "src/core/**"
---

# Engine Code Rules

- ZERO allocations in hot paths (update loops, rendering, physics) — pre-allocate, pool, reuse
- All engine APIs must be thread-safe OR explicitly documented as single-thread-only
- Profile before AND after every optimization — document the measured numbers
- Engine code must NEVER depend on gameplay code (strict dependency direction: engine <- gameplay)
- Every public API must have usage examples in its doc comment
- Changes to public interfaces require a deprecation period and migration guide
- Use RAII / deterministic cleanup for all resources
- All engine systems must support graceful degradation
- Before writing engine API code, consult `docs/engine-reference/` for the current engine version and verify APIs against the reference docs

## Examples

**Correct** (zero-alloc hot path):

```typescript
// Pre-allocated array reused each frame
private nearbyCache: Phaser.GameObjects.GameObject[] = [];

update(time: number, delta: number): void {
    this.nearbyCache.length = 0;  // Reuse, don't reallocate
    this.spatialGrid.queryRadius(this.position, this.radius, this.nearbyCache);
}
```

**Incorrect** (allocating in hot path):

```typescript
update(time: number, delta: number): void {
    const nearby: Phaser.GameObjects.GameObject[] = [];  // VIOLATION: allocates every frame
    const nearby = this.scene.getGroup('enemies').getChildren();  // VIOLATION: group query every frame
}
```
