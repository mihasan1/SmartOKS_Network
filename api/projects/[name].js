// Vercel serverless: загрузка / сохранение / удаление одного проекта.
import { promises as fs } from "fs";
import { join } from "path";

const DIR = "/tmp/netplanner";
const safe = (n) => String(n || "").replace(/[^a-zA-Z0-9_\-а-яА-ЯёЁ ]/g, "");

export default async function handler(req, res) {
  await fs.mkdir(DIR, { recursive: true });
  const name = safe(req.query.name);
  if (!name) return res.status(400).json({ error: "bad name" });
  const file = join(DIR, `${name}.json`);

  if (req.method === "GET") {
    try {
      const data = await fs.readFile(file, "utf8");
      res.setHeader("content-type", "application/json");
      return res.send(data);
    } catch {
      return res.status(404).json({ error: "not found" });
    }
  }

  if (req.method === "PUT") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch { body = {}; } }
    await fs.writeFile(file, JSON.stringify(body ?? {}, null, 2), "utf8");
    return res.json({ ok: true });
  }

  if (req.method === "DELETE") {
    await fs.unlink(file).catch(() => {});
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: "method not allowed" });
}
