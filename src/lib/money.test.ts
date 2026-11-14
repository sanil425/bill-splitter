import { describe, expect, it } from "vitest";
import { formatCents, toCents } from "./money";

describe("toCents", () => {
  it("converts whole and fractional dollars", () => {
    expect(toCents(12)).toBe(1200);
    expect(toCents(12.5)).toBe(1250);
    expect(toCents(0)).toBe(0);
  });

  it("is not fooled by float error (0.1 + 0.2)", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3));
  });

  it("handles negative amounts (discounts)", () => {
    expect(toCents(-5)).toBe(-500);
    expect(toCents(-0.99)).toBe(-99);
  });

  it("rounds half a cent away from zero", () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0.125)).toBe(13);
    expect(toCents(2.675)).toBe(268);
    expect(toCents(-1.005)).toBe(-101);
    expect(toCents(-0.005)).toBe(-1);
  });

  it("rounds less than half a cent toward zero, never returning -0", () => {
    expect(toCents(1.004)).toBe(100);
    expect(Object.is(toCents(-0.004), 0)).toBe(true);
  });

  it("rejects non-finite input", () => {
    expect(() => toCents(NaN)).toThrow(RangeError);
    expect(() => toCents(Infinity)).toThrow(RangeError);
  });
});

describe("formatCents", () => {
  it("formats as US dollars", () => {
    expect(formatCents(1250)).toBe("$12.50");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
  });

  it("formats negative amounts with a leading minus", () => {
    expect(formatCents(-1250)).toBe("-$12.50");
    expect(formatCents(-7)).toBe("-$0.07");
  });

  it("rejects non-integer cents", () => {
    expect(() => formatCents(12.5)).toThrow(RangeError);
    expect(() => formatCents(NaN)).toThrow(RangeError);
  });
});
