import { copyFile, mkdir, writeFile } from "node:fs/promises";

const publicFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "sgate-result.html",
  "verify.html",
  "config.js",
];

await mkdir("docs", { recursive: true });
await mkdir("docs/assets", { recursive: true });

for (const file of publicFiles) {
  await copyFile(file, `docs/${file}`);
}

await copyFile("assets/hm-logo.png", "docs/assets/hm-logo.png");

await writeFile("docs/.nojekyll", "", "utf8");

console.log(`Copied ${publicFiles.length} public files and assets to docs/.`);
