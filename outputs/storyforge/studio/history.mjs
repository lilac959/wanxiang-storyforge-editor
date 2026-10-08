import { clone } from "./model.mjs";
export class History {
  constructor(project, onChange = () => {}) {
    this.project = clone(project);
    this.past = [];
    this.future = [];
    this.onChange = onChange;
  }
  commit(label, edit) {
    const before = clone(this.project);
    edit(this.project);
    if (JSON.stringify(before) === JSON.stringify(this.project)) return;
    this.past.push({ label, project: before });
    if (this.past.length > 80) this.past.shift();
    this.future = [];
    this.onChange(this.project, label);
  }
  undo() {
    const x = this.past.pop();
    if (!x) return;
    this.future.push({ label: x.label, project: clone(this.project) });
    this.project = x.project;
    this.onChange(this.project, `撤销 ${x.label}`);
  }
  redo() {
    const x = this.future.pop();
    if (!x) return;
    this.past.push({ label: x.label, project: clone(this.project) });
    this.project = x.project;
    this.onChange(this.project, `重做 ${x.label}`);
  }
}
// Serial, coalescing queue. Revision advances only after an acknowledged write.
export class SaveQueue {
  constructor(write, onState = () => {}) {
    this.write = write;
    this.onState = onState;
    this.pending = null;
    this.running = null;
    this.revision = "none";
    this.sequence = 0;
    this.stopped = false;
  }
  enqueue(project) {
    this.pending = { project: clone(project), sequence: ++this.sequence };
    this.stopped = false;
    return this.flush();
  }
  flush() {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  async drain() {
    while (this.pending && !this.stopped) {
      const item = this.pending;
      this.pending = null;
      this.onState("saving");
      try {
        const result = await this.write(item.project, this.revision);
        this.revision = result.revision;
        if (!this.pending) this.onState("saved", result, item.sequence);
      } catch (error) {
        if (!this.pending) this.pending = item;
        this.stopped = true;
        this.onState(error.status === 409 ? "conflict" : "error", error);
      }
    }
  }
}
