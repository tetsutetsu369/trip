import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("GitHub Pages build requires Supabase public variables");
await writeFile("docs/app-config.js", `window.TRIP_CONFIG=${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: anonKey, tripSlug: "shikoku-saburo-bbq-2026" })};\n`);

const buildVersion = process.env.GITHUB_SHA?.slice(0, 12) || `local-${Date.now()}`;
async function stampAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await stampAssets(file);
    if (entry.isFile() && /\.(html|css)$/.test(entry.name)) {
      const source = await readFile(file, "utf8");
      await writeFile(file, source.replaceAll("__BUILD_VERSION__", buildVersion));
    }
  }
}
await stampAssets("docs");
