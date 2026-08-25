/// <reference lib="deno.ns" />
// build.ts — run with: deno run -A build.ts
const SRC = ".";
const OUT = "dist";

// TS files get bundled; HTML files get copied verbatim.
const tsEntries: string[] = [];
const htmlEntries: string[] = [];
for (const dirEntry of Deno.readDirSync(SRC)) {
  if (!dirEntry.isFile) continue;
  if (dirEntry.name.endsWith(".ts") && dirEntry.name !== "build.ts") {
    tsEntries.push(dirEntry.name.replace(/\.ts$/, ""));
  } else if (dirEntry.name.endsWith(".html")) {
    htmlEntries.push(dirEntry.name);
  }
}

await Deno.mkdir(OUT, { recursive: true });
const PROD = Deno.env.get("PROD") === "1";

for (const name of tsEntries) {
  console.log(`bundling ${name}...${PROD ? " (prod)" : " (debug)"}`);
  const args = [
    "bundle", "--platform", "browser",
    `${SRC}/${name}.ts`, "-o", `${OUT}/${name}.js`,
  ];
  if (PROD) {
    args.push("--minify");
  } else {
    args.push("--sourcemap=inline");
  }
  const { code } = new Deno.Command("deno", { args }).outputSync();
  if (code !== 0) {
    console.error(`failed to bundle ${name}`);
    Deno.exit(code);
  }
}

for (const name of htmlEntries) {
  console.log(`copying ${name}...`);
  await Deno.copyFile(`${SRC}/${name}`, `${OUT}/${name}`);
}

await Deno.copyFile(`${SRC}/manifest.json`, `${OUT}/manifest.json`);
console.log(`done — bundled ${tsEntries.length} scripts, copied ${htmlEntries.length} html`);
