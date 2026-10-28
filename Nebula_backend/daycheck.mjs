import AdmZip from "adm-zip";

const API = "http://localhost:5001";
const REPO = "https://github.com/Rishav250-cmd/Quick_Dine_2.0";
const show = (ok, msg) => console.log((ok ? "PASS  " : "FAIL  ") + msg);
async function call(url, opts) {
  const r = await fetch(url, opts);
  return { status: r.status, body: await r.json().catch(() => null) };
}

// 1. Blast radius on a known chain: a -> b -> c, d -> c, e alone
const zip = new AdmZip();
zip.addFile("README.md", Buffer.from("demo"));
zip.addFile("src/a.js", Buffer.from("import { b } from './b.js'; export const a = () => b();"));
zip.addFile("src/b.js", Buffer.from("import { c } from './c.js'; export const b = () => c();"));
zip.addFile("src/c.js", Buffer.from("export const c = () => 1;"));
zip.addFile("src/d.js", Buffer.from("import { c } from './c.js'; export const d = () => c();"));
zip.addFile("src/e.js", Buffer.from("export const e = () => 2;"));
const form = new FormData();
form.append("file", new Blob([zip.toBuffer()], { type: "application/zip" }), "blast-demo.zip");
const up = await (await fetch(`${API}/api/upload`, { method: "POST", body: form })).json();
const blast = await call(`${API}/api/blast?id=${up.id}&path=${encodeURIComponent("src/c.js")}`);
const dm = blast.body?.depthMap || {};
show(blast.body?.count === 3 && dm["src/b.js"] === 1 && dm["src/d.js"] === 1 && dm["src/a.js"] === 2,
  `Blast radius of c.js = ${blast.body?.count} (b:1, d:1, a:2)`);
const e = await call(`${API}/api/blast?id=${up.id}&path=${encodeURIComponent("src/e.js")}`);
show(e.body?.count === 0, "Blast radius of the isolated file is 0");
show((await call(`${API}/api/blast?id=${up.id}`)).status === 400, "Blast without path gives 400");
show((await call(`${API}/api/blast?id=${up.id}&path=nope.js`)).status === 404, "Blast with unknown file gives 404");
const g1 = (await call(`${API}/api/graph/${up.id}`)).body;
show(g1.nodes.find((n) => n.id === "src/c.js")?.blastRadius === 3, "Graph nodes carry blastRadius");

// 2. A real repo: health, onboarding
const a = await call(`${API}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: REPO }) });
const id = a.body.id;
const g = (await call(`${API}/api/graph/${id}`)).body;
const n0 = g.nodes[0];
show(["hotspot", "healthScore", "blastRadius"].every((k) => typeof n0[k] === "number") && typeof n0.isGodFile === "boolean",
  "Nodes carry hotspot, healthScore, isGodFile and blastRadius");
const h = await call(`${API}/api/health/${id}`);
show(h.status === 200 && typeof h.body.grade === "string" && Array.isArray(h.body.hotspots) && Array.isArray(h.body.godFiles),
  `Health report: grade ${h.body?.grade}, ${h.body?.hotspots?.length} hotspots, ${h.body?.godFiles?.length} god files`);
show(h.body?.stats?.churnAvailable === true, "Churn is used for the score (git history available)");
const o = await call(`${API}/api/onboarding/${id}`);
show(o.status === 200 && o.body?.path?.length > 0 && o.body.path.every((s) => s.id && s.reason),
  `Onboarding path has ${o.body?.path?.length} steps starting at ${o.body?.entry}`);
show(Array.isArray(o.body?.safeStarters) && o.body.safeStarters.length > 0, "Safe starter files found");
show(typeof o.body?.issuesStatus === "string", `Issues status: ${o.body?.issuesStatus} (${o.body?.issues?.length ?? 0} issues)`);

// 3. Async analysis and progress
const t0 = Date.now();
const as = await call(`${API}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://github.com/sindresorhus/ky", async: true }) });
show(as.status === 202 && !!as.body?.id && Date.now() - t0 < 3000, `Async analyze returned ${as.status} in ${Date.now() - t0} ms`);
let st = "cloning";
for (let i = 0; i < 90 && st !== "ready" && st !== "error"; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  st = (await call(`${API}/api/analyze/${as.body.id}/status`)).body?.status;
}
show(st === "ready", `Async job finished with status ${st}`);