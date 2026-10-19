import { describe, expect, it } from "vitest";
import { evenPositions, MIN_POSITION_GAP, moveId, needsRebalance, placeAt, POSITION_GAP, positionBetween } from "@/lib/tasks/position";

describe("positionBetween", () => {
  it("starts an empty list at one gap", () => {
    expect(positionBetween(null, null)).toBe(POSITION_GAP);
  });
  it("goes before the first and after the last item", () => {
    expect(positionBetween(null, 100)).toBe(100 - POSITION_GAP);
    expect(positionBetween(100, null)).toBe(100 + POSITION_GAP);
  });
  it("takes the midpoint between neighbours", () => {
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(-10, 10)).toBe(0);
  });
});

describe("needsRebalance", () => {
  it("only triggers when neighbours are too close", () => {
    expect(needsRebalance(1, 2)).toBe(false);
    expect(needsRebalance(1, 1 + MIN_POSITION_GAP)).toBe(true);
    expect(needsRebalance(null, 1)).toBe(false);
  });
});

describe("placeAt", () => {
  it("places at the top, middle and bottom", () => {
    const list = [1024, 2048, 3072];
    expect(placeAt(list, 0)).toEqual({ position: 0, rebalanced: null });
    expect(placeAt(list, 1)).toEqual({ position: 1536, rebalanced: null });
    expect(placeAt(list, 3)).toEqual({ position: 4096, rebalanced: null });
  });
  it("clamps out-of-range indexes", () => {
    expect(placeAt([10], 99).position).toBe(10 + POSITION_GAP);
    expect(placeAt([10], -5).position).toBe(10 - POSITION_GAP);
  });
  it("renumbers when a gap is exhausted and keeps order", () => {
    const tight = [1, 1 + MIN_POSITION_GAP, 5];
    const result = placeAt(tight, 1);
    expect(result.rebalanced).toEqual(evenPositions(3));
    expect(result.position).toBeGreaterThan(result.rebalanced![0]!);
    expect(result.position).toBeLessThan(result.rebalanced![1]!);
  });
  it("survives many inserts into the same gap", () => {
    let list = [POSITION_GAP, POSITION_GAP * 2];
    for (let i = 0; i < 200; i += 1) {
      const { position, rebalanced } = placeAt(list, 1);
      if (rebalanced) list = rebalanced;
      list = [...list.slice(0, 1), position, ...list.slice(1)].sort((a, b) => a - b);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe("moveId", () => {
  it("moves within and into lists", () => {
    expect(moveId(["a", "b", "c"], "c", null)).toEqual(["c", "a", "b"]);
    expect(moveId(["a", "b", "c"], "a", "b")).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b"], "x", "a")).toEqual(["a", "x", "b"]);
    expect(moveId(["a", "b"], "x", "missing")).toEqual(["a", "b", "x"]);
  });
});
