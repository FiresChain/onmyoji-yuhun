import type { TeamCalculationPieceDTO, TeamCalculationReportDTO, TeamCalculationYuhunDTO } from "../../src/browser.js";

function needsDetails(piece: TeamCalculationPieceDTO): boolean {
  return piece.yuhunId === undefined || piece.mainValue === undefined || piece.subStats === undefined || piece.intrinsicStats === undefined;
}

function matchesPiece(piece: TeamCalculationPieceDTO, detail: TeamCalculationYuhunDTO | undefined): detail is TeamCalculationYuhunDTO {
  return detail !== undefined && piece.position === detail.position && piece.suit === detail.suit
    && piece.mainStat === detail.mainStat && piece.level === detail.level && piece.star === detail.star
    && (piece.yuhunId === undefined || piece.yuhunId === detail.yuhunId);
}

/** Call only after verifying that the restored snapshot belongs to these reports. */
export async function restoreEquippedYuhunDetails(
  reports: readonly TeamCalculationReportDTO[],
  queryDetails: (ids: readonly string[]) => Promise<readonly TeamCalculationYuhunDTO[]>
): Promise<readonly TeamCalculationReportDTO[]> {
  const requested = new Set<string>();
  for (const report of reports) {
    const pieces = report.entities.flatMap(entity => entity.pieces);
    for (const piece of pieces) {
      if (needsDetails(piece) && piece.yuhunId !== undefined) requested.add(piece.yuhunId);
    }
    if (pieces.some(piece => piece.yuhunId === undefined)) {
      for (const id of report.reservedYuhunIds ?? []) requested.add(id);
    }
  }
  if (requested.size === 0) return reports;
  const details = new Map((await queryDetails([...requested])).map(detail => [detail.yuhunId, detail]));
  return reports.map(report => {
    const pieces = report.entities.flatMap(entity => entity.pieces);
    // Legacy reports kept reservations in entity/piece insertion order, even
    // before individual pieces carried IDs. Validate the entire mapping first;
    // matching only suit/slot could select another shikigami's equipment.
    const reserved = report.reservedYuhunIds ?? [];
    const orderedDetails = reserved.map(id => details.get(id));
    const hasOrderedMapping = reserved.length === pieces.length && new Set(reserved).size === pieces.length
      && pieces.every((piece, index) => matchesPiece(piece, orderedDetails[index]));
    let index = 0;
    return {
      ...report,
      entities: report.entities.map(entity => ({
        ...entity,
        pieces: entity.pieces.map(piece => {
          const orderedDetail = orderedDetails[index++];
          if (!needsDetails(piece)) return piece;
          const detail = piece.yuhunId === undefined
            ? hasOrderedMapping ? orderedDetail : undefined
            : details.get(piece.yuhunId);
          return matchesPiece(piece, detail) ? { ...piece, ...detail } : piece;
        })
      }))
    };
  });
}
