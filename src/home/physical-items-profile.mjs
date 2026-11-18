/** Gameplay capabilities are independent of where an asset mounts in a room. */
export function physicalItemProfile(definition) {
  const legacyTags = definition.mount === 'small' ? [] : ['furniture'];
  const tags = [...new Set(Array.isArray(definition.tags) ? definition.tags.filter(tag => typeof tag === 'string') : legacyTags)];
  const furniture = tags.includes('furniture'), vehicle = tags.includes('vehicle');
  const capabilities = {
    carry: !furniture && !vehicle && (definition.capabilities?.carry ?? definition.mount === 'small'),
    decorate: (furniture || definition.mount === 'wall') && !vehicle && definition.capabilities?.decorate !== false,
    tip: furniture && !vehicle && definition.mount === 'floor' && !definition.rug
      && (definition.capabilities?.tip ?? definition.size?.height > .2),
  };
  let container;
  if (definition.container) {
    const { interior, closable } = definition.container;
    if (interior && ['min', 'max'].every(key => Array.isArray(interior[key]) && interior[key].length === 3 && interior[key].every(Number.isFinite))
      && interior.max.every((value, axis) => value > interior.min[axis])) {
      container = { interior: { min: [...interior.min], max: [...interior.max] }, closable: closable === true };
    }
  } else if (definition.id === 'cardboard-open') {
    // boxes.glb: the actual walls are around x=-.146/.150, z=-.150/.147;
    // the larger catalog footprint includes the outward flaps. Keep packing
    // within a conservative interior rather than treating the flaps as space.
    container = { interior: { min: [-.13, .015, -.13], max: [.13, .28, .13] }, closable: true };
  }
  if (container && !tags.includes('container')) tags.push('container');
  return { tags, capabilities, ...(container ? { container } : {}) };
}
