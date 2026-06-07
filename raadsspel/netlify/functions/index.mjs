import { readFileSync } from "fs";
import { join } from "path";

export default async (req) => {
  // Serve index.html with env vars injected as window.__RSP_CONFIG__
  const htmlPath = join(process.cwd(), "public", "index.html");
  let html = readFileSync(htmlPath, "utf-8");

  const config = {
    supabaseUrl:    process.env.SUPABASE_URL     || "",
    supabaseAnon:   process.env.SUPABASE_ANON_KEY || "",
    firebaseUrl:    process.env.FIREBASE_DATABASE_URL || "",
    firebaseApiKey: process.env.FIREBASE_API_KEY  || "",
  };

  const injection = `<script>window.__RSP_CONFIG__ = ${JSON.stringify(config)};</script>`;
  html = html.replace("</head>", injection + "\n</head>");

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

export const config = { path: "/" };
