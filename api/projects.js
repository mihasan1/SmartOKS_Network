// Vercel serverless: список сохранённых проектов.
// На serverless файловая система непостоянна — используем /tmp (живёт в пределах
// «тёплого» инстанса). Реальное сохранение у пользователя — автосейв в localStorage.
import { promises as fs } from "fs";

const DIR = "/tmp/netplanner";

export default async function handler(req, res) {
  await fs.mkdir(DIR, { recursive: true });
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const files = await fs.readdir(DIR).catch(() => []);
  res.json(files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")));
}
