import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";

const publicFiles = [
  "index.html",
  "auth.html",
  "styles.css",
  "app.js",
  "auth.js",
  "verify.html",
  "config.js",
  "manifest.webmanifest",
  "pwa.js",
  "service-worker.js",
];

await mkdir("docs", { recursive: true });
await mkdir("docs/assets", { recursive: true });

for (const file of publicFiles) {
  await copyFile(file, `docs/${file}`);
}

for (const asset of await readdir("assets")) {
  await copyFile(`assets/${asset}`, `docs/assets/${asset}`);
}

await writeFile("docs/.nojekyll", "", "utf8");

console.log(`Copied ${publicFiles.length} public files and assets to docs/.`);
