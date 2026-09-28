// End-to-end tests against the running app (start it with: npx electron . --harness).
//   node test-e2e/overlay.e2e.mjs [testName...]
import assert from 'node:assert/strict';
import { call, evalIn } from '../tools/h.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 4000, every = 60, label = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn();
    if (last) return last;
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${label} (last=${JSON.stringify(last)})`);
}

const J = (js) => evalIn(`(() => { const C = window.__claude; const st = C.st; ${js} })()`);
const JA = (js) => evalIn(`(async () => { const C = window.__claude; const st = C.st; const sleep = (ms) => new Promise(r => setTimeout(r, ms)); ${js} })()`);
const charState = () => J(`const c = st.char; return { x: c.x, y: c.y, vx: c.vx, vy: c.vy, mode: c.mode, ground: c.ground, rope: c.rope.state, control: st.control.active, brain: st.brain.name, face: (st.anim.tempFace && st.t < st.anim.faceUntil ? st.anim.tempFace : st.anim.face).eyes };`);

async function brainInfo() {
  const info = await call('/overlay-info');
  return info.find((o) => o.brain);
}

async function takeControl() {
  await J(`C.setControlMode(true); return true;`);
}

async function releaseControl() {
  await J(`C.setControlMode(false); return true;`);
}

const tests = {
  async hoverTogglesClickThrough() {
    // Real mouse movement by the user can race this check, so retry a few times.
    for (let attempt = 0; attempt < 5; attempt++) {
      await J(`const c = C.centerOf(st.char); const a = C.info.area; window.dispatchEvent(new MouseEvent('mousemove', { clientX: c.x - a.x, clientY: c.y - a.y })); return true;`);
      await sleep(80);
      const on = await brainInfo();
      await J(`const c = C.centerOf(st.char); const a = C.info.area; window.dispatchEvent(new MouseEvent('mousemove', { clientX: c.x - a.x + 500, clientY: c.y - a.y - 300 })); return true;`);
      await sleep(80);
      const off = await brainInfo();
      if (on.clickThrough === false && off.clickThrough === true) return `hover: clickThrough=${on.clickThrough}, away: clickThrough=${off.clickThrough}`;
    }
    throw new Error('overlay did not toggle click-through on hover');
  },

  async pokeMakesClaudeReact() {
    await releaseControl();
    const r = await JA(`
      const c = C.centerOf(st.char); const a = C.info.area;
      const o = { clientX: c.x - a.x, clientY: c.y - a.y, button: 0 };
      window.dispatchEvent(new MouseEvent('mousemove', o));
      window.dispatchEvent(new MouseEvent('mousedown', o));
      await sleep(40);
      window.dispatchEvent(new MouseEvent('mouseup', o));
      await sleep(30);
      const f = st.anim.tempFace && st.t < st.anim.faceUntil ? st.anim.tempFace : null;
      return { face: f?.eyes, pokes: st.brain.pokes, mode: st.char.mode };`);
    assert.equal(r.mode !== 'held', true, 'a quick click must not pick Claude up');
    assert.ok(r.pokes >= 1, 'poke registered');
    assert.ok(['happy', 'wide', 'squint'].includes(r.face), `reaction face shown (${r.face})`);
    return r;
  },

  async dragAndThrow() {
    await releaseControl();
    const r = await JA(`
      const a = C.info.area;
      const c0 = C.centerOf(st.char);
      const at = (x, y) => ({ clientX: x - a.x, clientY: y - a.y, button: 0 });
      window.dispatchEvent(new MouseEvent('mousemove', at(c0.x, c0.y)));
      window.dispatchEvent(new MouseEvent('mousedown', at(c0.x, c0.y - 10)));
      let x = c0.x, y = c0.y - 10;
      const modes = [];
      // Lift up, then fling to the right.
      for (let i = 0; i < 10; i++) { y -= 25; window.dispatchEvent(new MouseEvent('mousemove', at(x, y))); await sleep(16); }
      modes.push(st.char.mode);
      const liftedY = st.char.y;
      for (let i = 0; i < 8; i++) { x += (x < a.x + a.w - 400 ? 45 : -45); y -= 10; window.dispatchEvent(new MouseEvent('mousemove', at(x, y))); await sleep(16); }
      window.dispatchEvent(new MouseEvent('mouseup', at(x, y)));
      await sleep(20);
      return { heldMode: modes[0], lifted: c0.y - (liftedY - 49), after: st.char.mode, vx: st.char.vx, vy: st.char.vy, tumble: st.char.tumble };`);
    assert.equal(r.heldMode, 'held', 'dragging picks Claude up');
    assert.equal(r.after, 'air', 'released Claude flies');
    assert.ok(Math.abs(r.vx) > 800, `thrown with speed (vx=${Math.round(r.vx)})`);
    const landed = await waitFor(async () => {
      const s = await charState();
      return s.mode === 'ground' ? s : null;
    }, { timeout: 8000, label: 'landing' });
    return { ...r, landedAt: Math.round(landed.x) };
  },

  async keyboardControl() {
    await takeControl();
    const s0 = await charState();
    assert.equal(s0.control, true);
    await J(`C.handleKey({ code: 'ArrowLeft', down: true }); return true;`);
    await sleep(600);
    const s1 = await charState();
    await J(`C.handleKey({ code: 'ArrowLeft', down: false }); return true;`);
    assert.ok(s1.x < s0.x - 40, `moved left (${Math.round(s0.x)} -> ${Math.round(s1.x)})`);
    await sleep(300);
    await J(`C.handleKey({ code: 'Space', down: true }); return true;`);
    await sleep(120);
    const s2 = await charState();
    await J(`C.handleKey({ code: 'Space', down: false }); return true;`);
    assert.equal(s2.mode, 'air', 'jumped');
    await waitFor(async () => (await charState()).mode === 'ground', { label: 'land after jump' });
    await J(`C.handleKey({ code: 'Escape', down: true }); return true;`);
    const s3 = await charState();
    assert.equal(s3.control, false, 'Escape releases control');
    return { movedLeft: Math.round(s0.x - s1.x), jumped: true };
  },

  async ropeSwing() {
    await takeControl();
    await waitFor(async () => (await charState()).mode === 'ground', { label: 'grounded' });
    const r = await JA(`
      const c = C.centerOf(st.char);
      st.cursor.x = c.x + 200; st.cursor.y = c.y - 350; st.cursor.t = st.t;
      C.handleKey({ code: 'KeyE', down: true, repeat: false }); C.handleKey({ code: 'KeyE', down: false });
      await sleep(400);
      const attached = st.char.rope.state;
      const mode = st.char.mode;
      C.handleKey({ code: 'ArrowRight', down: true }); await sleep(700); C.handleKey({ code: 'ArrowRight', down: false });
      const swingVx = st.char.vx;
      C.handleKey({ code: 'Space', down: true }); C.handleKey({ code: 'Space', down: false });
      await sleep(50);
      return { attached, mode, swingVx, after: st.char.mode, rope: st.char.rope.state };`);
    assert.equal(r.attached, 'attached');
    assert.equal(r.mode, 'rope');
    assert.equal(r.after, 'air', 'Space lets go of the rope');
    await waitFor(async () => (await charState()).mode === 'ground', { timeout: 6000, label: 'land after swing' });
    await releaseControl();
    return r;
  },

  async landsOnARealWindow() {
    const st = await call('/state');
    const p = [...st.platforms].sort((a, b) => b.x2 - b.x1 - (a.x2 - a.x1)).find((q) => q.x2 - q.x1 > 150);
    if (!p) return 'SKIPPED (no window ledges visible)';
    const region = st.displays.find((d) => (p.x1 + p.x2) / 2 >= d.workArea.x && (p.x1 + p.x2) / 2 < d.workArea.x + d.workArea.width);
    const brain = await brainInfo();
    if (region.id !== brain.id) {
      // Put Claude on that monitor first (via a hand-off) by teleporting across the seam.
      await takeControl();
      await J(`st.char.x = ${(p.x1 + p.x2) / 2}; st.char.y = ${p.y - 30}; st.char.vx = 0; st.char.vy = 0; st.char.mode = 'air'; st.char.ground = null; return true;`);
      await waitFor(async () => (await brainInfo()).id === region.id, { label: 'hand-off to the window monitor' });
    } else {
      await takeControl();
      await J(`st.char.x = ${(p.x1 + p.x2) / 2}; st.char.y = ${p.y - 30}; st.char.vx = 0; st.char.vy = 0; st.char.mode = 'air'; st.char.ground = null; return true;`);
    }
    const s = await waitFor(async () => {
      const x = await charState();
      return x.mode === 'ground' ? x : null;
    }, { label: 'landing on the window' });
    assert.equal(s.ground.kind, 'platform', `landed on ${JSON.stringify(s.ground)}`);
    assert.equal(s.ground.id, p.win);
    assert.equal(Math.round(s.y), Math.round(p.y));
    return { window: p.win, ledgeY: p.y, x: Math.round(s.x) };
  },

  async crossesMonitorsWithGhost() {
    const st = await call('/state');
    if (st.displays.length < 2) return 'SKIPPED (one monitor)';
    const [left, right] = [...st.displays].sort((a, b) => a.bounds.x - b.bounds.x);
    const seam = right.bounds.x;
    await takeControl();
    // Walk Claude to the seam on the left monitor.
    const b0 = await brainInfo();
    if (b0.id !== left.id) {
      await J(`st.char.x = ${seam + 300}; st.char.y = ${right.workArea.y + right.workArea.height - 3}; st.char.vx = 0; st.char.mode = 'ground'; st.char.ground = { kind: 'floor' }; return true;`);
      await J(`C.handleKey({ code: 'ArrowLeft', down: true }); return true;`);
      await waitFor(async () => (await brainInfo()).id === left.id, { timeout: 6000, label: 'hand-off to left monitor' });
      await J(`C.handleKey({ code: 'ArrowLeft', down: false }); return true;`);
      await sleep(300);
    }
    // Straddle the seam: center just left of it.
    await J(`st.char.x = ${seam - 12}; st.char.vx = 0; st.char.y = ${left.workArea.y + left.workArea.height - 3}; st.char.mode = 'ground'; st.char.ground = { kind: 'floor' }; return true;`);
    await sleep(250);
    const ghost = await evalIn(`(() => { const c = document.getElementById('char'); const x = c.getContext('2d'); const m = new DOMMatrix(getComputedStyle(c).transform); return { tx: m.m41, ty: m.m42, drew: x.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0) }; })()`, right.id);
    assert.ok(ghost.drew, 'right monitor draws the half of Claude that sticks over the bezel');
    // Now walk right: the simulation should hand off to the right monitor.
    await J(`C.handleKey({ code: 'ArrowRight', down: true }); return true;`);
    const after = await waitFor(async () => {
      const b = await brainInfo();
      return b.id === right.id ? b : null;
    }, { timeout: 5000, label: 'hand-off to right monitor' });
    await J(`C.handleKey({ code: 'ArrowRight', down: false }); return true;`);
    await releaseControl();
    return { ghostOnRight: ghost.drew, brainNow: after.id };
  },

  async fullscreenLocksToOtherMonitor() {
    const st = await call('/state');
    if (st.displays.length < 2) return 'SKIPPED (one monitor)';
    const b = await brainInfo();
    const other = st.displays.find((d) => d.id !== b.id);
    await call('/fullscreen', { ids: [b.id] });
    const moved = await waitFor(async () => {
      const i = await call('/overlay-info');
      const was = i.find((o) => o.id === b.id);
      const now = i.find((o) => o.brain);
      return !was.visible && now.id === other.id ? { hiddenOverlay: b.id, brainNow: now.id } : null;
    }, { timeout: 5000, label: 'evacuation to the other monitor' });
    const s = await charState();
    assert.ok(s.x >= other.workArea.x && s.x <= other.workArea.x + other.workArea.width, 'Claude is on the free monitor');
    // Claude must not wander back onto the fullscreen monitor.
    await takeControl();
    const towards = b.id === st.displays.sort((p, q) => p.bounds.x - q.bounds.x)[0].id ? 'ArrowLeft' : 'ArrowRight';
    await J(`C.handleKey({ code: '${towards}', down: true, repeat: false }); return true;`);
    await sleep(2500);
    const s2 = await charState();
    await J(`C.handleKey({ code: '${towards}', down: false }); return true;`);
    assert.ok(s2.x >= other.workArea.x && s2.x <= other.workArea.x + other.workArea.width, `stays on the free monitor (x=${Math.round(s2.x)})`);
    await releaseControl();
    await call('/fullscreen', { ids: [] });
    await waitFor(async () => (await call('/overlay-info')).every((o) => o.visible), { timeout: 5000, label: 'overlay restored' });
    await call('/fullscreen', { ids: null });
    return { ...moved, blockedAtEdge: Math.round(s2.x) };
  },
};

const only = process.argv.slice(2);
let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  if (only.length && !only.includes(name)) continue;
  try {
    const res = await fn();
    console.log(`✔ ${name}`, typeof res === 'string' ? res : JSON.stringify(res));
  } catch (err) {
    failed++;
    console.log(`✖ ${name}: ${err.message}`);
  }
}
await releaseControl().catch(() => {});
console.log(failed ? `${failed} failed` : 'all passed');
process.exitCode = failed ? 1 : 0;
