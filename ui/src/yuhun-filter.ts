import type { FilterCriteria } from "../../src/browser.js";

export function emptyYuhunFilter(): FilterCriteria {
  return { types: [], positions: [], stars: [], mainStats: [], subStats: [], subStatCounts: [], levelRanges: [], intrinsicStats: [], unknownTypeBits: [], unknownOptionBits: [] };
}
