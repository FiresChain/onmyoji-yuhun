import assert from "node:assert/strict";
import { test } from "node:test";
import { createBuiltinPresetRules } from "./builtin-preset.js";
import { compileFilterCriteria } from "./matcher.js";
import type { YyxYuhun } from "./yyx.js";

const item = (changes: Partial<YyxYuhun>): YyxYuhun => ({
  id: "synthetic", name: "狂骨", suitId: 300048, position: 1, star: 6, level: 0,
  mainStat: "attack", mainValue: 81, subStats: {}, initialSubStats: null,
  intrinsicStats: {}, born: 0, lock: false, garbage: false, ...changes
});

test("built-in preset preserves D/E overlap and leaves uncovered inventory for strategies", () => {
  const rules = createBuiltinPresetRules().map(rule => ({ ...rule, matches: compileFilterCriteria(rule.criteria) }));
  const disposition = (candidate: YyxYuhun) => {
    const matched = rules.filter(rule => rule.matches(candidate));
    return matched.some(rule => rule.pool === "enhance") ? "retain"
      : matched.some(rule => rule.pool === "discard") ? "discard" : "uncovered";
  };
  assert.equal(disposition(item({ subStats: { attack: 20, hp: 100, defense: 4 } })), "discard");
  assert.equal(disposition(item({ subStats: { speed: 3, hp: 100, defense: 4 } })), "discard");
  assert.equal(disposition(item({ subStats: { speed: 3, hp: 100, defense: 4, attack: 20 } })), "retain");
  // The three-line speed-main exception must survive the general three-line discard.
  assert.equal(disposition(item({ position: 2, mainStat: "speed", subStats: { speed: 3, hp: 100, defense: 4 } })), "retain");
  assert.equal(disposition(item({ position: 4, mainStat: "effectHit", subStats: { effectHit: .04, hp: 100, defense: 4 } })), "retain");
  assert.equal(disposition(item({ position: 6, mainStat: "critDamage", subStats: { crit: .03, hp: 100, defense: 4, attack: 20 } })), "retain");
  assert.equal(disposition(item({ subStats: { attackPercent: .03, crit: .03, critDamage: .04, hp: 100 } })), "uncovered");
});
