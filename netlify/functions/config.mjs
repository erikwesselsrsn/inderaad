export default async (req) => {
  // Alleen GET
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const config = {
    supabaseUrl:    process.env.SUPABASE_URL      || "",
    supabaseAnon:   process.env.SUPABASE_ANON_KEY || "",
    firebaseUrl:    process.env.FIREBASE_DATABASE_URL || "",
    firebaseApiKey: process.env.FIREBASE_API_KEY  || "",
  };

  return new Response(JSON.stringify(config), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
};

export const config = { path: "/api/config" };
