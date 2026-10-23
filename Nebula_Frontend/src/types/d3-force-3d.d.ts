declare module 'd3-force-3d' {
  type Force<N> = ((alpha: number) => void) & {
    initialize?: (nodes: N[], ...args: any[]) => void;
    [key: string]: any;
  };

  export function forceCollide<N>(radius: (node: N) => number): Force<N>;
}
