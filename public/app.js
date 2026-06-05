"use strict";
/* ====================================================================
   NetPlanner — аналог Cisco Packet Tracer на Canvas
   Планировщик помещений + проектирование локальных сетей
   ==================================================================== */

const T = window.DEVICE_TYPES;
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");

// ----- Модель документа -----
let model = { rooms: [], walls: [], devices: [], cables: [] };
let nextId = 1;
const uid = (p) => `${p}${nextId++}`;

// ----- Состояние вида -----
const view = { x: 0, y: 0, scale: 1 };
const GRID = 24;
const WIRELESS_RANGE = 190;

// ----- Состояние взаимодействия -----
let tool = "select";
let selected = null;          // выбранный объект {type, ref}
let drag = null;              // активное перетаскивание
let resizing = null;          // изменение размера {kind:'room'|'wall', ref, handle}
let multi = [];               // мультивыделение: массив устройств
let marquee = null;           // рамка выделения {x0,y0,x1,y1}
let clipboard = [];           // буфер обмена устройств
let draftRoom = null;         // рисуемая комната
let draftWall = null;         // рисуемая стена
let cableFrom = null;         // первый конец провода
let mouse = { x: 0, y: 0, wx: 0, wy: 0 };
let panning = false;
let spaceDown = false;
let simOn = false;
const layers = { rooms: true, grid: true, labels: true };

// ----- Анимация пакетов (пинг) -----
let packets = [];   // {path:[{x,y}...], t, color, onDone}

/* ====================================================================
   Утилиты координат
   ==================================================================== */
function resize() {
  const r = cv.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = r.width * dpr;
  cv.height = r.height * dpr;
  cv.style.width = r.width + "px";
  cv.style.height = r.height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", () => { resize(); draw(); });

const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale });
const snap = (v) => Math.round(v / GRID) * GRID;

function screenPos(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/* ====================================================================
   Палитра устройств
   ==================================================================== */
const devGrid = document.getElementById("dev-grid");
function buildPalette() {
  devGrid.innerHTML = "";
  window.DEVICE_ORDER.forEach((kind) => {
    const dt = T[kind];
    const b = document.createElement("div");
    b.className = "dev-btn";
    b.draggable = true;
    b.innerHTML = `<span class="ico">${dt.icon}</span><span class="nm">${devName(kind)}</span>`;
    b.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("kind", kind);
      b.classList.add("dragging");
    });
    b.addEventListener("dragend", () => b.classList.remove("dragging"));
    devGrid.appendChild(b);
  });
}
buildPalette();

cv.addEventListener("dragover", (e) => e.preventDefault());
cv.addEventListener("drop", (e) => {
  e.preventDefault();
  const kind = e.dataTransfer.getData("kind");
  if (!kind) return;
  const p = screenPos(e);
  const w = toWorld(p.x, p.y);
  addDevice(kind, snap(w.x), snap(w.y));
  draw();
});

/* ====================================================================
   Создание объектов
   ==================================================================== */
function randMac() {
  const h = () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase();
  return [h(), h(), h(), h(), h(), h()].join(":");
}

function makeDevice(kind, x, y) {
  const count = model.devices.filter((d) => d.kind === kind).length + 1;
  const d = {
    id: uid("d"), kind, x, y,
    name: `${devName(kind)}-${count}`,
    ip: "", mac: randMac(), on: true,
  };
  model.devices.push(d);
  return d;
}
function addDevice(kind, x, y) {
  const d = makeDevice(kind, x, y);
  select("device", d);
  log(t("log.added", { name: d.name }), "dim");
  autosave(); commit();
  return d;
}

function addCable(a, b) {
  if (a.id === b.id) return;
  if (model.cables.some((c) => (c.a === a.id && c.b === b.id) || (c.a === b.id && c.b === a.id))) {
    log(t("log.alreadyConnected"), "err");
    return;
  }
  const fiber = a.kind === "server" || b.kind === "server" || a.kind === "router" && b.kind === "router";
  const c = { id: uid("c"), a: a.id, b: b.id, type: fiber ? "fiber" : "copper" };
  model.cables.push(c);
  log(t("log.cable", { a: a.name, b: b.name }), "ok");
  autosave(); commit();
}

/* ====================================================================
   Поиск объектов под курсором
   ==================================================================== */
function deviceAt(wx, wy) {
  for (let i = model.devices.length - 1; i >= 0; i--) {
    const d = model.devices[i];
    if (Math.abs(wx - d.x) <= 26 && Math.abs(wy - d.y) <= 26) return d;
  }
  return null;
}
function roomAt(wx, wy) {
  for (let i = model.rooms.length - 1; i >= 0; i--) {
    const r = model.rooms[i];
    if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return r;
  }
  return null;
}
function cableAt(wx, wy) {
  for (const c of model.cables) {
    const a = byId(c.a), b = byId(c.b);
    if (!a || !b) continue;
    if (distToSeg(wx, wy, a.x, a.y, b.x, b.y) < 7) return c;
  }
  return null;
}
function wallAt(wx, wy) {
  for (const w of model.walls) {
    if (distToSeg(wx, wy, w.x1, w.y1, w.x2, w.y2) < 7) return w;
  }
  return null;
}
const byId = (id) => model.devices.find((d) => d.id === id);

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/* ----- Ручки зміни розміру ----- */
const ROOM_MIN = GRID;                       // мінімальний розмір кімнати

// Координати 8 ручок кімнати
function roomHandles(r) {
  const { x, y, w, h } = r;
  return {
    nw: [x, y], n: [x + w / 2, y], ne: [x + w, y],
    e: [x + w, y + h / 2], se: [x + w, y + h], s: [x + w / 2, y + h],
    sw: [x, y + h], w: [x, y + h / 2],
  };
}
// Координати кінців стіни
function wallHandles(wl) { return { a: [wl.x1, wl.y1], b: [wl.x2, wl.y2] }; }

// Курсор для ручки
const HANDLE_CURSOR = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", a: "move", b: "move",
};

// Знайти ручку під курсором для виділеного об'єкта
function handleAt(wx, wy) {
  if (!selected) return null;
  const tol = 8 / view.scale;
  let hs = null;
  if (selected.type === "room") hs = roomHandles(selected.ref);
  else if (selected.type === "wall") hs = wallHandles(selected.ref);
  if (!hs) return null;
  for (const k in hs) {
    if (Math.hypot(wx - hs[k][0], wy - hs[k][1]) <= tol) return k;
  }
  return null;
}

// Перерахунок геометрії кімнати при тягненні ручки
function resizeRoom(r, h, wx, wy) {
  let left = r.x, top = r.y, right = r.x + r.w, bottom = r.y + r.h;
  if (h.includes("e")) right = Math.max(left + ROOM_MIN, snap(wx));
  if (h.includes("w")) left = Math.min(right - ROOM_MIN, snap(wx));
  if (h.includes("s")) bottom = Math.max(top + ROOM_MIN, snap(wy));
  if (h.includes("n")) top = Math.min(bottom - ROOM_MIN, snap(wy));
  r.x = left; r.y = top; r.w = right - left; r.h = bottom - top;
}
function resizeWall(wl, h, wx, wy) {
  if (h === "a") { wl.x1 = snap(wx); wl.y1 = snap(wy); }
  else { wl.x2 = snap(wx); wl.y2 = snap(wy); }
}

// Пристрої, центр яких лежить у межах кімнати (для спільного переміщення)
function devicesInRoom(r) {
  return model.devices.filter((d) =>
    d.x >= r.x && d.x <= r.x + r.w && d.y >= r.y && d.y <= r.y + r.h);
}

/* ====================================================================
   Инструменты (верхняя панель)
   ==================================================================== */
document.querySelectorAll(".tool").forEach((b) => {
  b.addEventListener("click", () => setTool(b.dataset.tool));
});
function setTool(tl) {
  tool = tl;
  cableFrom = null;
  document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === tl));
  cv.style.cursor = tl === "select" ? "default" : "crosshair";
  setStatus(t("status.tool", { name: t("tool." + tl) }));
}

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  const ctrl = e.ctrlKey || e.metaKey;
  // ВАЖЛИВО: використовуємо e.code (фізична клавіша), а не e.key —
  // інакше при кириличній розкладці Z='я', Y='н' і скорочення не працюють.
  // Undo / Redo
  if (ctrl && e.code === "KeyZ" && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (ctrl && (e.code === "KeyY" || (e.shiftKey && e.code === "KeyZ"))) { e.preventDefault(); redo(); return; }
  if (ctrl && e.code === "KeyC") { e.preventDefault(); copySelection(); return; }
  if (ctrl && e.code === "KeyV") { e.preventDefault(); pasteSelection(); return; }
  if (ctrl && e.code === "KeyS") { e.preventDefault(); document.getElementById("btn-save").click(); return; }
  if (ctrl && e.code === "KeyA") { e.preventDefault(); selectAllDevices(); return; }
  if (ctrl) return; // інші Ctrl-комбінації не перехоплюємо як інструменти
  const map = { KeyV: "select", KeyR: "room", KeyW: "wall", KeyC: "cable", KeyE: "erase" };
  if (map[e.code]) { setTool(map[e.code]); return; }
  if (e.code === "Space") { spaceDown = true; e.preventDefault(); return; }
  if (e.key === "Delete" || e.key === "Backspace") { if (selected || multi.length) deleteSelected(); return; }
  if (e.key === "Escape") { select(null); multi = []; draw(); return; }
  // зсув виділеного стрілками
  const nudge = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[e.code];
  if (nudge && (selected?.type === "device" || multi.length)) { e.preventDefault(); nudgeSelection(nudge[0], nudge[1]); }
});
document.addEventListener("keyup", (e) => { if (e.code === "Space") spaceDown = false; });

/* ====================================================================
   Мышь на канвасе
   ==================================================================== */
cv.addEventListener("mousedown", (e) => {
  const p = screenPos(e);
  const w = toWorld(p.x, p.y);
  mouse = { x: p.x, y: p.y, wx: w.x, wy: w.y };

  // Панорама: средняя кнопка или пробел
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    panning = true; cv.style.cursor = "grabbing"; return;
  }
  if (e.button !== 0) return;

  if (tool === "select") {
    // 1) ручка зміни розміру виділеного об'єкта має пріоритет
    const handle = handleAt(w.x, w.y);
    if (handle) {
      resizing = { kind: selected.type, ref: selected.ref, handle };
      return;
    }
    const d = deviceAt(w.x, w.y);
    if (d) {
      if (e.shiftKey) {
        // shift-клік: додати/прибрати з мультивиділення
        const i = multi.indexOf(d);
        if (i >= 0) multi.splice(i, 1); else multi.push(d);
        selected = null; refreshInspector(); draw();
        return;
      }
      if (multi.includes(d) && multi.length > 1) {
        // груповий drag усіх виділених
        drag = { kind: "multi", items: multi.map((dd) => ({ d: dd, ox: dd.x, oy: dd.y })), bx: w.x, by: w.y };
        return;
      }
      multi = [];
      select("device", d);
      drag = { kind: "device", ref: d, dx: w.x - d.x, dy: w.y - d.y };
      return;
    }
    const c = cableAt(w.x, w.y);
    if (c) { select("cable", c); return; }
    const r = roomAt(w.x, w.y);
    if (r) {
      select("room", r);
      // захоплюємо пристрої всередині кімнати — рухатимуться разом із нею
      const children = devicesInRoom(r).map((dd) => ({ d: dd, ox: dd.x, oy: dd.y }));
      drag = { kind: "room", ref: r, dx: w.x - r.x, dy: w.y - r.y, rox: r.x, roy: r.y, children };
      return;
    }
    const wl = wallAt(w.x, w.y);
    if (wl) { select("wall", wl); return; }
    // порожнє місце: старт рамки мультивиділення
    select(null);
    if (!e.shiftKey) multi = [];
    marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
  } else if (tool === "room") {
    draftRoom = { x: snap(w.x), y: snap(w.y), w: 0, h: 0 };
  } else if (tool === "wall") {
    draftWall = { x1: snap(w.x), y1: snap(w.y), x2: snap(w.x), y2: snap(w.y) };
  } else if (tool === "cable") {
    const d = deviceAt(w.x, w.y);
    if (d) {
      if (!cableFrom) { cableFrom = d; log(t("log.cableFrom", { name: d.name }), "dim"); }
      else { addCable(cableFrom, d); cableFrom = null; }
    }
  } else if (tool === "erase") {
    eraseAt(w.x, w.y);
  }
  draw();
});

cv.addEventListener("mousemove", (e) => {
  const p = screenPos(e);
  const w = toWorld(p.x, p.y);

  if (panning) {
    view.x += p.x - mouse.x;
    view.y += p.y - mouse.y;
    mouse = { x: p.x, y: p.y, wx: w.x, wy: w.y };
    draw();
    return;
  }
  mouse = { x: p.x, y: p.y, wx: w.x, wy: w.y };

  if (resizing) {
    if (resizing.kind === "room") resizeRoom(resizing.ref, resizing.handle, w.x, w.y);
    else if (resizing.kind === "wall") resizeWall(resizing.ref, resizing.handle, w.x, w.y);
    if (selected && selected.type === "room") refreshInspector();
    draw();
    return;
  }

  if (marquee) {
    marquee.x1 = w.x; marquee.y1 = w.y;
    draw();
    return;
  }

  if (drag) {
    if (drag.kind === "device") { drag.ref.x = snap(w.x - drag.dx); drag.ref.y = snap(w.y - drag.dy); }
    if (drag.kind === "multi") {
      const rdx = w.x - drag.bx, rdy = w.y - drag.by;
      for (const it of drag.items) { it.d.x = snap(it.ox + rdx); it.d.y = snap(it.oy + rdy); }
    }
    if (drag.kind === "room") {
      drag.ref.x = snap(w.x - drag.dx); drag.ref.y = snap(w.y - drag.dy);
      // зсуваємо вкладені пристрої на ту саму дельту
      const ddx = drag.ref.x - drag.rox, ddy = drag.ref.y - drag.roy;
      for (const ch of drag.children) { ch.d.x = ch.ox + ddx; ch.d.y = ch.oy + ddy; }
    }
    draw();
  } else if (draftRoom) {
    draftRoom.w = snap(w.x) - draftRoom.x;
    draftRoom.h = snap(w.y) - draftRoom.y;
    draw();
  } else if (draftWall) {
    draftWall.x2 = snap(w.x); draftWall.y2 = snap(w.y);
    draw();
  } else if (tool === "cable" && cableFrom) {
    draw();
  } else if (tool === "select") {
    // підказка курсором над ручками зміни розміру
    const hk = handleAt(w.x, w.y);
    cv.style.cursor = hk ? HANDLE_CURSOR[hk] : "default";
  }
});

window.addEventListener("mouseup", () => {
  if (panning) { panning = false; cv.style.cursor = tool === "select" ? "default" : "crosshair"; }
  if (resizing) { autosave(); commit(); resizing = null; }
  if (drag) { autosave(); commit(); drag = null; }
  if (marquee) {
    const x0 = Math.min(marquee.x0, marquee.x1), x1 = Math.max(marquee.x0, marquee.x1);
    const y0 = Math.min(marquee.y0, marquee.y1), y1 = Math.max(marquee.y0, marquee.y1);
    if (Math.hypot(x1 - x0, y1 - y0) > 6) {
      const inside = model.devices.filter((d) => d.x >= x0 && d.x <= x1 && d.y >= y0 && d.y <= y1);
      const set = new Set(multi);
      inside.forEach((d) => set.add(d));
      multi = [...set];
      if (multi.length) setStatus(t("status.selected", { n: multi.length }));
    }
    marquee = null; draw();
  }
  if (draftRoom) {
    if (Math.abs(draftRoom.w) > 10 && Math.abs(draftRoom.h) > 10) {
      const r = {
        id: uid("r"),
        x: Math.min(draftRoom.x, draftRoom.x + draftRoom.w),
        y: Math.min(draftRoom.y, draftRoom.y + draftRoom.h),
        w: Math.abs(draftRoom.w), h: Math.abs(draftRoom.h),
        name: t("room.default", { n: model.rooms.length + 1 }),
        color: "#2a3550",
      };
      model.rooms.push(r);
      select("room", r);
      autosave(); commit();
    }
    draftRoom = null; draw();
  }
  if (draftWall) {
    if (Math.hypot(draftWall.x2 - draftWall.x1, draftWall.y2 - draftWall.y1) > 10) {
      model.walls.push({ id: uid("w"), ...draftWall });
      autosave(); commit();
    }
    draftWall = null; draw();
  }
});

// Масштаб колесом
cv.addEventListener("wheel", (e) => {
  e.preventDefault();
  const p = screenPos(e);
  const before = toWorld(p.x, p.y);
  const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  view.scale = Math.max(0.25, Math.min(3, view.scale * f));
  const after = toWorld(p.x, p.y);
  view.x += (after.x - before.x) * view.scale;
  view.y += (after.y - before.y) * view.scale;
  draw();
}, { passive: false });

cv.addEventListener("dblclick", (e) => {
  const p = screenPos(e);
  const w = toWorld(p.x, p.y);
  const d = deviceAt(w.x, w.y);
  if (d) { d.on = !d.on; log(t("log.power", { name: d.name, state: t(d.on ? "power.on" : "power.off") }), d.on ? "ok" : "err"); draw(); autosave(); commit(); }
});

/* ====================================================================
   Удаление
   ==================================================================== */
function eraseAt(wx, wy) {
  const d = deviceAt(wx, wy);
  if (d) return removeDevice(d);
  const c = cableAt(wx, wy);
  if (c) { model.cables = model.cables.filter((x) => x !== c); log(t("log.cableDeleted"), "dim"); autosave(); commit(); return; }
  const wl = wallAt(wx, wy);
  if (wl) { model.walls = model.walls.filter((x) => x !== wl); autosave(); commit(); return; }
  const r = roomAt(wx, wy);
  if (r) { model.rooms = model.rooms.filter((x) => x !== r); autosave(); commit(); return; }
}
function removeDevice(d) {
  model.devices = model.devices.filter((x) => x !== d);
  model.cables = model.cables.filter((c) => c.a !== d.id && c.b !== d.id);
  if (selected && selected.ref === d) select(null);
  log(t("log.removed", { name: d.name }), "dim");
  autosave(); commit();
}
function deleteSelected() {
  // мультивыделение устройств
  if (multi.length) {
    const ids = new Set(multi.map((d) => d.id));
    model.devices = model.devices.filter((d) => !ids.has(d.id));
    model.cables = model.cables.filter((c) => !ids.has(c.a) && !ids.has(c.b));
    multi = []; select(null); autosave(); commit(); draw();
    return;
  }
  if (!selected) return;
  const { type, ref } = selected;
  if (type === "device") removeDevice(ref);
  else if (type === "cable") model.cables = model.cables.filter((x) => x !== ref);
  else if (type === "room") model.rooms = model.rooms.filter((x) => x !== ref);
  else if (type === "wall") model.walls = model.walls.filter((x) => x !== ref);
  select(null);
  autosave(); commit(); draw();
}

/* ----- Мультивыделение / копирование / вставка / сдвиг ----- */
function selectionDevices() {
  if (multi.length) return multi;
  if (selected && selected.type === "device") return [selected.ref];
  return [];
}
function selectAllDevices() {
  multi = [...model.devices];
  selected = null; refreshInspector(); draw();
  setStatus(t("status.selected", { n: multi.length }));
}
function nudgeSelection(dx, dy) {
  const ds = selectionDevices();
  if (!ds.length) return;
  ds.forEach((d) => { d.x += dx; d.y += dy; });
  autosave(); commit(); draw();
}
function copySelection() {
  const ds = selectionDevices();
  if (!ds.length) return;
  clipboard = ds.map((d) => ({ kind: d.kind, x: d.x, y: d.y }));
  log(t("log.copied", { n: ds.length }), "dim");
}
function pasteSelection() {
  if (!clipboard.length) return;
  multi = [];
  for (const c of clipboard) {
    const d = makeDevice(c.kind, c.x + GRID, c.y + GRID);
    multi.push(d);
  }
  selected = null; refreshInspector();
  autosave(); commit(); draw();
  log(t("log.pasted", { n: clipboard.length }), "ok");
}

/* ====================================================================
   Сетевая логика: связность, авто-IP, маршрут пинга
   ==================================================================== */
function neighbors(d) {
  // соседи по проводам
  const out = [];
  for (const c of model.cables) {
    if (c.a === d.id) { const o = byId(c.b); if (o && o.on) out.push(o); }
    if (c.b === d.id) { const o = byId(c.a); if (o && o.on) out.push(o); }
  }
  // беспроводные соседи: если оба беспроводные и один из них — раздаёт (forward)
  if (T[d.kind].wireless && d.on) {
    for (const o of model.devices) {
      if (o === d || !o.on || !T[o.kind].wireless) continue;
      if (!(T[d.kind].forward || T[o.kind].forward)) continue; // нужен хотя бы один раздающий (роутер/AP)
      if (Math.hypot(o.x - d.x, o.y - d.y) <= WIRELESS_RANGE) out.push(o);
    }
  }
  return out;
}

// Компоненты связности (широковещательные сегменты L2)
function components() {
  const seen = new Set();
  const comps = [];
  for (const d of model.devices) {
    if (seen.has(d.id) || !d.on) continue;
    const comp = [];
    const q = [d];
    seen.add(d.id);
    while (q.length) {
      const cur = q.pop();
      comp.push(cur);
      for (const n of neighbors(cur)) {
        if (!seen.has(n.id)) { seen.add(n.id); q.push(n); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

function autoIP() {
  const comps = components().filter((c) => c.length > 1);
  let subnet = 0;
  let assigned = 0;
  for (const comp of comps) {
    const base = `192.168.${subnet}`;
    let host = 1;
    // шлюз — первый роутер, если есть
    const gw = comp.find((d) => d.kind === "router") || comp.find((d) => T[d.kind].forward);
    if (gw) { gw.ip = `${base}.1`; gw.gateway = `${base}.1`; host = 2; }
    for (const d of comp) {
      if (d === gw) continue;
      if (T[d.kind].forward && d.kind !== "router") { d.ip = ""; continue; } // коммутаторы/хабы без IP
      d.ip = `${base}.${host++}`;
      d.gateway = gw ? `${base}.1` : "";
      assigned++;
    }
    subnet++;
  }
  log(t("log.autoip", { seg: comps.length, nodes: assigned }), "info");
  autosave(); commit(); draw();
  refreshInspector();
}

// Кратчайший путь между двумя устройствами (для анимации пинга)
function findPath(src, dst) {
  const prev = new Map();
  const q = [src];
  const seen = new Set([src.id]);
  while (q.length) {
    const cur = q.shift();
    if (cur.id === dst.id) {
      const path = [cur];
      let p = cur;
      while (prev.has(p.id)) { p = prev.get(p.id); path.unshift(p); }
      return path;
    }
    for (const n of neighbors(cur)) {
      // в промежуточные конечные устройства не заходим (только пересылающие), кроме пункта назначения
      if (!seen.has(n.id) && (T[n.kind].forward || n.id === dst.id)) {
        seen.add(n.id); prev.set(n.id, cur); q.push(n);
      }
    }
  }
  return null;
}

function ping(src, dst) {
  if (!src.on || !dst.on) { log(t("ping.off"), "err"); return; }
  const path = findPath(src, dst);
  if (!path) { log(t("ping.noRoute", { a: src.name, b: dst.name }), "err"); return; }
  log(t("ping.start", { name: dst.name, ip: dst.ip || t("val.unknown"), src: src.name }), "info");
  const pts = path.map((d) => ({ x: d.x, y: d.y }));
  let seq = 0;
  const fire = () => {
    if (seq >= 4) return;
    packets.push({
      path: pts, t: 0, color: "#38d39f",
      onDone: () => {
        const ms = (Math.random() * 8 + 1).toFixed(1);
        log(t("ping.reply", { ip: dst.ip || dst.name, ms }), "ok");
        seq++;
        if (seq < 4) setTimeout(fire, 250);
        else log(t("ping.done", { a: src.name, b: dst.name }), "ok");
      },
    });
    if (!animRunning) animate();
  };
  fire();
}

/* ====================================================================
   Симуляция (фон): подсветка живых линков
   ==================================================================== */
document.getElementById("btn-sim").addEventListener("click", function () {
  simOn = !simOn;
  this.classList.toggle("on", simOn);
  setStatus(simOn ? t("status.simOn") : t("status.simOff"));
  draw();
});
document.getElementById("btn-autoip").addEventListener("click", autoIP);

/* ====================================================================
   Анимация пакетов
   ==================================================================== */
let animRunning = false;
function animate() {
  animRunning = true;
  packets.forEach((p) => {
    p.t += 0.012;
  });
  packets = packets.filter((p) => {
    if (p.t >= 1) { p.onDone && p.onDone(); return false; }
    return true;
  });
  draw();
  if (packets.length) requestAnimationFrame(animate);
  else animRunning = false;
}
function packetPos(p) {
  const segs = p.path.length - 1;
  const f = p.t * segs;
  const i = Math.min(Math.floor(f), segs - 1);
  const lt = f - i;
  const a = p.path[i], b = p.path[i + 1];
  return { x: a.x + (b.x - a.x) * lt, y: a.y + (b.y - a.y) * lt };
}

/* ====================================================================
   Отрисовка
   ==================================================================== */
function draw() {
  const w = cv.clientWidth, h = cv.clientHeight;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0f1420";
  ctx.fillRect(0, 0, w, h);

  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);

  if (layers.grid) drawGrid(w, h);
  if (layers.rooms) model.rooms.forEach(drawRoom);
  model.walls.forEach(drawWall);
  if (draftRoom) drawRoom(draftRoom, true);
  if (draftWall) drawWall(draftWall);

  model.cables.forEach(drawCable);
  if (tool === "cable" && cableFrom) {
    ctx.strokeStyle = "#3ea6ff"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(cableFrom.x, cableFrom.y); ctx.lineTo(mouse.wx, mouse.wy); ctx.stroke();
    ctx.setLineDash([]);
  }

  // диапазоны Wi-Fi
  model.devices.forEach((d) => {
    if (T[d.kind].wireless && T[d.kind].forward && d.on) drawWifiRange(d);
  });

  model.devices.forEach(drawDevice);

  // підсвітка мультивиділення
  if (multi.length) {
    ctx.strokeStyle = "#38d39f"; ctx.lineWidth = 2 / view.scale; ctx.setLineDash([5 / view.scale, 4 / view.scale]);
    multi.forEach((d) => { ctx.strokeRect(d.x - 25, d.y - 25, 50, 50); });
    ctx.setLineDash([]);
  }

  // рамка виділення
  if (marquee) {
    const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
    const mw = Math.abs(marquee.x1 - marquee.x0), mh = Math.abs(marquee.y1 - marquee.y0);
    ctx.fillStyle = "rgba(56,211,159,.10)";
    ctx.strokeStyle = "#38d39f"; ctx.lineWidth = 1 / view.scale; ctx.setLineDash([4 / view.scale, 3 / view.scale]);
    ctx.fillRect(x, y, mw, mh); ctx.strokeRect(x, y, mw, mh);
    ctx.setLineDash([]);
  }

  // ручки зміни розміру для виділеної кімнати / стіни
  if (selected && selected.type === "room") drawHandles(roomHandles(selected.ref));
  else if (selected && selected.type === "wall") drawHandles(wallHandles(selected.ref));

  // пакеты
  packets.forEach((p) => {
    const pos = packetPos(p);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(56,211,159,.5)"; ctx.lineWidth = 2; ctx.stroke();
  });

  ctx.restore();
}

function drawHandles(hs) {
  const s = 5 / view.scale;            // сталий екранний розмір
  ctx.lineWidth = 1.5 / view.scale;
  for (const k in hs) {
    const [hx, hy] = hs[k];
    ctx.fillStyle = "#3ea6ff";
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.rect(hx - s, hy - s, s * 2, s * 2);
    ctx.fill(); ctx.stroke();
  }
}

function drawGrid(w, h) {
  const x0 = -view.x / view.scale, y0 = -view.y / view.scale;
  const x1 = x0 + w / view.scale, y1 = y0 + h / view.scale;
  ctx.strokeStyle = "rgba(42,53,80,.5)";
  ctx.lineWidth = 1 / view.scale;
  ctx.beginPath();
  for (let x = Math.floor(x0 / GRID) * GRID; x < x1; x += GRID) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  for (let y = Math.floor(y0 / GRID) * GRID; y < y1; y += GRID) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.stroke();
}

function drawRoom(r, draft) {
  const x = draft ? Math.min(r.x, r.x + r.w) : r.x;
  const y = draft ? Math.min(r.y, r.y + r.h) : r.y;
  const ww = Math.abs(r.w), hh = Math.abs(r.h);
  ctx.fillStyle = draft ? "rgba(62,166,255,.10)" : "rgba(42,53,80,.35)";
  ctx.fillRect(x, y, ww, hh);
  ctx.strokeStyle = isSel(r) ? "#3ea6ff" : "#4a5980";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, ww, hh);
  if (!draft && layers.labels) {
    ctx.fillStyle = "#8a98ba";
    ctx.font = "12px Segoe UI";
    ctx.textAlign = "left";
    ctx.fillText("▭ " + r.name, x + 6, y + 16);
  }
}

function drawWall(w) {
  ctx.strokeStyle = isSel(w) ? "#3ea6ff" : "#8895b5";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
}

function drawCable(c) {
  const a = byId(c.a), b = byId(c.b);
  if (!a || !b) return;
  const live = (simOn || true) && a.on && b.on;
  let color = c.type === "fiber" ? "#ffd166" : "#5c6b8f";
  if (simOn) color = live ? "#38d39f" : "#ff5a6a";
  ctx.strokeStyle = isSel(c) ? "#3ea6ff" : color;
  ctx.lineWidth = c.type === "fiber" ? 3.5 : 3;
  ctx.lineCap = "round";
  // лёгкий провис провода
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + 10;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(mx, my, b.x, b.y);
  ctx.stroke();
  // коннекторы на концах
  ctx.fillStyle = color;
  [a, b].forEach((d) => { ctx.beginPath(); ctx.arc(d.x, d.y, 3.5, 0, Math.PI * 2); ctx.fill(); });
}

function drawWifiRange(d) {
  ctx.strokeStyle = "rgba(255,107,157,.25)";
  ctx.fillStyle = "rgba(255,107,157,.05)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 6]);
  ctx.beginPath(); ctx.arc(d.x, d.y, WIRELESS_RANGE, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);
}

function drawDevice(d) {
  const dt = T[d.kind];
  const sel = isSel(d);
  // корпус
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.fillStyle = d.on ? "#1f283c" : "#161b27";
  ctx.strokeStyle = sel ? "#3ea6ff" : (d.on ? dt.color : "#44506e");
  ctx.lineWidth = sel ? 3 : 2;
  roundRect(-22, -22, 44, 44, 9);
  ctx.fill(); ctx.stroke();
  // іконка
  ctx.globalAlpha = d.on ? 1 : 0.4;
  ctx.font = "22px serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(dt.icon, 0, 1);
  ctx.globalAlpha = 1;
  // индикатор питания
  ctx.fillStyle = d.on ? "#38d39f" : "#ff5a6a";
  ctx.beginPath(); ctx.arc(15, -15, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  if (layers.labels) {
    ctx.fillStyle = "#dce3f0";
    ctx.font = "11px Segoe UI";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(d.name, d.x, d.y + 26);
    if (d.ip) {
      ctx.fillStyle = "#7c89a6";
      ctx.font = "10px Cascadia Code, monospace";
      ctx.fillText(d.ip, d.x, d.y + 39);
    }
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const isSel = (o) => selected && selected.ref === o;

/* ====================================================================
   Выделение и инспектор
   ==================================================================== */
function select(type, ref) {
  selected = type ? { type, ref } : null;
  if (type) multi = [];          // одиночне виділення скидає мультивиділення
  refreshInspector();
  draw();
}

const inspBody = document.getElementById("insp-body");
function refreshInspector() {
  if (!selected) { inspBody.innerHTML = `<p class="muted">${t("insp.nothing")}</p>`; return; }
  const { type, ref } = selected;
  if (type === "device") return inspDevice(ref);
  if (type === "room") return inspRoom(ref);
  if (type === "cable") return inspCable(ref);
  if (type === "wall") { inspBody.innerHTML = `<p>${t("insp.wall")}</p><div class="btn-row"><button id="d-del" class="btn-mini">${t("insp.delete")}</button></div>`; bindDel(); return; }
}

function inspDevice(d) {
  const dt = T[d.kind];
  const others = model.devices.filter((x) => x !== d);
  const portsLabel = t("insp.ports", { n: dt.ports }) + (dt.wireless ? t("insp.wifi") : "") + (dt.forward ? t("insp.forward") : "");
  inspBody.innerHTML = `
    <div class="field"><label>${t("insp.type")}</label><div class="badge">${dt.icon} ${devName(d.kind)}</div>
      <span class="badge ${d.on ? "up" : "down"}">${d.on ? t("insp.powerOnBadge") : t("insp.powerOffBadge")}</span></div>
    <div class="field"><label>${t("insp.name")}</label><input id="d-name" value="${escAttr(d.name)}" /></div>
    <div class="field"><label>${t("insp.ip")}</label><input id="d-ip" value="${escAttr(d.ip)}" placeholder="${escAttr(t("insp.ipPlaceholder"))}" /></div>
    <div class="field"><label>${t("insp.mac")}</label><input value="${d.mac}" readonly /></div>
    <div class="field"><label>${portsLabel}</label></div>
    <div class="btn-row">
      <button id="d-power" class="btn-mini">${d.on ? t("insp.powerOffBtn") : t("insp.powerOnBtn")}</button>
      <button id="d-del" class="btn-mini">${t("insp.delete")}</button>
    </div>
    <div class="field" style="margin-top:12px"><label>${t("insp.pingTo")}</label>
      <div class="row">
        <select id="d-target">${others.map((o) => `<option value="${o.id}">${escHtml(o.name)}</option>`).join("")}</select>
        <button id="d-ping" class="btn-mini">▶</button>
      </div>
    </div>`;
  document.getElementById("d-name").addEventListener("input", (e) => { d.name = e.target.value; autosave(); draw(); });
  document.getElementById("d-name").addEventListener("change", commit);
  document.getElementById("d-ip").addEventListener("input", (e) => { d.ip = e.target.value; autosave(); draw(); });
  document.getElementById("d-ip").addEventListener("change", commit);
  document.getElementById("d-power").addEventListener("click", () => { d.on = !d.on; refreshInspector(); draw(); autosave(); commit(); });
  document.getElementById("d-ping").addEventListener("click", () => {
    const tg = byId(document.getElementById("d-target").value);
    if (tg) ping(d, tg);
  });
  bindDel();
}

function inspRoom(r) {
  inspBody.innerHTML = `
    <div class="field"><label>${t("insp.roomName")}</label><input id="r-name" value="${escAttr(r.name)}" /></div>
    <div class="field"><label>${t("insp.size")}</label><div class="badge">${Math.round(r.w)} × ${Math.round(r.h)} px</div></div>
    <div class="row">
      <div class="field" style="flex:1"><label>${t("insp.width")}</label><input id="r-w" type="number" value="${Math.round(r.w)}" /></div>
      <div class="field" style="flex:1"><label>${t("insp.height")}</label><input id="r-h" type="number" value="${Math.round(r.h)}" /></div>
    </div>
    <div class="btn-row"><button id="d-del" class="btn-mini">${t("insp.delete")}</button></div>`;
  document.getElementById("r-name").addEventListener("input", (e) => { r.name = e.target.value; autosave(); draw(); });
  document.getElementById("r-name").addEventListener("change", commit);
  document.getElementById("r-w").addEventListener("input", (e) => { r.w = +e.target.value || r.w; autosave(); draw(); });
  document.getElementById("r-w").addEventListener("change", commit);
  document.getElementById("r-h").addEventListener("input", (e) => { r.h = +e.target.value || r.h; autosave(); draw(); });
  document.getElementById("r-h").addEventListener("change", commit);
  bindDel();
}

function inspCable(c) {
  const a = byId(c.a), b = byId(c.b);
  inspBody.innerHTML = `
    <div class="field"><label>${t("insp.connection")}</label><div>${escHtml(a?.name || "?")} ⇄ ${escHtml(b?.name || "?")}</div></div>
    <div class="field"><label>${t("insp.cableType")}</label>
      <select id="c-type">
        <option value="copper" ${c.type === "copper" ? "selected" : ""}>${t("cable.copper")}</option>
        <option value="fiber" ${c.type === "fiber" ? "selected" : ""}>${t("cable.fiber")}</option>
      </select></div>
    <div class="btn-row"><button id="d-del" class="btn-mini">${t("insp.delete")}</button></div>`;
  document.getElementById("c-type").addEventListener("change", (e) => { c.type = e.target.value; autosave(); commit(); draw(); });
  bindDel();
}

function bindDel() {
  const b = document.getElementById("d-del");
  if (b) b.addEventListener("click", deleteSelected);
}

const escHtml = (s) => String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const escAttr = (s) => String(s).replace(/"/g, "&quot;");

/* ====================================================================
   Слои
   ==================================================================== */
document.getElementById("show-rooms").addEventListener("change", (e) => { layers.rooms = e.target.checked; draw(); });
document.getElementById("show-grid").addEventListener("change", (e) => { layers.grid = e.target.checked; draw(); });
document.getElementById("show-labels").addEventListener("change", (e) => { layers.labels = e.target.checked; draw(); });

/* ====================================================================
   Консоль / статус
   ==================================================================== */
const consoleEl = document.getElementById("console");
function log(msg, cls = "") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = msg;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
  while (consoleEl.children.length > 200) consoleEl.removeChild(consoleEl.firstChild);
}
function setStatus(s) { document.getElementById("status").textContent = s; }

/* ====================================================================
   Сохранение / загрузка
   ==================================================================== */
let saveTimer = null;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem("netplanner:auto", JSON.stringify({ model, nextId }));
  }, 400);
}

function serialize() { return { model, nextId, view }; }
function loadData(data) {
  model = data.model || { rooms: [], walls: [], devices: [], cables: [] };
  nextId = data.nextId || 1;
  // дефолти для сумісності
  model.rooms ||= []; model.walls ||= []; model.devices ||= []; model.cables ||= [];
  multi = []; marquee = null;
  select(null); draw();
  resetHistory();
}

/* ====================================================================
   Історія: undo / redo (Ctrl+Z / Ctrl+Y)
   Зберігаємо знімки стану (model + nextId) у стек.
   commit() викликається після кожної дискретної зміни.
   ==================================================================== */
const HIST_MAX = 100;
let undoStack = [], redoStack = [], lastState = null;

function snapState() { return JSON.stringify({ model, nextId }); }

function commit() {
  const s = snapState();
  if (s === lastState) return;            // нічого не змінилось
  if (lastState !== null) {
    undoStack.push(lastState);
    if (undoStack.length > HIST_MAX) undoStack.shift();
    redoStack = [];
  }
  lastState = s;
  updateHistButtons();
}

function resetHistory() {
  undoStack = []; redoStack = [];
  lastState = snapState();
  updateHistButtons();
}

function restoreState(s) {
  const d = JSON.parse(s);
  model = d.model; nextId = d.nextId;
  model.rooms ||= []; model.walls ||= []; model.devices ||= []; model.cables ||= [];
  selected = null; multi = []; marquee = null; refreshInspector(); draw();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(lastState);
  lastState = undoStack.pop();
  restoreState(lastState);
  autosave(); updateHistButtons();
  log(t("log.undo"), "dim");
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(lastState);
  lastState = redoStack.pop();
  restoreState(lastState);
  autosave(); updateHistButtons();
  log(t("log.redo"), "dim");
}

function updateHistButtons() {
  const u = document.getElementById("btn-undo"), r = document.getElementById("btn-redo");
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

document.getElementById("btn-undo").addEventListener("click", undo);
document.getElementById("btn-redo").addEventListener("click", redo);

document.getElementById("btn-save").addEventListener("click", async () => {
  const name = document.getElementById("proj-name").value.trim() || "untitled";
  try {
    await fetch(`/api/projects/${encodeURIComponent(name)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serialize()),
    });
    log(t("log.saved", { name }), "ok");
    refreshProjects();
  } catch { log(t("log.saveErr"), "err"); }
});

const projList = document.getElementById("proj-list");
projList.addEventListener("change", async () => {
  const name = projList.value;
  if (!name) return;
  const r = await fetch(`/api/projects/${encodeURIComponent(name)}`);
  if (r.ok) {
    loadData(await r.json());
    document.getElementById("proj-name").value = name;
    log(t("log.opened", { name }), "info");
  }
  projList.value = "";
});

async function refreshProjects() {
  try {
    const r = await fetch("/api/projects");
    const names = await r.json();
    projList.innerHTML = `<option value="">${t("proj.open")}</option>` +
      names.map((n) => `<option value="${escAttr(n)}">${escHtml(n)}</option>`).join("");
  } catch {}
}

document.getElementById("btn-clear").addEventListener("click", () => {
  if (!confirm(t("confirm.clear"))) return;
  model = { rooms: [], walls: [], devices: [], cables: [] };
  nextId = 1; select(null); autosave(); commit(); draw();
  log(t("log.cleared"), "dim");
});

/* ====================================================================
   Старт
   ==================================================================== */
function boot() {
  resize();
  // центруємо вид
  view.x = 60; view.y = 40;

  // ----- мова / i18n -----
  const langSel = document.getElementById("lang-sel");
  langSel.value = window.getLang();
  langSel.addEventListener("change", () => window.setLang(langSel.value));
  // при зміні мови перебудовуємо динамічні частини
  window.onLangChange = () => {
    langSel.value = window.getLang();
    buildPalette();
    refreshProjects();
    refreshInspector();
    setStatus(t("status.ready"));
    draw();
  };
  window.applyI18n();
  setStatus(t("status.ready"));

  const saved = localStorage.getItem("netplanner:auto");
  if (saved) { try { loadData(JSON.parse(saved)); } catch {} }
  refreshProjects();
  draw();
  resetHistory();          // базовий стан для undo/redo
  log(t("log.bootReady"), "info");
  log(t("log.bootHint"), "dim");
}
boot();
