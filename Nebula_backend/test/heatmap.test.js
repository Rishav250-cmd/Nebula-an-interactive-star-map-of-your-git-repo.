import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHeatmap } from "../services/heatmap.js";

const file = (overrides) => ({
    id: "a.js",
    loc: 10,
    churn: 0,
    maxComplexity: 0,
    hotspotScore: 0,
    isHotspot: false,
    isGodFile: false,
    inCycle: false,
    ...overrides,
});

test("churn 10 and complexity 10 is the debt zone", () => {
    const { grid } = buildHeatmap(
        [file({ churn: 10, maxComplexity: 10, isHotspot: true, hotspotScore: 100 })],
        { hasHistory: true },
    );
    const cell = grid[2][4];
    assert.equal(cell.quadrant, "debt");
    assert.equal(cell.count, 1);
});

test("churn 9 and complexity 10 is not the debt zone", () => {
    const { grid } = buildHeatmap([file({ churn: 9, maxComplexity: 10 })], { hasHistory: true });
    assert.notEqual(grid[2][3].quadrant, "debt");
});

test("a file with no functions lands in the first row", () => {
    const { grid } = buildHeatmap([file({ maxComplexity: 0 })], { hasHistory: true });
    assert.equal(grid[0][0].count, 1);
});

test("without history every file is in churn column 0", () => {
    const { grid } = buildHeatmap([file({ churn: null }), file({ id: "b.js", churn: null })], {
        hasHistory: false,
    });
    const column = grid.map((row) => row[0].count).reduce((a, b) => a + b, 0);
    assert.equal(column, 2);
    assert.equal(grid.flat().some((cell) => cell.files.some((f) => f.fragileGod)), false);
});

test("total cell count equals the number of files", () => {
    const files = [file({ id: "a" }), file({ id: "b", churn: 25, maxComplexity: 50 })];
    const { grid } = buildHeatmap(files, { hasHistory: true });
    assert.equal(grid.flat().reduce((sum, cell) => sum + cell.count, 0), files.length);
});