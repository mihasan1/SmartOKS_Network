"use strict";
/* ====================================================================
   Довідка / Про проєкт — модальне вікно (UA / EN)
   ==================================================================== */

const HELP = {
  uk: {
    title: "SmartOKS — Network Planner",
    tagline: "Візуальний конструктор локальних мереж та планувальник приміщень у браузері — аналог Cisco Packet Tracer.",
    sections: [
      {
        icon: "rocket", h: "Швидкий старт",
        html: `<ol>
          <li><b>Перетягніть пристрій</b> із палітри ліворуч на полотно.</li>
          <li>Оберіть інструмент <b>«Провід»</b> і клікніть на два пристрої — між ними з'явиться кабель.</li>
          <li>Натисніть <b>«Авто-IP»</b> — система роздасть IP-адреси по сегментах.</li>
          <li>Увімкніть <b>«Симуляція»</b> і запустіть <b>ping</b> у властивостях пристрою.</li>
        </ol>`,
      },
      {
        icon: "cursor", h: "Інструменти",
        html: `<ul>
          <li><b>Вибір (V)</b> — виділення, переміщення, зміна розмірів.</li>
          <li><b>Кімната (R)</b> — намалювати приміщення.</li>
          <li><b>Стіна (W)</b> — перегородки.</li>
          <li><b>Провід (C)</b> — з'єднати два пристрої кабелем.</li>
          <li><b>Видалити (E)</b> — клік прибирає об'єкт.</li>
        </ul>`,
      },
      {
        icon: "network", h: "Пристрої",
        html: `ПК, ноутбук, сервер, принтер, комутатор, концентратор, Wi-Fi роутер, точка доступу, IP-камера, відеореєстратор.
          У кожного — індивідуальні властивості: IP, маска, шлюз, кількість портів, Wi-Fi.`,
      },
      {
        icon: "cable", h: "З'єднання та порти",
        html: `<ul>
          <li>Кабель буває <b>мідний</b> та <b>оптичний</b> (тип у властивостях).</li>
          <li>Не можна під'єднати <b>більше кабелів, ніж є портів</b> — індикатори знизу пристрою показують зайняті/вільні.</li>
          <li><b>Wi-Fi</b>: увімкніть на пристрої галочку; у роутера/точки доступу — коло покриття, радіус можна <b>тягнути за маркер</b> або задати числом.</li>
        </ul>`,
      },
      {
        icon: "globe", h: "Мережа",
        html: `<ul>
          <li><b>Авто-IP</b> — адреси <code>192.168.X.0/24</code> по сегментах, шлюз на роутері.</li>
          <li><b>DHCP-сервер</b> — у властивостях сервера видає адреси його сегменту.</li>
          <li><b>Конфлікти IP</b> підсвічуються червоним ⚠ автоматично.</li>
          <li><b>Ping</b> — анімація пакета по маршруту з виводом у консоль.</li>
        </ul>`,
      },
      {
        icon: "square", h: "Редагування полотна",
        html: `<ul>
          <li><b>Undo / Redo</b> — Ctrl+Z / Ctrl+Y.</li>
          <li><b>Мультивиділення</b> — рамкою або Shift+клік; груповий рух і копіювання (Ctrl+C / Ctrl+V).</li>
          <li><b>Зсув стрілками</b> по сітці.</li>
          <li><b>Розмір кімнати/стіни</b> — тягніть за кутові маркери.</li>
          <li>Пристрої <b>всередині кімнати рухаються разом із нею</b>.</li>
        </ul>`,
      },
      {
        icon: "save", h: "Збереження та експорт",
        html: `<ul>
          <li><b>Зберегти</b> — проєкт на сервер; автозбереження в браузері.</li>
          <li><b>Експорт / Імпорт .json</b> — файл проєкту.</li>
          <li><b>PNG</b> — зображення схеми; <b>Друк</b>.</li>
        </ul>`,
      },
      {
        icon: "keyboard", h: "Гарячі клавіші",
        keys: [
          ["V R W C E", "Інструменти"],
          ["Ctrl + Z / Y", "Скасувати / Повернути"],
          ["Ctrl + C / V", "Копіювати / Вставити"],
          ["Ctrl + A", "Виділити всі пристрої"],
          ["Ctrl + S", "Зберегти проєкт"],
          ["Delete", "Видалити виділене"],
          ["Стрілки", "Зсув виділеного"],
          ["Колесо", "Масштаб"],
          ["Пробіл + тягнути", "Панорама"],
          ["Подвійний клік", "Увімк/вимк живлення"],
          ["F1", "Ця довідка"],
        ],
      },
    ],
    footer: "Стек: Node.js + Express · HTML5 Canvas · чистий JavaScript. Теми (світла/темна) і мова перемикаються у шапці.",
    close: "Зрозуміло",
  },

  en: {
    title: "SmartOKS — Network Planner",
    tagline: "A browser-based LAN designer and room planner — a Cisco Packet Tracer analog.",
    sections: [
      {
        icon: "rocket", h: "Quick start",
        html: `<ol>
          <li><b>Drag a device</b> from the left palette onto the canvas.</li>
          <li>Pick the <b>Cable</b> tool and click two devices — a cable appears.</li>
          <li>Click <b>Auto-IP</b> — addresses are assigned per segment.</li>
          <li>Turn on <b>Simulation</b> and run <b>ping</b> from a device's properties.</li>
        </ol>`,
      },
      {
        icon: "cursor", h: "Tools",
        html: `<ul>
          <li><b>Select (V)</b> — select, move, resize.</li>
          <li><b>Room (R)</b> — draw a room.</li>
          <li><b>Wall (W)</b> — partitions.</li>
          <li><b>Cable (C)</b> — connect two devices.</li>
          <li><b>Erase (E)</b> — click removes an object.</li>
        </ul>`,
      },
      {
        icon: "network", h: "Devices",
        html: `PC, laptop, server, printer, switch, hub, Wi-Fi router, access point, IP camera, NVR recorder.
          Each has its own properties: IP, mask, gateway, port count, Wi-Fi.`,
      },
      {
        icon: "cable", h: "Connections & ports",
        html: `<ul>
          <li>Cables can be <b>copper</b> or <b>fiber</b> (set in properties).</li>
          <li>You can't plug <b>more cables than ports</b> — dots under a device show used/free.</li>
          <li><b>Wi-Fi</b>: tick the box on a device; routers/APs show a coverage circle whose radius you can <b>drag by the marker</b> or type in.</li>
        </ul>`,
      },
      {
        icon: "globe", h: "Networking",
        html: `<ul>
          <li><b>Auto-IP</b> — <code>192.168.X.0/24</code> per segment, gateway on the router.</li>
          <li><b>DHCP server</b> — a server leases addresses to its segment.</li>
          <li><b>IP conflicts</b> are flagged red ⚠ automatically.</li>
          <li><b>Ping</b> — packet animation along the route with console output.</li>
        </ul>`,
      },
      {
        icon: "square", h: "Canvas editing",
        html: `<ul>
          <li><b>Undo / Redo</b> — Ctrl+Z / Ctrl+Y.</li>
          <li><b>Multi-select</b> — marquee or Shift+click; group move and copy (Ctrl+C / Ctrl+V).</li>
          <li><b>Arrow-key nudge</b> along the grid.</li>
          <li><b>Resize a room/wall</b> — drag the corner handles.</li>
          <li>Devices <b>inside a room move with it</b>.</li>
        </ul>`,
      },
      {
        icon: "save", h: "Saving & export",
        html: `<ul>
          <li><b>Save</b> — project to the server; auto-save in the browser.</li>
          <li><b>Export / Import .json</b> — project file.</li>
          <li><b>PNG</b> — diagram image; <b>Print</b>.</li>
        </ul>`,
      },
      {
        icon: "keyboard", h: "Keyboard shortcuts",
        keys: [
          ["V R W C E", "Tools"],
          ["Ctrl + Z / Y", "Undo / Redo"],
          ["Ctrl + C / V", "Copy / Paste"],
          ["Ctrl + A", "Select all devices"],
          ["Ctrl + S", "Save project"],
          ["Delete", "Delete selection"],
          ["Arrows", "Nudge selection"],
          ["Wheel", "Zoom"],
          ["Space + drag", "Pan"],
          ["Double-click", "Toggle power"],
          ["F1", "This help"],
        ],
      },
    ],
    footer: "Stack: Node.js + Express · HTML5 Canvas · vanilla JavaScript. Theme (light/dark) and language switch in the header.",
    close: "Got it",
  },
};

/* ---- Побудова DOM ---- */
const helpOverlay = document.createElement("div");
helpOverlay.id = "help-overlay";
helpOverlay.innerHTML = `<div id="help-modal" role="dialog" aria-modal="true"></div>`;
helpOverlay.style.display = "none";
document.body.appendChild(helpOverlay);
const helpModal = helpOverlay.querySelector("#help-modal");

function buildHelp() {
  const lang = (window.getLang && window.getLang()) || "uk";
  const H = HELP[lang] || HELP.uk;
  const sec = (s) => {
    let body;
    if (s.keys) {
      body = `<table class="help-keys">${s.keys.map((k) => `<tr><td><kbd>${k[0]}</kbd></td><td>${k[1]}</td></tr>`).join("")}</table>`;
    } else {
      body = `<div class="help-text">${s.html}</div>`;
    }
    return `<section class="help-sec">
      <h4>${window.svgInline(s.icon)}<span>${s.h}</span></h4>${body}</section>`;
  };
  helpModal.innerHTML = `
    <div class="help-head">
      <div class="help-brand">
        <span class="logo">${window.svgInline("network")}</span>
        <div>
          <div class="help-title">${H.title}</div>
          <div class="help-tag">${H.tagline}</div>
        </div>
      </div>
      <button id="help-x" class="icon-btn" aria-label="close">${window.svgInline("x")}</button>
    </div>
    <div class="help-body">${H.sections.map(sec).join("")}</div>
    <div class="help-foot">
      <span class="muted">${H.footer}</span>
      <button id="help-ok">${H.close}</button>
    </div>`;
  helpModal.querySelector("#help-x").addEventListener("click", closeHelp);
  helpModal.querySelector("#help-ok").addEventListener("click", closeHelp);
}

function openHelp() { buildHelp(); helpOverlay.style.display = "flex"; }
function closeHelp() { helpOverlay.style.display = "none"; }
function isHelpOpen() { return helpOverlay.style.display !== "none"; }

helpOverlay.addEventListener("mousedown", (e) => { if (e.target === helpOverlay) closeHelp(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "F1") { e.preventDefault(); isHelpOpen() ? closeHelp() : openHelp(); }
  else if (e.key === "Escape" && isHelpOpen()) closeHelp();
  else if (e.key === "?" && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); openHelp(); }
});
document.addEventListener("DOMContentLoaded", () => {
  const b = document.getElementById("btn-help");
  if (b) b.addEventListener("click", openHelp);
});
// якщо DOM вже готовий
{
  const b = document.getElementById("btn-help");
  if (b) b.addEventListener("click", openHelp);
}

window.openHelp = openHelp;
window.closeHelp = closeHelp;
window.refreshHelp = () => { if (isHelpOpen()) buildHelp(); };
