export interface TargetScene {
  readonly id: string;
  readonly label: string;
  readonly gameSceneId?: number | null;
  /** Local association that takes precedence over the R2-published game ID. */
  readonly gameSceneIdOverride?: number | null;
  /** Whether lineups assigned to this scene must use disjoint yuhun. */
  readonly mutualExclusion?: boolean;
}

export interface TargetCategory {
  readonly id: string;
  readonly label: string;
  readonly scenes: readonly TargetScene[];
}

export interface TargetDomain {
  readonly id: string;
  readonly label: string;
  readonly categories: readonly TargetCategory[];
}

export interface TargetScenePath {
  readonly domainId: string;
  readonly categoryId: string;
  readonly sceneId: string;
  readonly gameSceneId: number | null;
  readonly domainLabel: string;
  readonly categoryLabel: string;
  readonly sceneLabel: string;
  readonly mutualExclusion: boolean;
}

export interface SceneCatalogRecord {
  readonly customSceneId: number;
  readonly gameSceneId: number | null;
  readonly level1: string;
  readonly level2: string;
  readonly level3: string;
  readonly displayOrder: number;
  readonly status: "active" | "archived";
  readonly verification: "confirmed" | "inferred";
  readonly updatedAt: string;
}

export interface SceneCatalogSnapshot {
  readonly schemaVersion: 1;
  readonly revision: string;
  readonly generatedAt: string;
  readonly scenes: readonly SceneCatalogRecord[];
}

export interface PublishedTeamTargetSnapshot {
  readonly schemaVersion: 1;
  readonly revision: string;
  readonly generatedAt: string;
  readonly targets: readonly Record<string, unknown>[];
}

export const SCENE_CATALOG_URL = import.meta.env.VITE_SCENE_CATALOG_URL
  ?? `${(import.meta.env.VITE_ONMYOJI_API_URL ?? "https://api.fireschain.org").replace(/\/$/, "")}/onmyoji/v1/scenes/catalog`;

export const TARGET_CATALOG: readonly TargetDomain[] = [
  {
    id: "yuhun",
    label: "御魂",
    categories: [
      {
        id: "orochi",
        label: "八岐大蛇",
        scenes: ["虚无", "神罚", "悲鸣", "拾层", "玖层", "捌层", "柒层", "陆层", "伍层", "肆层", "叁层", "贰层", "壹层"]
          .map((label, index) => ({ id: `scene-${index + 7}`, label: `八岐大蛇 · ${label}`, gameSceneId: 1001000 + index }))
      },
      {
        id: "sougenbi",
        label: "业原火",
        scenes: ["痴之阵", "嗔之阵", "贪之阵"]
          .map((label, index) => ({ id: `scene-${index + 20}`, label: `业原火 · ${label}`, gameSceneId: 10011001 + index }))
      },
      {
        id: "sunfall",
        label: "日轮之陨",
        scenes: ["日蚀", "叁层", "贰层", "壹层"]
          .map((label, index) => ({ id: `scene-${index + 23}`, label: `日轮之陨 · ${label}`, gameSceneId: 10012001 + index }))
      },
      {
        id: "eternal-sea",
        label: "永生之海",
        scenes: ["肆层", "叁层", "贰层", "壹层"]
          .map((label, index) => ({ id: `scene-${index + 27}`, label: `永生之海 · ${label}`, gameSceneId: 10013001 + index }))
      }
    ]
  },
  {
    id: "guild",
    label: "阴阳寮",
    categories: [
      {
        id: "boss-defense",
        label: "首领退治",
        scenes: [
          { id: "scene-87", label: "首领退治 · 通用", gameSceneId: 10020204 },
          ...["饥饿的年兽", "贪婪的铁鼠", "冥界小鬼"]
            .map((label, index) => ({ id: `scene-${index + 88}`, label: `首领退治 · ${label}`, gameSceneId: 10020204 + index }))
        ]
      }
    ]
  }
] as const;

export function targetScenePaths(catalog: readonly TargetDomain[]): readonly TargetScenePath[] {
  return catalog.flatMap((domain) => domain.categories.flatMap((category) => category.scenes.map((scene) => ({
    domainId: domain.id,
    categoryId: category.id,
    sceneId: scene.id,
    gameSceneId: scene.gameSceneIdOverride === undefined
      ? scene.gameSceneId ?? null
      : scene.gameSceneIdOverride,
    domainLabel: domain.label,
    categoryLabel: category.label,
    sceneLabel: scene.label,
    mutualExclusion: scene.mutualExclusion === true
  }))));
}

export const TARGET_SCENE_PATHS: readonly TargetScenePath[] = targetScenePaths(TARGET_CATALOG);

export function isCustomCatalogId(id: string): boolean {
  return id.startsWith("custom-");
}

export function canonicalSceneId(sceneId: string): string {
  const numberedMappings: ReadonlyArray<readonly [RegExp, number]> = [
    [/^orochi-(\d+)$/, 6],
    [/^sougenbi-(\d+)$/, 19],
    [/^sunfall-(\d+)$/, 22],
    [/^eternal-sea-(\d+)$/, 26],
    [/^boss-defense-(\d+)$/, 87]
  ];
  if (sceneId === "boss-defense-general") return "scene-87";
  for (const [pattern, offset] of numberedMappings) {
    const match = sceneId.match(pattern);
    if (match !== null) return `scene-${offset + Number(match[1])}`;
  }
  return sceneId;
}

/**
 * R2 is authoritative. A saved catalog is only a migration source for locally
 * added custom-* nodes; edits, deletions, and ordering of published nodes are
 * intentionally ignored.
 */
export function mergePublishedCatalog(
  published: readonly TargetDomain[],
  saved: readonly TargetDomain[] | null | undefined
): readonly TargetDomain[] {
  const result = cloneTargetCatalog(published);
  if (saved === null || saved === undefined) return result;

  const usedIds = new Set(targetCatalogIds(result));
  for (const savedDomain of saved) {
    if (isCustomCatalogId(savedDomain.id)) {
      const customDomain = cloneCustomDomain(savedDomain, usedIds);
      if (customDomain !== null) result.push(customDomain);
      continue;
    }
    const domain = findPublishedDomain(result, savedDomain);
    if (domain === undefined) continue;
    for (const savedCategory of savedDomain.categories) {
      if (isCustomCatalogId(savedCategory.id)) {
        const customCategory = cloneCustomCategory(savedCategory, usedIds);
        if (customCategory !== null) domain.categories.push(customCategory);
        continue;
      }
      const category = findPublishedCategory(domain, savedCategory);
      if (category === undefined) continue;
      for (const savedScene of savedCategory.scenes) {
        if ((savedScene.gameSceneIdOverride !== undefined || savedScene.mutualExclusion === true) && !isCustomCatalogId(savedScene.id)) {
          const index = category.scenes.findIndex((scene) => canonicalSceneId(scene.id) === canonicalSceneId(savedScene.id));
          if (index >= 0) {
            const publishedScene = category.scenes[index]!;
            category.scenes[index] = {
              ...publishedScene,
              ...(savedScene.gameSceneIdOverride === undefined ? {} : { gameSceneIdOverride: savedScene.gameSceneIdOverride }),
              ...(savedScene.mutualExclusion === true ? { mutualExclusion: true } : {})
            };
          }
        }
        if (!isCustomCatalogId(savedScene.id) || usedIds.has(savedScene.id)) continue;
        category.scenes.push({ ...savedScene });
        usedIds.add(savedScene.id);
      }
    }
  }
  return result;
}

/** Stores only local additions plus the published parent path needed to reattach them. */
export function localCatalogOverlay(catalog: readonly TargetDomain[]): readonly TargetDomain[] {
  const overlay: MutableTargetDomain[] = [];
  for (const domain of catalog) {
    if (isCustomCatalogId(domain.id)) {
      overlay.push({
        ...domain,
        categories: domain.categories.filter((category) => isCustomCatalogId(category.id)).map((category) => ({
          ...category,
          scenes: category.scenes.filter((scene) => isCustomCatalogId(scene.id)).map((scene) => ({ ...scene }))
        }))
      });
      continue;
    }
    const categories: MutableTargetCategory[] = [];
    for (const category of domain.categories) {
      if (isCustomCatalogId(category.id)) {
        categories.push({
          ...category,
          scenes: category.scenes.filter((scene) => isCustomCatalogId(scene.id)).map((scene) => ({ ...scene }))
        });
        continue;
      }
      const scenes = category.scenes
        .filter((scene) => isCustomCatalogId(scene.id) || scene.gameSceneIdOverride !== undefined || scene.mutualExclusion === true)
        .map((scene) => ({ ...scene }));
      if (scenes.length > 0) categories.push({ id: category.id, label: category.label, scenes });
    }
    if (categories.length > 0) overlay.push({ id: domain.id, label: domain.label, categories });
  }
  return overlay;
}

type MutableTargetCategory = { id: string; label: string; scenes: TargetScene[] };
type MutableTargetDomain = { id: string; label: string; categories: MutableTargetCategory[] };

function cloneTargetCatalog(source: readonly TargetDomain[]): MutableTargetDomain[] {
  return source.map((domain) => ({
    ...domain,
    categories: domain.categories.map((category) => ({
      ...category,
      scenes: category.scenes.map((scene) => ({ ...scene }))
    }))
  }));
}

function targetCatalogIds(source: readonly TargetDomain[]): string[] {
  return source.flatMap((domain) => [
    domain.id,
    ...domain.categories.flatMap((category) => [category.id, ...category.scenes.map((scene) => scene.id)])
  ]);
}

function cloneCustomDomain(domain: TargetDomain, usedIds: Set<string>): MutableTargetDomain | null {
  if (usedIds.has(domain.id)) return null;
  usedIds.add(domain.id);
  const categories: MutableTargetCategory[] = [];
  for (const category of domain.categories) {
    if (!isCustomCatalogId(category.id)) continue;
    const cloned = cloneCustomCategory(category, usedIds);
    if (cloned !== null) categories.push(cloned);
  }
  return { id: domain.id, label: domain.label, categories };
}

function cloneCustomCategory(category: TargetCategory, usedIds: Set<string>): MutableTargetCategory | null {
  if (usedIds.has(category.id)) return null;
  usedIds.add(category.id);
  const scenes: TargetScene[] = [];
  for (const scene of category.scenes) {
    if (!isCustomCatalogId(scene.id) || usedIds.has(scene.id)) continue;
    scenes.push({ ...scene });
    usedIds.add(scene.id);
  }
  return { id: category.id, label: category.label, scenes };
}

function publishedSceneIdSet(domain: TargetDomain | TargetCategory): Set<string> {
  const scenes = "categories" in domain
    ? domain.categories.flatMap((category) => category.scenes)
    : domain.scenes;
  return new Set(scenes.filter((scene) => !isCustomCatalogId(scene.id)).map((scene) => canonicalSceneId(scene.id)));
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function findPublishedDomain(published: MutableTargetDomain[], saved: TargetDomain): MutableTargetDomain | undefined {
  const legacyLabels: Readonly<Record<string, string>> = { yuhun: "御魂", guild: "阴阳寮" };
  const direct = published.find((domain) => domain.label === saved.label)
    ?? published.find((domain) => domain.label === legacyLabels[saved.id]);
  if (direct !== undefined) return direct;
  const savedIds = publishedSceneIdSet(saved);
  const byScenes = published
    .map((domain) => ({ domain, score: overlapCount(publishedSceneIdSet(domain), savedIds) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.domain;
  return byScenes ?? published.find((domain) => domain.id === saved.id);
}

function findPublishedCategory(domain: MutableTargetDomain, saved: TargetCategory): MutableTargetCategory | undefined {
  const legacyLabels: Readonly<Record<string, string>> = {
    orochi: "八岐大蛇",
    sougenbi: "业原火",
    sunfall: "日轮之陨",
    "eternal-sea": "永生之海",
    "boss-defense": "首领退治"
  };
  const direct = domain.categories.find((category) => category.label === saved.label)
    ?? domain.categories.find((category) => category.label === legacyLabels[saved.id]);
  if (direct !== undefined) return direct;
  const savedIds = publishedSceneIdSet(saved);
  const byScenes = domain.categories
    .map((category) => ({ category, score: overlapCount(publishedSceneIdSet(category), savedIds) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.category;
  return byScenes ?? domain.categories.find((category) => category.id === saved.id);
}

export function findTargetScene(sceneId: string, catalog: readonly TargetDomain[] = TARGET_CATALOG): TargetScenePath | null {
  return targetScenePaths(catalog).find((scene) => scene.sceneId === sceneId) ?? null;
}

export function findTargetScenesByGameSceneId(gameSceneId: number, catalog: readonly TargetDomain[]): readonly TargetScenePath[] {
  return targetScenePaths(catalog).filter((scene) => scene.gameSceneId === gameSceneId);
}

export function catalogFromSceneSnapshot(value: unknown): readonly TargetDomain[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("关卡目录必须是对象");
  const snapshot = value as Partial<SceneCatalogSnapshot>;
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.scenes)) throw new TypeError("关卡目录版本无效");
  const domains: Array<{ id: string; label: string; categories: Array<{ id: string; label: string; scenes: TargetScene[] }> }> = [];
  const domainByLabel = new Map<string, typeof domains[number]>();
  for (const [index, raw] of snapshot.scenes.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new TypeError(`scenes[${index}] 必须是对象`);
    const record = raw as Partial<SceneCatalogRecord>;
    if (!Number.isSafeInteger(record.customSceneId) || record.customSceneId! <= 0) throw new TypeError(`scenes[${index}].customSceneId 无效`);
    if (record.gameSceneId !== null && record.gameSceneId !== undefined && !Number.isSafeInteger(record.gameSceneId)) throw new TypeError(`scenes[${index}].gameSceneId 无效`);
    if (record.status !== "active" && record.status !== "archived") throw new TypeError(`scenes[${index}].status 无效`);
    if (record.status !== "active") continue;
    for (const field of ["level1", "level2", "level3"] as const) {
      if (typeof record[field] !== "string" || record[field]!.trim() === "") throw new TypeError(`scenes[${index}].${field} 无效`);
    }
    let domain = domainByLabel.get(record.level1!);
    if (domain === undefined) {
      domain = { id: `catalog-domain-${domains.length + 1}`, label: record.level1!, categories: [] };
      domains.push(domain);
      domainByLabel.set(record.level1!, domain);
    }
    let category = domain.categories.find((entry) => entry.label === record.level2);
    if (category === undefined) {
      category = { id: `catalog-category-${record.customSceneId}`, label: record.level2!, scenes: [] };
      domain.categories.push(category);
    }
    category.scenes.push({
      id: `scene-${record.customSceneId}`,
      label: record.level3!,
      gameSceneId: record.gameSceneId ?? null
    });
  }
  if (domains.length === 0) throw new TypeError("关卡目录没有 active 记录");
  return domains;
}

export async function fetchSceneCatalog(url = SCENE_CATALOG_URL): Promise<readonly TargetDomain[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`关卡目录读取失败（HTTP ${response.status}）`);
  return catalogFromSceneSnapshot(await response.json());
}

export async function fetchPublishedTeamTargets(url = SCENE_CATALOG_URL.replace(/scenes\/catalog(?:\.json)?$/, "scenes/targets")): Promise<readonly Record<string, unknown>[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`阵容快照读取失败（HTTP ${response.status}）`);
  const payload = await response.json() as Partial<PublishedTeamTargetSnapshot>;
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.targets)) throw new TypeError("阵容快照版本无效");
  return payload.targets.filter((target): target is Record<string, unknown> => typeof target === "object" && target !== null && !Array.isArray(target));
}
