const FOLDER_PALETTE = [
  '#b5a8ff', '#52d7c5', '#62c8ff', '#ff8fc8', '#b8e879',
  '#ffd166', '#87a9ff', '#ff8f78', '#8be2ec', '#d3a6ff',
];

const ROOT_FOLDER_COLOR = '#a0aec0';

export type FolderLegendEntry = {
  folder: string;
  color: string;
};

export type FolderLegend = {
  entries: FolderLegendEntry[];
  otherCount: number;
  otherColors: string[];
};

function topLevelFolder(folder: string): string {
  if (!folder || folder === '.') return '.';
  return folder.split('/')[0] || '.';
}

function folderCounts(allFolders: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const folder of allFolders) {
    const topLevel = topLevelFolder(folder);
    counts.set(topLevel, (counts.get(topLevel) ?? 0) + 1);
  }
  return counts;
}

function adjustLightness(hexColor: string, shift: number): string {
  const red = Number.parseInt(hexColor.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hexColor.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hexColor.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;

  if (delta > 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const nextLightness = Math.max(0.48, Math.min(0.84, lightness + shift));
  const chroma = (1 - Math.abs(2 * nextLightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const offset = nextLightness - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, secondary, 0]
    : hue < 120 ? [secondary, chroma, 0]
      : hue < 180 ? [0, chroma, secondary]
        : hue < 240 ? [0, secondary, chroma]
          : hue < 300 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];

  return `#${[r, g, b].map((channel) => (
    Math.round((channel + offset) * 255).toString(16).padStart(2, '0')
  )).join('')}`;
}

function sortedFolders(allFolders: readonly string[]): Array<[string, number]> {
  return [...folderCounts(allFolders).entries()]
    .sort(([folderA, countA], [folderB, countB]) => countB - countA || folderA.localeCompare(folderB));
}

export function folderColor(folder: string, allFolders: readonly string[]): string {
  const topLevel = topLevelFolder(folder);
  if (topLevel === '.') return ROOT_FOLDER_COLOR;

  const rankedFolders = sortedFolders(allFolders)
    .filter(([candidate]) => candidate !== '.')
    .map(([candidate]) => candidate);
  const rank = rankedFolders.indexOf(topLevel);
  const index = rank < 0 ? rankedFolders.length : rank;
  const color = FOLDER_PALETTE[index % FOLDER_PALETTE.length];
  const paletteCycle = Math.floor(index / FOLDER_PALETTE.length);
  if (paletteCycle === 0) return color;

  const shift = paletteCycle % 2 === 1
    ? Math.min(0.12, Math.ceil(paletteCycle / 2) * 0.06)
    : -Math.min(0.12, Math.ceil(paletteCycle / 2) * 0.06);
  return adjustLightness(color, shift);
}

export function folderLegend(allFolders: readonly string[], maxEntries = 8): FolderLegend {
  const sorted = sortedFolders(allFolders);
  const remaining = sorted.slice(maxEntries);
  const entries = sorted.slice(0, maxEntries).map(([folder]) => ({
    folder,
    color: folderColor(folder, allFolders),
  }));

  return {
    entries,
    otherCount: remaining.length,
    otherColors: remaining.slice(0, 8).map(([folder]) => folderColor(folder, allFolders)),
  };
}

export function nodeRadius(loc: number): number {
  const safeLoc = Number.isFinite(loc) ? Math.max(0, loc) : 0;
  return Math.max(3, Math.min(11, 2 + Math.sqrt(safeLoc) * 0.3));
}
