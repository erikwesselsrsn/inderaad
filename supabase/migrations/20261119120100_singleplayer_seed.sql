-- ════════════════════════════════════════════════════════════════════
-- Raadsspel Singleplayer — seed: fractieprofielen, eerste dossier, config
--
-- LET OP: het dossier "De Veldkamp" is een CONCEPT, geschreven als
-- testdossier voor de NPC-engine. De locatie en spelcijfers zijn fictief.
-- Inhoudelijk laten toetsen (raadsspel-scenario / Erik) vóór gebruik in de klas.
-- Fractieprofielen bevatten bewust GEEN namen van raadsleden.
-- ════════════════════════════════════════════════════════════════════

insert into public.sp_fracties (id, naam, zetels, positie, kleur, volgorde, profiel) values
('sgp', 'SGP', 8, 'coalitie', '#C4621A', 1, $j${
  "waarden": "Bijbelse normen als richtsnoer voor beleid, gezin en gemeenschap, rentmeesterschap, financiële voorzichtigheid",
  "aandachtspunten": "degelijke gemeentefinanciën zonder onnodige risico's, woningen voor jonge gezinnen uit de eigen gemeenschap, ruimte voor kerken en verenigingen",
  "toon": "rustig, zorgvuldig en principieel; formeel taalgebruik; weegt af voordat het oordeelt"
}$j$::jsonb),
('cda', 'CDA', 4, 'coalitie', '#007B5F', 2, $j${
  "waarden": "gespreide verantwoordelijkheid, gemeenschapszin, rentmeesterschap",
  "aandachtspunten": "leefbaarheid in zowel Rijssen als Holten, platteland en agrariërs, verenigingsleven, doorstroming voor starters en ouderen",
  "toon": "verbindend en pragmatisch; zoekt een compromis maar houdt een eigen lijn"
}$j$::jsonb),
('gb', 'Gemeentebelang', 4, 'coalitie', '#5B8FC4', 3, $j${
  "waarden": "lokaal belang boven landelijke partijlijnen, praktisch en niet-ideologisch",
  "aandachtspunten": "uitvoerbaarheid, verkeer en voorzieningen in de wijken, aandacht voor Holten naast Rijssen",
  "toon": "nuchter en concreet; verwijst naar wat inwoners in hun straat merken"
}$j$::jsonb),
('cu', 'ChristenUnie', 3, 'oppositie', '#3A6EA5', 4, $j${
  "waarden": "christelijk-sociaal, zorg voor kwetsbare inwoners, duurzaamheid",
  "aandachtspunten": "betaalbare woningen, zorg en armoedebestrijding, klimaat en natuur",
  "toon": "betrokken en constructief kritisch; komt met concrete alternatieven"
}$j$::jsonb),
('fvd', 'FvD', 3, 'oppositie', '#8B1A1A', 5, $j${
  "waarden": "zeggenschap van de lokale gemeenschap, terughoudendheid met overheidsbemoeienis en landelijk opgelegde opgaven",
  "aandachtspunten": "inspraak van inwoners, open ruimte en het karakter van kernen en buurtschappen, lasten voor inwoners",
  "toon": "direct en controlerend; stelt scherpe vragen aan het college, onderbouwt met wat inwoners aangeven"
}$j$::jsonb),
('vvd', 'VVD', 2, 'oppositie', '#E88020', 6, $j${
  "waarden": "vrijheid en eigen verantwoordelijkheid, ondernemerschap, een overheid die doet wat ze belooft",
  "aandachtspunten": "lage lasten, snelheid en minder regeldruk, financiële discipline, middenhuur",
  "toon": "zakelijk en cijfermatig; to the point"
}$j$::jsonb),
('pro', 'PRO', 1, 'oppositie', '#7B2D8B', 7, $j${
  "waarden": "gelijke kansen, sociale rechtvaardigheid, klimaat",
  "aandachtspunten": "betaalbaar wonen, armoedebestrijding, duurzaamheid, kansen voor jongeren",
  "toon": "bevlogen maar onderbouwd; zoekt bondgenoten over partijgrenzen heen"
}$j$::jsonb)
on conflict (id) do update set naam = excluded.naam, zetels = excluded.zetels, positie = excluded.positie,
  kleur = excluded.kleur, volgorde = excluded.volgorde, profiel = excluded.profiel;

insert into public.sp_dossiers (id, titel, actief, inhoud) values
('veldkamp-woningbouw', 'Woningbouw De Veldkamp', true, $j${
  "titel": "Woningbouw De Veldkamp",
  "pitch": "Het college wil 180 woningen bouwen op De Veldkamp, aan de rand van Rijssen. Een ontwikkelaar heeft de grond al en wil snel beginnen. Maar over de woningmix, het verkeer en de vraag waarom Holten niets krijgt, is de raad het nog lang niet eens.",
  "raadsvoorstel": "Het college vraagt de raad in te stemmen met het stedenbouwkundig kader voor De Veldkamp: 180 woningen, gebouwd door de ontwikkelaar die de grond bezit (zelfrealisatie), met 30% sociale huur, 40% middenhuur en betaalbare koop en 30% vrije sector.",
  "context": "De Veldkamp is een fictieve uitbreidingslocatie aan de rand van de wijk Opbroek in Rijssen. Een ontwikkelaar bezit de grond. Bij zelfrealisatie bouwt de grondeigenaar zelf, binnen de regels die de gemeente stelt; de gemeente hoeft de grond dan niet te kopen, maar heeft minder invloed op tempo en prijs. Een stedenbouwkundig kader legt vast wat er ongeveer gebouwd wordt, voordat het bestemmingsplan (onder de Omgevingswet: het omgevingsplan) wordt aangepast.",
  "feiten": [
    "Spelcijfer: de gemiddelde wachttijd voor een sociale huurwoning in de gemeente is ongeveer 6 jaar.",
    "Spelcijfer: als de gemeente de grond zelf zou kopen en ontwikkelen (gemeentelijke grondexploitatie), verwacht het college een tekort van ongeveer 2,1 miljoen euro, maar dan kan de gemeente zelf meer bepalen.",
    "De ontwikkelaar heeft laten weten dat een hoger aandeel sociale huur dan 30% het plan financieel onhaalbaar maakt zonder bijdrage van de gemeente.",
    "Omwonenden in Opbroek maken zich zorgen over extra verkeer op de enige toegangsweg; een verkeersonderzoek is nog niet afgerond.",
    "In Holten zijn de afgelopen jaren nauwelijks nieuwe woningen gebouwd; jongeren uit Holten vertrekken naar elders.",
    "De gemeente heeft met de provincie en de regio Twente afspraken gemaakt over het aantal te bouwen woningen; De Veldkamp is daarin meegeteld.",
    "Binnen de wettelijke regels mag de gemeente een deel van nieuwe woningen met voorrang toewijzen aan mensen met een binding met de gemeente."
  ],
  "opties": [
    {"titel": "Instemmen zoals voorgesteld", "omschrijving": "Snel bouwen, geen financieel risico voor de gemeente, wel minder invloed op de woningmix."},
    {"titel": "Meer sociale huur (amendement naar 40%)", "omschrijving": "Meer betaalbare woningen, maar de ontwikkelaar vraagt dan een gemeentelijke bijdrage of haakt af; vertraging is waarschijnlijk."},
    {"titel": "Een deel van de woningen naar Holten", "omschrijving": "Woningen eerlijker verdelen over de kernen, maar in Holten is nog geen locatie klaar; dat kost naar verwachting twee jaar extra."},
    {"titel": "Eerst het verkeersonderzoek afwachten", "omschrijving": "Zorgen van omwonenden serieus nemen voordat de raad besluit, maar het hele plan schuift dan ongeveer een jaar op."}
  ],
  "fractie_hints": {
    "sgp": {"neiging": "voor", "aandachtspunt": "geen financieel risico voor de gemeente en woningen voor jonge gezinnen uit de eigen gemeenschap", "voorwaarde": "de voorrang voor inwoners met binding met de gemeente blijft overeind", "fallback_standpunt": "De SGP-fractie kan zich vinden in dit kader: er komen woningen voor jonge gezinnen zonder dat de gemeente financiële risico's loopt. Wel hecht de fractie aan voorrang voor inwoners met een binding met onze gemeente."},
    "cda": {"neiging": "voor", "aandachtspunt": "doorstroming van ouderen en starters, en leefbaarheid in beide kernen", "voorwaarde": "een duidelijke afspraak over levensloopbestendige woningen en een plan voor woningbouw in Holten", "fallback_standpunt": "Het CDA steunt de lijn van het college, omdat er snel gebouwd kan worden. De fractie wil wel weten wat dit plan betekent voor ouderen die kleiner willen wonen en wanneer Holten aan de beurt is."},
    "gb": {"neiging": "twijfel", "aandachtspunt": "verkeersveiligheid in Opbroek en de vraag waarom Holten opnieuw buiten de boot valt", "voorwaarde": "een toezegging van het college dat er verkeersmaatregelen zijn vóórdat de eerste woningen worden opgeleverd", "fallback_standpunt": "Gemeentebelang wil deze woningen graag, maar de toegangsweg in Opbroek is nu al druk. Zonder duidelijke afspraken over het verkeer vindt de fractie het lastig om in te stemmen."},
    "cu": {"neiging": "twijfel", "aandachtspunt": "voldoende betaalbare woningen gezien de lange wachttijd voor sociale huur", "voorwaarde": "een hoger aandeel sociale huur, of een harde afspraak met de woningcorporatie over de 30%", "fallback_standpunt": "De ChristenUnie is blij dat er gebouwd wordt, maar met een wachttijd van zes jaar is 30% sociale huur aan de krappe kant. De fractie wil weten hoe hard de afspraken met de ontwikkelaar zijn."},
    "fvd": {"neiging": "tegen", "aandachtspunt": "inspraak van omwonenden en het ontbreken van een afgerond verkeersonderzoek", "voorwaarde": "eerst het verkeersonderzoek afronden en omwonenden echt laten meepraten over de plannen", "fallback_standpunt": "FvD vindt het onverstandig om nu een besluit te nemen terwijl het verkeersonderzoek niet klaar is. Omwonenden hebben vragen gesteld die nog niet zijn beantwoord."},
    "vvd": {"neiging": "voor", "aandachtspunt": "snel bouwen zonder extra eisen en zonder geld van de gemeente", "voorwaarde": "geen extra eisen die de bouw vertragen of de gemeente geld kosten", "fallback_standpunt": "De VVD steunt dit voorstel: de grondeigenaar bouwt zelf, de gemeente loopt geen risico en er komt middenhuur bij. Extra eisen die de bouw vertragen ziet de fractie niet zitten."},
    "pro": {"neiging": "tegen", "aandachtspunt": "betaalbaarheid voor jongeren en mensen met een laag inkomen", "voorwaarde": "minimaal 40% sociale huur, desnoods met een gemeentelijke bijdrage", "fallback_standpunt": "PRO vindt 30% sociale huur te weinig bij een wachttijd van zes jaar. De fractie wil dat de gemeente durft te investeren in meer betaalbare woningen."}
  },
  "reflectievragen": [
    "Welke fractie heb je het meest proberen te overtuigen, en waarom juist die?",
    "Het college wilde snel bouwen zonder financieel risico. Welke invloed gaf de gemeente daarvoor op? Vind je dat een goede ruil?",
    "Een fractie die ergens over twijfelt, stemt toch voor of tegen: in de raad kun je je niet van stemming onthouden. Wat zegt dat over het werk van een raadslid?"
  ]
}$j$::jsonb)
on conflict (id) do update set titel = excluded.titel, actief = excluded.actief, inhoud = excluded.inhoud;

-- Config: leeg = code-defaults (netlify/functions/lib/sp-shared.mjs).
-- Wijzig hier modelnamen, prijzen of caps zonder nieuwe deploy, bijv.:
--   update sp_npc_config set data = data || '{"modellen":{"routine":"claude-haiku-5-5"}}' where id = 'default';
insert into public.sp_npc_config (id, data) values ('default', '{}'::jsonb)
on conflict (id) do nothing;
