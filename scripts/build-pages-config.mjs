import { writeFile } from "node:fs/promises";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("GitHub Pages build requires Supabase public variables");
await writeFile("docs/app-config.js", `window.TRIP_CONFIG=${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: anonKey, tripSlug: "shikoku-saburo-bbq-2026" })};\n`);
