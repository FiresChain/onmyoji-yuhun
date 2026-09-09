/// <reference lib="webworker" />

import {
  MAX_SNAPSHOT_BYTES,
  WorkflowError,
  createWorkflow
} from "../../../src/browser.js";

type Method =
  | "importSnapshot"
  | "analyze"
  | "queryInventory"
  | "queryYuhunDetails"
  | "queryDecisions"
  | "queryYuhunDecisions"
  | "queryYuhunDecisionFacets"
  | "generatePlan"
  | "runSimulation"
  | "buildImportChecklist"
  | "calculateTeamTargets"
  | "estimateTeamCalculationWork"
  | "getGateState"
  | "resetSession";

interface RequestMessage {
  readonly id: number;
  readonly method: Method;
  readonly args: readonly unknown[];
}

const workflow = createWorkflow();
const workerScope = self as DedicatedWorkerGlobalScope;

function post(id: number, payload: Record<string, unknown>): void {
  workerScope.postMessage({ id, ...payload });
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function importSnapshot(buffer: ArrayBuffer): Promise<unknown> {
  if (!(buffer instanceof ArrayBuffer)) throw new Error("快照必须通过 ArrayBuffer 传入");
  if (buffer.byteLength > MAX_SNAPSHOT_BYTES) {
    throw new WorkflowError({
      stage: "snapshot",
      code: "BYTE_LIMIT_EXCEEDED",
      path: null,
      message: `快照超过 ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MiB 限制`
    });
  }
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new WorkflowError({
      stage: "snapshot",
      code: "INVALID_JSON",
      path: null,
      message: "快照不是有效的 UTF-8 JSON"
    });
  }
  return workflow.importSnapshot(json, hex(new Uint8Array(digest)));
}

async function dispatch(message: RequestMessage): Promise<unknown> {
  switch (message.method) {
    case "importSnapshot":
      return importSnapshot(message.args[0] as ArrayBuffer);
    case "analyze":
      post(message.id, { progress: { phase: "baseline", completed: 0, total: 3 } });
      return workflow.analyze(message.args[0] as Parameters<typeof workflow.analyze>[0]);
    case "queryInventory":
      return workflow.queryInventory(message.args[0] as Parameters<typeof workflow.queryInventory>[0]);
    case "queryYuhunDetails":
      return workflow.queryYuhunDetails(message.args[0] as Parameters<typeof workflow.queryYuhunDetails>[0]);
    case "queryDecisions":
      return workflow.queryDecisions(message.args[0] as Parameters<typeof workflow.queryDecisions>[0]);
    case "queryYuhunDecisions":
      return workflow.queryYuhunDecisions(message.args[0] as Parameters<typeof workflow.queryYuhunDecisions>[0]);
    case "queryYuhunDecisionFacets":
      return workflow.queryYuhunDecisionFacets();
    case "generatePlan":
      return workflow.generatePlan(message.args[0] as Parameters<typeof workflow.generatePlan>[0]);
    case "runSimulation": {
      const sampleSize = message.args[0] as number | undefined;
      const seed = message.args[1] as number | undefined;
      return workflow.runSimulation(sampleSize, seed, (completed, total) => {
        post(message.id, { progress: { phase: "simulation", completed, total } });
      });
    }
    case "buildImportChecklist":
      return workflow.buildImportChecklist();
    case "calculateTeamTargets":
      return workflow.calculateTeamTargets(
        message.args[0] as Parameters<typeof workflow.calculateTeamTargets>[0],
        (progress) => post(message.id, { progress }),
        (report) => post(message.id, { report })
      );
    case "estimateTeamCalculationWork":
      return workflow.estimateTeamCalculationWork(
        message.args[0] as Parameters<typeof workflow.estimateTeamCalculationWork>[0]
      );
    case "getGateState":
      return workflow.getGateState();
    case "resetSession":
      workflow.resetSession();
      return null;
  }
}

workerScope.addEventListener("message", (event: MessageEvent<RequestMessage>) => {
  const message = event.data;
  void dispatch(message).then(
    (result) => post(message.id, { result }),
    (error: unknown) => {
      if (error instanceof WorkflowError) {
        post(message.id, { error: error.dto });
        return;
      }
      post(message.id, {
        error: {
          stage: "analysis",
          code: "WORKER_FAILURE",
          path: null,
          message: error instanceof Error ? error.message.replace(/[0-9a-f]{24,}/gi, "[已遮盖]") : "Worker 处理失败"
        }
      });
    }
  );
});
