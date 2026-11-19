-- ════════════════════════════════════════════════════════════════════
-- Raadsspel Singleplayer — dossier 4 (algemene zaken): zondagopenstelling
-- Input wethouder 19-11-2026: in Holten mogen winkels op zondag na 13.00 uur
-- open (vooral supermarkten gebruiken dat); de supermarkten vragen om eerder
-- open te mogen; in Rijssen zijn de winkels dicht; het coalitieakkoord zegt
-- dat de huidige situatie blijft. Geen namen van personen of bedrijven.
-- ════════════════════════════════════════════════════════════════════

insert into public.sp_dossiers (id, titel, actief, inhoud) values
('zondagopenstelling-holten', 'Zondag in Holten: eerder open?', true, $j${
  "titel": "Zondag in Holten: eerder open?",
  "domein": "Algemene zaken",
  "pitch": "In Holten mogen winkels op zondag vanaf 13.00 uur open, in Rijssen blijven ze dicht. De supermarkten in Holten willen eerder open. Het college houdt vast aan het coalitieakkoord: alles blijft zoals het is. Is dat terecht, of verdient deze vraag een ander antwoord?",
  "raadsvoorstel": "Het college stelt de raad voor de Winkeltijdenverordening niet te wijzigen en het verzoek van de supermarkten in Holten om op zondag eerder open te mogen af te wijzen. De huidige regeling blijft: in Holten op zondag open vanaf 13.00 uur, in Rijssen op zondag dicht.",
  "context": "Volgens de Winkeltijdenwet zijn winkels op zondag dicht, tenzij de gemeenteraad in een verordening anders bepaalt. De raad van Rijssen-Holten heeft dat voor Holten gedaan: daar mogen winkels op zondag vanaf 13.00 uur open, mede vanwege het toerisme rond de Holterberg. Het tijdstip na de ochtenddiensten in de kerken is een bewust gekozen compromis. In Rijssen zijn de winkels op zondag dicht. De supermarkten in Holten maken het meest gebruik van de regeling en hebben gevraagd om eerder open te mogen. In het coalitieakkoord van SGP, CDA en Gemeentebelang staat dat de huidige situatie blijft zoals die is. De ChristenUnie, in de oppositie, deelt op dit punt de principiële opvatting van de SGP over de zondagsrust.",
  "feiten": [
    "In Holten mogen winkels op zondag open vanaf 13.00 uur; vooral de supermarkten doen dat.",
    "In Rijssen zijn de winkels op zondag dicht.",
    "De supermarkten in Holten vragen of ze op zondag eerder open mogen.",
    "In het coalitieakkoord staat dat de huidige situatie rond de zondagopenstelling blijft zoals die is.",
    "De zondagsrust is voor veel inwoners een principiële en geloofskwestie; voor anderen gaat het vooral om gemak, werk en vrije keuze.",
    "Recreanten en toeristen rond de Holterberg doen ook op zondag boodschappen.",
    "Werknemers in de detailhandel kunnen niet altijd zelf kiezen of ze op zondag werken.",
    "Inwoners uit Rijssen die op zondag boodschappen willen doen, rijden nu naar Holten of naar buurgemeenten."
  ],
  "opties": [
    {"titel": "Instemmen: alles blijft zoals het is", "omschrijving": "Het coalitieakkoord wordt nagekomen en het compromis van na de kerkdiensten blijft. De supermarkten krijgen nee; recreanten en een deel van de inwoners missen de ochtend."},
    {"titel": "Amendement: in Holten eerder open", "omschrijving": "Supermarkten in Holten mogen op zondag bijvoorbeeld vanaf 12.00 uur open. Tegemoetkoming aan ondernemers en recreanten, maar het raakt aan het compromis rond de kerkdiensten en aan het coalitieakkoord."},
    {"titel": "Amendement: een proef met evaluatie", "omschrijving": "Een jaar lang eerder open, daarna evalueren met ondernemers, personeel, kerken en inwoners. Biedt ruimte om te leren, maar een proef wordt in de praktijk vaak blijvend."},
    {"titel": "Amendement: inwoners laten meebeslissen", "omschrijving": "Eerst een peiling onder inwoners van Holten voordat de raad besluit. Geeft draagvlak, maar een principiële kwestie laat zich niet altijd beslissen met een meerderheid van stemmen."}
  ],
  "fractie_hints": {
    "sgp": {"neiging": "voor", "aandachtspunt": "de zondagsrust als principe en het nakomen van het coalitieakkoord", "voorwaarde": "geen enkele verruiming van de zondagopenstelling", "fallback_standpunt": "De SGP-fractie steunt het voorstel van harte. De zondag is een rustdag, en het huidige compromis is al ver genoeg gegaan. Bovendien staat in het coalitieakkoord dat de situatie blijft zoals die is."},
    "cda": {"neiging": "voor", "aandachtspunt": "het nakomen van het coalitieakkoord, de zondag als dag van rust en ontmoeting, en oog voor ondernemers en personeel", "voorwaarde": "dat de coalitieafspraak overeind blijft; over een evaluatie in een volgende periode valt te praten", "fallback_standpunt": "Het CDA steunt het voorstel: in het coalitieakkoord hebben we afgesproken dat de huidige situatie blijft. De fractie begrijpt de vraag van de supermarkten, maar afspraak is afspraak."},
    "gb": {"neiging": "voor", "aandachtspunt": "het behoud van de tradities in beide kernen, maar ook de Holtense ondernemers en het toerisme", "voorwaarde": "aandacht voor de Holtense ondernemers zonder de huidige afspraak los te laten", "fallback_standpunt": "Gemeentebelang houdt vast aan de afspraak in het coalitieakkoord. Holten en Rijssen hebben elk hun eigen tradities, en het huidige compromis past daarbij."},
    "cu": {"neiging": "voor", "aandachtspunt": "de zondagsrust, ook als bescherming van werknemers die anders op zondag moeten werken", "voorwaarde": "geen verruiming, en aandacht voor personeel dat nu al op zondag werkt", "fallback_standpunt": "De ChristenUnie steunt dit voorstel. Een gezamenlijke rustdag is waardevol, ook voor de mensen achter de kassa die anders op zondag moeten werken."},
    "fvd": {"neiging": "twijfel", "aandachtspunt": "zeggenschap van de inwoners van Holten zelf, en zo min mogelijk regels van bovenaf", "voorwaarde": "de inwoners van Holten krijgen zelf een stem, bijvoorbeeld via een peiling", "fallback_standpunt": "FvD vindt dat niet het college en ook niet de raad hierover moet beslissen, maar de inwoners van Holten zelf. Vraag het ze."},
    "vvd": {"neiging": "tegen", "aandachtspunt": "vrijheid voor ondernemers en klanten om zelf te kiezen", "voorwaarde": "de supermarkten in Holten mogen op zondag eerder open", "fallback_standpunt": "De VVD vindt dat ondernemers zelf moeten kunnen bepalen wanneer ze open zijn. Niemand wordt gedwongen om op zondag te winkelen, dus waarom zou de gemeente het verbieden?"},
    "pro": {"neiging": "twijfel", "aandachtspunt": "de positie van werknemers en keuzevrijheid voor inwoners", "voorwaarde": "personeel mag niet worden verplicht om op zondag te werken", "fallback_standpunt": "PRO ziet beide kanten: keuzevrijheid voor inwoners, maar ook werknemers die onder druk staan om op zondag te werken. De fractie wil vooral dat het personeel beschermd wordt."}
  },
  "reflectievragen": [
    "Een coalitieakkoord bindt partijen aan afspraken, ook als ze er zelf soms anders over denken. Is dat goed voor de democratie of juist niet?",
    "De ChristenUnie zit in de oppositie maar stemt op dit punt met de SGP mee. Wat zegt dat over 'coalitie' en 'oppositie'?",
    "Kun je een principiële kwestie beslissen met een peiling of een meerderheid van stemmen? Waarom wel of niet?"
  ]
}$j$::jsonb)
on conflict (id) do update set titel = excluded.titel, actief = excluded.actief, inhoud = excluded.inhoud;
