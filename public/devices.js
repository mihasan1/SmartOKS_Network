// Каталог типів пристроїв. Іконки — емодзі (малюються на канвасі).
// Назви беруться з i18n за ключем "dev.<kind>" (див. i18n.js).
// ports: кількість портів, wireless: чи вміє Wi-Fi, forward: чи пересилає трафік
window.DEVICE_TYPES = {
  pc:      { icon: "🖥️", ports: 1, wireless: false, forward: false, color: "#3ea6ff" },
  laptop:  { icon: "💻", ports: 1, wireless: true,  forward: false, color: "#56b6ff" },
  server:  { icon: "🗄️", ports: 2, wireless: false, forward: false, color: "#b48cff" },
  printer: { icon: "🖨️", ports: 1, wireless: true,  forward: false, color: "#ffb454" },
  switch:  { icon: "🔀", ports: 8, wireless: false, forward: true,  color: "#38d39f" },
  hub:     { icon: "⚹",  ports: 6, wireless: false, forward: true,  color: "#7fe0c0" },
  router:  { icon: "📶", ports: 4, wireless: true,  forward: true,  color: "#ff6b9d" },
  ap:      { icon: "📡", ports: 1, wireless: true,  forward: true,  color: "#ff8fb3" },
};

// Порядок відображення в палітрі
window.DEVICE_ORDER = ["pc", "laptop", "server", "printer", "switch", "hub", "router", "ap"];

// Локалізована назва типу пристрою
window.devName = (kind) => window.t(`dev.${kind}`);
