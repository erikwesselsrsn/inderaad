-- ════════════════════════════════════════════════════════════════════
-- Raadsspel Singleplayer — lokale dossiers en bijgewerkte fractieprofielen
--
-- Drie dossiers, één per domein, gebaseerd op actuele ontwikkelingen in
-- Rijssen-Holten (input wethouder, 19-11-2026):
--   1. Ruimte:      Omgevingsplan De Banis (Rijssen), met De Liesen (Holten)
--                   en de spoorzones als context
--   2. Sociaal:     Armoederegeling verbreden naar 120% van het sociaal minimum
--   3. Financiën:   Wat doen we met het hoge weerstandsvermogen?
-- Echte plaats- en projectnamen; GEEN namen van personen.
-- Cijfers met "Spelcijfer" zijn afgerond of aangenomen voor het spel en
-- moeten nog inhoudelijk worden gecontroleerd.
-- Het conceptdossier "De Veldkamp" (fictief) wordt gedeactiveerd.
-- ════════════════════════════════════════════════════════════════════

-- ── Fractieprofielen: aangevuld met lokale standpunten ──
update public.sp_fracties set profiel = $j${
  "waarden": "Bijbelse normen als richtsnoer voor beleid, gezin en gemeenschap, zondagsrust, rentmeesterschap, financiële voorzichtigheid",
  "aandachtspunten": "degelijke gemeentefinanciën zonder onnodige risico's, woningen voor jonge gezinnen uit de eigen gemeenschap, ruimte voor kerken en verenigingen, tegen verdere zondagopenstelling",
  "toon": "rustig, zorgvuldig en principieel; formeel taalgebruik; weegt af voordat het oordeelt",
  "coalitie": "vormt de coalitie met CDA en Gemeentebelang en houdt zich aan het coalitieakkoord; vindt de ChristenUnie op principiële punten zoals de zondagsrust"
}$j$::jsonb where id = 'sgp';

update public.sp_fracties set profiel = $j${
  "waarden": "gespreide verantwoordelijkheid, gemeenschapszin, rentmeesterschap",
  "aandachtspunten": "leefbaarheid in zowel Rijssen als Holten, extra investeren in sport en sportaccommodaties, verenigingsleven, platteland en agrariërs, doorstroming voor starters en ouderen",
  "toon": "verbindend en pragmatisch; zoekt een compromis maar houdt een eigen lijn",
  "coalitie": "coalitiepartner van SGP en Gemeentebelang"
}$j$::jsonb where id = 'cda';

update public.sp_fracties set profiel = $j${
  "waarden": "lokaal belang boven landelijke partijlijnen, behoud van tradities en het eigen karakter van Rijssen en Holten, praktisch en niet-ideologisch",
  "aandachtspunten": "uitvoerbaarheid, verkeer en voorzieningen in de wijken, aandacht voor Holten naast Rijssen, wantrouwig tegenover 'stadse' prestigeplannen die niet bij de kernen passen",
  "toon": "nuchter en concreet; verwijst naar wat inwoners in hun straat merken",
  "coalitie": "coalitiepartner van SGP en CDA"
}$j$::jsonb where id = 'gb';

update public.sp_fracties set profiel = $j${
  "waarden": "christelijk-sociaal, zorg voor kwetsbare inwoners, zondagsrust, duurzaamheid",
  "aandachtspunten": "betaalbare woningen, armoedebestrijding en zorg, maatschappelijke voorzieningen zoals de aankoop en heropening van een aula voor de gemeenschap, klimaat en natuur",
  "toon": "betrokken en constructief kritisch; komt met concrete alternatieven",
  "coalitie": "oppositie; vindt de SGP op principiële punten zoals de zondagsrust"
}$j$::jsonb where id = 'cu';

update public.sp_fracties set profiel = $j${
  "waarden": "zeggenschap van de lokale gemeenschap, terughoudendheid met overheidsbemoeienis en landelijk opgelegde opgaven",
  "aandachtspunten": "inspraak van inwoners, lasten voor inwoners, wil de asielopvang op het vakantiepark beëindigen, tegen stikstofmaatregelen die boeren raken, zuinig met landbouwgrond",
  "toon": "direct en controlerend; stelt scherpe vragen aan het college, onderbouwt met wat inwoners aangeven",
  "coalitie": "oppositie"
}$j$::jsonb where id = 'fvd';

update public.sp_fracties set profiel = $j${
  "waarden": "vrijheid en eigen verantwoordelijkheid, ondernemerschap, een overheid die doet wat ze belooft",
  "aandachtspunten": "geen belastingverhoging en liever lastenverlichting, snelheid en minder regeldruk, financiële discipline, middenhuur",
  "toon": "zakelijk en cijfermatig; to the point",
  "coalitie": "oppositie"
}$j$::jsonb where id = 'vvd';

update public.sp_fracties set profiel = $j${
  "waarden": "gelijke kansen, sociale rechtvaardigheid, klimaat",
  "aandachtspunten": "armoederegelingen voor een bredere groep, betaalbaar wonen, duurzaamheid, kansen voor jongeren",
  "toon": "bevlogen maar onderbouwd; zoekt bondgenoten over partijgrenzen heen",
  "coalitie": "oppositie"
}$j$::jsonb where id = 'pro';

-- ── Oude conceptdossier uit ──
update public.sp_dossiers set actief = false where id = 'veldkamp-woningbouw';

-- ── Dossier 1: Ruimte ──
insert into public.sp_dossiers (id, titel, actief, inhoud) values
('banis-omgevingsplan', 'Omgevingsplan De Banis', true, $j${
  "titel": "Omgevingsplan De Banis",
  "domein": "Ruimte en wonen",
  "pitch": "Het is 2027. Aan de zuidwestrand van Rijssen moet de nieuwe woonwijk De Banis komen, en de raad moet het omgevingsplan vaststellen. In Holten wachten ze op De Liesen, en in de spoorzones van beide kernen wordt nagedacht over binnenstedelijk bouwen. Wie krijgt wat, en in welke volgorde?",
  "raadsvoorstel": "Het college vraagt de raad het omgevingsplan De Banis vast te stellen. Daarmee wordt woningbouw juridisch mogelijk volgens het stedenbouwkundig plan dat het college eerder heeft vastgesteld: een gemengde wijk met ongeveer 30% sociale huur, 30% middenhuur en betaalbare koop en 40% vrije sector.",
  "context": "De Banis is een nieuwe uitbreidingswijk (uitleglocatie) aan de zuidwestrand van Rijssen. De gemeente heeft er in 2022 een voorkeursrecht gevestigd: wie daar grond verkoopt, moet die eerst aan de gemeente aanbieden. De omgevingsvisie voor De Banis is samen met een klankbordgroep van inwoners gemaakt. Het college heeft het stedenbouwkundig plan vastgesteld; de raad besluit nu over het omgevingsplan, de regels die bepalen wat er gebouwd mag worden. In Holten wordt een stedenbouwkundig plan gemaakt voor het volgende woningbouwproject op De Liesen. In de spoorzones van Rijssen en Holten wordt gewerkt aan een ontwikkelstrategie om na De Banis en De Liesen binnen de bestaande kernen verder te kunnen bouwen.",
  "feiten": [
    "De Banis ligt aan de zuidwestrand van Rijssen; nu is het grotendeels agrarische grond.",
    "Spelcijfer: in De Banis komen in fases ongeveer 450 woningen, de eerste over ongeveer twee jaar.",
    "Spelcijfer: woningmix volgens het stedenbouwkundig plan: 30% sociale huur, 30% middenhuur en betaalbare koop, 40% vrije sector.",
    "Omdat de gemeente veel grond zelf verwerft, loopt zij ook financieel risico (grondexploitatie): bij tegenvallende verkoop of hogere kosten moet de gemeente bijspringen.",
    "Binnen de wettelijke regels mag de gemeente een deel van nieuwe woningen met voorrang toewijzen aan mensen met een binding met de gemeente.",
    "In Holten volgt De Liesen; het stedenbouwkundig plan daarvoor wordt nog gemaakt. Inwoners van Holten vragen zich af of zij niet opnieuw achteraan staan.",
    "Bouwen in de spoorzones (binnenstedelijk) spaart landbouwgrond, maar is ingewikkelder, duurder en duurt langer dan bouwen in een uitleglocatie.",
    "Agrarische bedrijven aan de rand van De Banis maken zich zorgen over hun toekomst en bedrijfsruimte."
  ],
  "opties": [
    {"titel": "Vaststellen zoals voorgesteld", "omschrijving": "Snel duidelijkheid en een start met bouwen; de woningmix ligt vast zoals het college voorstelt."},
    {"titel": "Amendement: meer betaalbare woningen", "omschrijving": "Een hoger aandeel sociale huur of betaalbare koop. Goed voor starters en woningzoekenden, maar het drukt de opbrengst van de grond: de gemeente loopt meer financieel risico."},
    {"titel": "Amendement: Holten niet laten wachten", "omschrijving": "Vastleggen dat De Liesen direct volgt, of het bouwtempo in De Banis koppelen aan Holten. Eerlijker voor de kernen, maar dat kan De Banis vertragen."},
    {"titel": "Amendement: voorrang en voorzieningen", "omschrijving": "Meer woningen met voorrang voor inwoners met binding, of ruimte reserveren voor een school, kerk of sportvoorziening. Versterkt de gemeenschap, maar maakt het plan minder flexibel."}
  ],
  "fractie_hints": {
    "sgp": {"neiging": "voor", "aandachtspunt": "woningen voor jonge gezinnen uit de eigen gemeenschap, ruimte voor maatschappelijke voorzieningen en een beheersbaar grondexploitatierisico", "voorwaarde": "voorrang voor inwoners met binding met de gemeente en geen onverantwoord financieel risico", "fallback_standpunt": "De SGP-fractie is blij dat er eindelijk ruimte komt voor gezinnen uit eigen kring. Wel let de fractie scherp op het financiële risico van de grondexploitatie en op voorrang voor inwoners met binding met onze gemeente."},
    "cda": {"neiging": "voor", "aandachtspunt": "doorstroming van ouderen en starters, en dat Holten met De Liesen niet achteraan komt", "voorwaarde": "een duidelijke afspraak dat De Liesen in Holten direct volgt", "fallback_standpunt": "Het CDA steunt het omgevingsplan, want er is grote behoefte aan woningen. De fractie wil wel zekerheid dat Holten met De Liesen niet opnieuw moet wachten."},
    "gb": {"neiging": "twijfel", "aandachtspunt": "verkeer aan de zuidwestkant van Rijssen, en geen 'stadse' hoogbouw die niet bij Rijssen past", "voorwaarde": "beperkte bouwhoogte passend bij Rijssen en goede verkeersafwikkeling vóór de eerste oplevering", "fallback_standpunt": "Gemeentebelang wil deze woningen, maar Rijssen moet Rijssen blijven. De fractie wil geen hoge flats aan de rand van de stad en wil weten hoe het verkeer wordt afgewikkeld."},
    "cu": {"neiging": "twijfel", "aandachtspunt": "betaalbaarheid, een groene en natuurinclusieve wijk, en woningen voor kwetsbare groepen", "voorwaarde": "een hoger aandeel betaalbare woningen of harde afspraken met de woningcorporatie", "fallback_standpunt": "De ChristenUnie ziet de noodzaak van De Banis, maar vraagt zich af of 30% sociale huur genoeg is. De fractie wil ook een groene wijk waar plek is voor kwetsbare inwoners."},
    "fvd": {"neiging": "tegen", "aandachtspunt": "verlies van landbouwgrond, de positie van de boeren aan de rand en de inspraak van omwonenden", "voorwaarde": "eerst binnenstedelijk bouwen in de spoorzones en een goede regeling voor de agrariërs", "fallback_standpunt": "FvD vindt het zonde om goede landbouwgrond vol te bouwen terwijl er in de spoorzones ruimte is. De boeren aan de rand van De Banis verdienen eerst duidelijkheid."},
    "vvd": {"neiging": "voor", "aandachtspunt": "snel bouwen, middenhuur, en geen extra eisen die de bouw vertragen", "voorwaarde": "geen extra eisen die het plan vertragen of de grondexploitatie verslechteren", "fallback_standpunt": "De VVD wil dat er zo snel mogelijk gebouwd wordt, met voldoende middenhuur. Elke extra eis kost tijd en geld, dus de fractie is kritisch op aanvullende wensen."},
    "pro": {"neiging": "tegen", "aandachtspunt": "betaalbaarheid voor jongeren en mensen met een laag inkomen", "voorwaarde": "minimaal 40% sociale huur", "fallback_standpunt": "PRO vindt 30% sociale huur te weinig nu jongeren jarenlang op een woning wachten. De fractie wil dat de gemeente haar eigen grond gebruikt om meer betaalbare woningen af te dwingen."}
  },
  "reflectievragen": [
    "Waarom moet de raad kiezen tussen snel bouwen in De Banis en eerlijk verdelen tussen Rijssen en Holten? Is het een echte tegenstelling?",
    "De gemeente heeft de grond zelf in handen. Wat levert dat op, en welk risico loopt de gemeente daardoor?",
    "Welk amendement heb je ingediend of gesteund, en wat moest je daarvoor opgeven om een meerderheid te krijgen?"
  ]
}$j$::jsonb)
on conflict (id) do update set titel = excluded.titel, actief = excluded.actief, inhoud = excluded.inhoud;

-- ── Dossier 2: Sociaal domein ──
insert into public.sp_dossiers (id, titel, actief, inhoud) values
('armoederegeling-120', 'Armoederegeling naar 120%', true, $j${
  "titel": "Armoederegeling naar 120%",
  "domein": "Sociaal domein",
  "pitch": "Steeds meer huishoudens in Rijssen-Holten komen net niet rond, ook als ze werken. Het college wil de armoederegelingen openstellen tot 120% van het sociaal minimum. Maar is een bredere regeling de beste hulp, wie betaalt het, en wat is de rol van kerken en vrijwilligers?",
  "raadsvoorstel": "Het college vraagt de raad de Verordening bijdrageregelingen minimabeleid te wijzigen: de inkomensgrens voor de bijdrageregelingen (onder meer voor sport, cultuur, schoolkosten en de collectieve zorgverzekering) gaat omhoog naar 120% van het wettelijk sociaal minimum.",
  "context": "Het sociaal minimum is ongeveer het bedrag van een bijstandsuitkering. Met minimaregelingen helpt de gemeente huishoudens met een laag inkomen, bijvoorbeeld met een bijdrage voor sportclub, schoolreis of zorgverzekering. Nu ligt de grens voor een deel van die regelingen lager dan 120%. Huishoudens net boven de grens vallen buiten alle hulp, terwijl zij soms minder overhouden dan huishoudens eronder: de 'armoedeval'. In Rijssen-Holten helpen ook kerken, diaconieën en vrijwilligersorganisaties veel mensen, vaak zonder dat de gemeente het ziet. Voor sommige regelingen, zoals de energietoeslag, gebruikte de gemeente eerder al een grens van 120%.",
  "feiten": [
    "Spelcijfer: de huidige inkomensgrens voor de bijdrageregelingen is 110% van het sociaal minimum.",
    "Spelcijfer: door de verhoging naar 120% komen ongeveer 400 extra huishoudens in aanmerking.",
    "Spelcijfer: de extra kosten zijn ongeveer € 350.000 per jaar, structureel (dus elk jaar opnieuw).",
    "Niet iedereen die recht heeft op een regeling, vraagt die ook aan. Vooral werkende huishoudens en ouderen weten vaak niet dat ze in aanmerking komen.",
    "Gezinnen met kinderen komen volgens onderzoek het vaakst niet rond met een inkomen rond het sociaal minimum.",
    "Kerken en diaconieën in Rijssen en Holten bieden veel hulp, maar zien ook dat sommige mensen zich schamen om aan te kloppen.",
    "De gemeente heeft een sterke financiële positie met grote reserves, maar structurele uitgaven moeten structureel worden gedekt in de begroting."
  ],
  "opties": [
    {"titel": "Instemmen: grens naar 120%", "omschrijving": "Meer huishoudens krijgen hulp en de armoedeval wordt kleiner. Kost elk jaar geld, en de grens schuift alleen op: net boven 120% blijft het knellen."},
    {"titel": "Amendement: nog breder, naar 130%", "omschrijving": "Nog meer werkende huishoudens bereiken. Duurder, en de vraag is of de gemeente hiermee taken van het Rijk overneemt."},
    {"titel": "Amendement: maatwerk in plaats van een hogere grens", "omschrijving": "Geen hogere grens, maar meer ruimte voor bijzondere bijstand per huishouden, samen met kerken en vrijwilligers. Gerichter, maar afhankelijk van wie aanklopt."},
    {"titel": "Amendement: tijdelijk en met evaluatie", "omschrijving": "De verhoging voor twee jaar betalen uit de reserves en daarna evalueren of de hulp terechtkomt waar die nodig is. Voorzichtig, maar onzeker voor de mensen die het betreft."}
  ],
  "fractie_hints": {
    "sgp": {"neiging": "twijfel", "aandachtspunt": "structurele kosten, de eigen verantwoordelijkheid van inwoners en de rol van kerken en diaconieën", "voorwaarde": "structurele dekking zonder belastingverhoging en samenwerking met diaconieën", "fallback_standpunt": "De SGP-fractie heeft oog voor mensen die het moeilijk hebben, maar vraagt zich af of een hogere grens de beste hulp is. De fractie wil weten hoe dit structureel wordt betaald en hoe kerken en diaconieën worden betrokken."},
    "cda": {"neiging": "voor", "aandachtspunt": "gezinnen met kinderen en mee kunnen doen aan sport en verenigingsleven", "voorwaarde": "aandacht voor het bereik: de hulp moet ook echt aankomen bij werkende gezinnen", "fallback_standpunt": "Het CDA steunt dit voorstel, omdat elk kind moet kunnen sporten en meedoen. De fractie wil wel weten hoe de gemeente de mensen bereikt die er nu geen gebruik van maken."},
    "gb": {"neiging": "voor", "aandachtspunt": "praktische hulp voor inwoners in beide kernen en weinig bureaucratie", "voorwaarde": "een eenvoudige aanvraag zonder ingewikkelde formulieren", "fallback_standpunt": "Gemeentebelang steunt dit: het gaat om onze eigen inwoners. De fractie wil wel dat de aanvraag eenvoudig is, anders bereik je de mensen niet."},
    "cu": {"neiging": "voor", "aandachtspunt": "kwetsbare huishoudens, schulden voorkomen en samenwerking met kerken en vrijwilligers", "voorwaarde": "samenwerking met diaconieën en vrijwilligers bij het bereiken van de doelgroep", "fallback_standpunt": "De ChristenUnie is blij met dit voorstel. Armoede raakt vooral kinderen, en de fractie wil dat de gemeente samen met kerken en vrijwilligers ervoor zorgt dat de hulp aankomt."},
    "fvd": {"neiging": "twijfel", "aandachtspunt": "hulp aan eigen inwoners, maar zonder hogere lasten voor andere inwoners", "voorwaarde": "geen lastenverzwaring en eerst besparen op andere uitgaven", "fallback_standpunt": "FvD vindt dat de gemeente er moet zijn voor haar eigen inwoners. Maar de fractie wil geen hogere lasten voor andere inwoners en vraagt waar het college op bespaart."},
    "vvd": {"neiging": "twijfel", "aandachtspunt": "structurele uitgaven, prikkels om te werken en geen belastingverhoging", "voorwaarde": "geen belastingverhoging en geen nieuwe armoedeval voor mensen die meer gaan werken", "fallback_standpunt": "De VVD wil dat werken loont. De fractie vreest dat een hogere grens alleen de armoedeval verschuift en wil geen belastingverhoging om dit te betalen."},
    "pro": {"neiging": "voor", "aandachtspunt": "zoveel mogelijk huishoudens bereiken, ook werkenden", "voorwaarde": "de grens naar 130% en actief benaderen van de doelgroep", "fallback_standpunt": "PRO steunt dit voorstel, maar vindt het niet ver genoeg gaan. Juist werkende gezinnen net boven de grens vallen nu nog buiten de boot."}
  },
  "reflectievragen": [
    "Waarom is een inkomensgrens altijd ergens oneerlijk, waar je hem ook legt?",
    "Wie moet mensen met weinig geld helpen: de gemeente, de kerk, de familie of de mensen zelf? Hoe zag je dat terug bij de fracties?",
    "Een regeling die niet wordt aangevraagd, helpt niemand. Wat zou jij doen om de mensen te bereiken?"
  ]
}$j$::jsonb)
on conflict (id) do update set titel = excluded.titel, actief = excluded.actief, inhoud = excluded.inhoud;

-- ── Dossier 3: Algemene zaken / financiën ──
insert into public.sp_dossiers (id, titel, actief, inhoud) values
('reserves-investeren', 'Geld op de plank of investeren?', true, $j${
  "titel": "Geld op de plank of investeren?",
  "domein": "Financiën",
  "pitch": "Rijssen-Holten heeft veel meer geld in reserve dan nodig is om risico's op te vangen. Het college wil een deel investeren in de samenleving. Maar waarin? Sportparken, een aula, armoedebestrijding, lagere belastingen, of toch liever een buffer voor onzekere tijden?",
  "raadsvoorstel": "Het college stelt voor om € 12 miljoen uit de algemene reserve vrij te maken voor een 'Investeringsfonds Samenleving'. Daaruit worden eenmalige investeringen betaald in sportaccommodaties, maatschappelijk vastgoed en verduurzaming van gemeentelijke gebouwen. Het weerstandsvermogen blijft daarna ruim boven de norm.",
  "context": "Het weerstandsvermogen is het geld dat de gemeente achter de hand heeft om tegenvallers en risico's op te vangen. Dat wordt uitgedrukt als een ratio: het beschikbare geld gedeeld door de berekende risico's. Volgens de eigen regels van de gemeente is een ratio boven 1,4 meer dan nodig; het deel daarboven mag worden ingezet voor andere doelen. Rijssen-Holten zit op een ratio van 2,43. Sommigen noemen dat 'dood geld' dat de samenleving tekortdoet; anderen zien het als verstandige spaarzin, omdat de bijdrage van het Rijk aan gemeenten de komende jaren onzeker is. Eenmalig geld kan alleen eenmalige uitgaven betalen: een nieuw gebouw wel, maar de jaarlijkse kosten van onderhoud of personeel moeten uit de gewone begroting komen.",
  "feiten": [
    "De ratio weerstandsvermogen is 2,43. Volgens de gemeentelijke regels is een ratio boven 1,4 meer dan nodig.",
    "Spelcijfer: de berekende risico's zijn ongeveer € 20 miljoen; het beschikbare weerstandsvermogen ongeveer € 49 miljoen.",
    "Spelcijfer: met € 12 miljoen voor het fonds daalt de ratio naar ongeveer 1,8.",
    "In Holten lopen fusiegesprekken tussen de twee voetbalverenigingen vast. Daardoor hebben ook andere sportclubs geen ruimte om op de sportparken uit te breiden.",
    "Er is in de gemeenschap behoefte aan een aula voor uitvaarten; een pand dat daarvoor geschikt is, zou door de gemeente kunnen worden aangekocht en weer in gebruik genomen.",
    "Spelcijfer: een eenmalige verlaging van de OZB voor alle huishoudens met in totaal € 12 miljoen zou neerkomen op ongeveer € 750 per huishouden.",
    "Eenmalige investeringen leiden vaak tot jaarlijkse kosten voor beheer en onderhoud, die structureel in de begroting moeten passen."
  ],
  "opties": [
    {"titel": "Instemmen met het fonds", "omschrijving": "€ 12 miljoen investeren in sport, maatschappelijk vastgoed en verduurzaming. De samenleving profiteert direct, de buffer blijft ruim boven de norm."},
    {"titel": "Amendement: geld terug naar de inwoners", "omschrijving": "Een deel van het geld gebruiken voor lagere lokale lasten. Iedereen merkt het in de portemonnee, maar het is eenmalig en verdwijnt daarna."},
    {"titel": "Amendement: andere bestemming", "omschrijving": "Een deel van het fonds oormerken voor één doel, zoals de sportparken in Holten, de aankoop van een aula of armoedebestrijding. Concreter, maar dan blijft er minder over voor de rest."},
    {"titel": "Amendement: kleiner fonds", "omschrijving": "Minder geld vrijmaken, bijvoorbeeld € 6 miljoen, en de rest als buffer houden voor onzekere rijksfinanciën. Voorzichtig, maar het 'dode geld' blijft grotendeels liggen."}
  ],
  "fractie_hints": {
    "sgp": {"neiging": "twijfel", "aandachtspunt": "financiële voorzichtigheid, alleen eenmalige uitgaven zonder grote structurele lasten, en een ruime buffer voor onzekere rijksfinanciën", "voorwaarde": "de ratio blijft ruim boven 1,4 en er komen geen nieuwe structurele lasten zonder dekking", "fallback_standpunt": "De SGP-fractie begrijpt de wens om te investeren, maar spaarzin is een deugd. De fractie wil zeker weten dat er geen jaarlijkse lasten bijkomen die we later niet kunnen dragen."},
    "cda": {"neiging": "voor", "aandachtspunt": "investeren in sport en sportaccommodaties, ook in Holten", "voorwaarde": "een duidelijk deel van het fonds voor sport, met een oplossing voor de sportparken in Holten", "fallback_standpunt": "Het CDA vindt dat geld dat op de plank ligt de samenleving niet helpt. De fractie wil dat een flink deel naar sport gaat, juist nu sportclubs in Holten vastzitten."},
    "gb": {"neiging": "twijfel", "aandachtspunt": "geld voor verenigingen en tradities in de kernen, geen prestigeprojecten", "voorwaarde": "het geld gaat naar bestaande verenigingen en voorzieningen in de kernen, niet naar 'stadse' prestigeprojecten", "fallback_standpunt": "Gemeentebelang is niet tegen investeren, maar wel tegen prestigeprojecten. De fractie wil dat het geld terechtkomt bij de verenigingen en voorzieningen die Rijssen en Holten nu al dragen."},
    "cu": {"neiging": "twijfel", "aandachtspunt": "maatschappelijke voorzieningen, zoals een aula voor de gemeenschap, en zorg voor kwetsbare inwoners", "voorwaarde": "de aankoop en heropening van een aula voor de gemeenschap wordt uit het fonds betaald", "fallback_standpunt": "De ChristenUnie ziet kansen in dit fonds, maar mist een duidelijke keuze voor wat de gemeenschap nodig heeft. Een aula voor afscheid nemen hoort daar wat de fractie betreft bij."},
    "fvd": {"neiging": "tegen", "aandachtspunt": "geld terug naar de inwoners en geen nieuwe projecten van de overheid", "voorwaarde": "een flink deel van het geld gaat terug naar inwoners via lagere lasten", "fallback_standpunt": "FvD vindt dat dit geld van de inwoners is. In plaats van een fonds van het college wil de fractie dat inwoners het terugzien in lagere lokale lasten."},
    "vvd": {"neiging": "tegen", "aandachtspunt": "lagere lokale lasten en financiële discipline", "voorwaarde": "een deel van het geld wordt gebruikt voor lastenverlichting", "fallback_standpunt": "De VVD vindt dat een overheid die te veel spaart, eerst de lasten moet verlagen. De fractie wil een deel van het geld teruggeven aan inwoners en ondernemers."},
    "pro": {"neiging": "twijfel", "aandachtspunt": "armoedebestrijding en kansen voor jongeren", "voorwaarde": "een deel van het fonds gaat naar armoedebestrijding", "fallback_standpunt": "PRO vindt het goed dat het geld wordt ingezet, maar mist armoedebestrijding in het fonds. Juist met zulke reserves kan de gemeente meer doen voor inwoners die niet rondkomen."}
  },
  "reflectievragen": [
    "Is geld in reserve 'dood geld' of verstandige spaarzin? Welke argumenten vond jij het sterkst?",
    "Waarom mag een gemeente eenmalig geld niet zomaar gebruiken voor uitgaven die elk jaar terugkomen?",
    "Elke fractie wilde het geld aan iets anders besteden. Hoe heb je geprobeerd een meerderheid te vinden?"
  ]
}$j$::jsonb)
on conflict (id) do update set titel = excluded.titel, actief = excluded.actief, inhoud = excluded.inhoud;
