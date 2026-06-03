import { describe, it, expect } from "vitest";
import { parseOrderKey } from "../src/livedata.js";

describe("parseOrderKey", () => {
  it("prices with magnitude suffixes", () => {
    expect(parseOrderKey("$50k")!.value).toBe(50000);
    expect(parseOrderKey("70K")!.value).toBe(70000);
    expect(parseOrderKey("$1.2M")!.value).toBe(1200000);
    expect(parseOrderKey("60,000")!.value).toBe(60000);
    expect(parseOrderKey("100")!.value).toBe(100);
  });
  it("kind is number for prices, date for months", () => {
    expect(parseOrderKey("$50k")!.kind).toBe("number");
    expect(parseOrderKey("December 31")!.kind).toBe("date");
  });
  it("dates do not get read as the day-of-month number", () => {
    const dec = parseOrderKey("December 31", 2026)!;
    expect(dec.kind).toBe("date");
    expect(dec.value).toBe(Date.UTC(2026, 11, 31));
    const jun = parseOrderKey("June 30, 2026")!;
    expect(jun.value).toBe(Date.UTC(2026, 5, 30));
  });
  it("orders correctly: Dec > Oct > Aug > Jul", () => {
    const y = 2026;
    const ks = ["July 31", "August 31", "October 31", "December 31"].map((l) => parseOrderKey(l, y)!.value);
    expect(ks).toEqual([...ks].sort((a, b) => a - b)); // already ascending
  });
  it("returns null for unordered labels", () => {
    expect(parseOrderKey("Gavin Newsom")).toBeNull();
    expect(parseOrderKey("San Antonio Spurs")).toBeNull();
  });
  it("axis labels are compact", () => {
    expect(parseOrderKey("$50,000")!.axisLabel).toBe("$50k");
    expect(parseOrderKey("under 50000")!.axisLabel).toBe("<$50k");
  });
});
