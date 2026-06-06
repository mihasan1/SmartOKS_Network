# 🖧 SmartOKS — Network Planner

> A browser-based LAN designer and room planner — a **Cisco Packet Tracer** analog.

[![demo](https://img.shields.io/badge/demo-smartoks--network.vercel.app-3b82f6)](https://smartoks-network.vercel.app)
![stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express%20%2B%20Canvas-22c55e)
![themes](https://img.shields.io/badge/themes-light%20%2F%20dark-7c5cff)
![i18n](https://img.shields.io/badge/i18n-UA%20%2F%20EN-ff8fb3)
![release](https://img.shields.io/badge/release-v1.0.0-3b82f6)

**🔗 Live demo:** https://smartoks-network.vercel.app

Design local networks visually: place devices inside rooms, connect them with cables or over Wi-Fi, hand out IP addresses, and verify connectivity with a ping simulation — all in the browser, no installs required.

---

## ✨ Features

### 🏢 Room planner
- Draw **rooms** and **walls / partitions** on a grid.
- Resize rooms and walls by their corner handles.
- Devices **inside a room move together with it**.

### 🖧 Network devices (10 types)
PC · Laptop · Server · Printer · Switch · Hub · Wi-Fi Router · Access Point · **IP Camera** · **NVR Recorder**.

Every device is configured individually: name, IP, subnet mask, gateway, MAC, **port count**, **Wi-Fi connectivity**, power.

### 🔌 Connections
- Visible **cables** (twisted pair / fiber) with sag and connectors.
- **Port limit** — you can't plug in more cables than there are ports; used/free port indicators are shown on each device.
- **Wi-Fi** — coverage circle with an **adjustable radius** (drag the marker or type a value); wireless devices associate within a router/access-point range.

### 🌐 Networking
- **Auto-IP** — assigns `192.168.X.0/24` per segment with the gateway on the router.
- **DHCP server** — a server leases addresses to its own segment.
- **Subnet masks** and **gateways** in device properties.
- **IP conflict detection** — duplicates are flagged red ⚠.
- **Ping simulation** — packet animation along the discovered route with console output; live/dead link highlighting.

### 🛠 Editing convenience
- **Undo / Redo** (Ctrl+Z / Ctrl+Y) via state snapshots, 100-step history.
- **Multi-select** with a marquee or Shift+click, group move, **copy/paste** (Ctrl+C / Ctrl+V), arrow-key nudge.
- Pan / zoom, snap to grid.
- **PNG export** (hi-res offscreen render), **JSON export/import**, **print**.
- **Project saving** to the server + auto-save to localStorage.

### 🎨 Interface
- **Light / dark themes** with a toggle (persisted).
- **Two languages**: Ukrainian / English (full i18n).
- Professional **SVG icons** (Lucide style) — across the UI, palette, canvas and inspector.
- Built-in **help** (button or `F1`) with usage instructions and keyboard shortcuts.

---

## 🚀 Run locally

```bash
git clone https://github.com/mihasan1/SmartOKS_Network.git
cd SmartOKS_Network
npm install
npm start
```

Open **http://localhost:3000**

> Requires Node.js 18+ (developed on v24).

With auto-reload:

```bash
npm run dev
```

---

## ⌨️ Keyboard shortcuts

| Key | Action |
|---|---|
| `V` `R` `W` `C` `E` | Tools: Select / Room / Wall / Cable / Erase |
| `Ctrl + Z` / `Ctrl + Y` | Undo / Redo |
| `Ctrl + C` / `Ctrl + V` | Copy / Paste devices |
| `Ctrl + A` | Select all devices |
| `Ctrl + S` | Save project |
| `Delete` | Delete selection |
| `Arrows` | Nudge selection along the grid |
| `Mouse wheel` | Zoom |
| `Space + drag` / middle button | Pan |
| Double-click a device | Toggle power |
| `F1` | Help |

> Shortcuts work on any keyboard layout (they use `event.code`).

---

## 🧱 Tech stack

- **Backend:** Node.js + [Express](https://expressjs.com/) — serves static files and stores projects.
- **Frontend:** HTML5 **Canvas** + vanilla **JavaScript** (no frameworks) — rendering, drag & drop, all networking logic.
- **Deployment:** [Vercel](https://vercel.com/) — static assets from `public/` + serverless functions in `api/`.

---

## 📁 Project structure

```
SmartOKS_Network/
├── server.js              # local Express server (dev)
├── vercel.json            # Vercel deployment config
├── api/
│   ├── projects.js        # serverless: list projects
│   └── projects/[name].js # serverless: load / save / delete
└── public/
    ├── index.html         # markup
    ├── style.css          # themes (light/dark) + styles
    ├── i18n.js            # UA/EN dictionary + translation engine
    ├── icons.js           # SVG icon library (Lucide style)
    ├── devices.js         # device type catalog
    ├── help.js            # help modal
    └── app.js             # core: canvas engine, interaction, networking, history
```

### Project storage
- **Local (Express):** files in `data/*.json`.
- **On Vercel (serverless):** ephemeral `/tmp` storage. Reliable persistence comes from the **localStorage auto-save**; to move projects between devices use **JSON export/import**.

---

## 🌐 API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects` | list saved projects |
| `GET` | `/api/projects/:name` | load a project |
| `PUT` | `/api/projects/:name` | save a project |
| `DELETE` | `/api/projects/:name` | delete a project |

---

## 📥 Import from SmartOKS

The [SmartOKS platform](https://github.com/mihasan1/smartoks) can export its
knowledge base (rooms + networkable devices) straight into this planner.

In SmartOKS open **База знань → Експорт у Network** and download the JSON file,
then load it here via **Import** (the JSON import button). The file uses the
planner's native project format (`{ model: { rooms, devices, walls, cables }, nextId, view }`),
so no conversion is needed.

What comes across:

- **Rooms** — every cabinet, keeping its SmartOKS name; sized to fit its devices.
- **Devices** — PCs, laptops, printers/MFPs and routers, laid out on a grid
  inside their room. Device names are unique: `{room}_PC{n}` (e.g. `22_PC1`).
- **IP** — transferred when set on the device (MAC too, if present).
- **No links** — devices arrive unconnected; wiring is done here in the planner.

## 🗺 Roadmap

- VLANs with color-coded port tags.
- Inter-subnet routing with routing tables.
- Topology template library (office, school, data center).
- Persistent storage instead of ephemeral `/tmp` (Vercel KV / Postgres).
- Real-time collaborative editing (WebSocket).

---

## 📄 License

MIT — use freely.

---

<p align="center">Built with ❤️ for network design · <a href="https://smartoks-network.vercel.app">smartoks-network.vercel.app</a></p>
