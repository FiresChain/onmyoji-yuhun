// Run in Chrome DevTools Console on the workbench page, without refreshing it.
// Reads local state and downloads a private report. No upload or storage writes.
(async () => {
  const heroId = 311;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("onmyoji-yuhun-workbench");
    request.onupgradeneeded = () => request.transaction.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Database is blocked by another workbench tab."));
  });
  let saved, buffer;
  try {
    [saved, buffer] = await new Promise((resolve, reject) => {
      const tx = db.transaction(["sessions", "snapshots"], "readonly");
      const session = tx.objectStore("sessions").get("current");
      const snapshot = tx.objectStore("snapshots").get("current");
      tx.oncomplete = () => resolve([session.result, snapshot.result]);
      tx.onabort = () => reject(tx.error ?? new Error("Could not read the saved session."));
    });
  } finally {
    db.close();
  }
  if (!saved || !(buffer instanceof ArrayBuffer)) throw new Error("No saved session on this website origin.");
  const store = document.querySelector("#app")?.__vue_app__?.config.globalProperties.$pinia?._s.get("workbench");
  const reports = values => (values ?? [])
    .filter(report => report.entities?.some(entity => Number(entity.shikigamiId) === heroId))
    .map(report => ({
      id: report.id, label: report.label, scope: report.scope,
      reservedYuhunIds: report.reservedYuhunIds,
      entities: report.entities.map(entity => ({
        entityIndex: entity.entityIndex, shikigamiId: entity.shikigamiId,
        shikigamiName: entity.shikigamiName, status: entity.status,
        metricId: entity.metricId, metricName: entity.metricName,
        score: entity.score, panel: entity.panel, pieces: entity.pieces,
        constraints: entity.constraints, targetScoreRaw: entity.targetScoreRaw,
        exact: entity.exact
      }))
    }));
  const report = JSON.parse(JSON.stringify({
    kind: "onmyoji-yuhun-speed-debug", schemaVersion: 1,
    containsAccountDerivedData: true, doNotCommit: true,
    exportedAt: new Date().toISOString(), page: location.origin + location.pathname + location.hash,
    scripts: [...document.scripts].map(script => script.src).filter(Boolean),
    heroId, savedAt: saved.savedAt, savedSnapshotSha256: saved.snapshotSha256,
    liveStoreAvailable: !!store, liveSnapshotSha256: store?.snapshot?.sha256,
    liveBusy: store?.busy, liveRestoring: store?.restoring,
    persistedReports: reports(saved.teamCalculations),
    liveReports: reports(store?.teamCalculations),
    visiblePieceDetails: document.querySelector(".yuhun-detail-panel")?.innerText ?? null
  }));
  const ids = new Set([...report.persistedReports, ...report.liveReports].flatMap(value => [
    ...(value.reservedYuhunIds ?? []),
    ...value.entities.flatMap(entity => entity.pieces.map(piece => piece.yuhunId).filter(Boolean))
  ]));
  const raw = JSON.parse(new TextDecoder().decode(buffer));
  if (Array.isArray(raw.data?.hero_equips)) {
    report.snapshotFormat = "yyx";
    report.rawPieces = raw.data.hero_equips.filter(item => ids.has(item.id));
    report.rawHeroBases = (raw.data.heroes ?? []).filter(hero => Number(hero.hero_id) === heroId)
      .map(hero => ({ hero_id: hero.hero_id, level: hero.level, star: hero.star, awake: hero.awake, attrs: hero.attrs }));
  } else if (raw.equip_desc) {
    const payload = typeof raw.equip_desc === "string" ? JSON.parse(raw.equip_desc) : raw.equip_desc;
    report.snapshotFormat = "onmyoji-hub";
    report.rawPieces = Object.entries(payload.inventory ?? {})
      .filter(([id, item]) => ids.has(id) || ids.has(item.uuid)).map(([id, item]) => ({ inventoryId: id, ...item }));
    report.rawHeroBases = Object.values(payload.heroes ?? {}).filter(hero => Number(hero.heroId) === heroId)
      .map(hero => ({ heroId: hero.heroId, name: hero.name, level: hero.level, star: hero.star, awake: hero.awake, attrs: hero.attrs }));
  } else {
    throw new Error("Unrecognized saved snapshot format.");
  }
  report.actualSnapshotSha256 = crypto.subtle
    ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map(byte => byte.toString(16).padStart(2, "0")).join("")
    : null;
  const filename = `onmyoji-yuhun-speed-debug-${Date.now()}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  console.info("Downloaded:", filename, {
    liveStoreAvailable: report.liveStoreAvailable,
    persistedReports: report.persistedReports.length,
    liveReports: report.liveReports.length,
    rawPieces: report.rawPieces.length
  });
})().catch(error => console.error("Speed debug export failed:", error));
