interface CameraDefinition {
  width: number;
  depth: number;
  entities: readonly { position: readonly [number, number, number]; size: readonly [number, number, number] }[];
}

/** Fit all legal entity heights and the whole arena, including motion destinations. */
export function frameWorkshopCamera(definition: CameraDefinition, aspect: number) {
  const fov = 42;
  const minY = -.35;
  // Include the player and currently hidden entities, which rules may reveal later.
  const maxY = Math.max(1.1, ...definition.entities.map(entity => entity.position[1] + entity.size[1] / 2));
  const centerY = (minY + maxY) / 2;
  const radius = Math.hypot(definition.width / 2 + .6, (maxY - minY) / 2, definition.depth / 2 + .6);
  const verticalHalfFov = fov * Math.PI / 360;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
  const distance = radius * 1.12 / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov));
  const directionLength = Math.hypot(.22, 1.2, 1);
  return {
    fov, aspect,
    near: Math.max(.05, distance - radius * 1.1),
    far: distance + radius * 1.1,
    position: [.22 * distance / directionLength, centerY + 1.2 * distance / directionLength, distance / directionLength] as [number, number, number],
    target: [0, centerY, 0] as [number, number, number],
  };
}
