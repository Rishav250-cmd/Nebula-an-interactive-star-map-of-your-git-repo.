/**
 * Find strongly connected components using iterative Tarjan traversal.
 *
 * @param {{ id: string }[] | string[]} nodes
 * @param {{ source: string, target: string }[]} edges
 * @returns {string[][]}
 */
export function findCycles(nodes, edges) {
  const nodeIds = new Set(
    (Array.isArray(nodes) ? nodes : [])
      .map((node) => (typeof node === "string" ? node : node?.id))
      .filter((id) => typeof id === "string"),
  );
  const orderedNodeIds = [...nodeIds].sort((left, right) =>
    left.localeCompare(right),
  );
  const adjacencySets = new Map(orderedNodeIds.map((id) => [id, new Set()]));

  for (const edge of Array.isArray(edges) ? edges : []) {
    if (nodeIds.has(edge?.source) && nodeIds.has(edge?.target)) {
      adjacencySets.get(edge.source).add(edge.target);
    }
  }

  const adjacency = new Map(
    orderedNodeIds.map((id) => [
      id,
      [...adjacencySets.get(id)].sort((left, right) =>
        left.localeCompare(right),
      ),
    ]),
  );
  const indices = new Map();
  const lowLinks = new Map();
  const componentStack = [];
  const onComponentStack = new Set();
  const cycles = [];
  let nextIndex = 0;

  for (const root of orderedNodeIds) {
    if (indices.has(root)) continue;

    const traversalStack = [
      { id: root, parent: null, nextNeighbor: 0, entered: false },
    ];

    while (traversalStack.length > 0) {
      const frame = traversalStack.at(-1);

      if (!frame.entered) {
        frame.entered = true;
        indices.set(frame.id, nextIndex);
        lowLinks.set(frame.id, nextIndex);
        nextIndex += 1;
        componentStack.push(frame.id);
        onComponentStack.add(frame.id);
      }

      const neighbors = adjacency.get(frame.id);
      if (frame.nextNeighbor < neighbors.length) {
        const neighbor = neighbors[frame.nextNeighbor];
        frame.nextNeighbor += 1;

        if (!indices.has(neighbor)) {
          traversalStack.push({
            id: neighbor,
            parent: frame.id,
            nextNeighbor: 0,
            entered: false,
          });
        } else if (onComponentStack.has(neighbor)) {
          lowLinks.set(
            frame.id,
            Math.min(lowLinks.get(frame.id), indices.get(neighbor)),
          );
        }
        continue;
      }

      traversalStack.pop();
      if (frame.parent !== null) {
        lowLinks.set(
          frame.parent,
          Math.min(lowLinks.get(frame.parent), lowLinks.get(frame.id)),
        );
      }

      if (lowLinks.get(frame.id) === indices.get(frame.id)) {
        const component = [];
        let member;
        do {
          member = componentStack.pop();
          onComponentStack.delete(member);
          component.push(member);
        } while (member !== frame.id);

        if (
          component.length > 1 ||
          adjacency.get(frame.id).includes(frame.id)
        ) {
          component.sort((left, right) => left.localeCompare(right));
          cycles.push(component);
        }
      }
    }
  }

  cycles.sort(
    (left, right) =>
      right.length - left.length || left[0].localeCompare(right[0]),
  );
  return cycles;
}
