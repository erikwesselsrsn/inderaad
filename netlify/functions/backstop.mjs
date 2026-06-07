/**
 * Netlify Scheduled Function — draait elke minuut
 * Scant actieve spellen op verlopen beurten die client-side gemist zijn
 * (bijv. alle clients waren offline op het moment van expiry)
 *
 * Netlify schedule: elke minuut via cron in netlify.toml
 */

export default async (req) => {
  const FIREBASE_URL = process.env.FIREBASE_DATABASE_URL;
  const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

  if (!FIREBASE_URL || !FIREBASE_API_KEY) {
    return new Response("Config ontbreekt", { status: 500 });
  }

  try {
    // Haal alle actieve spellen op via Firebase REST API
    const gamesRes = await fetch(
      `${FIREBASE_URL}/games.json?orderBy="status"&equalTo="playing"&auth=${FIREBASE_API_KEY}`
    );

    if (!gamesRes.ok) {
      return new Response("Firebase fetch mislukt", { status: 502 });
    }

    const games = await gamesRes.json();
    if (!games) return new Response("Geen actieve spellen", { status: 200 });

    const now = Date.now();
    const updates = [];

    for (const [gameCode, game] of Object.entries(games)) {
      const { turnStartedAt, turnDurationMs, currentTurn, turnOrder, turnLock } = game;

      // Skip als beurt al geclaimd wordt door een client
      if (turnLock?.claimed) continue;

      // Skip als geen timestamp beschikbaar
      if (!turnStartedAt || !turnDurationMs) continue;

      const elapsed = now - turnStartedAt;
      if (elapsed < turnDurationMs) continue; // Nog niet verlopen

      // Beurt is verlopen — advance via REST
      const order = Array.isArray(turnOrder) ? turnOrder : Object.keys(game.players || {});
      const currIdx = order.indexOf(currentTurn);
      const nextIdx = (currIdx + 1) % order.length;
      const nextTurn = order[nextIdx];

      const patch = {
        currentTurn: nextTurn,
        turnStartedAt: { ".sv": "timestamp" },
        lastActivity: { ".sv": "timestamp" },
        "turnLock/holder": null,
        "turnLock/claimed": false,
      };

      // Schrijf update terug via Firebase REST
      const updateRes = await fetch(
        `${FIREBASE_URL}/games/${gameCode}.json?auth=${FIREBASE_API_KEY}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );

      if (updateRes.ok) {
        updates.push(`${gameCode}: beurt doorgestuurd van ${currentTurn} naar ${nextTurn}`);
        console.log(`[backstop] ${gameCode}: turn advanced`);
      }
    }

    return new Response(
      JSON.stringify({ checked: Object.keys(games).length, advanced: updates }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[backstop] fout:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

export const config = {
  schedule: "* * * * *", // elke minuut
};
