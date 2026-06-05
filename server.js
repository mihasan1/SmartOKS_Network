import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { promises as fs } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = join(__dirname, "data");

app.use(express.json({ limit: "10mb" }));
app.use(express.static(join(__dirname, "public")));

await fs.mkdir(DATA_DIR, { recursive: true });

// Список сохранённых проектов
app.get("/api/projects", async (_req, res) => {
  const files = await fs.readdir(DATA_DIR);
  const names = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  res.json(names);
});

// Загрузить проект
app.get("/api/projects/:name", async (req, res) => {
  try {
    const safe = req.params.name.replace(/[^a-zA-Z0-9_\-а-яА-ЯёЁ ]/g, "");
    const data = await fs.readFile(join(DATA_DIR, `${safe}.json`), "utf8");
    res.type("json").send(data);
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

// Сохранить проект
app.put("/api/projects/:name", async (req, res) => {
  const safe = req.params.name.replace(/[^a-zA-Z0-9_\-а-яА-ЯёЁ ]/g, "");
  if (!safe) return res.status(400).json({ error: "bad name" });
  await fs.writeFile(join(DATA_DIR, `${safe}.json`), JSON.stringify(req.body, null, 2), "utf8");
  res.json({ ok: true });
});

// Удалить проект
app.delete("/api/projects/:name", async (req, res) => {
  const safe = req.params.name.replace(/[^a-zA-Z0-9_\-а-яА-ЯёЁ ]/g, "");
  try {
    await fs.unlink(join(DATA_DIR, `${safe}.json`));
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.listen(PORT, () => {
  console.log(`\n  NetPlanner запущен:  http://localhost:${PORT}\n`);
});
