let sortingItem = null,
  sortClickUntil = 0;
function moveSortedItem(items, sourceId, targetId, after) {
  const from = items.findIndex((item) => item.id === sourceId),
    target = items.findIndex((item) => item.id === targetId);
  if (from < 0 || target < 0 || from === target) return false;
  let to = target + (after ? 1 : 0);
  if (from < to) to--;
  if (from === to) return false;
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  return true;
}
function clearSortMarks() {
  document
    .querySelectorAll(".sort-before,.sort-after")
    .forEach((el) => el.classList.remove("sort-before", "sort-after"));
}
function finishSorting() {
  clearSortMarks();
  document
    .querySelectorAll(".sort-dragging")
    .forEach((el) => el.classList.remove("sort-dragging"));
  sortingItem = null;
}
function sortingTarget(event) {
  const target = event.target.closest?.("[data-sort-kind]");
  if (
    !target ||
    !sortingItem ||
    target.dataset.sortKind !== sortingItem.kind ||
    target.dataset.sortNode !== sortingItem.node
  )
    return null;
  return target;
}
function isAfterSort(event, target) {
  const r = target.getBoundingClientRect();
  return target.classList.contains("boardtile")
    ? event.clientX > r.left + r.width / 2
    : event.clientY > r.top + r.height / 2;
}
document.addEventListener("dragstart", (event) => {
  const item = event.target.closest?.("[data-sort-kind]");
  if (!item) return;
  if (
    event.target.closest("input,select,textarea") ||
    importBusy ||
    $("#player").open
  ) {
    event.preventDefault();
    return;
  }
  sortingItem = {
    kind: item.dataset.sortKind,
    node: item.dataset.sortNode,
    id: item.dataset.sortId,
  };
  event.dataTransfer.setData(
    "application/x-storyforge-sort",
    JSON.stringify(sortingItem),
  );
  event.dataTransfer.effectAllowed = "move";
  item.classList.add("sort-dragging");
});
document.addEventListener("dragover", (event) => {
  if (!sortingItem) return;
  event.preventDefault();
  clearSortMarks();
  const target = sortingTarget(event);
  event.dataTransfer.dropEffect = target ? "move" : "none";
  if (target && target.dataset.sortId !== sortingItem.id)
    target.classList.add(
      isAfterSort(event, target) ? "sort-after" : "sort-before",
    );
});
document.addEventListener("drop", (event) => {
  if (!sortingItem) return;
  event.preventDefault();
  const target = sortingTarget(event),
    source = sortingItem;
  const after = target && isAfterSort(event, target);
  finishSorting();
  sortClickUntil = Date.now() + 350;
  if (!target) return;
  const node =
    source.kind === "frame"
      ? project.nodes.find((n) => n.id === source.node)
      : null;
  const items = source.kind === "node" ? project.nodes : node?.frames;
  if (!items || !moveSortedItem(items, source.id, target.dataset.sortId, after))
    return;
  save();
  render();
  if (
    node &&
    page === "story" &&
    current() === node &&
    usingBoards(node) &&
    !graph
  ) {
    showEditorBoard(node, source.id);
  }
  notify(
    source.kind === "frame"
      ? "分镜顺序已更新并保存"
      : "剧情节点顺序已更新并保存，第一个节点为试玩入口",
  );
});
document.addEventListener("dragend", () => {
  if (sortingItem) sortClickUntil = Date.now() + 350;
  finishSorting();
});
document.addEventListener(
  "click",
  (event) => {
    if (
      Date.now() < sortClickUntil &&
      event.target.closest?.("[data-sort-kind]")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);
document.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) clearSortMarks();
});
