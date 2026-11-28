(function attachLayoutGeometry(root, factory) {
  const geometry = factory();
  if (typeof module === 'object' && module.exports) module.exports = geometry;
  if (root) root.NexusLayoutGeometry = geometry;
})(globalThis, () => {
  'use strict';
  const GRID = 22;
  const SPACE_WIDTH = 2400;
  const SPACE_HEIGHT = 10000;
  const NODE_HEIGHT = 196;
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 700;
  const GAP = 12;

  const snap = value => Math.round(value / GRID) * GRID;
  function normalizeNode(node) {
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.width)) return null;
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(node.width)));
    const x = Math.max(0, Math.min(SPACE_WIDTH - width, snap(node.x)));
    const y = Math.max(0, Math.min(SPACE_HEIGHT - NODE_HEIGHT, snap(node.y)));
    return { x, y, width };
  }
  function overlaps(left, right) {
    return left.x < right.x + right.width + GAP && left.x + left.width + GAP > right.x &&
      left.y < right.y + NODE_HEIGHT + GAP && left.y + NODE_HEIGHT + GAP > right.y;
  }
  function canPlace(candidate, nodes, excludedId = null) {
    const normalized = normalizeNode(candidate);
    if (!normalized) return false;
    return Object.entries(nodes || {}).every(([id, node]) => {
      if (id === excludedId) return true;
      const other = normalizeNode(node);
      return !other || !overlaps(normalized, other);
    });
  }
  function moveNode(candidate, nodes, id) {
    const normalized = normalizeNode(candidate);
    return normalized && canPlace(normalized, nodes, id) ? normalized : null;
  }
  function resizeNode(current, delta, nodes, id) {
    if (!Number.isFinite(delta)) return null;
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(current.width + delta)));
    return moveNode({ ...current, width }, nodes, id);
  }
  function clampPan(panX, panY, viewportWidth = 0, viewportHeight = 0, zoom = 1) {
    const minX = Math.min(0, Math.max(0, viewportWidth) - SPACE_WIDTH * zoom);
    const minY = Math.min(0, Math.max(0, viewportHeight) - SPACE_HEIGHT * zoom);
    return {
      panX: Math.max(minX, Math.min(0, Number.isFinite(panX) ? panX : 0)),
      panY: Math.max(minY, Math.min(0, Number.isFinite(panY) ? panY : 0))
    };
  }
  return Object.freeze({ GRID, SPACE_WIDTH, SPACE_HEIGHT, NODE_HEIGHT, MIN_WIDTH, MAX_WIDTH, normalizeNode, canPlace, moveNode, resizeNode, clampPan });
});
