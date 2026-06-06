"use strict";
/* ====================================================================
   NetPlanner — аналог Cisco Packet Tracer на Canvas
   Планировщик помещений + проектирование локальных сетей
   ==================================================================== */

const T = window.DEVICE_TYPES;
const cv = document.getElementById("cv");
let ctx = cv.getContext("2d");      // let — щоб тимчасово підміняти на offscreen для експорту
let renderW = null, renderH = null; // override розмірів полотна під час експорту

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
   Теми (кольори canvas) + кеш SVG-іконок
   ==================================================================== */
const THEMES = {
  light: {
    canvasBg: "#eef1f6", grid: "rgba(120,138,170,.16)",
    roomFill: "rgba(59,130,246,.05)", roomFillDraft: "rgba(59,130,246,.12)",
    roomStroke: "#cdd5e2", roomLabel: "#7a8499", wall: "#aab3c4",
    cableCopper: "#9aa6be", cableFiber: "#f0a93a",
    deviceFill: "#ffffff", deviceFillOff: "#eef0f4", deviceBorder: "#e2e7f0", deviceOff: "#c2cad7",
    label: "#1b2233", sub: "#8a93a6", pipFree: "#cfd6e2",
    sel: "#3b82f6", ok: "#22c55e", danger: "#ef4655",
  },
  dark: {
    canvasBg: "#1b1f29", grid: "rgba(255,255,255,.045)",
    roomFill: "rgba(79,140,255,.06)", roomFillDraft: "rgba(79,140,255,.12)",
    roomStroke: "#3a414f", roomLabel: "#8b94a7", wall: "#6b7488",
    cableCopper: "#5c6b8f", cableFiber: "#ffd166",
    deviceFill: "#262b36", deviceFillOff: "#1d212a", deviceBorder: "#363c49", deviceOff: "#444b59",
    label: "#e7eaf1", sub: "#8b94a7", pipFree: "#3c4350",
    sel: "#4f8cff", ok: "#34d399", danger: "#ff6170",
  },
};
let THEME_NAME = localStorage.getItem("netplanner:theme") || "light";
let TH = THEMES[THEME_NAME];

function setTheme(name) {
  if (!THEMES[name]) return;
  THEME_NAME = name;
  TH = THEMES[name];
  document.documentElement.dataset.theme = name;
  localStorage.setItem("netplanner:theme", name);
  const tb = document.getElementById("theme-toggle");
  if (tb) tb.innerHTML = window.svgInline(name === "dark" ? "sun" : "moon");
  _iconCache = {};            // перемалювати іконки під нову тему за потреби
  draw();
}

// Кеш растрованих SVG-іконок для canvas
let _iconCache = {};
function iconImg(name, color) {
  const key = name + "|" + color;
  if (_iconCache[key]) return _iconCache[key];
  const img = new Image();
  img.onload = () => draw();
  img.src = window.svgDataURL(name, color, 48);
  _iconCache[key] = img;
  return img;
}
function drawIconImg(name, color, cx, cy, size) {
  const img = iconImg(name, color);
  if (img.complete && img.naturalWidth) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
}

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
    b.innerHTML = `<span class="ico">${window.svgInline(kind, { color: dt.color, size: 24 })}</span><span class="nm">${devName(kind)}</span>`;
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
    ip: "", mask: "", gateway: "", mac: randMac(), on: true,
    dhcp: false,                       // лише для сервера: роль DHCP
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
  // ліміт портів
  if (!freePort(a)) { log(t("log.portFull", { name: a.name, n: portCount(a) }), "err"); return; }
  if (!freePort(b)) { log(t("log.portFull", { name: b.name, n: portCount(b) }), "err"); return; }
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

// Ефективна кількість портів та здатність Wi-Fi (з урахуванням override на пристрої)
const portCount = (d) => (d.ports != null ? d.ports : T[d.kind].ports);
const canWifi = (d) => (d.wifi != null ? d.wifi : T[d.kind].wireless);

// Радіус покриття Wi-Fi (індивідуальний на пристрої або глобальний за замовч.)
const RANGE_MIN = 60, RANGE_MAX = 600;
const rangeOf = (d) => (d.range != null ? d.range : WIRELESS_RANGE);
// Чи пристрій є джерелом Wi-Fi-покриття (малює коло, має радіус)
const isWifiSource = (d) => canWifi(d) && T[d.kind].forward;

// Кількість зайнятих (кабельних) портів пристрою та наявність вільного
const usedPorts = (d) => model.cables.filter((c) => c.a === d.id || c.b === d.id).length;
const freePort = (d) => usedPorts(d) < portCount(d);

/* ----- Мережа: валідація, конфлікти IP ----- */
function isValidIP(s) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s || "")) return false;
  return s.split(".").every((o) => +o >= 0 && +o <= 255);
}
// Множина id пристроїв із дубльованою IP-адресою
function ipConflictSet() {
  const seen = new Map(), bad = new Set();
  for (const d of model.devices) {
    const ip = (d.ip || "").trim();
    if (!ip) continue;
    if (seen.has(ip)) { bad.add(d.id); bad.add(seen.get(ip)); }
    else seen.set(ip, d.id);
  }
  return bad;
}
let conflictSet = new Set();   // перераховується в draw()

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
  range: "ew-resize",
};

// Точка ручки радіуса Wi-Fi (на колі, праворуч від центру)
function rangeHandlePos(d) { return [d.x + rangeOf(d), d.y]; }

// Знайти ручку під курсором для виділеного об'єкта
function handleAt(wx, wy) {
  if (!selected) return null;
  const tol = 8 / view.scale;
  // ручка радіуса Wi-Fi для виділеного джерела
  if (selected.type === "device" && isWifiSource(selected.ref) && selected.ref.on) {
    const [hx, hy] = rangeHandlePos(selected.ref);
    if (Math.hypot(wx - hx, wy - hy) <= tol) return "range";
  }
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
      const kind = handle === "range" ? "range" : selected.type;
      resizing = { kind, ref: selected.ref, handle };
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
    else if (resizing.kind === "range") {
      const dd = resizing.ref;
      const r = Math.round(Math.hypot(w.x - dd.x, w.y - dd.y) / 5) * 5;
      dd.range = Math.max(RANGE_MIN, Math.min(RANGE_MAX, r));
      refreshInspector();
    }
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
  // бездротові сусіди: обидва Wi-Fi і хоча б один роздає (forward — роутер/AP).
  // Покриття визначається радіусом джерела (роздавача).
  if (canWifi(d) && d.on) {
    for (const o of model.devices) {
      if (o === d || !o.on || !canWifi(o)) continue;
      let rng = 0;
      if (T[d.kind].forward) rng = Math.max(rng, rangeOf(d));
      if (T[o.kind].forward) rng = Math.max(rng, rangeOf(o));
      if (rng === 0) continue;                         // жоден не роздає — асоціації немає
      if (Math.hypot(o.x - d.x, o.y - d.y) <= rng) out.push(o);
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

const MASK24 = "255.255.255.0";

function autoIP() {
  const comps = components().filter((c) => c.length > 1);
  let subnet = 0;
  let assigned = 0;
  for (const comp of comps) {
    const base = `192.168.${subnet}`;
    let host = 1;
    // шлюз — перший роутер, якщо є
    const gw = comp.find((d) => d.kind === "router") || comp.find((d) => T[d.kind].forward);
    if (gw) { gw.ip = `${base}.1`; gw.mask = MASK24; gw.gateway = `${base}.1`; host = 2; }
    for (const d of comp) {
      if (d === gw) continue;
      if (T[d.kind].forward && d.kind !== "router") { d.ip = ""; d.mask = ""; continue; } // комутатори/хаби без IP
      d.ip = `${base}.${host++}`;
      d.mask = MASK24;
      d.gateway = gw ? `${base}.1` : "";
      assigned++;
    }
    subnet++;
  }
  log(t("log.autoip", { seg: comps.length, nodes: assigned }), "info");
  const conf = ipConflictSet();
  if (conf.size) log(t("log.conflicts", { n: conf.size }), "err");
  autosave(); commit(); draw();
  refreshInspector();
}

// DHCP: сервер видає адреси пристроям свого сегмента, що не мають статичної IP
function runDHCP(server) {
  const comp = components().find((c) => c.includes(server)) || [server];
  let base = "192.168.50";
  if (isValidIP(server.ip)) base = server.ip.split(".").slice(0, 3).join(".");
  else { server.ip = `${base}.1`; server.mask = MASK24; }
  const gw = comp.find((d) => d.kind === "router");
  const gwIp = gw && isValidIP(gw.ip) ? gw.ip : `${base}.1`;
  // зайняті адреси, щоб не дублювати
  const taken = new Set(model.devices.map((d) => d.ip).filter(Boolean));
  let host = 100, leased = 0;
  for (const d of comp) {
    if (d === server || T[d.kind].forward) continue;     // інфраструктуру пропускаємо
    if (isValidIP(d.ip)) continue;                        // статичні не чіпаємо
    let ip;
    do { ip = `${base}.${host++}`; } while (taken.has(ip) && host < 255);
    taken.add(ip);
    d.ip = ip; d.mask = MASK24; d.gateway = gwIp; leased++;
  }
  log(t("log.dhcp", { name: server.name, n: leased }), "info");
  autosave(); commit(); draw(); refreshInspector();
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
      path: pts, t: 0, color: TH.ok,
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
  const w = renderW ?? cv.clientWidth, h = renderH ?? cv.clientHeight;
  conflictSet = ipConflictSet();
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = TH.canvasBg;
  ctx.fillRect(0, 0, w, h);

  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);

  if (layers.grid) drawGrid(w, h);
  if (layers.rooms) model.rooms.forEach((r) => drawRoom(r));
  model.walls.forEach(drawWall);
  if (draftRoom) drawRoom(draftRoom, true);
  if (draftWall) drawWall(draftWall);

  model.cables.forEach(drawCable);
  if (tool === "cable" && cableFrom) {
    ctx.strokeStyle = TH.sel; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(cableFrom.x, cableFrom.y); ctx.lineTo(mouse.wx, mouse.wy); ctx.stroke();
    ctx.setLineDash([]);
  }

  // диапазоны Wi-Fi (тільки роздавачі — роутер/AP)
  model.devices.forEach((d) => {
    if (canWifi(d) && T[d.kind].forward && d.on) drawWifiRange(d);
  });

  model.devices.forEach(drawDevice);

  // підсвітка мультивиділення
  if (multi.length) {
    ctx.strokeStyle = TH.ok; ctx.lineWidth = 2 / view.scale; ctx.setLineDash([5 / view.scale, 4 / view.scale]);
    multi.forEach((d) => { ctx.strokeRect(d.x - 25, d.y - 25, 50, 50); });
    ctx.setLineDash([]);
  }

  // рамка виділення
  if (marquee) {
    const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
    const mw = Math.abs(marquee.x1 - marquee.x0), mh = Math.abs(marquee.y1 - marquee.y0);
    ctx.fillStyle = "rgba(56,211,159,.10)";
    ctx.strokeStyle = TH.ok; ctx.lineWidth = 1 / view.scale; ctx.setLineDash([4 / view.scale, 3 / view.scale]);
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
    ctx.fillStyle = TH.sel;
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.rect(hx - s, hy - s, s * 2, s * 2);
    ctx.fill(); ctx.stroke();
  }
}

function drawGrid(w, h) {
  const x0 = -view.x / view.scale, y0 = -view.y / view.scale;
  const x1 = x0 + w / view.scale, y1 = y0 + h / view.scale;
  ctx.strokeStyle = TH.grid;
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
  ctx.fillStyle = draft ? TH.roomFillDraft : TH.roomFill;
  ctx.fillRect(x, y, ww, hh);
  ctx.strokeStyle = isSel(r) ? TH.sel : TH.roomStroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, ww, hh);
  if (!draft && layers.labels) {
    ctx.fillStyle = TH.roomLabel;
    ctx.font = "600 12px Inter, Segoe UI";
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(r.name, x + 8, y + 17);
  }
}

function drawWall(w) {
  ctx.strokeStyle = isSel(w) ? TH.sel : TH.wall;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
}

function drawCable(c) {
  const a = byId(c.a), b = byId(c.b);
  if (!a || !b) return;
  const live = a.on && b.on;
  let color = c.type === "fiber" ? TH.cableFiber : TH.cableCopper;
  if (simOn) color = live ? TH.ok : TH.danger;
  ctx.strokeStyle = isSel(c) ? TH.sel : color;
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
  const rng = rangeOf(d);
  const sel = isSel(d);
  ctx.strokeStyle = sel ? TH.sel : "rgba(255,107,157,.3)";
  ctx.fillStyle = "rgba(255,107,157,.05)";
  ctx.lineWidth = sel ? 2 : 1.5;
  ctx.setLineDash([5, 6]);
  ctx.beginPath(); ctx.arc(d.x, d.y, rng, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);
  // ручка зміни радіуса (на колі праворуч) — лише для виділеного джерела
  if (sel) {
    const [hx, hy] = rangeHandlePos(d);
    const s = 5 / view.scale;
    ctx.fillStyle = TH.sel; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 / view.scale;
    ctx.beginPath(); ctx.arc(hx, hy, s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // підпис радіуса
    ctx.fillStyle = TH.sub; ctx.font = `${11 / view.scale}px Inter, Segoe UI`;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(rng)} px`, hx + 8 / view.scale, hy);
  }
}

function drawDevice(d) {
  const dt = T[d.kind];
  const sel = isSel(d);
  // корпус (картка зі скругленням і тінню)
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.shadowColor = "rgba(20,30,60,.12)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  ctx.fillStyle = d.on ? TH.deviceFill : TH.deviceFillOff;
  roundRect(-22, -22, 44, 44, 12);
  ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = sel ? TH.sel : TH.deviceBorder;
  ctx.lineWidth = sel ? 2.5 : 1.5;
  roundRect(-22, -22, 44, 44, 12);
  ctx.stroke();

  // SVG-іконка пристрою
  drawIconImg(d.kind, d.on ? dt.color : TH.deviceOff, 0, 0, 24);

  // индикатор питания
  ctx.fillStyle = d.on ? TH.ok : TH.danger;
  ctx.beginPath(); ctx.arc(15, -15, 3.2, 0, Math.PI * 2); ctx.fill();

  // позначка Wi-Fi
  if (canWifi(d)) drawIconImg("wifi", d.on ? TH.sel : TH.deviceOff, -14, -14, 12);

  // конфлікт IP
  if (conflictSet.has(d.id)) {
    ctx.strokeStyle = TH.danger; ctx.lineWidth = 2;
    roundRect(-24, -24, 48, 48, 13); ctx.stroke();
    drawIconImg("alert", TH.danger, 16, 16, 14);
  }

  // порти: ряд індикаторів унизу
  const total = portCount(d);
  const used = usedPorts(d);
  const show = Math.min(total, 8);
  const gap = Math.min(7, 34 / Math.max(show, 1));
  const startX = -((show - 1) * gap) / 2;
  for (let i = 0; i < show; i++) {
    ctx.fillStyle = i < used ? TH.ok : TH.pipFree;
    ctx.beginPath(); ctx.arc(startX + i * gap, 17, 1.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  if (layers.labels) {
    ctx.fillStyle = TH.label;
    ctx.font = "600 11px Inter, Segoe UI";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(d.name, d.x, d.y + 28);
    if (d.ip) {
      ctx.fillStyle = TH.sub;
      ctx.font = "10px Cascadia Code, monospace";
      ctx.fillText(d.ip, d.x, d.y + 41);
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
  const portsLabel = t("insp.portsUsed", { used: usedPorts(d), total: portCount(d) }) + (canWifi(d) ? t("insp.wifi") : "") + (dt.forward ? t("insp.forward") : "");
  const portsEditor = dt.ports >= 2
    ? `<div class="field"><label>${t("insp.portsCount")}</label><input id="d-ports" type="number" min="${Math.max(1, usedPorts(d))}" max="48" value="${portCount(d)}" /></div>`
    : "";
  const wifiToggle = `<label class="chk" style="margin:2px 0 6px"><input type="checkbox" id="d-wifi" ${canWifi(d) ? "checked" : ""} /> ${t("insp.wifiToggle")}</label>`;
  const rangeField = isWifiSource(d)
    ? `<div class="field"><label>${t("insp.wifiRange")}</label>
         <input id="d-range" type="number" min="${RANGE_MIN}" max="${RANGE_MAX}" step="5" value="${rangeOf(d)}" />
         <div class="muted" style="font-size:10px;margin-top:3px">${t("insp.wifiRangeHint")}</div></div>`
    : "";
  const conflict = conflictSet.has(d.id);
  const ipBad = d.ip && !isValidIP(d.ip);
  const warn = conflict ? `<div class="warn">${t("insp.ipConflict")}</div>`
             : ipBad ? `<div class="warn">${t("insp.ipInvalid")}</div>` : "";
  const dhcpBlock = d.kind === "server"
    ? `<div class="field" style="margin-top:10px">
         <label class="chk"><input type="checkbox" id="d-dhcp" ${d.dhcp ? "checked" : ""} /> ${t("insp.dhcp")}</label>
         <button id="d-dhcp-run" class="btn-mini" style="width:100%;margin-top:6px">${window.svgInline("globe")}${t("insp.dhcpRun")}</button>
       </div>` : "";
  inspBody.innerHTML = `
    <div class="field"><label>${t("insp.type")}</label><div class="badge">${window.svgInline(d.kind, { color: dt.color, size: 14 })} ${devName(d.kind)}</div>
      <span class="badge ${d.on ? "up" : "down"}">${d.on ? t("insp.powerOnBadge") : t("insp.powerOffBadge")}</span></div>
    <div class="field"><label>${t("insp.name")}</label><input id="d-name" value="${escAttr(d.name)}" /></div>
    <div class="field"><label>${t("insp.ip")}</label><input id="d-ip" class="${conflict || ipBad ? "bad" : ""}" value="${escAttr(d.ip)}" placeholder="${escAttr(t("insp.ipPlaceholder"))}" /></div>
    ${warn}
    <div class="row">
      <div class="field" style="flex:1"><label>${t("insp.mask")}</label><input id="d-mask" value="${escAttr(d.mask)}" placeholder="255.255.255.0" /></div>
      <div class="field" style="flex:1"><label>${t("insp.gateway")}</label><input id="d-gw" value="${escAttr(d.gateway)}" placeholder="—" /></div>
    </div>
    <div class="field"><label>${t("insp.mac")}</label><input value="${d.mac}" readonly /></div>
    <div class="field"><label>${portsLabel}</label></div>
    ${portsEditor}
    ${wifiToggle}
    ${rangeField}
    ${dhcpBlock}
    <div class="btn-row">
      <button id="d-power" class="btn-mini">${window.svgInline("power")}${d.on ? t("insp.powerOffBtn") : t("insp.powerOnBtn")}</button>
      <button id="d-del" class="btn-mini">${window.svgInline("trash")}${t("insp.delete")}</button>
    </div>
    <div class="field" style="margin-top:12px"><label>${t("insp.pingTo")}</label>
      <div class="row">
        <select id="d-target">${others.map((o) => `<option value="${o.id}">${escHtml(o.name)}</option>`).join("")}</select>
        <button id="d-ping" class="btn-mini">${window.svgInline("play")}</button>
      </div>
    </div>`;
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("input", fn); if (el) el.addEventListener("change", commit); };
  document.getElementById("d-name").addEventListener("input", (e) => { d.name = e.target.value; autosave(); draw(); });
  document.getElementById("d-name").addEventListener("change", commit);
  document.getElementById("d-ip").addEventListener("input", (e) => { d.ip = e.target.value; autosave(); draw(); });
  document.getElementById("d-ip").addEventListener("change", () => { commit(); refreshInspector(); });
  bind("d-mask", (e) => { d.mask = e.target.value; autosave(); });
  bind("d-gw", (e) => { d.gateway = e.target.value; autosave(); });
  const portsInput = document.getElementById("d-ports");
  if (portsInput) {
    portsInput.addEventListener("input", (e) => {
      let v = parseInt(e.target.value, 10);
      const minv = Math.max(1, usedPorts(d));
      if (isNaN(v)) return;
      v = Math.max(minv, Math.min(48, v));
      d.ports = v; autosave(); draw();
    });
    portsInput.addEventListener("change", () => { commit(); refreshInspector(); });
  }
  const wifiInput = document.getElementById("d-wifi");
  if (wifiInput) wifiInput.addEventListener("change", (e) => { d.wifi = e.target.checked; autosave(); commit(); draw(); refreshInspector(); });
  const rangeInput = document.getElementById("d-range");
  if (rangeInput) {
    rangeInput.addEventListener("input", (e) => {
      let v = parseInt(e.target.value, 10);
      if (isNaN(v)) return;
      d.range = Math.max(RANGE_MIN, Math.min(RANGE_MAX, v));
      autosave(); draw();
    });
    rangeInput.addEventListener("change", commit);
  }
  document.getElementById("d-power").addEventListener("click", () => { d.on = !d.on; refreshInspector(); draw(); autosave(); commit(); });
  if (d.kind === "server") {
    document.getElementById("d-dhcp").addEventListener("change", (e) => { d.dhcp = e.target.checked; autosave(); commit(); });
    document.getElementById("d-dhcp-run").addEventListener("click", () => runDHCP(d));
  }
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
    <div class="btn-row"><button id="d-del" class="btn-mini">${window.svgInline("trash")}${t("insp.delete")}</button></div>`;
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
    <div class="btn-row"><button id="d-del" class="btn-mini">${window.svgInline("trash")}${t("insp.delete")}</button></div>`;
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
  nextId = 1; multi = []; select(null); autosave(); commit(); draw();
  log(t("log.cleared"), "dim");
});

/* ====================================================================
   Експорт / друк / імпорт
   ==================================================================== */
function contentBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
  const ext = (x, y) => { any = true; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  model.devices.forEach((d) => { ext(d.x - 30, d.y - 30); ext(d.x + 30, d.y + 44); });
  model.rooms.forEach((r) => { ext(r.x, r.y); ext(r.x + r.w, r.y + r.h); });
  model.walls.forEach((w) => { ext(w.x1, w.y1); ext(w.x2, w.y2); });
  return any ? { minX, minY, maxX, maxY } : null;
}

function fitToContent(pad = 50) {
  const b = contentBounds();
  if (!b) return false;
  const cw = cv.clientWidth, ch = cv.clientHeight;
  const bw = (b.maxX - b.minX) + pad * 2, bh = (b.maxY - b.minY) + pad * 2;
  view.scale = Math.max(0.25, Math.min(3, Math.min(cw / bw, ch / bh)));
  view.x = (cw - (b.maxX + b.minX) * view.scale) / 2;
  view.y = (ch - (b.maxY + b.minY) * view.scale) / 2;
  return true;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildPNG(scale = 2) {
  const b = contentBounds();
  if (!b) { log(t("log.empty"), "err"); return null; }
  const pad = 40;
  const W = Math.ceil((b.maxX - b.minX) + pad * 2);
  const H = Math.ceil((b.maxY - b.minY) + pad * 2);
  const off = document.createElement("canvas");
  off.width = W * scale; off.height = H * scale;
  const offCtx = off.getContext("2d");

  // підміняємо ціль рендеру на offscreen
  const savedCtx = ctx, savedView = { ...view }, savedSel = selected, savedMulti = multi;
  const savedRW = renderW, savedRH = renderH;
  ctx = offCtx; renderW = W; renderH = H;
  selected = null; multi = [];
  offCtx.setTransform(scale, 0, 0, scale, 0, 0);
  view.scale = 1; view.x = -b.minX + pad; view.y = -b.minY + pad;
  draw();
  const url = off.toDataURL("image/png");

  // відновлюємо
  ctx = savedCtx; Object.assign(view, savedView);
  selected = savedSel; multi = savedMulti; renderW = savedRW; renderH = savedRH;
  draw();
  return url;
}

function projName() {
  return (document.getElementById("proj-name").value.trim() || "netplanner").replace(/[^\w\-а-яА-ЯіїєґІЇЄҐ ]/g, "");
}

document.getElementById("btn-png").addEventListener("click", () => {
  const url = buildPNG();
  if (!url) return;
  fetch(url).then((r) => r.blob()).then((b) => {
    downloadBlob(b, `${projName()}.png`);
    log(t("log.exportedPng"), "ok");
  });
});

document.getElementById("btn-print").addEventListener("click", () => {
  const url = buildPNG();
  if (!url) return;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<html><head><title>${projName()}</title></head>
    <body style="margin:0;display:flex;align-items:center;justify-content:center">
    <img src="${url}" style="max-width:100%" onload="window.focus();window.print();" /></body></html>`);
  win.document.close();
});

document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: "application/json" });
  downloadBlob(blob, `${projName()}.json`);
  log(t("log.exportedJson"), "ok");
});

document.getElementById("btn-import").addEventListener("click", () => document.getElementById("file-import").click());
document.getElementById("file-import").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.model) throw new Error("no model");
      loadData(data);
      log(t("log.imported"), "ok");
    } catch { log(t("log.importErr"), "err"); }
  };
  reader.readAsText(file);
  e.target.value = "";
});

/* ====================================================================
   Старт
   ==================================================================== */
function boot() {
  resize();
  // центруємо вид
  view.x = 60; view.y = 40;

  // ----- SVG-іконки у кнопки -----
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.insertAdjacentHTML("afterbegin", window.svgInline(el.dataset.icon));
  });

  // ----- тема -----
  setTheme(THEME_NAME);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    setTheme(THEME_NAME === "dark" ? "light" : "dark");
  });

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
    if (window.refreshHelp) window.refreshHelp();
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
