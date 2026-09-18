let boardMenuTarget = null,
  boardInsertTarget = null;
const boardMenu = document.createElement("div");
boardMenu.className = "board-context-menu";
boardMenu.hidden = true;
boardMenu.setAttribute("role", "menu");
boardMenu.setAttribute("aria-label", "分镜操作");
boardMenu.innerHTML =
  '<button role="menuitem" data-board-action="copy">复制分镜</button><button role="menuitem" data-board-action="add">在后面添加新分镜…</button><button role="menuitem" class="board-delete" data-board-action="delete">删除分镜</button>';
document.body.append(boardMenu);
const boardInsertPicker = document.createElement("input");
boardInsertPicker.type = "file";
boardInsertPicker.accept = "image/png,image/jpeg,image/webp,image/gif";
boardInsertPicker.multiple = true;
boardInsertPicker.hidden = true;
document.body.append(boardInsertPicker);
function hideBoardMenu() {
  boardMenu.hidden = true;
  boardMenuTarget = null;
}
function refreshInsertedBoard(node, id) {
  save();
  render();
  if (page === "story" && current() === node && !graph && usingBoards(node)) {
    showEditorBoard(node, id);
  }
}
function duplicateBoard(node, id) {
  if (!project.nodes.includes(node) || importBusy) return false;
  const index = node.frames?.findIndex((f) => f.id === id);
  if (index === undefined || index < 0) return false;
  if (node.frames.length >= 100) {
    notify("每个节点最多支持 100 张分镜图片");
    return false;
  }
  const atEnd =
    usingBoards(node) && Math.abs(node.trigger - nodeDuration(node)) < 0.01;
  const copy = { ...node.frames[index], id: "f" + crypto.randomUUID() };
  node.frames.splice(index + 1, 0, copy);
  if (atEnd) node.trigger = nodeDuration(node);
  refreshInsertedBoard(node, copy.id);
  notify("已在后面复制分镜，图片和时长保持一致");
  return true;
}
document.addEventListener("contextmenu", (event) => {
  const item = event.target.closest?.('[data-sort-kind="frame"]');
  if (!item) {
    hideBoardMenu();
    return;
  }
  event.preventDefault();
  const node = project.nodes.find((n) => n.id === item.dataset.sortNode);
  if (!node) return;
  boardMenuTarget = { node, id: item.dataset.sortId };
  boardMenu.hidden = false;
  boardMenu.querySelector('[data-board-action="copy"]').disabled =
    importBusy || node.frames.length >= 100;
  boardMenu.querySelector('[data-board-action="add"]').disabled =
    importBusy || node.frames.length >= 100;
  boardMenu.querySelector('[data-board-action="delete"]').disabled = importBusy;
  boardMenu.style.left =
    Math.max(
      8,
      Math.min(event.clientX, window.innerWidth - boardMenu.offsetWidth - 8),
    ) + "px";
  boardMenu.style.top =
    Math.max(
      8,
      Math.min(event.clientY, window.innerHeight - boardMenu.offsetHeight - 8),
    ) + "px";
  boardMenu.querySelector("button:not(:disabled)")?.focus();
});
boardMenu.addEventListener("click", (event) => {
  const action = event.target.closest("[data-board-action]")?.dataset
      .boardAction,
    target = boardMenuTarget;
  if (!action || !target) return;
  hideBoardMenu();
  if (action === "copy") duplicateBoard(target.node, target.id);
  else if (action === "delete") deleteBoard(target.node, target.id);
  else if (action === "add") {
    boardInsertTarget = target;
    boardInsertPicker.click();
  }
});
boardInsertPicker.onchange = async () => {
  const files = Array.from(boardInsertPicker.files),
    target = boardInsertTarget;
  boardInsertPicker.value = "";
  boardInsertTarget = null;
  if (!files.length || !target) return;
  const { node, id } = target;
  if (importBusy) {
    notify("素材正在导入，请稍候");
    return;
  }
  if (!project.nodes.includes(node) || !node.frames.some((f) => f.id === id)) {
    notify("原分镜已移除，请重新选择插入位置");
    return;
  }
  const existing = new Set(node.frames.map((f) => f.id)),
    atEnd =
      usingBoards(node) && Math.abs(node.trigger - nodeDuration(node)) < 0.01;
  importBusy = true;
  try {
    await importBoards(files, node);
    const added = node.frames.filter((f) => !existing.has(f.id));
    if (!added.length) return;
    node.frames = node.frames.filter((f) => existing.has(f.id));
    const anchor = node.frames.findIndex((f) => f.id === id);
    node.frames.splice(
      anchor < 0 ? node.frames.length : anchor + 1,
      0,
      ...added,
    );
    if (atEnd) node.trigger = nodeDuration(node);
    refreshInsertedBoard(node, added[0].id);
    notify("已添加 " + added.length + " 张新分镜");
  } finally {
    importBusy = false;
  }
};
document.addEventListener("pointerdown", (e) => {
  if (!boardMenu.contains(e.target)) hideBoardMenu();
});
document.addEventListener("keydown", (e) => {
  if (boardMenu.hidden) return;
  if (e.key === "Escape") {
    e.preventDefault();
    hideBoardMenu();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const buttons = [...boardMenu.querySelectorAll("button:not(:disabled)")];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    buttons[
      (index + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
        buttons.length
    ].focus();
  } else if (e.key === "Tab") hideBoardMenu();
});
window.addEventListener("resize", hideBoardMenu);
document.addEventListener("scroll", hideBoardMenu, true);
document.addEventListener("dragstart", hideBoardMenu);

function deleteBoard(node, id) {
  if (importBusy || !project.nodes.includes(node)) return false;
  const index = node.frames?.findIndex((f) => f.id === id);
  if (index === undefined || index < 0) return false;
  const atEnd =
    usingBoards(node) && Math.abs(node.trigger - nodeDuration(node)) < 0.01;
  node.frames.splice(index, 1);
  if (!node.frames.length) node.previewSource = "video";
  if (atEnd && usingBoards(node)) node.trigger = nodeDuration(node);
  else if (!["time", "linked-tail"].includes(node.qteTriggerMode))
    node.trigger = Math.min(node.trigger, nodeDuration(node));
  const next = node.frames[Math.min(index, node.frames.length - 1)];
  if (next) refreshInsertedBoard(node, next.id);
  else {
    save();
    render();
  }
  notify("已删除该分镜");
  return true;
}
