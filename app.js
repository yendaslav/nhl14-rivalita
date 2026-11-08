/* =========================================================
   NHL 14 RIVALITA — logika aplikace
   Bez frameworků, bez backendu. Data: localStorage (+ IndexedDB pro videa).

   Princip: XP, levely, statistiky i achievementy se VŽDY přepočítávají
   z historie (zápasy + úpravy XP), takže úprava nebo smazání zápasu
   je vždy konzistentní. Jednorázové události (tresty, pokladna,
   challenge) se vytvářejí jen při zápisu NOVÉHO zápasu.
   ========================================================= */
'use strict';

/* =========================================================
   1) KONFIGURACE
   ========================================================= */
const STORAGE_KEY = 'nhl14-rivalita-v2';
const MAX_LEVEL = 20;                 // po dosažení levelu 20 → prestiž (reset XP + hvězdička)

/** Herní módy: XP za výhru / prohru (účast). */
const MODES = {
  SO:  { label: 'Nájezdy', win: 10, loss: 3 },
  '5': { label: '5 min',   win: 20, loss: 5 },
  '10':{ label: '10 min',  win: 35, loss: 8 },
  '20':{ label: '20 min',  win: 50, loss: 12 },
};
const MODE_ORDER = ['SO', '5', '10', '20'];
const OT_FACTOR = 0.8;                              // výhra v prodloužení = 80 % XP
const BONUS = { shutout: 10, blowout: 10, comeback: 15 };

/** Skill shoty a bonusové XP za každý gól daného typu. */
const SKILLS = [
  { k: 'bh',   label: 'Bekhend',             xp: 5  },
  { k: 'spin', label: 'Spin-o-rama',         xp: 10 },
  { k: 'lax',  label: 'Lacrosse / Michigan', xp: 15 },
  { k: 'legs', label: 'Mezi nohama',         xp: 8  },
  { k: 'one',  label: 'Z první (one-timer)', xp: 6  },
  { k: 'full', label: 'Přes celé hřiště',    xp: 12 },
  // Bonus mimo skill shoty (nepočítá se do „skill shotů celkem“ ani do jejich odznaků)
  { k: 'def',  label: 'Gól obránce',         xp: 5, extra: true },
];

/** Události v zápase: mínusy za fauly a góly v oslabení/přesilovce, plus za bitku (XP za každý kus). */
const EVENTS = [
  { k: 'foul',  label: 'Vyloučení (faul)',          xp: -3 },
  { k: 'pkga',  label: 'Dostal gól, když byl v oslabení', xp: -2 },
  { k: 'shga',  label: 'Dostal gól, když měl přesilovku', xp: -5 },
  { k: 'fight', label: 'Vyhraná bitka',             xp: 5 },
];

/** Mini výzvy během hry: nepovinné drobnosti za pár XP. */
const MINI = [
  { k: 'm_fouled',  label: 'Sfauloval tě a stejně dáš gól', xp: 8 },
  { k: 'm_shg',     label: 'Gól v oslabení',                xp: 10 },
  { k: 'm_faceoff', label: 'Gól do 10 s po buly',           xp: 8 },
  { k: 'm_last',    label: 'Gól v posledních 30 s třetiny', xp: 8 },
  { k: 'm_tie',     label: 'Vyrovnání v poslední minutě',   xp: 12 },
  { k: 'm_quick',   label: 'Dva góly do 30 sekund',         xp: 10 },
  { k: 'm_hitgoal', label: 'Hit a z té akce gól',           xp: 8 },
  { k: 'm_post',    label: 'Tyčka a gól ve stejném útoku',  xp: 6 },
  { k: 'm_boards',  label: 'Gól odrazem od mantinelu',      xp: 10 },
  { k: 'm_hat',     label: 'Hattrick jednoho hráče',        xp: 12 },
  { k: 'm_gassist', label: 'Asistence brankáře',            xp: 15 },
  { k: 'm_ps',      label: 'Proměněné trestné střílení',    xp: 10 },
  { k: 'm_pk53',    label: 'Ubráněné oslabení 3 na 5',      xp: 10 },
  { k: 'm_save',    label: 'Brankář chytil samostatný únik', xp: 5 },
  { k: 'm_top',     label: 'Gól pod břevno (víko)',          xp: 4 },
  { k: 'm_rebound', label: 'Gól z dorážky',                 xp: 4 },
  { k: 'm_celebr',  label: 'Oslava gólu, u které se soupeř zasmál', xp: 3 },
];
const COUNTERS = [...SKILLS, ...EVENTS, ...MINI];
const fmtXp = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n) + ' XP';

const DIFF = { easy: 'Lehká', mid: 'Střední', hard: 'Těžká' };
const CATS = { auto: 'Automatické', random: 'Náhodné', team: 'Týmové', duel: 'Duely' };

/**
 * Týmy z NHL 14 (sezóna 2013/14, nové rozdělení do 4 divizí) + reprezentace.
 * [zkratka, název, hlavní barva, vedlejší barva] — barvy slouží jen pro odznak se zkratkou.
 */
const TEAM_GROUPS = [
  { id: 'met', label: 'Metropolitní divize', teams: [
    ['CAR', 'Carolina Hurricanes', '#CC0000', '#111111'], ['CBJ', 'Columbus Blue Jackets', '#002654', '#CE1126'],
    ['NJD', 'New Jersey Devils', '#CE1126', '#111111'], ['NYI', 'New York Islanders', '#00539B', '#F47D30'],
    ['NYR', 'New York Rangers', '#0038A8', '#CE1126'], ['PHI', 'Philadelphia Flyers', '#F74902', '#111111'],
    ['PIT', 'Pittsburgh Penguins', '#111111', '#FCB514'], ['WSH', 'Washington Capitals', '#041E42', '#C8102E'] ] },
  { id: 'atl', label: 'Atlantická divize', teams: [
    ['BOS', 'Boston Bruins', '#111111', '#FFB81C'], ['BUF', 'Buffalo Sabres', '#002654', '#FCB514'],
    ['DET', 'Detroit Red Wings', '#CE1126', '#8B0B1A'], ['FLA', 'Florida Panthers', '#041E42', '#C8102E'],
    ['MTL', 'Montreal Canadiens', '#AF1E2D', '#192168'], ['OTT', 'Ottawa Senators', '#111111', '#C52032'],
    ['TBL', 'Tampa Bay Lightning', '#002868', '#4A72B8'], ['TOR', 'Toronto Maple Leafs', '#00205B', '#3A5DAE'] ] },
  { id: 'cen', label: 'Centrální divize', teams: [
    ['CHI', 'Chicago Blackhawks', '#CF0A2C', '#111111'], ['COL', 'Colorado Avalanche', '#6F263D', '#236192'],
    ['DAL', 'Dallas Stars', '#006847', '#111111'], ['MIN', 'Minnesota Wild', '#154734', '#A6192E'],
    ['NSH', 'Nashville Predators', '#FFB81C', '#041E42'], ['STL', 'St. Louis Blues', '#002F87', '#FCB514'],
    ['WPG', 'Winnipeg Jets', '#041E42', '#004C97'] ] },
  { id: 'pac', label: 'Pacifická divize', teams: [
    ['ANA', 'Anaheim Ducks', '#F47A38', '#111111'], ['CGY', 'Calgary Flames', '#C8102E', '#F1BE48'],
    ['EDM', 'Edmonton Oilers', '#041E42', '#FF4C00'], ['LAK', 'Los Angeles Kings', '#111111', '#A2AAAD'],
    ['PHX', 'Phoenix Coyotes', '#8C2633', '#E2D6B5'], ['SJS', 'San Jose Sharks', '#006D75', '#111111'],
    ['VAN', 'Vancouver Canucks', '#00205B', '#00843D'] ] },
  { id: 'int', label: 'Reprezentace', teams: [
    ['CZE', 'Česko', '#D7141A', '#11457E'], ['SVK', 'Slovensko', '#0B4EA2', '#EE1C25'],
    ['CAN', 'Kanada', '#D80621', '#8E0414'], ['USA', 'USA', '#0A3161', '#B31942'],
    ['SWE', 'Švédsko', '#006AA7', '#FECC00'], ['FIN', 'Finsko', '#002F6C', '#5B7DB1'],
    ['RUS', 'Rusko', '#D52B1E', '#0039A6'], ['GER', 'Německo', '#111111', '#DD0000'],
    ['SUI', 'Švýcarsko', '#D52B1E', '#8E1B13'], ['NOR', 'Norsko', '#BA0C2F', '#00205B'],
    ['DEN', 'Dánsko', '#C8102E', '#7E0A1D'], ['LAT', 'Lotyšsko', '#9E3039', '#5E1C22'] ] },
];
const TEAM_LIST = TEAM_GROUPS.flatMap(g => g.teams.map(([abbr, name, c1, c2]) => ({ abbr, name, c1, c2, group: g.id })));
const TEAMS = TEAM_LIST.map(t => t.name);
const teamByName = n => TEAM_LIST.find(t => t.name === n);

/** Výchozí nastavení odměn a trestů (vše editovatelné v Nastavení). */
const DEFAULT_SETTINGS = {
  leadRules: [
    { lead: 3,  text: 'nosí vítězi pití celý večer' },
    { lead: 5,  text: 'kupuje popcorn a pití na další session' },
    { lead: 10, text: 'platí večeři' },
  ],
  money: { month: 200, blowout: 50, streak10: 300 },
  rewards: [
    'Poražený mu udělá kafe nebo donese pití',
    'Vybírá film nebo seriál na večer',
    'Vybírá jídlo na příští session',
    'Poražený mu 2 minuty masíruje ramena',
    'Celý večer mu poražený říká „šampione“',
    'Vybírá si tým jako první celý příští týden',
    'Dostane lepší ovladač a lepší místo na gauči',
    'Poražený za něj vyklidí myčku',
    'Vybírá hudbu na celý večer',
    'Poražený mu napíše ódu na jeho hokej a přečte ji nahlas',
    'Poražený mu nosí svačinu jako osobní sluha',
    'Má u soupeře jedno přání (rozumné)',
    'Smí soupeři vybrat kameru na příští zápas',
    'Poražený mu dá lajk na 5 posledních fotek na IG',
    'Pózuje s „trofejí“ (cokoliv po ruce) na společnou fotku',
  ],
  punishments: [
    'Hraje příští zápas s jinou kamerou / nastavením ovládání',
    'Pochválí vítěze na Instagram story',
    'Uklízí po session',
    'Nosí „dres hanby“ do příští výhry',
    'Vítěz mu vybere profilovku na týden',
    'Vaří příští jídlo',
    'Zpívá hymnu vítězova týmu',
    'Přinese pití a svačinu na příští session',
    'Vítěz vybírá hudbu na celý večer',
    '24 h oslovuje vítěze „pane kapitáne“',
    'Píše vítězi SMS s omluvou za špatný hokej',
    'Hraje příští zápas bez body checku',
    'Nosí vítězi ovladač a pití jako sluha',
    'Vybírá si tým jako druhý celý příští týden',
    'Natočí krátké video, kde uznává porážku (Síň hanby)',
  ],
};

/**
 * Výchozí katalog challengí.
 * fail = co se stane při nesplnění: { xp: ztráta XP, money: Kč do pokladny, penalty: trest z kola }
 * trigger = jen u automatických (kdy se challenge sama vyhlásí)
 * action  = speciální chování po přijetí (losování týmů apod.)
 */
const C = (cat, name, text, diff, xp, fail = {}, extra = {}) => ({ cat, name, text, diff, xp, fail: { xp: 0, money: 0, penalty: false, ...fail }, ...extra });
const DEFAULT_CATALOG = [
  // 1) Automatické podle situace
  C('auto', 'Odvolej brankáře', 'Outsider musí v poslední minutě odvolat brankáře.', 'mid', 40, { xp: 10 }, { trigger: 'lose3', tip: '3 prohry v řadě' }),
  C('auto', 'Výběr outsidera', 'Outsider si vybere tým, favorit hraje s nejslabším týmem ligy. Vyhraj!', 'mid', 35, {}, { trigger: 'lose5', tip: '5 proher v řadě' }),
  C('auto', 'Bez body checku', 'Po 4 výhrách v řadě hraješ příští zápas bez body checku.', 'mid', 30, { xp: 15 }, { trigger: 'win4', tip: 'série 4 výher' }),
  C('auto', 'Jen bekhendem', 'Když vedeš o 3+ góly, další gól musíš dát bekhendem.', 'mid', 25, {}, { trigger: 'live', tip: 'během zápasu' }),
  C('auto', 'Last Dance', 'Prohráváš o 1 gól 2 minuty před koncem → musíš hned odvolat brankáře.', 'hard', 40, {}, { trigger: 'live', tip: 'během zápasu' }),
  // 2) Náhodné před zápasem
  C('random', 'Sniper', 'Platí jen góly z první (one-timer), ostatní se nepočítají.', 'hard', 50, { xp: 15 }),
  C('random', 'Pouze bekhend', 'Každý gól musí být bekhendem.', 'hard', 45, { xp: 15 }),
  C('random', 'Točka', 'Dej gól z otočky (spin-o-rama).', 'mid', 30, { xp: 10 }),
  C('random', 'Gentleman', 'Vyhraj bez jediného vyloučení.', 'mid', 25, { xp: 10 }),
  C('random', 'Bleskovka', 'Dej gól do 30 sekund od začátku.', 'mid', 30, { xp: 10 }),
  C('random', 'Nájezdový artista', 'Vyhraj nájezdy aspoň se 2 skill moves.', 'mid', 30),
  C('random', 'Jedna lajna', 'Hraj celý zápas jen jednou lajnou.', 'mid', 25),
  C('random', 'Bez střídání', 'Kdo prohrává po 1. třetině, střídá jen při přerušení.', 'mid', 25),
  C('random', 'Zeď', 'Vyhraj s úspěšností brankáře nad 95 %.', 'hard', 45),
  C('random', 'Rodeo', '3 hity za třetinu, jinak mínus XP.', 'mid', 30, { xp: 20 }),
  C('random', 'Samurajský kodex', 'Žádná střela zpoza modré čáry.', 'mid', 30, { xp: 10 }),
  C('random', 'Kapitán', 'Všechny góly dá jeden hráč.', 'hard', 40),
  C('random', 'Obránce útočí', 'Všechny góly musí dát obránci.', 'hard', 45),
  C('random', 'Hráč zápasu', 'Gól, asistence a bitka v jednom zápase.', 'mid', 35),
  C('random', 'Fighter', 'Vyhraj bitku a do 2 minut dej gól.', 'mid', 35),
  C('random', 'Rychlík', 'Vyhraj 5minutovku o 3+ góly.', 'mid', 30),
  C('random', 'Penaltový král', 'Proměň 3 nájezdy v řadě.', 'hard', 40),
  C('random', 'Oslabení', 'Dej gól v oslabení.', 'mid', 35),
  C('random', 'Bez přesilovky', 'Soupeř ti v přesilovce nedá gól.', 'easy', 20),
  C('random', 'Pomalý start', 'První třetinu nestřílíš, pak vyhraj.', 'hard', 45, { xp: 15 }),
  C('random', 'Poslední vteřina', 'Dej gól v posledních 10 sekundách.', 'hard', 50),
  C('random', 'Přesná rána', 'Tyčka a gól ve stejném střídání.', 'hard', 40),
  C('random', 'Mlýnek', '3 různé skill shoty v jednom zápase.', 'hard', 45),
  C('random', 'Brankář hrdina', 'Soupeř má 30+ střel a ty stejně vyhraješ.', 'mid', 35),
  C('random', 'Kamikaze', 'Odvolej brankáře už při stavu −2.', 'mid', 30),
  C('random', 'Slepý brankář', 'Hraj s jinou kamerou než obvykle.', 'easy', 15),
  C('random', 'Ticho', 'Celý zápas se nemluví. Kdo promluví, dostane trest.', 'easy', 20, { penalty: true }),
  C('random', 'Prohozené ovladače', 'Hrajete s prohozenými ovladači.', 'easy', 20),
  // 3) Týmové
  C('team', 'Zrcadlo', 'Oba hrají s týmem soupeře z minulého zápasu.', 'mid', 30, {}, { action: 'mirror' }),
  C('team', 'Underdog', 'Favorit hraje s nejhorším týmem, outsider s nejlepším.', 'hard', 50),
  C('team', 'Blind draft', 'Týmy vylosuje aplikace.', 'mid', 25, {}, { action: 'draft' }),
  C('team', 'Dvojí agent', 'Hraješ za tým, který ti vylosuje soupeř.', 'mid', 30, {}, { action: 'draft' }),
  C('team', 'Retro', 'Oba hrají s klasickými týmy.', 'easy', 20),
  C('team', 'Revenge', 'Po prohře musíš vyhrát odvetu se stejným týmem.', 'mid', 35),
  // 4) Duelové a sázkové (pro oba, vítěz bere XP od druhého)
  C('duel', 'Duel', 'Oba přijmou stejnou výzvu. Kdo ji splní, bere XP od druhého.', 'mid', 40),
  C('duel', 'Double or nothing', 'Poražený vyzve k odvetě. Vítěz odvety bere dvojnásob XP od druhého.', 'hard', 70),
];

/**
 * Achievementy. `test(ctx)` se vyhodnotí po každém zápase pro každého hráče.
 * ctx = { s: statistiky hráče, win, gf, ga, diff, prevCur, sk: skill shoty v zápase }
 * Achievementy bez `test` se počítají na konci (challenge, prestiž…).
 */
const ACH = [
  { id: 'first',    ic: '🩸', name: 'První krev',             desc: 'První výhra',                           test: c => c.win },
  { id: 'hattrick', ic: '🎩', name: 'Hattrick',               desc: '3 výhry v řadě',                        test: c => c.s.cur >= 3 },
  { id: 'unbeat',   ic: '🛡️', name: 'Neporazitelný',          desc: '5 výher v řadě',                        test: c => c.s.cur >= 5 },
  { id: 'kanonyr',  ic: '💥', name: 'Kanonýr',                desc: '10 gólů v jednom zápase',               test: c => c.gf >= 10 },
  { id: 'shutout',  ic: '🧱', name: 'Čisté konto',            desc: 'Výhra bez obdrženého gólu',             test: c => c.win && c.ga === 0 },
  { id: 'magic',    ic: '🪄', name: 'Kouzelník',              desc: '5 skill shotů celkem',                  test: c => c.s.skillTotal >= 5 },
  { id: 'soSpec',   ic: '🎯', name: 'Specialista na nájezdy', desc: '10 výher v módu Nájezdy',               test: c => c.s.byMode.SO.w >= 10 },
  { id: 'marathon', ic: '🏃', name: 'Maratonec',              desc: '10 zápasů na 20 minut',                 test: c => c.s.byMode['20'].w + c.s.byMode['20'].l >= 10 },
  { id: 'comeback', ic: '🔄', name: 'Comeback',               desc: 'Výhra po 3+ prohrách v řadě',           test: c => c.win && c.prevCur <= -3 },
  { id: 'stovka',   ic: '💯', name: 'Stovka',                 desc: '100 odehraných zápasů',                 test: c => c.s.games >= 100 },
  { id: 'master',   ic: '🧠', name: 'Challenge master',       desc: '25 splněných challengí' },
  // … a vtipné navíc
  { id: 'ponizeni', ic: '🤡', name: 'Ponížení',               desc: 'Výhra o 7 a více gólů',                 test: c => c.win && c.diff >= 7 },
  { id: 'cednik',   ic: '🫗', name: 'Cedník',                 desc: 'Dostat 10+ gólů v jednom zápase',       test: c => c.ga >= 10 },
  { id: 'rohlik',   ic: '🥖', name: 'Suchý rohlík',           desc: 'Prohra bez vstřeleného gólu',           test: c => !c.win && c.gf === 0 },
  { id: 'lavicka',  ic: '🪑', name: 'Čestný člen lavičky',    desc: '5 proher v řadě',                       test: c => c.s.cur <= -5 },
  { id: 'smolar',   ic: '🍀', name: 'Smolař',                 desc: '3 prohry v prodloužení / nájezdech',    test: c => c.s.otL >= 3 },
  { id: 'nervy',    ic: '🧊', name: 'Nervy z oceli',          desc: '5 výher v prodloužení / nájezdech',     test: c => c.s.otW >= 5 },
  { id: 'mlynek',   ic: '🌪️', name: 'Mixér',                  desc: '3 různé skill shoty v jednom zápase',   test: c => SKILLS.filter(s => !s.extra && c.sk[s.k] > 0).length >= 3 },
  { id: 'bekhend',  ic: '🔙', name: 'Bekhendový bůh',         desc: '10 gólů bekhendem',                     test: c => c.s.skills.bh >= 10 },
  { id: 'michigan', ic: '🥍', name: 'Michigan Man',           desc: '3 góly à la lacrosse',                  test: c => c.s.skills.lax >= 3 },
  { id: 'kmet',     ic: '👴', name: 'Ligový kmet',            desc: '50 odehraných zápasů',                  test: c => c.s.games >= 50 },
  { id: 'golman',   ic: '🥅', name: 'Hazardér',               desc: 'Splnit „Odvolej brankáře“' },
  { id: 'plnic',    ic: '✅', name: 'Plnič úkolů',            desc: '5 splněných challengí' },
  { id: 'sluha',    ic: '🧹', name: 'Věrný sluha',            desc: 'Odpracovat 5 trestů' },
  { id: 'zolik',    ic: '🃏', name: 'Eso v rukávu',           desc: 'Zrušit trest žolíkem' },
  { id: 'veteran',  ic: '⭐', name: 'Veterán',                desc: 'Dosáhnout levelu 10' },
  { id: 'prestiz',  ic: '🌟', name: 'Prestiž',                desc: 'Projít levelem 20 a resetovat XP' },
];

/* =========================================================
   2) DATA — načtení, uložení, výchozí stav
   ========================================================= */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowISO = () => new Date().toISOString();
const clone = o => JSON.parse(JSON.stringify(o));

function defaultData() {
  return {
    v: 2,
    names: ['Jenda', 'Seba'],
    settings: clone(DEFAULT_SETTINGS),
    catalog: DEFAULT_CATALOG.map(c => ({ id: uid() + Math.random().toString(36).slice(2, 4), ...clone(c) })),
    matches: [],       // { id, date, mode, s:[a,b], ot, teams:[t0,t1], skills:[{bh,…},{…}] }
    challenges: [],    // { id, cid, p:0|1|'both', cat, name, text, diff, xp, fail, status, date, doneAt, winner }
    xpAdj: [],         // úpravy XP mimo zápasy: { p, xp, reason, date }
    penalties: [],     // { id, loser, text, source, date, done, doneAt, joker, video }
    rewards: [],       // odměny pro vítěze: { id, p, text, source, date, done, doneAt }
    ledger: [],        // pokladna: { id, from, to, amount, reason, date, settled }
    shame: [],         // síň hanby: { id, p, text, date, hasVideo }
    vetoes: [],        // { id, by, team, date, active }
    jokersUsed: [0, 0],
    vetoUsed: [0, 0],
    seasonsClosed: [], // měsíce 'YYYY-MM', které už mají vyhlášeného šampiona
    drawnMode: null,   // vylosovaný mód na další zápas
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn('Načtení dat selhalo', e);
    return defaultData();
  }
}

/** Seznamy, které se mezi telefony slučují podle id (nic se neztratí ani při zápisu na obou). */
const SYNC_COLLECTIONS = ['matches', 'challenges', 'xpAdj', 'penalties', 'rewards', 'ledger', 'shame', 'vetoes', 'catalog'];

/** Doplní chybějící pole (např. ze starší zálohy). */
function normalize(d) {
  const base = defaultData();
  const out = { ...base, ...d };
  out.settings = { ...base.settings, ...(d.settings || {}) };
  out.settings.money = { ...base.settings.money, ...((d.settings || {}).money || {}) };
  if (!Array.isArray(d.catalog) || !d.catalog.length) out.catalog = base.catalog;
  if (out.names?.[1] === 'Brácha') out.names[1] = 'Seba';   // původní výchozí jméno → Seba
  // původní výchozí trest s nikotinem → nová výchozí odměna
  (out.settings.leadRules || []).forEach(r => { if (/nikotin/i.test(r.text)) r.text = 'nosí vítězi pití celý večer'; });
  if (!Array.isArray(out.settings.rewards)) out.settings.rewards = base.settings.rewards;
  // Firebase nevrací prázdná pole → doplnit; starší úpravy XP neměly id (kvůli slučování ho potřebují)
  for (const k of SYNC_COLLECTIONS) if (!Array.isArray(out[k])) out[k] = [];
  out.xpAdj.forEach((a, i) => { if (!a.id) a.id = `x${i}-${a.date || ''}-${a.p}-${a.xp}`; });
  if (!Array.isArray(out.deletedIds)) out.deletedIds = [];
  return out;
}

let data = load();

/** Uloží data. Změna z tohoto telefonu dostane časové razítko a odešle se druhému telefonu. */
function persist(fromRemote = false) {
  if (!fromRemote) data.updatedAt = Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch (e) { toast('⚠️', 'Chyba', 'Data se nepodařilo uložit', true); }
  if (!fromRemote && typeof Sync !== 'undefined') Sync.schedulePush();
}

/** Smazání položky si pamatujeme, aby ji druhý telefon při slučování nevrátil zpět. */
function markDeleted(id) { if (id && !data.deletedIds.includes(id)) data.deletedIds.push(id); }

/* ---------- IndexedDB pro videa Síně hanby ---------- */
const VideoDB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('nhl14-hanba', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('videos');
      r.onsuccess = () => { this._db = r.result; res(this._db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('videos', mode);
      const req = fn(t.objectStore('videos'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  },
  put(id, blob) { return this.tx('readwrite', s => s.put(blob, id)); },
  get(id) { return this.tx('readonly', s => s.get(id)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
};

/* =========================================================
   3) POMOCNÉ FUNKCE
   ========================================================= */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nm = p => esc(data.names[p] || (p ? 'Seba' : 'Jenda'));
const rawNm = p => data.names[p] || (p ? 'Seba' : 'Jenda');
const fmtDate = iso => new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
const fmtNum = n => Math.round(n).toLocaleString('cs-CZ');
const kc = n => `${fmtNum(n)} Kč`;
const monthKey = iso => iso.slice(0, 7);
const monthName = key => new Date(key + '-15T12:00:00').toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' });
const emptySkills = () => Object.fromEntries(COUNTERS.map(s => [s.k, 0]));
const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = rnd(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const plural = (n, one, few, many) => n === 1 ? one : n >= 2 && n <= 4 ? few : many;

/** Cena levelu L → L+1 (100, 150, 200 …). */
const levelCost = l => 100 + (l - 1) * 50;
/** XP potřebné na celý cyklus 1 → MAX_LEVEL (= jedna prestiž). */
const PRESTIGE_XP = Array.from({ length: MAX_LEVEL - 1 }, (_, i) => levelCost(i + 1)).reduce((a, b) => a + b, 0);

/** Z celkového XP spočítá prestiž, level a postup v levelu. */
function levelInfo(totalXp) {
  const xp = Math.max(0, totalXp);
  const prestige = Math.floor(xp / PRESTIGE_XP);
  let rest = xp % PRESTIGE_XP, lvl = 1;
  while (lvl < MAX_LEVEL - 1 && rest >= levelCost(lvl)) { rest -= levelCost(lvl); lvl++; }
  const need = levelCost(lvl);
  return { prestige, lvl, into: rest, need, pct: Math.min(100, Math.round(rest / need * 100)) };
}

function streakText(cur) {
  if (cur >= 2) return `🔥 ${cur} ${plural(cur, 'výhra', 'výhry', 'výher')} v řadě`;
  if (cur <= -2) return `❄️ ${-cur} ${plural(-cur, 'prohra', 'prohry', 'proher')} v řadě`;
  return '';
}

/** Barevný odznak týmu se zkratkou (vlastní tým = šedý s prvními písmeny). */
function teamBadge(name, size = '') {
  if (!name) return '';
  const t = teamByName(name);
  if (!t) return `<span class="tbadge custom ${size}">${esc(name.slice(0, 3).toUpperCase())}</span>`;
  // Logo (NHL) nebo vlajka (reprezentace); bez internetu se ukáže barevná zkratka
  const url = teamLogoUrl(t);
  return `<span class="tbadge logo ${t.group === 'int' ? 'flag' : ''} ${size}" style="--c1:${t.c1};--c2:${t.c2}" title="${esc(t.name)}">`
    + `<img src="${url}" alt="" loading="lazy" onerror="this.parentNode.classList.add('fail')"><b class="ab">${t.abbr}</b></span>`;
}

/** Oficiální loga z období sezóny 2013/14 (jak byla v NHL 14) + vlajky reprezentací. */
const LOGO_ERA = {
  ANA: 'ANA_20132014-20232024', BOS: 'BOS_20082009-20222023', BUF: 'BUF_20102011-20192020', CGY: 'CGY_19941995-20192020',
  CHI: 'CHI_19981999-20242025', DAL: 'DAL_20122013-20202021', EDM: 'EDM_20112012-20162017', FLA: 'FLA_19992000-20152016',
  LAK: 'LAK_20112012-20182019', NYI: 'NYI_20102011-20162017', OTT: 'OTT_20072008-20192020', PHI: 'PHI_19992000-20222023',
  PHX: 'PHX_20032004-20132014', PIT: 'PIT_20062007-20152016', SJS: 'SJS_20082009-20232024', STL: 'STL_20082009-20242025',
  TOR: 'TOR_19871988-20152016', VAN: 'VAN_20072008-20182019',
};
const FLAG_ISO = { CZE: 'cz', SVK: 'sk', CAN: 'ca', USA: 'us', SWE: 'se', FIN: 'fi', RUS: 'ru', GER: 'de', SUI: 'ch', NOR: 'no', DEN: 'dk', LAT: 'lv' };
function teamLogoUrl(t) {
  if (t.group === 'int') return `https://flagcdn.com/${FLAG_ISO[t.abbr]}.svg`;
  return `https://assets.nhle.com/logos/nhl/svg/${LOGO_ERA[t.abbr] || t.abbr}_light.svg`;
}

/* ---------- Vtipné přezdívky podle levelu a formy ---------- */
const LEVEL_TITLES = [
  'Nováček z lavičky', 'Nosič puků', 'Řidič rolby', 'Ohřívač střídačky', 'Čtvrtá lajna',
  'Bojovník do rohů', 'Specialista na buly', 'Dělo od modré', 'Třetí lajna', 'Dvoucestný forvard',
  'Druhá lajna', 'Asistent kapitána', 'Kapitán šatny', 'Snajpr', 'Elitní centr',
  'All-Star', 'Kanonýr ligy', 'Síň slávy', 'Hokejový bůh',
];
function levelTitle(lv) {
  const base = LEVEL_TITLES[Math.min(lv.lvl, LEVEL_TITLES.length) - 1];
  return lv.prestige ? `${base} ★${lv.prestige}` : base;
}

/** Štítek nálady podle formy, posledního zápasu a celkového vedení (první platný vyhrává). */
function moodTag(comp, p) {
  const s = comp.st[p], c = s.cur, lead = p === 0 ? comp.lead : -comp.lead;
  const last = comp.sorted.at(-1);
  const gf = last ? last.s[p] : 0, ga = last ? last.s[1 - p] : 0, won = gf > ga;
  const ev = last?.skills?.[p] || {};
  const rules = [
    [c >= 8, '🐐 Koza (GOAT)'],
    [c <= -8, '⚰️ Pohřbený zaživa'],
    [c >= 5, '🚂 Nezastavitelný'],
    [c <= -5, '🪦 Na odpis'],
    [last && won && ga === 0 && gf >= 5, '🧹 Zametač'],
    [last && won && gf - ga >= 5, '💣 Drtič'],
    [last && !won && ga - gf >= 5, '🫠 Rozstřílený'],
    [last && won && ga === 0, '🧱 Betonová zeď'],
    [last && won && (ev.fight || 0) === 1, '🥊 Rváč se srdcem'],
    [(ev.foul || 0) >= 4, '🪓 Řezník'],
    [(ev.fight || 0) >= 2, '🥊 Bijec'],
    [c >= 3, '🔥 V ráži'],
    [c <= -3, '🧊 Ve slumpu'],
    [last && won && last.ot, '😎 Klidná hlava'],
    [last && !won && last.ot, '😩 Smolař z prodloužení'],
    [lead >= 15, '👑 Diktátor'],
    [lead <= -15, '🐢 Věčně druhý'],
    [lead >= 8, '🦁 Král ledu'],
    [lead <= -8, '🪣 Nosič vody'],
    [c === 2, '😏 Rozjetý'],
    [c === -2, '😬 Nervózní'],
    [lead > 0, '👑 Šéf ledu'],
    [lead < 0, '🎯 Pronásledovatel'],
  ];
  return (rules.find(([ok]) => ok) || [0, '⚖️ Vyrovnané'])[1];
}

/* ---------- HLAVNÍ STRÁNKA: hlavička se skóre a statistikami (vlevo hráč 1, vpravo hráč 2) ---------- */
function avatar(p) { return `<div class="ava">${esc(rawNm(p).slice(0, 1).toUpperCase())}</div>`; }

/** Řádky statistik pro srovnání: [popisek, A, B, číslo A, číslo B, vyšší je lepší] */
function h2hRows(comp) {
  const [a, b] = comp.st;
  const avg = s => s.games ? +(s.gf / s.games).toFixed(1) : 0;
  const achN = s => Object.keys(s.ach).length;
  return [
    ['Výhry', a.w, b.w, a.w, b.w],
    ['Góly', a.gf, b.gf, a.gf, b.gf],
    ['Průměr gólů', String(avg(a)).replace('.', ','), String(avg(b)).replace('.', ','), avg(a), avg(b)],
    ['Nejvyšší výhra', a.big?.score ?? '–', b.big?.score ?? '–', a.big?.diff ?? 0, b.big?.diff ?? 0],
    ['Nejdelší série', a.best, b.best, a.best, b.best],
    ['Skill shoty', a.skillTotal, b.skillTotal, a.skillTotal, b.skillTotal],
    ['Splněné challenge', a.chDone, b.chDone, a.chDone, b.chDone],
    ['Odznaky', achN(a), achN(b), achN(a), achN(b)],
  ];
}

function homeH2H(comp) {
  const [a, b] = comp.st;
  const side = p => {
    const s = comp.st[p];
    return `<div class="h2-p ${comp.leader === p ? 'lead' : ''}">
      ${avatar(p)}
      <div class="h2-n">${nameBadge(comp, p)}</div>
      <div class="h2-t">${levelTitle(s.lv)}</div>
      <div class="h2-l">Level ${s.lv.lvl} · ${fmtNum(Math.max(0, s.xp))} XP</div>
      <div class="h2-mood">${moodTag(comp, p)}</div>
    </div>`;
  };
  const leadTxt = comp.leader === null ? (comp.sorted.length ? 'Vyrovnáno' : 'Rivalita začíná') : `Vede ${nm(comp.leader)} o ${Math.abs(comp.lead)}`;
  const bar = (x, y) => { const t = x + y || 1; return [Math.round(x / t * 100), Math.round(y / t * 100)]; };
  return `
  <section class="h2">
    <div class="h2-top">
      ${side(0)}
      <div class="h2-score">
        <div class="h2-big"><span class="${a.w > b.w ? 'w' : ''}">${a.w}</span><i>:</i><span class="${b.w > a.w ? 'w' : ''}">${b.w}</span></div>
        <div class="h2-lead">${leadTxt}</div>
        <div class="small mut">${comp.sorted.length} ${plural(comp.sorted.length, 'zápas', 'zápasy', 'zápasů')}</div>
      </div>
      ${side(1)}
    </div>
    <div class="h2-xp">
      <div class="xpb l ${comp.leader === 0 ? 'gold' : ''}"><i style="width:${a.lv.pct}%"></i></div>
      <span class="small mut">XP</span>
      <div class="xpb r ${comp.leader === 1 ? 'gold' : ''}"><i style="width:${b.lv.pct}%"></i></div>
    </div>
    <div class="h2-rows">
      ${h2hRows(comp).map(([label, va, vb, na, nb]) => {
        const [pa, pb] = bar(na, nb);
        return `<div class="h2-row">
          <b class="${na > nb ? 'best' : ''}">${va}</b><span>${label}</span><b class="${nb > na ? 'best' : ''}">${vb}</b>
          <div class="mb l"><i style="width:${pa}%"></i></div><div class="mb r"><i style="width:${pb}%"></i></div>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}


/** Jméno s korunkou (leader) a hvězdičkami prestiže. */
function nameBadge(comp, p) {
  const pr = comp.st[p].lv.prestige;
  const stars = pr ? ` <span class="stars">${pr <= 3 ? '★'.repeat(pr) : '★×' + pr}</span>` : '';
  const crown = comp.leader === p ? ' <span class="crown">👑</span>' : '';
  return nm(p) + stars + crown;
}

/* =========================================================
   4) VÝPOČET — statistiky, XP, achievementy, sezóny
   ========================================================= */
function blankStats() {
  return {
    xp: 0, w: 0, l: 0, gf: 0, ga: 0, games: 0,
    cur: 0, best: 0, big: null,
    skills: emptySkills(), skillTotal: 0,
    byMode: Object.fromEntries(MODE_ORDER.map(m => [m, { w: 0, l: 0 }])),
    otW: 0, otL: 0, vetoEarned: 0,
    ev: Object.fromEntries([...EVENTS, ...MINI].map(e => [e.k, 0])), miniTotal: 0,
    chDone: 0, chFail: 0, penDone: 0,
    ach: {},
  };
}

/** XP jednoho hráče za jeden zápas. */
function matchXP(m, p, prevCur) {
  const mode = MODES[m.mode];
  const gf = m.s[p], ga = m.s[1 - p], win = gf > ga;
  let xp = win ? (m.ot && m.mode !== 'SO' ? Math.round(mode.win * OT_FACTOR) : mode.win) : mode.loss;
  const sk = (m.skills && m.skills[p]) || {};
  for (const s of COUNTERS) xp += (sk[s.k] || 0) * s.xp;
  if (win && ga === 0) xp += BONUS.shutout;
  if (win && gf - ga >= 5) xp += BONUS.blowout;
  if (win && prevCur <= -3) xp += BONUS.comeback;
  return xp;
}

function compute() {
  const sorted = [...data.matches].sort((a, b) => a.date.localeCompare(b.date));
  const st = [blankStats(), blankStats()];
  const mxp = {};

  for (const m of sorted) {
    mxp[m.id] = [0, 0];
    for (const p of [0, 1]) {
      const s = st[p];
      const gf = m.s[p], ga = m.s[1 - p], diff = gf - ga, win = diff > 0, prevCur = s.cur;
      const xp = matchXP(m, p, prevCur);
      s.xp += xp; mxp[m.id][p] = xp;
      s.games++; s.gf += gf; s.ga += ga;
      const sk = (m.skills && m.skills[p]) || {};
      for (const k of SKILLS) { const n = sk[k.k] || 0; s.skills[k.k] += n; if (!k.extra) s.skillTotal += n; }
      for (const k of EVENTS) s.ev[k.k] += sk[k.k] || 0;
      for (const k of MINI) { const n = sk[k.k] || 0; s.ev[k.k] += n; s.miniTotal += n; }
      if (win) {
        s.w++; s.byMode[m.mode].w++;
        s.cur = s.cur > 0 ? s.cur + 1 : 1;
        if (s.cur === 3) s.vetoEarned++;          // každá série 3 výher = 1 veto
        if (m.ot) s.otW++;
        if (!s.big || diff > s.big.diff) s.big = { diff, score: `${gf}:${ga}` };
      } else {
        s.l++; s.byMode[m.mode].l++;
        s.cur = s.cur < 0 ? s.cur - 1 : -1;
        if (m.ot) s.otL++;
      }
      s.best = Math.max(s.best, s.cur);
      const ctx = { s, win, gf, ga, diff, prevCur, sk };
      for (const a of ACH) if (a.test && !s.ach[a.id] && a.test(ctx)) s.ach[a.id] = m.date;
    }
  }

  // XP mimo zápasy (challenge, duely, ztráty)
  for (const a of data.xpAdj) st[a.p].xp += a.xp;

  // Challenge statistiky + achievementy z nich
  const doneList = [[], []];
  for (const c of data.challenges) {
    if (c.status === 'done') {
      const who = c.p === 'both' ? c.winner : c.p;
      if (who === 0 || who === 1) { st[who].chDone++; doneList[who].push(c); }
    } else if (c.status === 'failed' && (c.p === 0 || c.p === 1)) st[c.p].chFail++;
  }
  for (const p of [0, 1]) {
    const s = st[p];
    const done = doneList[p].sort((a, b) => (a.doneAt || '').localeCompare(b.doneAt || ''));
    const g = done.find(c => c.trigger === 'lose3');
    if (g) s.ach.golman = g.doneAt;
    if (done.length >= 5) s.ach.plnic = done[4].doneAt;
    if (done.length >= 25) s.ach.master = done[24].doneAt;
    const pens = data.penalties.filter(x => x.loser === p && x.done && !x.joker).sort((a, b) => a.doneAt.localeCompare(b.doneAt));
    s.penDone = pens.length;
    if (pens.length >= 5) s.ach.sluha = pens[4].doneAt;
    const jk = data.penalties.find(x => x.loser === p && x.joker);
    if (jk) s.ach.zolik = jk.doneAt;
    s.lv = levelInfo(s.xp);
    if (s.lv.lvl >= 10 || s.lv.prestige > 0) s.ach.veteran = s.ach.veteran || sorted.at(-1)?.date || nowISO();
    if (s.lv.prestige > 0) s.ach.prestiz = s.ach.prestiz || sorted.at(-1)?.date || nowISO();
    // žolíci: 1 za každých 5 splněných challengí
    s.jokers = Math.floor(s.chDone / 5) - (data.jokersUsed[p] || 0);
    s.vetoes = s.vetoEarned - (data.vetoUsed[p] || 0);
  }

  const lead = st[0].w - st[1].w;
  const leader = lead > 0 ? 0 : lead < 0 ? 1 : null;
  return { st, mxp, sorted, lead, leader, seasons: seasonTable(sorted), rivalry: rivalryMeter(sorted, lead) };
}

/** Sezóny = kalendářní měsíce. Vrací { 'YYYY-MM': { w:[a,b], g:[a,b], n, champ } } */
function seasonTable(sorted) {
  const t = {};
  for (const m of sorted) {
    const k = monthKey(m.date);
    t[k] = t[k] || { w: [0, 0], g: [0, 0], n: 0 };
    const w = m.s[0] > m.s[1] ? 0 : 1;
    t[k].w[w]++; t[k].g[0] += m.s[0]; t[k].g[1] += m.s[1]; t[k].n++;
  }
  for (const k in t) {
    const s = t[k];
    s.champ = s.w[0] !== s.w[1] ? (s.w[0] > s.w[1] ? 0 : 1) : s.g[0] !== s.g[1] ? (s.g[0] > s.g[1] ? 0 : 1) : null;
  }
  return t;
}

/**
 * Rivalita meter 0–100: jak vyhrocená je série.
 * Z posledních 10 zápasů: vyrovnanost výher, střídání vítězů, těsné výsledky,
 * celkový rozdíl výher a délka aktuální série (dlouhá série = někdo zuří).
 */
function rivalryMeter(sorted, lead) {
  const last = sorted.slice(-10), n = last.length;
  if (n < 3) return { v: 0, label: 'Rozjíždí se', ic: '🥱' };
  const winners = last.map(m => m.s[0] > m.s[1] ? 0 : 1);
  const w0 = winners.filter(w => w === 0).length;
  const balance = 1 - Math.abs(w0 - (n - w0)) / n;
  let swaps = 0; for (let i = 1; i < n; i++) if (winners[i] !== winners[i - 1]) swaps++;
  const alt = swaps / (n - 1);
  const close = last.filter(m => Math.abs(m.s[0] - m.s[1]) <= 1 || m.ot).length / n;
  const overall = 1 - Math.min(Math.abs(lead), 15) / 15;
  let streak = 1; for (let i = n - 1; i > 0 && winners[i] === winners[i - 1]; i--) streak++;
  const fury = Math.min(streak, 6) / 6;
  const v = Math.round(100 * (0.28 * balance + 0.2 * alt + 0.22 * close + 0.15 * overall + 0.15 * fury));
  const [label, ic] = v < 30 ? ['Přátelák', '😴'] : v < 55 ? ['Napjaté', '😤'] : v < 75 ? ['Vyhrocené', '🔥'] : ['Krevní msta', '☠️'];
  return { v, label, ic };
}

/* =========================================================
   5) AUTOMATIKA — tresty, pokladna, challenge, sezóny
   ========================================================= */
function addPenalty(loser, text, source) {
  // Stejný trest, který ještě není splněný, se nevyhlašuje znovu (vedení může kolísat kolem hranice)
  if (data.penalties.some(p => !p.done && p.loser === loser && p.text === text)) return;
  const video = /video/i.test(text);
  data.penalties.push({ id: uid(), loser, text, source, date: nowISO(), done: false, video });
  celebrate({ kind: 'red', ic: '🚨', k: `Trest · ${source}`, t: rawNm(loser), s: text });
}

/** Odměna pro hráče p: náhodná ze seznamu v Nastavení, s oslavou. */
function addReward(p, source, text = null) {
  const list = data.settings.rewards || [];
  if (!text && !list.length) return;
  const t = text || list[rnd(list.length)];
  data.rewards.push({ id: uid(), p, text: t, source, date: nowISO(), done: false });
  celebrate({ kind: 'gold', ic: '🎁', k: `Odměna · ${source}`, t: rawNm(p), s: t, confetti: true });
}

function addDebt(from, to, amount, reason) {
  if (!amount) return;
  data.ledger.push({ id: uid(), from, to, amount, reason, date: nowISO(), settled: false });
  toast('💰', 'Pokladna', `${rawNm(from)} → ${rawNm(to)}: ${kc(amount)} (${reason})`);
}

/** Vytvoří instanci challenge z katalogu. p = 0 | 1 | 'both' */
function assignChallenge(item, p, extraText = '') {
  const c = {
    id: uid(), cid: item.id, p, cat: item.cat, name: item.name,
    text: item.text + (extraText ? `\n${extraText}` : ''),
    diff: item.diff, xp: item.xp, fail: { ...item.fail }, trigger: item.trigger || null,
    status: 'active', date: nowISO(),
  };
  data.challenges.push(c);
  return c;
}

function autoChallenge(trigger, p) {
  const item = data.catalog.find(c => c.cat === 'auto' && c.trigger === trigger);
  if (!item) return;
  if (data.challenges.some(c => c.status === 'active' && c.cid === item.id && c.p === p)) return;
  assignChallenge(item, p);
  toast('⚡', `Nová challenge · ${rawNm(p)}`, item.name);
}

/** Spustí se jen po zápisu NOVÉHO zápasu. */
function afterNewMatch(before, after, m) {
  const w = m.s[0] > m.s[1] ? 0 : 1, l = 1 - w;
  const S = data.settings;

  // Odstupňované tresty podle rozdílu výher (při překročení hranice)
  const lb = before.lead, la = after.lead;
  for (const r of [...S.leadRules].filter(r => r.lead > 0 && r.text).sort((a, b) => a.lead - b.lead)) {
    if (la >= r.lead && lb < r.lead) addPenalty(1, r.text, `vedení o ${r.lead}`);
    if (-la >= r.lead && -lb < r.lead) addPenalty(0, r.text, `vedení o ${r.lead}`);
  }

  // Finanční odměny
  if (m.s[w] - m.s[l] >= 7) addDebt(l, w, S.money.blowout, 'výhra o 7+ gólů');
  if (after.st[w].cur === 10) addDebt(l, w, S.money.streak10, '10 výher v řadě');

  // Automatické challenge podle situace
  for (const p of [0, 1]) {
    const cur = after.st[p].cur;
    if (cur <= -3) autoChallenge('lose3', p);
    if (cur === -5) autoChallenge('lose5', p);
    if (cur === 4) autoChallenge('win4', p);
  }

  // Odměny za série výher
  if (after.st[w].cur === 3) addReward(w, 'série 3 výher');
  if (after.st[w].cur === 5) addReward(w, 'série 5 výher');
  if (after.st[w].cur === 10) addReward(w, 'série 10 výher');

  // Nové veto?
  if (after.st[w].vetoEarned > before.st[w].vetoEarned) toast('🚫', 'Veto získáno', `${rawNm(w)} může soupeři zakázat tým`);
}

/** Uzavře skončené měsíce: vyhlásí šampiona a připíše odměnu do pokladny. */
function closeSeasons() {
  const comp = compute();
  const current = monthKey(nowISO());
  let changed = false;
  for (const k of Object.keys(comp.seasons).sort()) {
    if (k >= current || data.seasonsClosed.includes(k)) continue;
    data.seasonsClosed.push(k);
    changed = true;
    const s = comp.seasons[k];
    if (s.champ === null) { toast('🤝', `Sezóna ${monthName(k)}`, 'Remíza, žádný šampion'); continue; }
    addDebt(1 - s.champ, s.champ, data.settings.money.month, `šampion sezóny ${monthName(k)}`);
    celebrate({ kind: 'gold', ic: '🏆', k: `Šampion sezóny · ${monthName(k)}`, t: rawNm(s.champ), s: `${s.w[s.champ]} : ${s.w[1 - s.champ]} na výhry · odměna ${kc(data.settings.money.month)}` });
  }
  if (changed) { persist(); render(); }
}

/* Vyhodnocení challenge. res: 'done' | 'fail' | 'win0' | 'win1' | 'none' */
function resolveChallenge(id, res) {
  const c = data.challenges.find(x => x.id === id);
  if (!c || c.status !== 'active') return;
  c.doneAt = nowISO();
  if (c.p === 'both') {
    if (res === 'win0' || res === 'win1') {
      const w = res === 'win0' ? 0 : 1;
      c.status = 'done'; c.winner = w;
      data.xpAdj.push({ id: uid(), p: w, xp: c.xp, reason: `${c.name} (výhra)`, date: c.doneAt });
      data.xpAdj.push({ id: uid(), p: 1 - w, xp: -c.xp, reason: `${c.name} (prohra)`, date: c.doneAt });
      toast('⚔️', c.name, `${rawNm(w)} bere ${c.xp} XP od soupeře`);
    } else c.status = 'expired';
    return;
  }
  if (res === 'done') {
    c.status = 'done';
    data.xpAdj.push({ id: uid(), p: c.p, xp: c.xp, reason: c.name, date: c.doneAt });
    toast('⚡', 'Challenge splněna', `${rawNm(c.p)} +${c.xp} XP`);
  } else {
    c.status = 'failed';
    if (c.fail.xp) data.xpAdj.push({ id: uid(), p: c.p, xp: -c.fail.xp, reason: `${c.name} (nesplněno)`, date: c.doneAt });
    if (c.fail.money) addDebt(c.p, 1 - c.p, c.fail.money, `nesplněná challenge ${c.name}`);
    if (c.fail.penalty && data.settings.punishments.length) {
      const list = data.settings.punishments;
      addPenalty(c.p, list[rnd(list.length)], `nesplněná challenge ${c.name}`);
    }
    if (!c.fail.xp && !c.fail.money && !c.fail.penalty) toast('✕', 'Challenge nesplněna', `${rawNm(c.p)}: ${c.name}`, true);
  }
}

/** Provede změnu, uloží a oznámí nově odemčené věci (achievementy, level up, prestiž). */
function mutate(fn) {
  const before = compute();
  fn(before);
  const after = compute();
  persist();
  let rewardAdded = false;
  for (const p of [0, 1]) {
    for (const a of ACH) {
      if (after.st[p].ach[a.id] && !before.st[p].ach[a.id]) celebrate({ ic: a.ic, k: `Achievement · ${rawNm(p)}`, t: a.name, s: a.desc, confetti: true });
    }
    const b = before.st[p].lv, n = after.st[p].lv;
    if (n.prestige > b.prestige) celebrate({ kind: 'gold', ic: '🌟', k: 'Prestiž!', t: `${rawNm(p)} ★${n.prestige}`, s: 'Level 20 pokořen. XP se resetuje, hvězda zůstává.', confetti: true });
    else if (n.lvl > b.lvl) toast('⬆️', 'Level up!', `${rawNm(p)} je level ${n.lvl} · ${levelTitle(n)}`);
    if (n.prestige > b.prestige || n.lvl > b.lvl) { addReward(p, n.prestige > b.prestige ? 'prestiž' : `level ${n.lvl}`); rewardAdded = true; }
  }
  if (rewardAdded) persist();
  render();
  return after;
}

/* =========================================================
   6) EFEKTY — toasty, velké animace, potvrzení, kolo štěstí
   ========================================================= */
let toastChain = Promise.resolve();
function toast(ic, t, b, red = false) {
  toastChain = toastChain.then(() => new Promise(res => {
    const el = document.createElement('div');
    el.className = 'toast' + (red ? ' red' : '');
    el.innerHTML = `<div class="ti">${ic}</div><div><div class="tt">${esc(t)}</div><div class="tb">${esc(b)}</div></div>`;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); res(); }, 2300);
  }));
}

/** Celoobrazovková animace. kind: '' (mint) | 'red' (trest) | 'gold' (šampion). Řadí se za sebe. */
let celeChain = Promise.resolve();
function celebrate({ kind = '', ic, k, t, s = '', confetti = false }) {
  celeChain = celeChain.then(() => new Promise(res => {
    const el = document.createElement('div');
    el.className = `cele ${kind}`;
    let conf = '';
    if (confetti || kind === 'gold') {
      const cols = kind === 'gold' ? ['#F2C14E', '#fff', '#93DAAB'] : ['#93DAAB', '#fff', '#F2C14E', '#5FA97A'];
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2, d = 140 + Math.random() * 260;
        conf += `<i class="conf" style="background:${cols[i % cols.length]};--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--r:${rnd(720)}deg;animation-delay:${Math.random() * .15}s"></i>`;
      }
    }
    el.innerHTML = `${conf}<div class="cbox"><div class="cic">${ic}</div><div class="ck">${esc(k)}</div><div class="ct">${esc(t)}</div>${s ? `<div class="cs">${esc(s)}</div>` : ''}<div class="ctap">ťukni pro pokračování</div></div>`;
    document.getElementById('celebrate').appendChild(el);
    if (navigator.vibrate) navigator.vibrate(kind === 'red' ? [80, 60, 80] : 40);
    let closed = false;
    const close = () => { if (closed) return; closed = true; el.classList.add('out'); setTimeout(() => { el.remove(); res(); }, 300); };
    el.addEventListener('click', close);
    setTimeout(close, kind === 'red' ? 4200 : 3200);
  }));
}

/** Vlastní potvrzovací okno. Vrací Promise<boolean>. */
function confirmBox(text, okLabel = 'Ano', danger = true) {
  return new Promise(resolve => {
    const m = document.createElement('div');
    m.className = 'modal cmodal';
    m.innerHTML = `<div class="box"><p>${esc(text)}</p>
      <button class="btn ${danger ? 'danger' : ''}" data-r="1">${esc(okLabel)}</button>
      <button class="btn ghost" data-r="0">Zrušit</button></div>`;
    m.addEventListener('click', e => {
      const r = e.target.closest('[data-r]');
      if (!r && e.target !== m) return;
      e.stopPropagation();
      m.remove(); resolve(r ? r.dataset.r === '1' : false);
    });
    document.body.appendChild(m);
  });
}

/**
 * KOLO ŠTĚSTÍ
 * labels: popisky výsečí, pick: index výsledku, result: HTML výsledku,
 * actions: tlačítka po dotočení [{ v, label, cls }]. Vrací Promise s `v` zvoleného tlačítka.
 */
function spinWheel({ title, icon = '🎡', labels, pick, result, actions = [{ v: 'ok', label: 'OK' }] }) {
  // Na kole se zobrazí max. 12 výsečí (vždy včetně výsledku), aby byly čitelné.
  let shown = labels.map((l, i) => i);
  if (shown.length > 12) shown = shuffle(shuffle(shown.filter(i => i !== pick)).slice(0, 11).concat(pick));
  const target = shown.indexOf(pick);
  const ov = document.getElementById('wheelOv');
  ov.innerHTML = `<h3>${esc(title)}</h3>
    <div class="wheel"><div class="ptr"></div><canvas width="680" height="680"></canvas><div class="hub">${icon}</div></div>
    <div class="wheel-res" style="visibility:hidden"></div>`;
  ov.classList.remove('hidden');

  const cv = ov.querySelector('canvas'), ctx = cv.getContext('2d');
  const n = shown.length, seg = (Math.PI * 2) / n, R = 340;
  const fills = ['#13233F', '#FFFDF8', '#C8102E', '#E9E1D0'];   // barvy dresu
  const inks = ['#FFFDF8', '#13233F', '#FFFDF8', '#13233F'];
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * seg;
    let fi = i % 4;
    if (n > 1 && i === n - 1 && fi === 0) fi = 2;          // poslední výseč nesmí mít stejnou barvu jako první
    ctx.beginPath(); ctx.moveTo(R, R); ctx.arc(R, R, R, a0, a0 + seg); ctx.closePath();
    ctx.fillStyle = fills[fi]; ctx.fill();
    ctx.strokeStyle = '#13233F'; ctx.lineWidth = 3; ctx.stroke();
    ctx.save(); ctx.translate(R, R); ctx.rotate(a0 + seg / 2);
    ctx.fillStyle = inks[fi]; ctx.font = `600 ${n > 8 ? 22 : 26}px Poppins, sans-serif`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    let txt = labels[shown[i]]; if (txt.length > 18) txt = txt.slice(0, 17) + '…';
    ctx.fillText(txt, R - 26, 0);
    ctx.restore();
  }

  // Otočení tak, aby střed výsledné výseče skončil nahoře pod šipkou.
  const segDeg = 360 / n;
  const jitter = (Math.random() - 0.5) * segDeg * 0.6;
  const final = 360 * 6 - (target + 0.5) * segDeg + jitter;
  cv.style.transition = 'none'; cv.style.transform = 'rotate(0deg)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    cv.style.transition = 'transform 4.2s cubic-bezier(.12,.75,.1,1)';
    cv.style.transform = `rotate(${final}deg)`;
  }));
  if (navigator.vibrate) navigator.vibrate([15, 120, 15, 160, 15, 220, 15, 300, 15]);

  return new Promise(resolve => {
    setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(60);
      const box = ov.querySelector('.wheel-res');
      box.innerHTML = result + actions.map(a => `<button class="btn ${a.cls || ''}" data-w="${esc(a.v)}">${esc(a.label)}</button>`).join('');
      box.style.visibility = 'visible';
      box.addEventListener('click', e => {
        const b = e.target.closest('[data-w]');
        if (!b) return;
        ov.classList.add('hidden'); ov.innerHTML = '';
        resolve(b.dataset.w);
      });
    }, 4350);
  });
}

/* =========================================================
   7) NAVIGACE A VYKRESLENÍ
   ========================================================= */
const TABS = [
  { id: 'home',  ic: '🏒', label: 'Domů' },
  { id: 'chal',  ic: '⚡', label: 'Challenge' },
  { id: 'hist',  ic: '📋', label: 'Zápasy' },
  { id: 'stats', ic: '📊', label: 'Statistiky' },
  { id: 'rew',   ic: '💰', label: 'Odměny' },
  { id: 'set',   ic: '⚙️', label: 'Nastavení' },
];
const ui = { tab: 'home', histFilter: 'all', statSub: 'over', catFilter: 'random' };

function renderNav() {
  const activeCh = data.challenges.filter(c => c.status === 'active').length;
  const openPen = data.penalties.filter(p => !p.done).length;
  const badge = { chal: activeCh, rew: openPen + data.rewards.filter(r => !r.done).length };
  document.getElementById('nav').innerHTML = TABS.map(t =>
    `<button class="${t.id === ui.tab ? 'on' : ''}" data-a="tab" data-v="${t.id}"><b>${t.ic}</b>${t.label}${badge[t.id] ? `<span class="badge">${badge[t.id]}</span>` : ''}</button>`).join('');
}

function render() {
  const comp = compute();
  const views = { home: viewHome, chal: viewChal, hist: viewHist, stats: viewStats, rew: viewRew, set: viewSet };
  document.getElementById('view').innerHTML = views[ui.tab](comp);
  renderNav();
  if (ui.tab === 'rew') loadShameVideos();
}

/* ---------- Karta aktivní challenge (sdílená: Domů + Challenge) ---------- */
function challengeCard(c) {
  const who = c.p === 'both' ? `${nm(0)} vs ${nm(1)}` : nm(c.p);
  const fail = [c.fail.xp ? `−${c.fail.xp} XP` : '', c.fail.money ? `${kc(c.fail.money)} do pokladny` : '', c.fail.penalty ? 'trest z kola' : ''].filter(Boolean).join(' · ');
  const acts = c.p === 'both'
    ? `<button class="pill" data-a="ch-res" data-v="${c.id}" data-r="win0">🏆 ${nm(0)}</button>
       <button class="pill" data-a="ch-res" data-v="${c.id}" data-r="win1">🏆 ${nm(1)}</button>
       <button class="pill no sq" data-a="ch-res" data-v="${c.id}" data-r="none" aria-label="Nikdo">✕</button>`
    : `<button class="pill" data-a="ch-res" data-v="${c.id}" data-r="done">✓ Splněno</button>
       <button class="pill no" data-a="ch-res" data-v="${c.id}" data-r="fail">✕ Nesplněno</button>`;
  return `<div class="card chal ${c.diff}">
    <div class="row"><span class="h" style="margin:0">⚡ ${who}</span><span class="chip ${c.diff}">${DIFF[c.diff]}</span></div>
    <div class="chal-n">${esc(c.name)}</div>
    <div class="chal-t">${esc(c.text).replace(/\n/g, '<br>')}</div>
    <div class="chal-meta"><span class="chip m">+${c.xp} XP${c.p === 'both' ? ' od soupeře' : ''}</span>${fail ? `<span class="chip">Nesplnění: ${fail}</span>` : ''}</div>
    <div class="chal-act">${acts}</div>
  </div>`;
}

/* ---------- Řádek trestu ---------- */
function penaltyRow(p, comp) {
  const canJoker = comp.st[p.loser].jokers > 0;
  return `<div class="pen">
    <div><b>${nm(p.loser)}</b>: ${esc(p.text)}<div class="small mut">${esc(p.source)} · ${fmtDate(p.date)}</div></div>
    <div class="acts">
      ${canJoker ? `<button class="pill gold sq" data-a="pen-joker" data-v="${p.id}" aria-label="Použít žolíka">🃏</button>` : ''}
      <button class="pill" data-a="pen-done" data-v="${p.id}">Splněno</button>
    </div>
  </div>`;
}

/** Řádek odměny s tlačítkem „Vybráno“. */
function rewardRow(r) {
  return `<div class="pen">
    <div><b>${nm(r.p)}</b>: ${esc(r.text)}<div class="small mut">${esc(r.source)} · ${fmtDate(r.date)}</div></div>
    <div class="acts"><button class="pill gold" data-a="rew-done" data-v="${r.id}">Vybráno</button></div>
  </div>`;
}

/** Kdo komu kolik dluží (jen nevyrovnané položky). Kladné = hráč 1 dluží hráči 2. */
function ledgerBalance() {
  let net = 0;
  for (const e of data.ledger) if (!e.settled) net += e.from === 0 ? e.amount : -e.amount;
  return net;
}

/* =========================================================
   OBRAZOVKA: DOMŮ (hlavní stránka „Souboj“: skóre + statistiky proti sobě)
   ========================================================= */

function viewHome(comp) {
  const active = data.challenges.filter(c => c.status === 'active');
  const openPen = data.penalties.filter(p => !p.done);
  const openRew = data.rewards.filter(r => !r.done);
  const vetoes = data.vetoes.filter(v => v.active);
  const last = comp.sorted.at(-1);
  const net = ledgerBalance();
  const cur = comp.seasons[monthKey(nowISO())];

  return `
  ${homeH2H(comp)}
  <div class="wrap">
    <button class="btn" data-a="new">＋ ZAPSAT ZÁPAS${data.drawnMode ? ` · ${MODES[data.drawnMode].label}` : ''}</button>
    <div class="btns3">
      <button class="qbtn" data-a="draw-mode"><b>🎡</b>Losuj mód</button>
      <button class="qbtn" data-a="draw-ch"><b>⚡</b>Losuj challenge</button>
      <button class="qbtn" data-a="draw-pen"><b>🚨</b>Losuj trest</button>
      <button class="qbtn" data-a="draw-rew"><b>🎁</b>Losuj odměnu</button>
    </div>

    ${vetoes.map(v => `<div class="card warn"><div class="h">🚫 Veto</div><b>${nm(1 - v.by)}</b> nesmí příští zápas hrát za <b>${esc(v.team)}</b></div>`).join('')}

    ${active.map(challengeCard).join('')}

    ${openPen.length ? `<div class="card warn"><div class="h">🍿 Nesplněné tresty</div>${openPen.map(p => penaltyRow(p, comp)).join('')}</div>` : ''}

    ${openRew.length ? `<div class="card goldc"><div class="h">🎁 Odměny k vybrání</div>${openRew.map(rewardRow).join('')}</div>` : ''}

    ${net ? `<button class="card goldc row" style="width:100%;text-align:left" data-a="tab" data-v="rew"><span>💰 Dluh: <b>${nm(net > 0 ? 0 : 1)}</b> → ${nm(net > 0 ? 1 : 0)}</span><b style="color:var(--gold);font-size:20px">${kc(Math.abs(net))}</b></button>` : ''}

    ${[0, 1].filter(p => comp.st[p].vetoes > 0).map(p => `<button class="btn ghost" data-a="veto" data-v="${p}">🚫 ${nm(p)}: použít veto (${comp.st[p].vetoes})</button>`).join('')}

    ${cur ? `<div class="card row"><span class="small mut">Sezóna ${monthName(monthKey(nowISO()))}</span><span>${nm(0)} <b style="color:var(--mint)">${cur.w[0]} : ${cur.w[1]}</b> ${nm(1)}</span></div>` : ''}

    ${last ? `<div class="card">
        <div class="h">Poslední zápas</div>
        <div class="row">
          <span>${nm(0)} <b style="color:var(--mint);font-size:18px">${last.s[0]} : ${last.s[1]}</b> ${nm(1)}${last.ot ? ' <span class="chip">PP/SN</span>' : ''}</span>
          <span class="small mut">${MODES[last.mode].label}</span>
        </div>
      </div>` : `<div class="card empty">Zatím žádný zápas.<br>Zapiš první a rivalita začíná! 🏒</div>`}
  </div>`;
}

/* =========================================================
   OBRAZOVKA: CHALLENGE (hlavní funkce)
   ========================================================= */
function viewChal(comp) {
  const [a, b] = comp.st;
  const active = data.challenges.filter(c => c.status === 'active');
  const live = data.catalog.filter(c => c.cat === 'auto' && c.trigger === 'live');
  const list = data.catalog.filter(c => c.cat === ui.catFilter);
  const hist = data.challenges.filter(c => c.status !== 'active').sort((x, y) => (y.doneAt || '').localeCompare(x.doneAt || '')).slice(0, 30);
  const rate = s => s.chDone + s.chFail ? Math.round(s.chDone / (s.chDone + s.chFail) * 100) + ' %' : '–';
  const stLabel = { done: '✓ splněno', failed: '✕ nesplněno', expired: '— propadlo' };

  return `
  <div style="height:16px"></div>
  <section class="ch-hero">
    <h1>CHAL<span>LENGE</span></h1>
    <div class="small mut" style="margin-top:6px">Splň výzvu a ber XP. Vykašleš se na ni, tak plať.</div>
    <div class="ch-score">
      <div><div class="n">${nm(0)}</div><div class="v" style="color:${a.chDone >= b.chDone ? 'var(--mint)' : 'inherit'}">${a.chDone}</div><div class="small mut">úspěšnost ${rate(a)}</div></div>
      <div class="vs">splněno</div>
      <div class="r"><div class="n">${nm(1)}</div><div class="v" style="color:${b.chDone >= a.chDone ? 'var(--mint)' : 'inherit'}">${b.chDone}</div><div class="small mut">úspěšnost ${rate(b)}</div></div>
    </div>
  </section>
  <div class="wrap" style="margin-top:14px">
    <button class="btn" data-a="draw-ch">🎡 LOSUJ CHALLENGE</button>

    <div class="h" style="margin:8px 0 0">Aktivní (${active.length})</div>
    ${active.length ? active.map(challengeCard).join('') : `<div class="card empty">Žádná aktivní challenge. Roztoč kolo!</div>`}

    ${live.length ? `<div class="card hot"><div class="h">🔴 Živá pravidla během zápasu</div>
      ${live.map(c => `<div class="pen"><div><b>${esc(c.name)}</b><div class="small mut">${esc(c.text)}</div></div>
        <span class="acts"><button class="pill sq" data-a="ch-assign" data-v="${c.id}" aria-label="Zadat">＋</button></span></div>`).join('')}
    </div>` : ''}

    <div class="h" style="margin:8px 0 0">Katalog</div>
  </div>
  <div class="filters" style="margin-top:8px">${Object.entries(CATS).map(([k, l]) => `<button class="fbtn ${ui.catFilter === k ? 'on' : ''}" data-a="cat-filter" data-v="${k}">${l} (${data.catalog.filter(c => c.cat === k).length})</button>`).join('')}</div>
  <div class="wrap" style="margin-top:10px">
    <div class="card">
      ${list.length ? list.map(c => `<div class="cat-item">
        <i class="dot ${c.diff}"></i>
        <div class="tx"><b>${esc(c.name)} <span class="chip m" style="margin-left:4px">+${c.xp}</span></b><span>${c.tip ? esc(c.tip) + ' · ' : ''}${esc(c.text)}</span></div>
        <button data-a="ch-assign" data-v="${c.id}" aria-label="Zadat">＋</button>
        <button data-a="ch-edit" data-v="${c.id}" aria-label="Upravit">✏️</button>
      </div>`).join('') : '<div class="empty">Prázdné</div>'}
    </div>
    <button class="btn ghost" data-a="ch-new">＋ Nová challenge</button>

    <div class="card"><div class="h">Historie challengí</div>
      ${hist.length ? hist.map(c => {
        const who = c.p === 'both' ? (c.winner === 0 || c.winner === 1 ? `🏆 ${nm(c.winner)}` : 'oba') : nm(c.p);
        return `<div class="hrow"><span><b>${esc(c.name)}</b><br><span class="small mut">${who} · ${fmtDate(c.doneAt || c.date)}</span></span><span class="st-${c.status} small" style="white-space:nowrap">${stLabel[c.status] || ''}</span></div>`;
      }).join('') : '<div class="empty">Zatím nic</div>'}
    </div>
  </div>`;
}

/* =========================================================
   OBRAZOVKA: ZÁPASY (historie s filtrem)
   ========================================================= */
function viewHist(comp) {
  const list = comp.sorted.filter(m => ui.histFilter === 'all' || m.mode === ui.histFilter).reverse();
  const f = [['all', 'Vše'], ...MODE_ORDER.map(k => [k, MODES[k].label])];
  return `
  <div class="title">Historie <em>zápasů</em></div>
  <div class="filters">${f.map(([k, l]) => `<button class="fbtn ${ui.histFilter === k ? 'on' : ''}" data-a="filter" data-v="${k}">${l}</button>`).join('')}</div>
  <div class="wrap" style="margin-top:12px">
    ${list.length ? list.map(m => {
      const w = m.s[0] > m.s[1] ? 0 : 1, x = comp.mxp[m.id];
      const sk = [0, 1].map(p => SKILLS.filter(s => !s.extra).reduce((n, s) => n + ((m.skills?.[p]?.[s.k]) || 0), 0));
      const t = m.teams || ['', ''];
      return `<div class="card match">
        <div class="row small mut"><span>${fmtDate(m.date)}</span><span><span class="chip m">${MODES[m.mode].label}</span>${m.ot ? ' <span class="chip">PP/SN</span>' : ''}</span></div>
        <div class="sc">
          <span class="pn ${w === 0 ? 'win' : ''}">${nm(0)}</span>
          <span class="num">${m.s[0]} : ${m.s[1]}</span>
          <span class="pn r ${w === 1 ? 'win' : ''}">${nm(1)}</span>
        </div>
        ${t[0] || t[1] ? `<div class="tm"><span>${teamBadge(t[0], 'sm')} ${esc(t[0])}</span><span>${esc(t[1])} ${teamBadge(t[1], 'sm')}</span></div>` : ''}
        <div class="row small mut"><span>${fmtXp(x[0])}${sk[0] ? ` · ${sk[0]}× skill` : ''}</span><span>${sk[1] ? `${sk[1]}× skill · ` : ''}${fmtXp(x[1])}</span></div>
        <div class="acts"><button data-a="edit" data-v="${m.id}">✏️ Upravit</button><button class="del" data-a="del" data-v="${m.id}">🗑 Smazat</button></div>
      </div>`;
    }).join('') : `<div class="card empty">Žádné zápasy${ui.histFilter !== 'all' ? ' v tomto módu' : ''}.</div>`}
  </div>`;
}

/* =========================================================
   OBRAZOVKA: STATISTIKY (přehled / sezóny / odznaky)
   ========================================================= */
function viewStats(comp) {
  const subs = [['over', 'Přehled'], ['season', 'Sezóny'], ['ach', 'Odznaky']];
  const body = ui.statSub === 'season' ? statSeasons(comp) : ui.statSub === 'ach' ? statAch(comp) : statOverview(comp);
  return `
  <div class="title">Statis<em>tiky</em></div>
  <div class="wrap"><div class="seg">${subs.map(([k, l]) => `<button class="${ui.statSub === k ? 'on' : ''}" data-a="stat-sub" data-v="${k}">${l}</button>`).join('')}</div>${body}</div>`;
}

function statOverview(comp) {
  const [a, b] = comp.st, rv = comp.rivalry;
  const avg = s => s.games ? (s.gf / s.games).toFixed(1).replace('.', ',') : '–';
  const pct = s => s.games ? Math.round(s.w / s.games * 100) + ' %' : '–';
  const ser = s => s.cur > 0 ? s.cur + ' W' : s.cur < 0 ? -s.cur + ' L' : '–';
  const rows = [
    ['Výhry', a.w, b.w, a.w, b.w, true],
    ['Prohry', a.l, b.l, a.l, b.l, false],
    ['Úspěšnost', pct(a), pct(b), a.w / (a.games || 1), b.w / (b.games || 1), true],
    ['Góly celkem', a.gf, b.gf, a.gf, b.gf, true],
    ['Průměr gólů', avg(a), avg(b), a.gf / (a.games || 1), b.gf / (b.games || 1), true],
    ['Nejvyšší výhra', a.big?.score ?? '–', b.big?.score ?? '–', a.big?.diff ?? 0, b.big?.diff ?? 0, true],
    ['Aktuální série', ser(a), ser(b), a.cur, b.cur, true],
    ['Nejdelší série', a.best, b.best, a.best, b.best, true],
    ['Skill shoty', a.skillTotal, b.skillTotal, a.skillTotal, b.skillTotal, true],
    ['Splněné challenge', a.chDone, b.chDone, a.chDone, b.chDone, true],
    ['Mini výzvy', a.miniTotal, b.miniTotal, a.miniTotal, b.miniTotal, true],
    ['Vyloučení', a.ev.foul, b.ev.foul, a.ev.foul, b.ev.foul, false],
    ['Vyhrané bitky', a.ev.fight, b.ev.fight, a.ev.fight, b.ev.fight, true],
    ['Góly v oslabení obdržené', a.ev.pkga + a.ev.shga, b.ev.pkga + b.ev.shga, a.ev.pkga + a.ev.shga, b.ev.pkga + b.ev.shga, false],
    ['XP celkem', fmtNum(Math.max(0, a.xp)), fmtNum(Math.max(0, b.xp)), a.xp, b.xp, true],
  ];
  const cell = (v, me, other, hi) => `<td class="${me !== other && (hi ? me > other : me < other) ? 'best' : ''}">${v}</td>`;
  const head = `<tr><th></th><th>${nm(0)}</th><th>${nm(1)}</th></tr>`;
  const pair = (label, x, y) => `<tr><td>${label}</td>${cell(x, x, y, true)}${cell(y, y, x, true)}</tr>`;
  return `
    <div class="card">
      <div class="h">🌡️ Rivalita meter</div>
      <div class="row"><span class="meter-v">${rv.v}<span class="small mut"> / 100</span></span><span style="font-size:18px;font-weight:800">${rv.ic} ${rv.label}</span></div>
      <div class="meter"><i style="left:${Math.max(4, Math.min(96, rv.v))}%"></i></div>
      <div class="small mut">Z posledních 10 zápasů: vyrovnanost, střídání vítězů, těsné výsledky a série.</div>
    </div>
    <div class="card"><div class="small mut" style="margin-bottom:8px">Odehráno ${comp.sorted.length} zápasů</div>
      <table class="cmp">${head}${rows.map(r => `<tr><td>${r[0]}</td>${cell(r[1], r[3], r[4], r[5])}${cell(r[2], r[4], r[3], r[5])}</tr>`).join('')}</table>
    </div>
    <div class="card"><div class="h">Bilance podle módů (výhry)</div>
      <table class="cmp">${head}${MODE_ORDER.map(k => pair(MODES[k].label, a.byMode[k].w, b.byMode[k].w)).join('')}</table>
    </div>
    <div class="card"><div class="h">Skill shoty podle typu</div>
      <table class="cmp">${head}${SKILLS.map(s => pair(s.label, a.skills[s.k], b.skills[s.k])).join('')}</table>
    </div>
    ${teamStatsCard(comp)}`;
}

/** Oblíbené týmy: top 3 pro každého hráče s bilancí výher a proher. */
function teamStatsCard(comp) {
  const per = [{}, {}];
  for (const m of comp.sorted) {
    for (const p of [0, 1]) {
      const t = m.teams?.[p];
      if (!t) continue;
      per[p][t] = per[p][t] || { n: 0, w: 0 };
      per[p][t].n++;
      if (m.s[p] > m.s[1 - p]) per[p][t].w++;
    }
  }
  const top = p => Object.entries(per[p]).sort((x, y) => y[1].n - x[1].n).slice(0, 3);
  if (!top(0).length && !top(1).length) return '';
  return `<div class="card"><div class="h">🏒 Oblíbené týmy</div>
    ${[0, 1].map(p => `<div class="small mut" style="margin:8px 0 4px">${nm(p)}</div>
      ${top(p).map(([t, s]) => `<div class="hrow" style="align-items:center"><span style="display:flex;align-items:center;gap:8px">${teamBadge(t, 'sm')} ${esc(t)}</span><span class="small"><b>${s.w}</b>–${s.n - s.w}</span></div>`).join('') || '<div class="small mut">—</div>'}`).join('')}
  </div>`;
}

function statSeasons(comp) {
  const curKey = monthKey(nowISO());
  const cur = comp.seasons[curKey] || { w: [0, 0], g: [0, 0], n: 0 };
  const past = Object.keys(comp.seasons).filter(k => k < curKey).sort().reverse();
  const titles = [0, 1].map(p => past.filter(k => comp.seasons[k].champ === p).length);
  return `
    <div class="card hot">
      <div class="h">Aktuální sezóna · ${monthName(curKey)}</div>
      <div class="row" style="margin-top:6px">
        <div><div class="small mut">${nm(0)}</div><div style="font-size:44px;font-weight:900;line-height:1;color:${cur.w[0] > cur.w[1] ? 'var(--mint)' : 'inherit'}">${cur.w[0]}</div></div>
        <div class="small mut" style="text-align:center">${cur.n} ${plural(cur.n, 'zápas', 'zápasy', 'zápasů')}<br>góly ${cur.g[0]}:${cur.g[1]}</div>
        <div style="text-align:right"><div class="small mut">${nm(1)}</div><div style="font-size:44px;font-weight:900;line-height:1;color:${cur.w[1] > cur.w[0] ? 'var(--mint)' : 'inherit'}">${cur.w[1]}</div></div>
      </div>
      <div class="small mut" style="margin-top:10px">Na konci měsíce se vyhlásí šampion (odměna ${kc(data.settings.money.month)}).</div>
    </div>
    <div class="card row"><span>🏆 Tituly</span><span>${nm(0)} <b style="color:var(--gold)">${titles[0]}</b> · <b style="color:var(--gold)">${titles[1]}</b> ${nm(1)}</span></div>
    <div class="card"><div class="h">Archiv sezón</div>
      ${past.length ? past.map(k => {
        const s = comp.seasons[k];
        return `<div class="season"><div><b style="text-transform:capitalize">${monthName(k)}</b><div class="small mut">${s.n} zápasů · ${s.w[0]} : ${s.w[1]}</div></div>
          <div>${s.champ === null ? '<span class="chip">remíza</span>' : `<span class="pill gold" style="min-height:36px">👑 ${nm(s.champ)}</span>`}</div></div>`;
      }).join('') : '<div class="empty">Archiv se naplní po prvním měsíci.</div>'}
    </div>`;
}

function statAch(comp) {
  const cnt = p => ACH.filter(a => comp.st[p].ach[a.id]).length;
  return `
    <div class="card row"><span><b>${nm(0)}</b> ${cnt(0)}/${ACH.length}</span><span>🏆</span><span><b>${nm(1)}</b> ${cnt(1)}/${ACH.length}</span></div>
    <div class="card">
      ${ACH.map(a => {
        const got = [0, 1].map(p => comp.st[p].ach[a.id]);
        return `<div class="ach ${got[0] || got[1] ? '' : 'locked'}">
          <div class="ic">${a.ic}</div>
          <div class="tx"><b>${a.name}</b><span>${a.desc}</span></div>
          <div class="who">${[0, 1].map(p => `<i class="${got[p] ? 'on' : ''}">${got[p] ? '✓ ' : ''}${nm(p)}</i>`).join('')}</div>
        </div>`;
      }).join('')}
    </div>`;
}

/* =========================================================
   OBRAZOVKA: ODMĚNY (tresty, pokladna, žolíci, veta, síň hanby)
   ========================================================= */
function viewRew(comp) {
  const openPen = data.penalties.filter(p => !p.done);
  const donePen = data.penalties.filter(p => p.done).sort((a, b) => b.doneAt.localeCompare(a.doneAt)).slice(0, 10);
  const openLedger = data.ledger.filter(e => !e.settled);
  const net = ledgerBalance();
  const S = data.settings;

  return `
  <div class="title">Odměny <em>& tresty</em></div>
  <div class="wrap">
    <div class="btns3" style="grid-template-columns:1fr 1fr">
      <button class="btn" data-a="draw-rew">🎁 ODMĚNA</button>
      <button class="btn" style="background:var(--red)" data-a="draw-pen">🚨 TREST</button>
    </div>

    <div class="card goldc"><div class="h">🎁 Odměny k vybrání (${data.rewards.filter(r => !r.done).length})</div>
      ${data.rewards.filter(r => !r.done).map(rewardRow).join('') || '<div class="empty" style="padding:8px">Žádné nevybrané odměny. Vyhrávej série a leveluj! 🏆</div>'}
      <div class="small mut" style="margin-top:8px">Odměna padne sama za každý level, za série 3, 5 a 10 výher, nebo si ji vítěz vylosuje.</div>
    </div>

    <div class="card ${openPen.length ? 'warn' : ''}"><div class="h">🍿 Nesplněné tresty (${openPen.length})</div>
      ${openPen.length ? openPen.map(p => penaltyRow(p, comp)).join('') : '<div class="empty" style="padding:8px">Všechno odpracováno 👌</div>'}
    </div>

    <div class="card goldc">
      <div class="h">💰 Pokladna</div>
      <div class="bank">
        ${net ? `<div class="small mut">Dluh: ${nm(net > 0 ? 0 : 1)} → ${nm(net > 0 ? 1 : 0)}</div><div class="amt">${kc(Math.abs(net))}</div>` : `<div class="amt" style="font-size:30px">Vyrovnáno ✓</div>`}
      </div>
      ${openLedger.map(e => `<div class="hrow"><span>${nm(e.from)} → ${nm(e.to)}<br><span class="small mut">${esc(e.reason)} · ${fmtDate(e.date)}</span></span><b style="white-space:nowrap">${kc(e.amount)}</b></div>`).join('')}
      ${openLedger.length ? `<button class="btn gold" style="margin-top:12px" data-a="settle">🤝 Vyrovnáno</button>` : ''}
      <details style="margin-top:12px"><summary class="small mut" style="cursor:pointer;min-height:32px">＋ Přidat položku ručně</summary>
        <div class="seg" style="margin-top:8px" id="debtWho">${[0, 1].map(p => `<button class="${p === 0 ? 'on' : ''}" data-a="debt-who" data-v="${p}">Platí ${nm(p)}</button>`).join('')}</div>
        <input class="field" id="debtAmt" type="number" inputmode="numeric" placeholder="Částka v Kč" style="margin-top:8px">
        <input class="field" id="debtWhy" placeholder="Za co" style="margin-top:8px">
        <button class="btn ghost" style="margin-top:8px" data-a="debt-add">Přidat do pokladny</button>
      </details>
    </div>

    <div class="card"><div class="h">🃏 Žolíci & 🚫 veta</div>
      <div class="tokens">
        ${[0, 1].map(p => `<div class="tok"><div class="small mut">${nm(p)}</div><b>🃏 ${Math.max(0, comp.st[p].jokers)}</b><div class="small mut">🚫 veto: ${Math.max(0, comp.st[p].vetoes)}</div></div>`).join('')}
      </div>
      <div class="small mut" style="margin-top:10px">Žolík = 5 splněných challengí, zruší jeden trest. Veto = série 3 výher, zakáže soupeři tým na příští zápas.</div>
      ${[0, 1].filter(p => comp.st[p].vetoes > 0).map(p => `<button class="btn ghost" style="margin-top:8px" data-a="veto" data-v="${p}">🚫 ${nm(p)}: použít veto</button>`).join('')}
    </div>

    <div class="card"><div class="h">📜 Pravidla</div>
      ${S.leadRules.slice().sort((a, b) => a.lead - b.lead).map(r => `<div class="hrow"><span>Rozdíl ${r.lead} výher</span><span class="mut" style="text-align:right">${esc(r.text)}</span></div>`).join('')}
      <div class="hrow"><span>Vítěz měsíce</span><b>${kc(S.money.month)}</b></div>
      <div class="hrow"><span>Výhra o 7+ gólů</span><b>${kc(S.money.blowout)}</b></div>
      <div class="hrow"><span>10 výher v řadě</span><b>${kc(S.money.streak10)}</b></div>
      <div class="small mut" style="margin-top:8px">Upravíš v Nastavení.</div>
    </div>

    <div class="card shame"><div class="h">🎬 Síň hanby</div>
      ${data.shame.length ? data.shame.slice().reverse().map(s => `<div class="pen" style="flex-direction:column;align-items:stretch">
        <div class="row"><span><b>${nm(s.p)}</b> · ${esc(s.text)}<br><span class="small mut">${fmtDate(s.date)}</span></span>
        <button class="pill no sq" data-a="shame-del" data-v="${s.id}" aria-label="Smazat">🗑</button></div>
        ${s.hasVideo ? `<video controls playsinline preload="metadata" data-vid="${s.id}"></video>` : ''}
      </div>`).join('') : '<div class="empty" style="padding:8px">Zatím prázdná. Zatím…</div>'}
      <button class="btn ghost" style="margin-top:10px" data-a="shame-add">🎥 Přidat video do Síně hanby</button>
    </div>

    ${donePen.length ? `<div class="card"><div class="h">Odpracované tresty</div>
      ${donePen.map(p => `<div class="hrow"><span>${nm(p.loser)}: ${esc(p.text)}</span><span class="small mut" style="white-space:nowrap">${p.joker ? '🃏 žolík' : '✓'} ${fmtDate(p.doneAt)}</span></div>`).join('')}
    </div>` : ''}
  </div>`;
}

const videoURLs = {};
async function loadShameVideos() {
  for (const v of document.querySelectorAll('video[data-vid]')) {
    const id = v.dataset.vid;
    try {
      if (!videoURLs[id]) { const blob = await VideoDB.get(id); if (blob) videoURLs[id] = URL.createObjectURL(blob); }
      if (videoURLs[id]) v.src = videoURLs[id];
    } catch (e) { console.warn('Video nelze načíst', e); }
  }
}

/* =========================================================
   OBRAZOVKA: NASTAVENÍ
   ========================================================= */
function viewSet() {
  const S = data.settings;
  return `
  <div class="title">Nasta<em>vení</em></div>
  <div class="wrap">
    <div class="card"><div class="h">Hráči</div>
      ${[0, 1].map(p => `<label class="lbl">Hráč ${p + 1}</label><input class="field" data-name="${p}" value="${nm(p)}" maxlength="16">`).join('')}
    </div>

    <div class="card"><div class="h">Tresty podle rozdílu výher</div>
      ${S.leadRules.map((r, i) => `<div class="prow">
        <input class="field lead" type="number" inputmode="numeric" min="1" data-rule="${i}" data-f="lead" value="${r.lead}" aria-label="Rozdíl výher">
        <input class="field" data-rule="${i}" data-f="text" value="${esc(r.text)}" placeholder="co musí poražený">
        <button class="x" data-a="rule-del" data-v="${i}" aria-label="Smazat">✕</button>
      </div>`).join('')}
      <button class="btn ghost" data-a="rule-add">＋ Přidat stupeň</button>
    </div>

    <div class="card"><div class="h">Finanční odměny (Kč)</div>
      ${[['month', 'Vítěz měsíce'], ['blowout', 'Výhra o 7+ gólů'], ['streak10', '10 výher v řadě']].map(([k, l]) =>
        `<div class="money-row"><span>${l}</span><input class="field" type="number" inputmode="numeric" min="0" data-money="${k}" value="${S.money[k]}"></div>`).join('')}
    </div>

    <div class="card"><div class="h">Odměny pro vítěze (1 řádek = 1 odměna)</div>
      <textarea class="field" id="rewList" rows="10" style="min-height:240px">${esc((S.rewards || []).join('\n'))}</textarea>
    </div>

    <div class="card"><div class="h">Tresty v kole štěstí (1 řádek = 1 trest)</div>
      <textarea class="field" id="punList" rows="10" style="min-height:240px">${esc(S.punishments.join('\n'))}</textarea>
      <div class="small mut" style="margin-top:6px">Trest se slovem „video“ se po splnění nabídne k uložení do Síně hanby.</div>
    </div>

    <div class="card ${Sync.room ? 'hot' : ''}"><div class="h">🔄 Synchronizace s druhým telefonem</div>
      ${Sync.room ? `
        <div class="row"><span>Stav</span><b>${Sync.statusText()}</b></div>
        <div class="small mut" style="margin:6px 0 10px">Kód rivality: <b>${esc(Sync.room)}</b></div>
        <div class="gap8">
          <button class="btn ghost" data-a="sync-qr">📱 Ukázat QR pro druhý telefon</button>
          <button class="btn ghost" data-a="sync-now">🔄 Synchronizovat teď</button>
          <button class="btn danger" data-a="sync-off">Odpojit tento telefon</button>
        </div>` : `
        <div class="small mut" style="margin-bottom:10px">Spojí tvůj a Sebův telefon: zápas zapsaný u jednoho se do pár sekund objeví i u druhého.</div>
        <div class="gap8">
          <button class="btn" data-a="sync-create">＋ Vytvořit společnou rivalitu</button>
          <button class="btn ghost" data-a="sync-join">Mám kód od druhého telefonu</button>
        </div>`}
    </div>

    <div class="card"><div class="h">Záloha dat</div>
      <div class="gap8">
        <button class="btn ghost" data-a="export">⬇️ Exportovat (JSON)</button>
        <button class="btn ghost" data-a="import">⬆️ Importovat ze zálohy</button>
      </div>
      <div class="small mut" style="margin-top:8px">Videa ze Síně hanby se do zálohy neukládají (jsou moc velká).</div>
    </div>

    <div class="card"><div class="h">Nebezpečná zóna</div>
      <button class="btn danger" data-a="reset">Smazat všechna data</button>
    </div>
    <div class="small mut" style="text-align:center;padding:6px">Data jsou uložená jen v tomto telefonu. Občas si udělej zálohu.</div>
  </div>`;
}

/* =========================================================
   8) ZÁPIS / ÚPRAVA ZÁPASU
   ========================================================= */
let form = null;

function openForm(match) {
  const last = [...data.matches].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  form = match ? clone(match) : {
    id: null, mode: data.drawnMode || last?.mode || '10', s: [0, 0], ot: false,
    teams: last?.teams ? [...last.teams] : ['', ''],
    skills: [emptySkills(), emptySkills()], date: nowISO(),
  };
  form.skills = form.skills || [emptySkills(), emptySkills()];
  form.teams = form.teams || ['', ''];
  form.chRes = {};   // výsledky aktivních challengí zadané ve formuláři
  renderForm();
  document.getElementById('sheet').scrollTop = 0;
  requestAnimationFrame(() => document.getElementById('sheet').classList.add('open'));
}

function closeForm() {
  document.getElementById('sheet').classList.remove('open');
  form = null;
}

function renderForm() {
  const f = form, tie = f.s[0] === f.s[1];
  const w = tie ? null : f.s[0] > f.s[1] ? 0 : 1;
  const counter = (p, k) => {
    const n = f.skills[p][k] || 0;
    return `<div class="cnt"><button data-a="sk" data-p="${p}" data-k="${k}" data-d="-1" aria-label="Méně">−</button><b class="${n ? '' : 'z'}">${n}</b><button data-a="sk" data-p="${p}" data-k="${k}" data-d="1" aria-label="Více">＋</button></div>`;
  };
  const cRow = s => `<div class="sk">${counter(0, s.k)}<div class="lab">${s.label}<small class="${s.xp < 0 ? 'neg' : ''}">${fmtXp(s.xp)}</small></div>${counter(1, s.k)}</div>`;
  const miniCount = MINI.reduce((n, m) => n + (f.skills[0][m.k] || 0) + (f.skills[1][m.k] || 0), 0);
  // Aktivní challenge k potvrzení (jen u nového zápasu)
  const active = f.id ? [] : data.challenges.filter(c => c.status === 'active');
  const chOpts = c => {
    const cur = f.chRes[c.id] || '';
    const o = c.p === 'both'
      ? [['', '— později', 'sk0'], ['win0', nm(0), 'ok'], ['win1', nm(1), 'ok']]
      : [['', '— později', 'sk0'], ['done', '✓ Splnil', 'ok'], ['fail', '✕ Nesplnil', 'ko']];
    return o.map(([v, l, cls]) => `<button class="${cls} ${cur === v ? 'on' : ''}" data-a="fch" data-v="${c.id}" data-r="${v}">${l}</button>`).join('');
  };

  document.getElementById('sheet').innerHTML = `
  <div class="in">
    <div class="top"><h2>${f.id ? 'Upravit zápas' : 'Nový zápas'}</h2><button class="closex" data-a="close" aria-label="Zavřít">✕</button></div>

    <div class="seg">${MODE_ORDER.map(k => `<button class="${f.mode === k ? 'on' : ''}" data-a="mode" data-v="${k}">${MODES[k].label}</button>`).join('')}</div>

    <div class="scorebox">
      ${[0, 1].map(p => `
        <div class="sp ${w === p ? 'win' : ''}" style="order:${p * 2}">
          <div class="n">${nm(p)}</div>
          <div class="v">${f.s[p]}</div>
          <div class="pm"><button data-a="sc" data-p="${p}" data-d="-1" aria-label="Ubrat gól">−</button><button class="plus" data-a="sc" data-p="${p}" data-d="1" aria-label="Přidat gól">＋</button></div>
        </div>`).join('')}
      <div class="colon" style="order:1">:</div>
    </div>
    ${tie && (f.s[0] || f.s[1] || f.id) ? `<div class="tiewarn">V hokeji není remíza, někdo musí vyhrát.</div>` : ''}

    <div class="teams">${[0, 1].map(p => `<button class="tsel" data-a="team-open" data-v="form" data-p="${p}">
      ${f.teams[p] ? teamBadge(f.teams[p]) : '<span class="tbadge custom">?</span>'}
      <span class="n">${f.teams[p] ? esc(f.teams[p]) : `Tým ${nm(p)}`}</span></button>`).join('')}</div>
    ${f.fromScan ? `<div class="card hot scanbox"><div class="h">📷 Načteno z NHL 14</div>
      <div class="small">Zkontroluj, kdo hrál za koho. Když je to obráceně, prohoď.${f.statsFilled ? ' Fauly, přesilovky, oslabení a góly z první jsou vyplněné ze statistik utkání.' : ''}</div>
      <button class="btn ghost" style="margin-top:10px" data-a="swap">⇄ Prohodit ${nm(0)} ↔ ${nm(1)}</button></div>` : ''}

    ${f.mode !== 'SO' ? `
    <div class="card toggle" data-a="ot">
      <div><b>Prodloužení / nájezdy</b><div class="small mut">Výhra po prodloužení dává ${Math.round(OT_FACTOR * 100)} % XP</div></div>
      <div class="sw ${f.ot ? 'on' : ''}"></div>
    </div>` : ''}

    <div class="card">
      <div class="h">Skill shoty a bonusy</div>
      <div class="skhead"><span>${nm(0)}</span><span>${nm(1)}</span></div>
      ${SKILLS.map(cRow).join('')}
    </div>

    <div class="card">
      <div class="h">Fauly, oslabení, bitky</div>
      <div class="skhead"><span>${nm(0)}</span><span>${nm(1)}</span></div>
      ${EVENTS.map(cRow).join('')}
    </div>

    <div class="card">
      <button class="row" style="width:100%;min-height:44px" data-a="mini-toggle">
        <span class="h" style="margin:0">🎯 Mini výzvy během hry ${miniCount ? `(${miniCount})` : ''}</span><span class="small mut">${f.showMini ? 'Skrýt ▲' : 'Ukázat ▼'}</span>
      </button>
      ${f.showMini ? `<div class="skhead" style="margin-top:8px"><span>${nm(0)}</span><span>${nm(1)}</span></div>${MINI.map(cRow).join('')}` : ''}
    </div>

    ${active.length ? `<div class="card hot"><div class="h">⚡ Aktivní challenge</div>
      ${active.map(c => `<div class="fch"><b>${esc(c.name)}</b> <span class="small mut">· ${c.p === 'both' ? 'duel' : nm(c.p)} · +${c.xp} XP</span><div class="opts">${chOpts(c)}</div></div>`).join('')}
    </div>` : ''}

    <div class="small mut" style="text-align:center">📅 ${fmtDate(f.date)}</div>
    <button class="btn" data-a="save" ${tie ? 'disabled' : ''}>${f.id ? 'Uložit změny' : 'Uložit zápas'}</button>
    ${f.id ? `<button class="btn danger" data-a="del" data-v="${f.id}">🗑 Smazat zápas</button>` : ''}
  </div>`;
}

function saveForm() {
  if (!form || form.s[0] === form.s[1]) return;
  const { chRes, fromScan, showMini, statsFilled, ...rest } = form;
  const m = { ...rest, ot: form.mode === 'SO' ? false : form.ot, teams: form.teams.map(t => t.trim()) };
  const isNew = !m.id;
  if (isNew) m.id = uid();
  closeForm();
  ui.tab = 'home';
  mutate(before => {
    if (isNew) {
      data.matches.push(m);
      for (const [id, r] of Object.entries(chRes)) if (r) resolveChallenge(id, r);
      data.vetoes.forEach(v => { v.active = false; });
      data.drawnMode = null;
      afterNewMatch(before, compute(), m);
    } else {
      data.matches = data.matches.map(x => x.id === m.id ? m : x);
    }
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  closeSeasons();
}

/* =========================================================
   9) LOSOVÁNÍ (kolo štěstí)
   ========================================================= */
async function drawMode() {
  const pick = rnd(MODE_ORDER.length);
  const k = MODE_ORDER[pick];
  const v = await spinWheel({
    title: 'Losování módu', icon: '🏒', labels: MODE_ORDER.map(m => MODES[m].label), pick,
    result: `<div class="big">Hrajete: <span style="color:var(--mint)">${MODES[k].label}</span></div><div class="sub">Mód se předvyplní při zápisu zápasu.</div>`,
    actions: [{ v: 'ok', label: 'Beru' }, { v: 'again', label: 'Losovat znovu', cls: 'ghost' }],
  });
  if (v === 'again') return drawMode();
  data.drawnMode = k; persist(); render();
}

/** Losování trestu pro zvoleného hráče (výchozí = poražený posledního zápasu). */
function drawPenaltyStart() {
  const last = compute().sorted.at(-1);
  const def = last ? (last.s[0] > last.s[1] ? 1 : 0) : 1;
  showModal(`<h3>🚨 Losuj trest</h3><p class="mut" style="font-size:14px">Pro koho se točí?</p>
    ${[0, 1].map(p => `<button class="btn ${p === def ? '' : 'ghost'}" data-a="pen-spin" data-v="${p}">${nm(p)}${p === def && last ? ' (prohrál poslední)' : ''}</button>`).join('')}
    <button class="btn ghost" data-a="modal-close">Zrušit</button>`);
}

async function drawPenalty(p) {
  hideModal();
  const list = data.settings.punishments;
  if (!list.length) { toast('⚠️', 'Žádné tresty', 'Doplň seznam v Nastavení', true); return; }
  const pick = rnd(list.length);
  const v = await spinWheel({
    title: `Trest · ${rawNm(p)}`, icon: '🚨', labels: list, pick,
    result: `<div class="big" style="color:var(--red)">${esc(list[pick])}</div>`,
    actions: [{ v: 'ok', label: 'Uložit trest', cls: 'danger' }, { v: 'again', label: 'Losovat znovu', cls: 'ghost' }, { v: 'no', label: 'Zahodit', cls: 'ghost' }],
  });
  if (v === 'again') return drawPenalty(p);
  if (v === 'ok') { addPenalty(p, list[pick], 'kolo štěstí'); persist(); render(); }
}

/** Losování odměny pro vítěze (výchozí = vítěz posledního zápasu). */
function drawRewardStart() {
  const last = compute().sorted.at(-1);
  const def = last ? (last.s[0] > last.s[1] ? 0 : 1) : 0;
  showModal(`<h3>🎁 Losuj odměnu</h3><p class="mut" style="font-size:14px">Pro koho se točí?</p>
    ${[0, 1].map(p => `<button class="btn ${p === def ? '' : 'ghost'}" data-a="rew-spin" data-v="${p}">${nm(p)}${p === def && last ? ' (vyhrál poslední)' : ''}</button>`).join('')}
    <button class="btn ghost" data-a="modal-close">Zrušit</button>`);
}

async function drawReward(p) {
  hideModal();
  const list = data.settings.rewards || [];
  if (!list.length) { toast('⚠️', 'Žádné odměny', 'Doplň seznam v Nastavení', true); return; }
  const pick = rnd(list.length);
  const v = await spinWheel({
    title: `Odměna · ${rawNm(p)}`, icon: '🎁', labels: list, pick,
    result: `<div class="big" style="color:var(--gold)">${esc(list[pick])}</div>`,
    actions: [{ v: 'ok', label: 'Uložit odměnu', cls: 'gold' }, { v: 'again', label: 'Losovat znovu', cls: 'ghost' }, { v: 'no', label: 'Zahodit', cls: 'ghost' }],
  });
  if (v === 'again') return drawReward(p);
  if (v === 'ok') { addReward(p, 'kolo štěstí', list[pick]); persist(); render(); }
}

/* Losování challenge: nejdřív výběr pro koho a z jaké kategorie */
const drawState = { p: 0, cat: 'random' };
function drawChallengeStart() {
  const d = drawState;
  showModal(`<h3>⚡ Losuj challenge</h3>
    <label class="lbl">Pro koho</label>
    <div class="seg">${[[0, nm(0)], [1, nm(1)], ['both', 'Oba']].map(([v, l]) => `<button class="${String(d.p) === String(v) ? 'on' : ''}" data-a="dr-p" data-v="${v}">${l}</button>`).join('')}</div>
    <label class="lbl">Z čeho</label>
    <div class="seg">${[['random', 'Náhodné'], ['team', 'Týmové'], ['duel', 'Duel'], ['all', 'Vše']].map(([v, l]) => `<button class="${d.cat === v ? 'on' : ''}" data-a="dr-cat" data-v="${v}">${l}</button>`).join('')}</div>
    ${d.cat === 'duel' ? '<div class="small mut">Duel je vždy pro oba, vítěz bere XP od druhého.</div>' : ''}
    <button class="btn" style="margin-top:8px" data-a="dr-go">🎡 Roztočit kolo</button>
    <button class="btn ghost" data-a="modal-close">Zrušit</button>`);
}

async function drawChallenge() {
  hideModal();
  const d = drawState;
  const pool = data.catalog.filter(c => c.cat !== 'auto' && (d.cat === 'all' || c.cat === d.cat));
  if (!pool.length) { toast('⚠️', 'Prázdný katalog', 'V této kategorii nic není', true); return; }
  const pick = rnd(pool.length), item = pool[pick];
  const forWho = item.cat === 'duel' ? 'both' : d.p;
  const whoTxt = forWho === 'both' ? '· oba' : `· ${rawNm(forWho)}`;
  const failTxt = [item.fail.xp ? `−${item.fail.xp} XP` : '', item.fail.money ? kc(item.fail.money) : '', item.fail.penalty ? 'trest' : ''].filter(Boolean).join(' · ');
  const v = await spinWheel({
    title: `Challenge ${whoTxt}`, icon: '⚡', labels: pool.map(c => c.name), pick,
    result: `<div><span class="chip ${item.diff}">${DIFF[item.diff]}</span> <span class="chip m">+${item.xp} XP</span>${failTxt ? ` <span class="chip">nesplnění: ${failTxt}</span>` : ''}</div>
      <div class="big">${esc(item.name)}</div><div class="sub">${esc(item.text)}</div>`,
    actions: [{ v: 'ok', label: 'Přijímám výzvu' }, { v: 'again', label: 'Losovat znovu', cls: 'ghost' }, { v: 'no', label: 'Zrušit', cls: 'ghost' }],
  });
  if (v === 'again') return drawChallenge();
  if (v !== 'ok') return;
  await acceptChallenge(item, forWho);
}

/** Přijetí challenge + speciální akce (losování týmů, zrcadlo). */
async function acceptChallenge(item, forWho) {
  let extra = '';
  if (item.action === 'mirror') {
    const last = compute().sorted.at(-1);
    extra = last?.teams?.[0] || last?.teams?.[1]
      ? `${rawNm(0)} hraje za ${last.teams[1] || '?'}, ${rawNm(1)} za ${last.teams[0] || '?'}.`
      : 'Minulý zápas nemá zapsané týmy, domluvte se.';
  }
  if (item.action === 'draft') {
    const picks = [];
    for (const p of [0, 1]) {
      const i = rnd(TEAMS.length);
      await spinWheel({ title: `${item.name} · tým · ${rawNm(p)}`, icon: '🏒', labels: TEAMS, pick: i,
        result: `<div class="big">${esc(rawNm(p))} → <span style="color:var(--mint)">${esc(TEAMS[i])}</span></div>`, actions: [{ v: 'ok', label: p === 0 ? 'Další' : 'Hotovo' }] });
      picks.push(TEAMS[i]);
    }
    extra = `${rawNm(0)}: ${picks[0]} · ${rawNm(1)}: ${picks[1]}`;
  }
  const targets = forWho === 'both' && item.cat !== 'duel' ? [0, 1] : [forWho];
  for (const p of targets) assignChallenge(item, p, extra);
  persist(); render();
  toast('⚡', 'Challenge přijata', item.name);
}

/** Ruční zadání challenge z katalogu. */
function assignStart(id) {
  const item = data.catalog.find(c => c.id === id);
  if (!item) return;
  if (item.cat === 'duel') { acceptChallenge(item, 'both'); return; }
  showModal(`<h3>${esc(item.name)}</h3><p class="mut" style="font-size:14px">${esc(item.text)}</p>
    ${[0, 1].map(p => `<button class="btn ghost" data-a="assign-go" data-v="${id}" data-p="${p}">Zadat: ${nm(p)}</button>`).join('')}
    <button class="btn ghost" data-a="assign-go" data-v="${id}" data-p="both">Zadat oběma</button>
    <button class="btn ghost" data-a="modal-close">Zrušit</button>`);
}

/* =========================================================
   10) EDITACE KATALOGU CHALLENGÍ
   ========================================================= */
let editCh = null;
function editChallenge(id) {
  const src = id ? data.catalog.find(c => c.id === id) : null;
  editCh = src ? clone(src) : { id: null, cat: ui.catFilter === 'auto' ? 'random' : ui.catFilter, name: '', text: '', diff: 'mid', xp: 30, fail: { xp: 0, money: 0, penalty: false } };
  renderEditCh();
}

function renderEditCh() {
  const c = editCh;
  const cats = c.cat === 'auto' ? [['auto', 'Automatická']] : [['random', 'Náhodná'], ['team', 'Týmová'], ['duel', 'Duel']];
  showModal(`<h3>${c.id ? 'Upravit challenge' : 'Nová challenge'}</h3>
    <label class="lbl">Název</label><input class="field" id="ecName" value="${esc(c.name)}" maxlength="40">
    <label class="lbl">Popis</label><textarea class="field" id="ecText">${esc(c.text)}</textarea>
    <label class="lbl">Kategorie</label><div class="seg">${cats.map(([v, l]) => `<button class="${c.cat === v ? 'on' : ''}" data-a="ec-cat" data-v="${v}">${l}</button>`).join('')}</div>
    <label class="lbl">Obtížnost</label><div class="seg">${Object.entries(DIFF).map(([v, l]) => `<button class="${c.diff === v ? 'on' : ''}" data-a="ec-diff" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="money-row" style="margin-top:12px"><span>Odměna (XP)</span><input class="field" id="ecXp" type="number" inputmode="numeric" value="${c.xp}"></div>
    <div class="h" style="margin-top:6px">Při nesplnění</div>
    <div class="money-row"><span>Ztráta XP</span><input class="field" id="ecFxp" type="number" inputmode="numeric" value="${c.fail.xp || 0}"></div>
    <div class="money-row"><span>Do pokladny (Kč)</span><input class="field" id="ecFmoney" type="number" inputmode="numeric" value="${c.fail.money || 0}"></div>
    <div class="toggle" data-a="ec-pen" style="min-height:52px"><span>Trest z kola štěstí</span><div class="sw ${c.fail.penalty ? 'on' : ''}"></div></div>
    <button class="btn" data-a="ec-save">Uložit</button>
    ${c.id ? '<button class="btn danger" data-a="ec-del">Smazat z katalogu</button>' : ''}
    <button class="btn ghost" data-a="modal-close">Zrušit</button>`);
}

/** Přenese hodnoty z polí do editCh (před překreslením modalu). */
function syncEditCh() {
  const g = id => document.getElementById(id);
  if (!g('ecName')) return;
  editCh.name = g('ecName').value.trim();
  editCh.text = g('ecText').value.trim();
  editCh.xp = Math.max(0, parseInt(g('ecXp').value, 10) || 0);
  editCh.fail.xp = Math.max(0, parseInt(g('ecFxp').value, 10) || 0);
  editCh.fail.money = Math.max(0, parseInt(g('ecFmoney').value, 10) || 0);
}

/* =========================================================
   10b) VÝBĚR TÝMU (mřížka týmů NHL 14 + reprezentace)
   teamPick.kind: 'form' = tým do zápisu zápasu, 'veto' = zakázaný tým pro soupeře
   ========================================================= */
const teamPick = { kind: 'form', p: 0, group: 'nhl' };

function openTeamPicker({ kind, p }) {
  teamPick.kind = kind; teamPick.p = p;
  renderTeamPicker();
}

function renderTeamPicker() {
  const { kind, p, group } = teamPick;
  const current = kind === 'form' && form ? form.teams[p] : '';
  const groups = TEAM_GROUPS.filter(g => group === 'all' || g.id === group || (group === 'nhl' && g.id !== 'int'));
  const title = kind === 'veto'
    ? `🚫 Veto · ${nm(p)}<div class="small mut" style="font-weight:500;margin-top:4px">Za jaký tým ${nm(1 - p)} příště hrát nesmí?</div>`
    : `Tým · ${nm(p)}`;
  showModal(`<h3>${title}</h3>
    <input class="field" id="teamSearch" placeholder="Hledat tým…" autocomplete="off">
    <div class="seg">${[['nhl', 'NHL'], ['int', 'Reprezentace'], ['all', 'Vše']].map(([v, l]) => `<button class="${group === v ? 'on' : ''}" data-a="team-grp" data-v="${v}">${l}</button>`).join('')}</div>
    <button class="btn ghost" data-a="team-rnd">🎲 Náhodný tým</button>
    <div class="tgrid" id="teamGrid">
      ${groups.map(g => `<div class="tgh">${g.label}</div>` + g.teams.map(([abbr, name]) =>
        `<button class="tpick ${current === name ? 'on' : ''}" data-a="team-pick" data-v="${esc(name)}" data-n="${esc((name + ' ' + abbr).toLowerCase())}">${teamBadge(name)}<span>${esc(name)}</span></button>`).join('')).join('')}
    </div>
    <button class="btn ghost hidden" id="teamCustom" data-a="team-custom">Použít vlastní název</button>
    ${kind === 'form' && current ? `<button class="btn ghost" data-a="team-pick" data-v="">Bez týmu</button>` : ''}
    <button class="btn ghost" data-a="modal-close">Zavřít</button>`);
}

/** Výsledek výběru: zapíše tým do formuláře, nebo vyhlásí veto. */
function choosePickedTeam(name) {
  const { kind, p } = teamPick;
  hideModal();
  if (kind === 'form' && form) {
    form.teams[p] = name;
    renderForm();
    return;
  }
  if (kind === 'veto' && name) {
    data.vetoes.push({ id: uid(), by: p, team: name, date: nowISO(), active: true });
    data.vetoUsed[p] = (data.vetoUsed[p] || 0) + 1;
    persist(); render();
    celebrate({ kind: 'red', ic: '🚫', k: `Veto · ${rawNm(p)}`, t: name, s: `${rawNm(1 - p)} za tento tým příště hrát nesmí.` });
  }
}

/* Vyhledávání v mřížce bez překreslení */
document.addEventListener('input', e => {
  if (e.target.id !== 'teamSearch') return;
  const q = e.target.value.trim().toLowerCase();
  let any = false;
  document.querySelectorAll('#teamGrid .tpick').forEach(b => { const hit = !q || b.dataset.n.startsWith(q) || b.dataset.n.split(' ').some(w => w.startsWith(q)); b.classList.toggle('hidden', !hit); any = any || hit; });
  document.querySelectorAll('#teamGrid .tgh').forEach(h => h.classList.toggle('hidden', !!q));
  document.getElementById('teamCustom').classList.toggle('hidden', !q || any);
});

/* =========================================================
   11) MODAL
   ========================================================= */
function showModal(html) {
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modal').classList.remove('hidden');
}
function hideModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modalBox').innerHTML = '';
}
document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') hideModal(); });

/* =========================================================
   12) EXPORT / IMPORT / VIDEO
   ========================================================= */
function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nhl14-rivalita-zaloha-${nowISO().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('💾', 'Záloha', 'Soubor se stahuje');
}

document.getElementById('importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || !Array.isArray(parsed.matches)) throw new Error('Neplatný formát');
    if (!(await confirmBox(`Nahrát zálohu s ${parsed.matches.length} zápasy? Současná data se přepíšou.`, 'Nahrát'))) return;
    data = normalize(parsed);
    persist(); render();
    toast('✅', 'Import', 'Data obnovena ze zálohy');
  } catch (err) {
    toast('⚠️', 'Import selhal', 'Soubor není platná záloha', true);
  }
});

/* Video do Síně hanby: pendingShame = { p, text } čeká na výběr souboru */
let pendingShame = null;
function shameStart(p = null, text = '') {
  if (p === null) {
    showModal(`<h3>🎬 Síň hanby</h3><p class="mut" style="font-size:14px">Čí video to je?</p>
      ${[0, 1].map(q => `<button class="btn ghost" data-a="shame-who" data-v="${q}">${nm(q)}</button>`).join('')}
      <button class="btn ghost" data-a="modal-close">Zrušit</button>`);
    return;
  }
  pendingShame = { p, text: text || 'Uznává porážku' };
  showModal(`<h3>🎬 Síň hanby · ${nm(p)}</h3><p class="mut" style="font-size:14px">${esc(pendingShame.text)}</p>
    <button class="btn" data-a="shame-pick">🎥 Vybrat / natočit video</button>
    <button class="btn ghost" data-a="modal-close">Později</button>`);
}

document.getElementById('videoFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !pendingShame) return;
  const entry = { id: uid(), p: pendingShame.p, text: pendingShame.text, date: nowISO(), hasVideo: true };
  pendingShame = null;
  try {
    await VideoDB.put(entry.id, file);
    data.shame.push(entry); persist();
    ui.tab = 'rew'; render();
    celebrate({ kind: 'red', ic: '🎬', k: 'Síň hanby', t: rawNm(entry.p), s: 'Video uloženo navěky. Nebo do resetu.' });
  } catch (err) {
    toast('⚠️', 'Video', 'Nepodařilo se uložit (moc velké?)', true);
  }
});

/* =========================================================
   13) OVLÁDÁNÍ — jeden posluchač pro všechna tlačítka [data-a]
   ========================================================= */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a, v = el.dataset.v;

  switch (a) {
    /* navigace */
    case 'tab': ui.tab = v; render(); window.scrollTo(0, 0); break;
    case 'filter': ui.histFilter = v; render(); break;
    case 'stat-sub': ui.statSub = v; render(); break;
    case 'cat-filter': ui.catFilter = v; render(); break;
    case 'modal-close': hideModal(); break;

    /* zápas */
    case 'new': openForm(null); break;
    case 'edit': openForm(data.matches.find(m => m.id === v)); break;
    case 'close': closeForm(); break;
    case 'mode': form.mode = v; renderForm(); break;
    case 'sc': { const p = +el.dataset.p; form.s[p] = Math.max(0, Math.min(99, form.s[p] + +el.dataset.d)); renderForm(); break; }
    case 'sk': { const p = +el.dataset.p, k = el.dataset.k; form.skills[p][k] = Math.max(0, (form.skills[p][k] || 0) + +el.dataset.d); renderForm(); break; }
    case 'ot': form.ot = !form.ot; renderForm(); break;
    case 'mini-toggle': form.showMini = !form.showMini; renderForm(); break;
    case 'swap': form.s.reverse(); form.teams.reverse(); [form.skills[0], form.skills[1]] = [form.skills[1], form.skills[0]]; renderForm(); break;
    case 'fch': form.chRes[v] = el.dataset.r; renderForm(); break;
    case 'save': saveForm(); break;
    case 'del':
      if (await confirmBox('Opravdu smazat tento zápas? XP a statistiky se přepočítají.', 'Smazat')) {
        if (form) closeForm();
        mutate(() => { data.matches = data.matches.filter(m => m.id !== v); markDeleted(v); });
      }
      break;

    /* losování */
    case 'draw-mode': drawMode(); break;
    case 'draw-pen': drawPenaltyStart(); break;
    case 'pen-spin': drawPenalty(+v); break;
    case 'draw-rew': drawRewardStart(); break;
    case 'rew-spin': drawReward(+v); break;
    case 'rew-done': {
      const r = data.rewards.find(x => x.id === v);
      r.done = true; r.doneAt = nowISO(); persist(); render();
      toast('🎁', 'Odměna vybrána', `${rawNm(r.p)} si užil: ${r.text}`);
      break;
    }
    case 'draw-ch': drawChallengeStart(); break;
    case 'dr-p': drawState.p = v === 'both' ? 'both' : +v; drawChallengeStart(); break;
    case 'dr-cat': drawState.cat = v; drawChallengeStart(); break;
    case 'dr-go': drawChallenge(); break;

    /* challenge */
    case 'ch-res': {
      const r = el.dataset.r;
      if (r === 'fail' && !(await confirmBox('Označit jako nesplněnou? Může to stát XP nebo peníze.', 'Nesplněno'))) break;
      mutate(() => resolveChallenge(v, r));
      break;
    }
    case 'ch-assign': assignStart(v); break;
    case 'assign-go': {
      const item = data.catalog.find(c => c.id === v);
      hideModal();
      if (item) acceptChallenge(item, el.dataset.p === 'both' ? 'both' : +el.dataset.p);
      break;
    }
    case 'ch-new': editChallenge(null); break;
    case 'ch-edit': editChallenge(v); break;
    case 'ec-cat': syncEditCh(); editCh.cat = v; renderEditCh(); break;
    case 'ec-diff': syncEditCh(); editCh.diff = v; renderEditCh(); break;
    case 'ec-pen': syncEditCh(); editCh.fail.penalty = !editCh.fail.penalty; renderEditCh(); break;
    case 'ec-save':
      syncEditCh();
      if (!editCh.name) { toast('⚠️', 'Chybí název', 'Vyplň název challenge', true); break; }
      if (editCh.id) data.catalog = data.catalog.map(c => c.id === editCh.id ? editCh : c);
      else data.catalog.push({ ...editCh, id: uid() });
      persist(); hideModal(); ui.catFilter = editCh.cat; render();
      toast('✅', 'Katalog', 'Challenge uložena');
      break;
    case 'ec-del':
      if (await confirmBox(`Smazat „${editCh.name}“ z katalogu?`, 'Smazat')) {
        data.catalog = data.catalog.filter(c => c.id !== editCh.id); markDeleted(editCh.id);
        persist(); hideModal(); render();
      }
      break;

    /* tresty, žolík, veto */
    case 'pen-done': {
      const pen = data.penalties.find(p => p.id === v);
      mutate(() => { pen.done = true; pen.doneAt = nowISO(); });
      toast('🤝', 'Trest splněn', 'Dluh je smazán');
      if (pen.video) shameStart(pen.loser, pen.text);
      break;
    }
    case 'pen-joker': {
      const pen = data.penalties.find(p => p.id === v);
      if (!(await confirmBox(`Použít žolíka a zrušit trest „${pen.text}“?`, '🃏 Použít', false))) break;
      mutate(() => { pen.done = true; pen.joker = true; pen.doneAt = nowISO(); data.jokersUsed[pen.loser] = (data.jokersUsed[pen.loser] || 0) + 1; });
      celebrate({ kind: 'gold', ic: '🃏', k: 'Žolík použit', t: rawNm(pen.loser), s: `Trest „${pen.text}“ je zrušen.` });
      break;
    }
    case 'veto': openTeamPicker({ kind: 'veto', p: +v }); break;

    /* výběr týmu */
    case 'team-open': openTeamPicker({ kind: 'form', p: +el.dataset.p }); break;
    case 'team-grp': teamPick.group = v; renderTeamPicker(); break;
    case 'team-rnd': {
      const pool = TEAM_LIST.filter(t => teamPick.group === 'all' || t.group === teamPick.group || (teamPick.group === 'nhl' && t.group !== 'int'));
      choosePickedTeam(pool[rnd(pool.length)].name);
      break;
    }
    case 'team-pick': choosePickedTeam(v); break;
    case 'team-custom': {
      const val = document.getElementById('teamSearch').value.trim();
      if (val) choosePickedTeam(val);
      break;
    }
    /* pokladna */
    case 'settle':
      if (await confirmBox('Všechny dluhy jsou zaplacené?', 'Vyrovnáno', false)) {
        data.ledger.forEach(x => { if (!x.settled) { x.settled = true; x.settledAt = nowISO(); } });
        persist(); render();
        toast('🤝', 'Pokladna', 'Vyrovnáno, čistý stůl');
      }
      break;
    case 'debt-who':
      document.querySelectorAll('#debtWho button').forEach(b => b.classList.toggle('on', b === el));
      break;
    case 'debt-add': {
      const who = +document.querySelector('#debtWho button.on').dataset.v;
      const amt = parseInt(document.getElementById('debtAmt').value, 10);
      const why = document.getElementById('debtWhy').value.trim() || 'ručně';
      if (!amt || amt <= 0) { toast('⚠️', 'Částka', 'Zadej kladnou částku', true); break; }
      addDebt(who, 1 - who, amt, why); persist(); render();
      break;
    }

    /* síň hanby */
    case 'shame-add': shameStart(); break;
    case 'shame-who': shameStart(+v); break;
    case 'shame-pick': hideModal(); document.getElementById('videoFile').click(); break;
    case 'shame-del':
      if (await confirmBox('Smazat záznam ze Síně hanby?', 'Smazat')) {
        data.shame = data.shame.filter(s => s.id !== v); markDeleted(v);
        VideoDB.del(v).catch(() => {});
        persist(); render();
      }
      break;

    /* nastavení */
    case 'rule-add': data.settings.leadRules.push({ lead: Math.max(0, ...data.settings.leadRules.map(r => r.lead)) + 5, text: '' }); persist(); render(); break;
    case 'rule-del': data.settings.leadRules.splice(+v, 1); persist(); render(); break;
    case 'export': exportData(); break;
    case 'import': document.getElementById('importFile').click(); break;
    case 'reset':
      if (await confirmBox('Smazat úplně všechna data? Zápasy, XP, odznaky, tresty i pokladna zmizí. Nejde to vrátit.', 'Smazat vše')) {
        if (await confirmBox('Fakt? Poslední šance. Doporučuju nejdřív export.', 'Ano, smazat')) {
          data = defaultData(); persist(); ui.tab = 'home'; render();
          toast('🧹', 'Reset', 'Začínáte od nuly');
        }
      }
      break;
  }
});

/* Textová pole (bez překreslení, aby neutíkal kurzor) */
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.name !== undefined) {
    data.names[+t.dataset.name] = t.value.trim() || (+t.dataset.name ? 'Seba' : 'Jenda');
    persist();
  } else if (t.dataset.rule !== undefined) {
    const r = data.settings.leadRules[+t.dataset.rule];
    if (t.dataset.f === 'lead') r.lead = Math.max(1, parseInt(t.value, 10) || 1);
    else r.text = t.value;
    persist();
  } else if (t.dataset.money !== undefined) {
    data.settings.money[t.dataset.money] = Math.max(0, parseInt(t.value, 10) || 0);
    persist();
  } else if (t.id === 'rewList') {
    data.settings.rewards = t.value.split('\n').map(x => x.trim()).filter(Boolean);
    persist();
  } else if (t.id === 'punList') {
    data.settings.punishments = t.value.split('\n').map(s => s.trim()).filter(Boolean);
    persist();
  } else if (t.dataset.team !== undefined && form) {
    form.teams[+t.dataset.team] = t.value;
  }
});

/* =========================================================
   ODKAZ Z QR KÓDU (most z RPCS3): ?z=DET.3.PIT.2.OT
   Otevře zápis zápasu s předvyplněnými týmy a skóre.
   ========================================================= */
function openFromLink() {
  const z = new URLSearchParams(location.search).get('z');
  if (!z) return;
  const stParam = new URLSearchParams(location.search).get('st');
  history.replaceState(null, '', location.pathname);           // ať se po obnovení stránky neotevře znovu
  const [a1, s1, a2, s2, flag] = z.split('.');
  const teamName = abbr => TEAM_LIST.find(t => t.abbr === abbr)?.name || '';
  let teams = [teamName(a1), teamName(a2)], score = [parseInt(s1, 10) || 0, parseInt(s2, 10) || 0], swapped = false;
  // Kdo hrál za koho: podle týmů z minulého zápasu (když sedí obráceně, prohodit)
  const last = [...data.matches].sort((x, y) => x.date.localeCompare(y.date)).at(-1);
  if (last?.teams && (last.teams[1] === teams[0] || last.teams[0] === teams[1]) && last.teams[0] !== teams[0]) {
    teams.reverse(); score.reverse(); swapped = true;
  }
  openForm(null);
  form.teams = teams; form.s = score; form.ot = flag === 'OT' || flag === 'SO'; form.fromScan = true;
  // st = tr.min. A.B, góly v přesilovce A.B, góly v oslabení A.B, góly z první A.B (pořadí jako v z)
  const st = (new URLSearchParams(location.search).get('st') || stParam || '').split('.').map(n => parseInt(n, 10));
  if (st.length === 8 && st.every(n => !isNaN(n))) {
    let pim = [st[0], st[1]], ppg = [st[2], st[3]], shg = [st[4], st[5]], one = [st[6], st[7]];
    if (swapped) { pim.reverse(); ppg.reverse(); shg.reverse(); one.reverse(); }
    for (const p of [0, 1]) {
      Object.assign(form.skills[p], {
        foul: Math.round(pim[p] / 2), pkga: ppg[1 - p], shga: shg[1 - p], m_shg: shg[p], one: one[p],
      });
    }
    form.statsFilled = true;
  }
  renderForm();
  toast('📷', 'Výsledek z NHL 14', `${a1} ${s1} : ${s2} ${a2}${flag ? ' · ' + flag : ''}`);
}

/* =========================================================
   SYNCHRONIZACE (Firebase Realtime Database přes REST, bez knihoven)
   Oba telefony sdílí jeden „pokoj“ (náhodný kód). Celý stav se ukládá do
   /rooms/<kód>; změny chodí živě přes EventSource. Při rozdílu se seznamy
   sloučí podle id a vyhrává novější verze položek, které jsou v obou.
   ========================================================= */
const SYNC_DB = 'https://nhl14-rivalita-default-rtdb.europe-west1.firebasedatabase.app';
const SYNC_ROOM_KEY = 'nhl14-rivalita-room';

/** Sloučí dva stavy: novější je základ, ze staršího přibudou položky, které novější nezná (a nebyly smazané). */
function mergeStates(newer, older) {
  const out = normalize(clone(newer));
  const o = normalize(clone(older));
  out.deletedIds = [...new Set([...out.deletedIds, ...o.deletedIds])];
  const gone = new Set(out.deletedIds);
  let added = 0;
  for (const k of SYNC_COLLECTIONS) {
    out[k] = out[k].filter(x => !gone.has(x.id));
    const have = new Set(out[k].map(x => x.id));
    for (const x of o[k]) if (x.id && !have.has(x.id) && !gone.has(x.id)) { out[k].push(x); added++; }
  }
  out.seasonsClosed = [...new Set([...(out.seasonsClosed || []), ...(o.seasonsClosed || [])])];
  return { state: out, added };
}

const Sync = {
  room: (() => { try { return localStorage.getItem(SYNC_ROOM_KEY); } catch (e) { return null; } })(),
  es: null, timer: null, lastOk: 0, status: 'off',
  url() { return `${SYNC_DB}/rooms/${this.room}.json`; },
  statusText() {
    if (this.status === 'live') return '🟢 Připojeno' + (this.lastOk ? ` · ${new Date(this.lastOk).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}` : '');
    if (this.status === 'error') return '🔴 Bez spojení';
    return '🟡 Připojuji…';
  },
  setStatus(s) { this.status = s; if (ui.tab === 'set') render(); },

  /** Odeslat celý stav (s krátkým zpožděním, ať se víc změn pošle najednou). */
  schedulePush() {
    if (!this.room) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), 700);
  },
  async push() {
    if (!this.room) return;
    try {
      const r = await fetch(this.url(), { method: 'PUT', body: JSON.stringify(data) });
      if (!r.ok) throw new Error(r.status);
      this.lastOk = Date.now(); this.setStatus('live');
    } catch (e) { this.setStatus('error'); }
  },

  /** Zpracuje stav ze serveru (při startu, z živého spojení i ručně). */
  receive(remote) {
    if (!remote || !remote.matches && !remote.updatedAt) { this.push(); return; }   // prázdný pokoj → nahrát naše data
    const rAt = remote.updatedAt || 0, lAt = data.updatedAt || 0;
    if (rAt === lAt) { this.lastOk = Date.now(); this.setStatus('live'); return; }  // to jsme poslali my
    const before = compute();
    if (rAt > lAt) {
      const { state, added } = mergeStates(remote, data);
      data = state; data.updatedAt = rAt;
      persist(true);
      if (added) persist();                 // měli jsme něco navíc → poslat zpět
      announceRemote(before);
    } else {
      const { state } = mergeStates(data, remote);
      data = state; persist();              // naše verze je novější → poslat
    }
    this.lastOk = Date.now(); this.setStatus('live');
    if (!document.getElementById('sheet').classList.contains('open')) render();
  },
  async pull() {
    if (!this.room) return;
    try { const r = await fetch(this.url()); this.receive(await r.json()); }
    catch (e) { this.setStatus('error'); }
  },

  /** Živé spojení: Firebase posílá změny přes EventSource. Když spadne, zkusí se znovu + záložní dotaz. */
  connect() {
    if (!this.room || SYNC_DB.startsWith('FIREBASE')) return;
    this.disconnect(false);
    this.setStatus('connecting');
    try {
      this.es = new EventSource(this.url());
      this.es.addEventListener('put', ev => {
        try { const msg = JSON.parse(ev.data); if (msg.path === '/') this.receive(msg.data); else this.pull(); } catch (e) {}
      });
      this.es.addEventListener('patch', () => this.pull());
      this.es.onerror = () => { this.setStatus('error'); };
    } catch (e) { this.setStatus('error'); }
    this.pull();
  },
  disconnect(clearRoom = true) {
    if (this.es) { this.es.close(); this.es = null; }
    if (clearRoom) { this.room = null; try { localStorage.removeItem(SYNC_ROOM_KEY); } catch (e) {} this.status = 'off'; }
  },
  join(code) {
    this.room = code;
    try { localStorage.setItem(SYNC_ROOM_KEY, code); } catch (e) {}
    this.connect();
  },
  link() { return `${location.origin}${location.pathname}?room=${encodeURIComponent(this.room)}`; },
};

/** Ohlásí, co přišlo z druhého telefonu (nový zápas apod.). */
function announceRemote(before) {
  const after = compute();
  const n = after.sorted.length - before.sorted.length;
  if (n > 0) {
    const m = after.sorted.at(-1);
    toast('🔄', 'Z druhého telefonu', `Nový zápas: ${rawNm(0)} ${m.s[0]} : ${m.s[1]} ${rawNm(1)}`);
  } else toast('🔄', 'Synchronizováno', 'Data z druhého telefonu');
}

/** QR kód pro druhý telefon (knihovna se načte až při prvním použití). */
function loadQRLib() {
  if (window.QRCode) return Promise.resolve();
  return new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    sc.onload = res; sc.onerror = rej; document.head.appendChild(sc);
  });
}
async function showSyncQR() {
  showModal(`<h3>📱 Spojit druhý telefon</h3>
    <p class="mut" style="font-size:14px">Na druhém telefonu naskenuj tenhle kód fotoaparátem. Otevře se Rivalita a spojí se.</p>
    <div id="syncQR" style="background:#fff;padding:16px;border-radius:18px;align-self:center"></div>
    <div class="small mut" style="text-align:center;word-break:break-all">${esc(Sync.link())}</div>
    <button class="btn ghost" data-a="modal-close">Hotovo</button>`);
  try {
    await loadQRLib();
    new QRCode(document.getElementById('syncQR'), { text: Sync.link(), width: 220, height: 220, colorDark: '#13233F', colorLight: '#ffffff' });
  } catch (e) { document.getElementById('syncQR').textContent = 'QR se nenačetl, pošli odkaz výše.'; }
}

/** Odkaz ?room=… z QR druhého telefonu → připojit (a sloučit, co je v tomto telefonu). */
function joinFromLink() {
  const room = new URLSearchParams(location.search).get('room');
  if (!room) return;
  history.replaceState(null, '', location.pathname);
  if (Sync.room === room) return;
  Sync.join(room);
  toast('🔄', 'Spojeno', 'Tento telefon teď sdílí rivalitu s druhým');
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  switch (el.dataset.a) {
    case 'sync-create': {
      const code = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : uid() + uid()).slice(0, 20);
      Sync.join(code); persist(); render(); showSyncQR();
      break;
    }
    case 'sync-join':
      showModal(`<h3>Připojit kódem</h3><input class="field" id="syncCode" placeholder="Kód rivality" autocomplete="off">
        <button class="btn" data-a="sync-join-go">Připojit</button><button class="btn ghost" data-a="modal-close">Zrušit</button>`);
      break;
    case 'sync-join-go': {
      const code = document.getElementById('syncCode').value.trim();
      if (code) { hideModal(); Sync.join(code); render(); }
      break;
    }
    case 'sync-qr': showSyncQR(); break;
    case 'sync-now': Sync.pull(); toast('🔄', 'Synchronizace', 'Stahuji data…'); break;
    case 'sync-off':
      if (await confirmBox('Odpojit tento telefon? Data v něm zůstanou, jen se přestanou sdílet.', 'Odpojit')) { Sync.disconnect(); render(); }
      break;
  }
});
/* Po návratu do aplikace (telefon ji uspí) se znovu spojit */
document.addEventListener('visibilitychange', () => { if (!document.hidden && Sync.room) Sync.connect(); });

/* =========================================================
   START
   ========================================================= */
document.getElementById('teamsList').innerHTML = TEAMS.map(t => `<option value="${esc(t)}">`).join('');
render();
closeSeasons();
joinFromLink();
Sync.connect();
openFromLink();
