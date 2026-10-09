// One visible entry per work, while keeping local and cloud identities separate.
export function projectCatalog(local, cloud) {
  const rows = new Map();
  for (const item of Object.values(local)) {
    if (!item?.project?.id) continue;
    rows.set(item.project.id, {
      id: item.project.id,
      name: item.project.name,
      local: item,
      updatedAt: item.updatedAt || "",
    });
  }
  for (const item of cloud) {
    const row = rows.get(item.id) || {
      id: item.id,
      name: item.name,
      updatedAt: item.updatedAt || "",
    };
    row.cloud = item;
    if ((item.updatedAt || "") > row.updatedAt) row.updatedAt = item.updatedAt;
    rows.set(item.id, row);
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      deleted: Boolean(
        (!row.local || row.local.deleted) && (!row.cloud || row.cloud.deleted),
      ),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
