// Lower bound of each column (churn) and each row (complexity).
export const CHURN_BOUNDS = [0, 1, 3, 6, 10, 20];
export const COMPLEXITY_BOUNDS = [1, 5, 10, 20, 40];
export const CHURN_LABELS = ["0", "1–2", "3–5", "6–9", "10–19", "20+"];
export const COMPLEXITY_LABELS = ["0–4", "5–9", "10–19", "20–39", "40+"];

// Column and row indexes where churn ≥ 10 and complexity ≥ 10.
const HOT_CHURN_BIN = 4;
const HOT_COMPLEXITY_BIN = 2;
const FRAGILE_CHURN = 6;

function binIndex(value, lowerBounds) {
  const index = lowerBounds.findLastIndex((low) => value >= low);
  return index < 0 ? 0 : index;
}

export function classifyCell(churnBin, complexityBin) {
  const churnHigh = churnBin >= HOT_CHURN_BIN;
  const complexityHigh = complexityBin >= HOT_COMPLEXITY_BIN;
  if (churnHigh && complexityHigh) return "debt";
  if (complexityHigh) return "dormant";
  if (churnHigh) return "watch";
  return "healthy";
}

/**
 * @param {object[]} files  output of computeHealth(...).files
 * @param {{ hasHistory: boolean }} options
 */
export function buildHeatmap(files, { hasHistory }) {
  const grid = COMPLEXITY_BOUNDS.map((_, complexityBin) =>
    CHURN_BOUNDS.map((_, churnBin) => ({
      complexityBin,
      churnBin,
      quadrant: classifyCell(churnBin, complexityBin),
      count: 0,
      files: [],
    })),
  );

  for (const file of files) {
    const churn = hasHistory ? file.churn ?? 0 : 0;
    const churnBin = binIndex(churn, CHURN_BOUNDS);
    const complexityBin = binIndex(file.maxComplexity, COMPLEXITY_BOUNDS);
    const cell = grid[complexityBin][churnBin];

    cell.count += 1;
    cell.files.push({
      id: file.id,
      loc: file.loc,
      churn: hasHistory ? file.churn : null,
      maxComplexity: file.maxComplexity,
      hotspotScore: file.hotspotScore,
      isHotspot: file.isHotspot,
      isGodFile: file.isGodFile,
      fragileGod: hasHistory && file.isGodFile && churn >= FRAGILE_CHURN,
      inCycle: file.inCycle,
    });
  }

  // Most urgent files first inside each cell.
  for (const row of grid) {
    for (const cell of row) {
      cell.files.sort(
        (a, b) => (b.hotspotScore ?? 0) - (a.hotspotScore ?? 0) || a.id.localeCompare(b.id),
      );
    }
  }

  return {
    historyAvailable: hasHistory,
    churnLabels: CHURN_LABELS,
    complexityLabels: COMPLEXITY_LABELS,
    grid, // grid[complexityBin][churnBin]; row 0 is the lowest complexity
  };
}