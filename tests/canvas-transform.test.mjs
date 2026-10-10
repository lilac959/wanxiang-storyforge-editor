import test from "node:test";
import assert from "node:assert/strict";
import {
  transformBox,
  transformPatch,
  uiTransformStyle,
  captionBoxStyle,
  CanvasTransform,
} from "../outputs/storyforge/studio/canvas-transform.mjs";
import {
  newProject,
  newEvent,
  migrate,
  validate,
} from "../outputs/storyforge/studio/model.mjs";
import { History } from "../outputs/storyforge/studio/history.mjs";

const stage = { left: 100, top: 60, width: 1000, height: 562.5 };
const box = { left: 500, top: 260, width: 100, height: 60 };

test("all four edges resize only their axis and keep the opposite edge fixed", () => {
  for (const handle of ["n", "e", "s", "w"]) {
    const after = transformBox(box, handle, 30, 20, stage);
    if (handle === "e" || handle === "w") {
      assert.equal(after.height, box.height);
      assert.equal(after.top, box.top);
      assert.equal(
        handle === "e" ? after.left : after.left + after.width,
        handle === "e" ? box.left : box.left + box.width,
      );
    } else {
      assert.equal(after.width, box.width);
      assert.equal(after.left, box.left);
      assert.equal(
        handle === "s" ? after.top : after.top + after.height,
        handle === "s" ? box.top : box.top + box.height,
      );
    }
  }
});
test("four corners preserve aspect and keep the opposite corner fixed even at size limits", () => {
  for (const handle of ["nw", "ne", "se", "sw"]) {
    const after = transformBox(box, handle, 90, 20, stage, {
      min: 0.2,
      max: 1.5,
    });
    assert.ok(
      Math.abs(after.width / after.height - box.width / box.height) < 1e-9,
    );
    assert.equal(
      handle.includes("w") ? after.left + after.width : after.left,
      handle.includes("w") ? box.left + box.width : box.left,
    );
    assert.equal(
      handle.includes("n") ? after.top + after.height : after.top,
      handle.includes("n") ? box.top + box.height : box.top,
    );
  }
});
test("subtitle edges change wrapping region without stretching letters; corners change font and region together", () => {
  const item = { x: 50, y: 50, size: 30 };
  const wider = transformBox(box, "e", 100, 0, stage);
  const patch = transformPatch(item, "subtitle", box, wider, stage, "e");
  assert.equal(patch.width, 20);
  assert.equal(patch.size, undefined);
  assert.equal(patch.stretchX, undefined);
  const double = transformBox(box, "se", 100, 60, stage);
  const corner = transformPatch(item, "subtitle", box, double, stage, "se");
  assert.equal(corner.size, 60);
  assert.equal(corner.width, 20);
});
test("stage letterboxing and viewport scaling preserve authored positions and sizes; choice offsets use width", () => {
  const item = { x: 65, y: 50, scale: 50 };
  const expected = transformPatch(
    item,
    "event",
    box,
    transformBox(box, "e", 30, 0, stage),
    stage,
    "e",
  );
  const half = (r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v / 2]));
  const small = transformPatch(
    item,
    "event",
    half(box),
    transformBox(half(box), "e", 15, 0, half(stage)),
    half(stage),
    "e",
  );
  assert.deepEqual(small, expected);
  const choice = transformPatch(
    { x: 0, y: 0 },
    "event",
    box,
    { ...box, top: box.top + 100 },
    stage,
    "move",
    true,
  );
  assert.equal(choice.y, 10);
});
test("center snapping respects the fitted stage and can be disabled", () => {
  const after = transformBox(box, "move", 52, 52, stage);
  assert.equal(after.left + after.width / 2, 600);
  assert.equal(after.top + after.height / 2, stage.top + stage.height / 2);
  assert.deepEqual(after.guides, ["x", "y"]);
  assert.equal(transformBox(box, "move", 52, 52, stage, {}, false).left, 552);
});
test("UI stretch and subtitle boxes survive save/migration and undo, while legacy data retains defaults", () => {
  const p = newProject(),
    s = p.scenes[0];
  s.events.push(newEvent(0, "qte"), newEvent(0, "choice"));
  s.subtitles.push({
    id: "caption-a",
    text: "字幕",
    startMs: 0,
    endMs: 2000,
    x: 50,
    y: 88,
    size: 30,
    color: "#ffffff",
    background: true,
  });
  const history = new History(p);
  history.commit("调整尺寸", (p) => {
    Object.assign(p.scenes[0].events[0], { stretchX: 150, stretchY: 70 });
    Object.assign(p.scenes[0].events[1].options[0], {
      scale: 75,
      stretchX: 130,
    });
    Object.assign(p.scenes[0].subtitles[0], {
      width: 40,
      height: 10,
      size: 100,
    });
  });
  const restored = migrate(JSON.parse(JSON.stringify(history.project)));
  assert.ok(!validate(restored).some((x) => x.level === "error"));
  assert.equal(restored.scenes[0].events[0].stretchY, 70);
  assert.equal(restored.scenes[0].events[1].options[0].stretchX, 130);
  assert.equal(restored.scenes[0].subtitles[0].width, 40);
  assert.match(
    uiTransformStyle(restored.scenes[0].events[0]),
    /--scale-x:1.5;--scale-y:0.7/,
  );
  assert.equal(
    captionBoxStyle(restored.scenes[0].subtitles[0]),
    "width:40%;height:10%;",
  );
  history.undo();
  assert.equal(history.project.scenes[0].subtitles[0].width, undefined);
  assert.equal(captionBoxStyle(history.project.scenes[0].subtitles[0]), "");
  assert.equal(uiTransformStyle({}), "--scale:1;--scale-x:1;--scale-y:1");
  restored.scenes[0].subtitles[0].width = Infinity;
  restored.scenes[0].events[0].stretchX = 0;
  restored.scenes[0].events[1].options[0].stretchY = 401;
  assert.ok(validate(restored).filter((x) => x.level === "error").length >= 3);
});
test("Escape and pointer cancellation restore transient styles and never save, release commits once", () => {
  const savedWindow = globalThis.window;
  globalThis.window = new EventTarget();
  try {
    let commits = 0,
      cancels = 0;
    const styles = {
      setProperty(k, v) {
        this[k] = v;
      },
    };
    const classes = new Set();
    const target = {
      getBoundingClientRect: () => box,
      getAttribute: () => "original",
      setAttribute(k, v) {
        this.restored = v;
      },
      style: styles,
      classList: {
        contains: (k) => classes.has(k),
        add: (k) => classes.add(k),
        toggle(k, on) {
          on ? classes.add(k) : classes.delete(k);
        },
      },
    };
    const view = {
      target,
      item: { x: 50, y: 50, scale: 100 },
      kind: "event",
      canvas: {
        querySelector: () => ({ getBoundingClientRect: () => stage }),
        getBoundingClientRect: () => stage,
      },
      begin() {},
      snap: () => true,
      preview() {},
      commit() {
        commits++;
      },
      cancel() {
        cancels++;
      },
      refresh() {},
      layer: {
        querySelectorAll: () => [],
        querySelector: () => ({ style: {} }),
      },
    };
    const dispatch = (type, props = {}) => {
      const ev = new Event(type);
      Object.assign(ev, props);
      window.dispatchEvent(ev);
    };
    for (const ending of ["Escape", "pointercancel", "pointerup"]) {
      CanvasTransform.prototype.pointer.call(
        view,
        {
          button: 0,
          clientX: 0,
          clientY: 0,
          preventDefault() {},
          stopPropagation() {},
        },
        "e",
      );
      dispatch("pointermove", { clientX: 30, clientY: 0 });
      ending === "Escape"
        ? dispatch("keydown", { key: "Escape" })
        : dispatch(ending);
      assert.equal(target.restored, "original");
      assert.equal(view.active, false);
    }
    assert.equal(commits, 1);
    assert.equal(cancels, 2);
    assert.equal(view.item.stretchX, undefined);
  } finally {
    globalThis.window = savedWindow;
  }
});
