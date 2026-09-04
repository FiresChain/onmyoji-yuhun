import type { TeamCalculationReportDTO } from "../../src/team-calculation.js";

/** Stable, human-readable error text shared by the target row and diagnostics panel. */
export function formatTeamCalculationError(
  report: TeamCalculationReportDTO,
  resolveShikigamiName?: (id: number | null, fallback: string) => string
): string {
  const failed = report.entities.filter((entity) => entity.status === "unsupported");
  const details = failed.length === 0
    ? ["无成功结果"]
    : failed.map((entity) => {
      const fallback = entity.shikigamiName || `式神 ${entity.entityIndex}`;
      const name = resolveShikigamiName?.(entity.shikigamiId, fallback) ?? fallback;
      return `${name}：${entity.message || "计算失败"}`;
    });
  return [`阵容：${report.label}`, "状态：错误", "错误详情：", ...details].join("\n");
}
