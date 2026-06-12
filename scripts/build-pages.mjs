import { copyFile, mkdir, writeFile } from "node:fs/promises";

const publicFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "sgate-result.html",
  "config.js",
];

await mkdir("docs", { recursive: true });

for (const file of publicFiles) {
  await copyFile(file, `docs/${file}`);
}

await writeFile("docs/.nojekyll", "", "utf8");

console.log(`Copied ${publicFiles.length} public files to docs/.`);
