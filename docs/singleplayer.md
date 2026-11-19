# Singleplayer — NPC-fracties: implementatie

Uitvoering van het architectuurvoorstel *AI-NPC-fracties (Raadsspel Singleplayer)*,
scenario 2 "middenweg", met beide aanpassingen van 19 november 2026
(5.5-modelgeneratie, hybride inzet vanaf de start).

## Spelverloop (één sessie = één dossier, 30–45 min)

| Fase | Wat de leerling doet | AI-calls (max) | Model |
|---|---|---|---|
| 1. Briefing | Leest dossier, raadsvoorstel en opties | 0 | — |
| 2. Fractieoverleg | Kiest voor/tegen en schrijft inbreng (max 600 tekens) | 0 | — |
| 3. Commissie | Leest 6 openingsstandpunten; max **2 vragen per fractie** | 6 + 12 | Sonnet 5.5 (opening), Haiku 5.5 (vragen) |
| 4. Onderhandeling (optioneel) | Met **1–2 fracties**, **4 berichten** | 4 | Sonnet 5.5 |
| 5. Stemming | Kiest eigen stem; uitslag regelgebaseerd + stemverklaringen | 1 | Sonnet 5.5 |
| **Totaal** | | **≤ 23** | |

## Componenten

```
public/singleplayer.html           frontend (los van index.html / Firebase)
netlify/functions/npc-fractie.mjs  één NPC-beurt per request (≤ 1 Claude-call)
netlify/functions/sp-sessie.mjs    sessie starten, inbreng, fasewissel (geen AI)
netlify/functions/lib/sp-shared.mjs   pure logica: routering, caps, kosten, prompts, stemregels, fallbacks
netlify/functions/lib/sp-server.mjs   Supabase-auth/RPC, config laden, Anthropic-call (fetch, geen SDK)
supabase/migrations/…_singleplayer_npc_fracties.sql   tabellen, RLS, RPC's
supabase/migrations/…_singleplayer_seed.sql           7 fractieprofielen, conceptdossier, config-rij
```

**Request-volgorde in `npc-fractie`:** Supabase-JWT controleren → `sp_reserveer_call`
(atomair, `FOR UPDATE`: caps + circuit breaker) → Claude-call of gescript antwoord →
`sp_registreer_call` (tokenlog, berichten, standpunt/akkoord/uitslag in één transactie).

**Beveiliging.** De Anthropic-key en de Supabase service-role-key staan alleen in
Netlify-env. Leerlingen kunnen via RLS hun eigen sessies en berichten *lezen*, maar
niets schrijven: alle schrijfacties lopen via de functions, dus een leerling kan zijn
eigen caps of budget niet resetten. Tokenlog en config zijn niet leesbaar voor
leerlingen. Spelersinvoer wordt ingekort, opgeschoond en in de frontend ge-escaped.

## Kostenbeheersing

- **Configureerbare modelnamen.** Code-defaults < env (`NPC_MODEL_PREMIUM`/`NPC_MODEL_ROUTINE`)
  < Supabase `sp_npc_config` (rij `default`). Prijzen en caps staan in dezelfde config.
- **Prompt caching (1 uur).** Statisch deel = spelregels + 7 fractieprofielen + dossier
  (≈ 2.100 tokens). Dat deel bevat géén sessie-inhoud, dus leerlingen in dezelfde klas
  die tegelijk spelen delen de cache. De delta per call is ≈ 300–600 tokens.
- **Eerste opening alleen, de rest parallel.** De eerste openingscall schrijft de cache,
  daarna gaan er 5 parallel met cache-hits. Zes parallelle calls zouden alle zes de cache
  schrijven: dat kost ≈ $0,07 aan openingen in plaats van ≈ $0,03.
- **Circuit breaker.** Per sessie maximaal 26 calls en $0,12 (≈ 2× verwacht). Daarboven
  krijgt de leerling een gescript antwoord ("fractie X verwijst naar het eerder ingenomen
  standpunt"), de sessie loopt gewoon door. Dezelfde fallback wordt gebruikt bij een
  API-fout, een timeout of onbruikbare modeloutput.
- **Dagcap:** max 8 nieuwe sessies per gebruiker per 24 uur (niet in het voorstel; voorkomt
  dat "nieuw spel" de sessiecap omzeilt).
- **Tokenlog** per call (`sp_tokenlog`) en view `sp_kosten_per_sessie` om de schatting
  tegen echt gebruik te valideren.

**Rekenschatting per sessie** (23 calls; zonder cache-hits tussen sessies; Haiku zonder
cache omdat het statische deel mogelijk onder Haiku's minimale cachegrootte zit):
≈ **$0,049** → ≈ $1,36 per klas van 28 → ≈ $27 per maand bij 560 sessies. Dat valt binnen
de bandbreedte van het voorstel ($0,05–0,06). Dit is nog steeds een rekenmodel en geen meting.

## Stemregels (regelgebaseerd, geen AI)

1. De leerling kiest de stem van de eigen fractie.
2. Een fractie waarmee een **akkoord** is bereikt, stemt mee met de leerling.
3. Anders telt het openingsstandpunt: voor → voor, tegen → tegen.
4. Twijfel zonder akkoord: coalitiefracties steunen het collegevoorstel, oppositiefracties
   stemmen tegen (onthouden van stemming bestaat niet in de raad).
5. Geen geldig standpunt (bijv. door een API-fout)? Dan geldt de startneiging uit het dossier.

Daarna schrijft één Sonnet-call de stemverklaringen voor alle zes fracties. De stemmen
liggen dan al vast; het model kan ze niet veranderen.

## Inhoudelijke waarborgen

- Systeemprompt: geen partij is de goede, geen karikaturen, afwegingen benoemen, alleen
  feiten uit het dossier, uitleg bij vaktermen, korte antwoorden, rolverdeling raad/college.
- Geen persoonsnamen van (echte) raadsleden of collegeleden: NPC's spreken als "de fractie".
- **Vermijdlijst-detectie:** elke NPC-tekst wordt gecontroleerd op de clichés uit de
  vermijdlijst. Treffers worden gelogd (`sp_tokenlog.vermijd_hits`, kolom
  `calls_met_vermijdhits` in de view), maar niet opnieuw gegenereerd, want dat zou extra
  calls kosten. Gebruik dit bij de verplichte kwaliteitstoets van de 5.5-modellen.

## Bewuste keuzes en afwijkingen t.o.v. het voorstel

| Punt | Keuze |
|---|---|
| Aantal NPC's | 7 fracties in de raad, 1 door de leerling gespeeld → 6 NPC's |
| Stemverklaringen | 1 call voor alle fracties samen in plaats van 6 → totaal ≤ 23 calls (voorstel: ~22) |
| Timeout | `timeout_ms` 9 s (env `NPC_TIMEOUT_MS`), veilig onder de synchrone Netlify-limiet. **Plan verifiëren.** |
| 1-uur-cache | Wordt meegestuurd als `cache_control.ttl = "1h"`. Vraagt de API een beta-header, zet die dan via `ANTHROPIC_BETA` of schakel terug naar `NPC_CACHE_TTL=5m`. |
| Demo-modus (scenario 1) | Nog niet gebouwd. De fallback-route is er al, dus een demo-modus is later vooral een configuratiekeuze. |

## Beheer

```sql
-- modelwissel zonder deploy
update sp_npc_config set data = data || '{"modellen":{"premium":"claude-sonnet-5-5"}}' where id = 'default';
-- caps bijstellen na de playtest (geldt voor nieuwe sessies)
update sp_npc_config set data = jsonb_set(data, '{caps}', '{"max_calls":26,"max_kosten_usd":0.12,"max_vragen_per_fractie":3,"max_onderhandeling_beurten":4,"max_onderhandeling_fracties":2}') where id = 'default';
-- kosten en kwaliteit
select * from sp_kosten_per_sessie order by kosten_usd desc limit 20;
select soort, model, avg(kosten_usd), avg(cache_read_tokens), count(*) filter (where fallback) from sp_tokenlog group by 1,2;
```
