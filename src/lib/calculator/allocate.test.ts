import { describe, expect, it } from "vitest";
import { allocate } from "./allocate";
import { CalculationError } from "./errors";

const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("allocate", () => {
  it("splits exactly when it divides evenly", () => {
    expect(allocate(900, [1, 1, 1])).toEqual([300, 300, 300]);
    expect(allocate(900, [2, 1])).toEqual([600, 300]);
  });

  it("always adds up exactly", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [2, 1])).toEqual([667, 333]);
    expect(allocate(1001, [3, 3, 1])).toEqual([429, 429, 143]);
    for (const [t, ws] of [
      [9999, [1, 2, 3, 4, 5, 6, 7]],
      [1, [1, 1, 1, 1]],
      [12345, [0.5, 0.25, 0.125]],
      [7, [1e-3, 1, 1000]],
    ] as const) {
      expect(total(allocate(t, ws))).toBe(t);
    }
  });

  it("gives leftover cents to the largest remainders", () => {
    // Quotas 3.3, 3.6, 3.1 -> floors 3,3,3 and the 1 leftover goes to the 0.6.
    expect(allocate(10, [33, 36, 31])).toEqual([3, 4, 3]);
  });

  it("breaks ties by order", () => {
    expect(allocate(1, [1, 1])).toEqual([1, 0]);
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocate(5, [1, 1, 1, 1])).toEqual([2, 1, 1, 1]);
  });

  it("gives nothing to zero weights, not even leftover cents", () => {
    expect(allocate(100, [1, 0, 1])).toEqual([50, 0, 50]);
    expect(allocate(1, [0, 1, 1])).toEqual([0, 1, 0]);
    expect(allocate(1, [0, 0, 1])).toEqual([0, 0, 1]);
  });

  it("handles fractional weights", () => {
    expect(allocate(100, [0.5, 0.25, 0.25])).toEqual([50, 25, 25]);
    expect(allocate(100, [1 / 3, 1 / 3, 1 / 3])).toEqual([34, 33, 33]);
  });

  it("mirrors positive totals for negative totals", () => {
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(-1000, [2, 1])).toEqual([-667, -333]);
  });

  it("never returns -0", () => {
    const result = allocate(-1, [1, 1]);
    expect(result).toEqual([-1, 0]);
    expect(Object.is(result[1], 0)).toBe(true);
  });

  it("gives everything to a single person", () => {
    expect(allocate(1234, [3])).toEqual([1234]);
    expect(allocate(-50, [0.1])).toEqual([-50]);
  });

  it("returns zeros for a zero total, even with all-zero weights", () => {
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(0, [0, 0])).toEqual([0, 0]);
  });

  it("rejects impossible inputs", () => {
    expect(() => allocate(100, [0, 0])).toThrow(CalculationError);
    expect(() => allocate(100, [])).toThrow(CalculationError);
    expect(() => allocate(100, [1, -1])).toThrow(CalculationError);
    expect(() => allocate(100, [1, NaN])).toThrow(CalculationError);
    expect(() => allocate(100, [1, Infinity])).toThrow(CalculationError);
    expect(() => allocate(10.5, [1])).toThrow(CalculationError);
  });
});
