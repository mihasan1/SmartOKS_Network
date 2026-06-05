// Каталог типов устройств. Иконки — эмодзи (рисуются на канвасе).
// kind: тип, ports: число портов, wireless: умеет ли по Wi-Fi, forward: пересылает ли трафик (хаб/коммутатор/роутер)
window.DEVICE_TYPES = {
  pc:      { name: "ПК",          icon: "🖥️", ports: 1,  wireless: false, forward: false, color: "#3ea6ff" },
  laptop:  { name: "Ноутбук",     icon: "💻", ports: 1,  wireless: true,  forward: false, color: "#56b6ff" },
  server:  { name: "Сервер",      icon: "🗄️", ports: 2,  wireless: false, forward: false, color: "#b48cff" },
  printer: { name: "Принтер",     icon: "🖨️", ports: 1,  wireless: true,  forward: false, color: "#ffb454" },
  switch:  { name: "Коммутатор",  icon: "🔀", ports: 8,  wireless: false, forward: true,  color: "#38d39f" },
  hub:     { name: "Концентратор",icon: "⚹",  ports: 6,  wireless: false, forward: true,  color: "#7fe0c0" },
  router:  { name: "Wi-Fi роутер",icon: "📶", ports: 4,  wireless: true,  forward: true,  color: "#ff6b9d" },
  ap:      { name: "Точка доступа",icon: "📡", ports: 1,  wireless: true,  forward: true,  color: "#ff8fb3" },
};

// Порядок отображения в палитре
window.DEVICE_ORDER = ["pc", "laptop", "server", "printer", "switch", "hub", "router", "ap"];
