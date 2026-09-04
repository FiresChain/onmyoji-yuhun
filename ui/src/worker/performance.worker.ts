/// <reference lib="webworker" />

import { searchYuhunBuilds, type Panel, type Yuhun } from "../../../src/calculation.js";
import type { PerformanceCpuBenchmark, PerformanceMemoryBenchmark } from "../performance.js";

interface BenchmarkRequest {
  readonly kind: "cpu" | "memory";
  readonly durationMs: number;
}

const workerScope = self as DedicatedWorkerGlobalScope;
const CANDIDATES_PER_POSITION = 4;
const COMBINATIONS_PER_SEARCH = CANDIDATES_PER_POSITION ** 6;

const basePanel: Panel = {
  attack: 3_200,
  hp: 12_000,
  defense: 500,
  speed: 110,
  crit: 0.1,
  critDamage: 1.5,
  effectHit: 0,
  effectResist: 0
};

const candidates: Yuhun[] = Array.from({ length: 6 * CANDIDATES_PER_POSITION }, (_, index) => {
  const position = Math.floor(index / CANDIDATES_PER_POSITION) + 1;
  const variant = index % CANDIDATES_PER_POSITION;
  return {
    id: `benchmark-${position}-${variant}`,
    name: variant % 2 === 0 ? "散件甲" : "散件乙",
    position,
    level: 15,
    star: 6,
    mainStat: position === 2 ? "speed" : position === 6 ? "crit" : "attackPercent",
    mainValue: position === 2 ? 57 : position === 6 ? 0.55 : 0.55,
    subStats: {
      speed: 8 + variant * 1.25,
      crit: 0.03 + variant * 0.005,
      critDamage: 0.06 + variant * 0.008,
      attackPercent: 0.04 + variant * 0.006
    },
    intrinsicStats: {}
  };
});

function runCpu(durationMs: number): PerformanceCpuBenchmark {
  const deadlineMs = Math.max(500, Math.min(2_000, durationMs));
  const options = {
    indicator: "damageOutput" as const,
    constraints: { speed: { min: 180 }, crit: { min: 0.5 } },
    topN: 20,
    maxCombinations: COMBINATIONS_PER_SEARCH
  };
  // One uncounted pass lets the JS engine optimize the exact search path being measured.
  searchYuhunBuilds(basePanel, candidates, options);
  const startedAt = performance.now();
  let evaluatedCombinations = 0;
  let checksum = 0;
  do {
    const search = searchYuhunBuilds(basePanel, candidates, options);
    evaluatedCombinations += search.evaluatedCombinations;
    checksum += search.results[0]?.score ?? 0;
  } while (performance.now() - startedAt < deadlineMs);
  const elapsedMs = performance.now() - startedAt;
  return {
    id: "cpu-yuhun-search-js-v1",
    durationMs: elapsedMs,
    evaluatedCombinations,
    evaluationsPerSecond: Math.round(evaluatedCombinations / (elapsedMs / 1_000)),
    checksum
  };
}

function runMemory(durationMs: number): PerformanceMemoryBenchmark {
  let source = new Float64Array(524_288);
  let target = new Float64Array(source.length);
  for (let index = 0; index < source.length; index += 1) source[index] = index / source.length;
  const startedAt = performance.now();
  const deadlineMs = Math.max(300, Math.min(1_000, durationMs));
  let bytesProcessed = 0;
  let checksum = 0;
  do {
    for (let index = 0; index < source.length; index += 1) target[index] = source[index]! * 1.000001 + 0.000001;
    checksum += target[(bytesProcessed / 16) % target.length] ?? 0;
    bytesProcessed += source.byteLength + target.byteLength;
    const previousSource = source;
    source = target;
    target = previousSource;
  } while (performance.now() - startedAt < deadlineMs);
  const elapsedMs = performance.now() - startedAt;
  return {
    id: "memory-f64-stream-v1",
    durationMs: elapsedMs,
    bytesProcessed,
    mebibytesPerSecond: Math.round(bytesProcessed / 1024 / 1024 / (elapsedMs / 1_000)),
    checksum
  };
}

workerScope.addEventListener("message", (event: MessageEvent<BenchmarkRequest>) => {
  workerScope.postMessage(event.data.kind === "memory"
    ? runMemory(event.data.durationMs)
    : runCpu(event.data.durationMs));
});
