import { describe, expect, it } from "vitest";
import { fitWithin, MAX_EDGE } from "./image";

describe("fitWithin", () => {
  it("scales the long edge down to the max, keeping the aspect ratio", () => {
    expect(fitWithin(4032, 3024, MAX_EDGE)).toEqual({ width: 2000, height: 1500 }); // landscape phone photo
    expect(fitWithin(3024, 4032, MAX_EDGE)).toEqual({ width: 1500, height: 2000 }); // portrait
  });

  it("never scales up", () => {
    expect(fitWithin(1200, 800, MAX_EDGE)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(2000, 2000, MAX_EDGE)).toEqual({ width: 2000, height: 2000 });
  });

  it("rounds to whole pixels and never returns zero", () => {
    expect(fitWithin(3001, 1000, MAX_EDGE)).toEqual({ width: 2000, height: 666 });
    expect(fitWithin(100000, 10, MAX_EDGE)).toEqual({ width: 2000, height: 1 });
  });
});
