'use strict';

const musicTaxonomy = [
  {
    category: 'Electronic',
    genres: [
      { name: 'House', subgenres: ['Acid', 'Afro', 'Amapiano', 'Bass', 'Chicago', 'Classic', 'Deep', 'Detroit', 'Disco House', 'Electro', 'French', 'Funky', 'Garage House', 'Ghetto', 'Hard', 'Italo', 'Jackin', 'Jakbeat', 'Lo-Fi', 'Melodic House', 'Microhouse', 'Minimal', 'Organic', 'Progressive House', 'Raw', 'Tech House', 'Tribal', 'UK'] },
      { name: 'Techno', subgenres: ['Acid', 'Ambient', 'Berlin', 'Bleep', 'Detroit', 'Dub', 'Hard', 'Hypnotic', 'Industrial', 'Minimal', 'Peak Time', 'Raw', 'Schranz', 'Tribal'] },
      { name: 'Electro', subgenres: ['Classic', 'Detroit', 'Bass', 'Electroclash', 'Ghettotech', 'Miami Bass', 'Modern', 'Punk'] },
      { name: 'Breakbeat / Bass', subgenres: ['Bassline', 'Breakbeat / Breaks', 'Broken Beat', 'Footwork / Juke', 'Future Bass', 'Grime', 'UK Bass', 'UK Funky'] },
      { name: 'Garage', subgenres: ['2-Step', 'Future', 'Speed', 'UK'] },
      { name: 'Dubstep', subgenres: ['Deep', 'Classic', 'Post', 'Riddim'] },
      { name: 'Drum & Bass', subgenres: ['Atmospheric DnB', 'Darkstep', 'Drumfunk', 'Halftime', 'Intelligent DnB', 'Jump Up', 'Jungle', 'Liquid DnB', 'Neurofunk', 'Ragga Jungle', 'Techstep'] },
      { name: 'Trance', subgenres: ['Acid', 'Classic', 'Goa', 'Hard', 'Progressive', 'Psy', 'Raw / Deep / Hypnotic', 'Uplifting'] },
      { name: 'Downtempo / Chill', subgenres: ['Balearic', 'Chillout', 'Downtempo', 'Lounge', 'Trip Hop'] },
      { name: 'Ambient / Drone', subgenres: ['Ambient', 'Dark Ambient', 'Drone', 'Fourth World', 'New Age', 'Space Ambient'] },
      { name: 'Experimental Electronic', subgenres: ['Chiptune', 'Deconstructed Club', 'Electroacoustic', 'Electronica', 'Glitch', 'IDM', 'Leftfield', 'Musique Concrete', 'Vaporwave', 'Witch House'] },
      { name: 'Industrial / Body Music', subgenres: ['Death Industrial', 'EBM', 'Electro-Industrial', 'Industrial', 'Industrial Dance', 'Futurepop', 'Minimal Synth', 'Rhythmic Noise'] },
      { name: 'Disco / Synth', subgenres: ['Cosmic', 'Dark', 'Darksynth', 'Future Funk', 'Italo', 'Nu', 'Synthpop', 'Synthwave'] },
      { name: 'Rave / Hardcore', subgenres: ['Breakcore / Digital Hardcore', 'Gabber', 'Happy Hardcore', 'Hardcore', 'Hardstyle', 'Rave'] },
      { name: 'Club / Global Electronic', subgenres: ['Baile Funk', 'Ballroom', 'Batida', 'Gqom', 'Jersey Club', 'Kuduro', 'Reggaeton Club'] },
    ],
  },
  {
    category: 'Rock / Metal / Punk',
    genres: [
      { name: 'Rock', subgenres: ['Art Rock', 'Classic', 'Garage', 'Gothic Rock', 'Indie', 'Industrial Rock', 'Krautrock', 'Math Rock', 'Noise', 'Post-Rock', 'Progressive Rock', 'Psychedelic', 'Stoner', 'Surf'] },
      { name: 'Alternative', subgenres: ['Alternative Rock', 'Britpop', 'Dream Pop', 'Emo', 'Grunge', 'Midwest Emo', 'Shoegaze', 'Slowcore'] },
      { name: 'Punk', subgenres: ['Anarcho', 'Crust Punk', 'D-Beat', 'Garage', 'Hardcore Punk', 'Post-Punk', 'Punk Rock'] },
      { name: 'Wave / Goth', subgenres: ['Coldwave', 'Darkwave', 'Deathrock', 'Ethereal Wave', 'Goth', 'Minimal Wave', 'New Romantic', 'New Wave', 'No Wave', 'Post-Punk Revival'] },
      { name: 'Hardcore', subgenres: ['Beatdown', 'Crossover', 'Grindcore', 'Melodic Hardcore', 'Metalcore', 'NYHC', 'Post-Hardcore', 'Screamo'] },
      { name: 'Metal', subgenres: ['Alternative Metal', 'Black', 'Death', 'Doom', 'Folk Metal', 'Gothic Metal', 'Heavy', 'Industrial Metal', 'Nu Metal', 'Post-Metal', 'Power Metal', 'Progressive Metal', 'Sludge', 'Speed Metal', 'Thrash'] },
    ],
  },
  {
    category: 'Hip-Hop / Rap',
    genres: [
      { name: 'Hip-Hop / Rap', subgenres: ['Alternative', 'Boom Bap', 'Cloud', 'Conscious', 'Drill', 'East Coast', 'Emo Rap', 'Experimental', 'Hardcore', 'Instrumental', 'Jazz Rap', 'Lo-Fi', 'Memphis', 'Old School', 'Plugg', 'Rage', 'Southern Hip-Hop', 'Trap', 'Trap Metal', 'West Coast'] },
      { name: 'Beats', subgenres: ['Abstract Beats', 'Beat Tape', 'Phonk', 'Wave'] },
    ],
  },
  {
    category: 'Pop / Dance',
    genres: [
      { name: 'Pop', subgenres: ['Alt', 'Art', 'Bedroom', 'Dance', 'Dark Pop', 'Electropop', 'Experimental Pop', 'Hyperpop', 'Indie'] },
      { name: 'Dance', subgenres: ['Eurodance', 'Hi-NRG', 'Pop House', 'Pop Techno'] },
    ],
  },
  {
    category: 'Jazz / Funk / Soul',
    genres: [
      { name: 'Jazz', subgenres: ['Acid', 'Avant-Garde', 'Bebop', 'Contemporary Jazz', 'Cool Jazz', 'Free', 'Fusion', 'Jazz-Funk', 'Latin Jazz', 'Modal Jazz', 'Nu Jazz', 'Spiritual'] },
      { name: 'Funk', subgenres: ['Boogie', 'Classic Funk', 'Electro Funk', 'P-Funk'] },
      { name: 'Soul / R&B', subgenres: ['Alternative R&B', 'Contemporary R&B', 'Neo Soul', 'Rhythm & Blues', 'Soul'] },
    ],
  },
  {
    category: 'Experimental / Noise',
    genres: [
      { name: 'Experimental', subgenres: ['Avant-Garde', 'Field Recording', 'Free Improvisation', 'Plunderphonics', 'Sound Collage', 'Spoken Word', 'Tape Music'] },
      { name: 'Noise', subgenres: ['Harsh', 'Harsh Wall', 'Noise Music', 'Power Electronics'] },
    ],
  },
  {
    category: 'Folk / Acoustic / World',
    genres: [
      { name: 'Folk', subgenres: ['Anti', 'Contemporary', 'Dark', 'Folk Rock', 'Neofolk'] },
      { name: 'Acoustic', subgenres: ['Acoustic Music', 'Singer-Songwriter'] },
      { name: 'World / Regional', subgenres: ['Afrobeat', 'Afrobeats', 'Balkan', 'Cumbia', 'Dancehall', 'Dub', 'Latin', 'Middle Eastern', 'Reggae', 'Roots Reggae', 'Ska'] },
    ],
  },
  {
    category: 'Blues / Country',
    genres: [
      { name: 'Blues', subgenres: ['Blues Rock', 'Delta Blues', 'Electric Blues', 'Experimental Blues'] },
      { name: 'Country', subgenres: ['Alternative Country', 'Americana', 'Contemporary Country', 'Outlaw Country'] },
    ],
  },
  {
    category: 'Classical / Contemporary',
    genres: [
      { name: 'Classical', subgenres: ['Baroque', 'Chamber Music', 'Classical Period', 'Opera', 'Romantic'] },
      { name: 'Contemporary', subgenres: ['Contemporary Classical', 'Minimalism', 'Modern Composition', 'Neoclassical'] },
    ],
  },
];

const legacyMusicGenreAliases = {
  'Electronic > House > Disco': 'Electronic > House > Disco House',
  'Electronic > House > Garage': 'Electronic > House > Garage House',
  'Electronic > House > Melodic': 'Electronic > House > Melodic House',
  'Electronic > House > Progressive': 'Electronic > House > Progressive House',
  'Electronic > House > Tech': 'Electronic > House > Tech House',
  'Electronic > Breakbeat / Bass > 140': 'Electronic > Breakbeat / Bass > UK Bass',
  'Electronic > Breakbeat / Bass > Breakbeat': 'Electronic > Breakbeat / Bass > Breakbeat / Breaks',
  'Electronic > Breakbeat / Bass > Breaks': 'Electronic > Breakbeat / Bass > Breakbeat / Breaks',
  'Electronic > Breakbeat / Bass > Jersey Club': 'Electronic > Club / Global Electronic > Jersey Club',
  'Electronic > Downtempo / Chill > Nu Jazz': 'Jazz / Funk / Soul > Jazz > Nu Jazz',
  'Electronic > Experimental Electronic > Noise': 'Experimental / Noise > Noise > Noise Music',
  'Electronic > Industrial / Body Music > Dance': 'Electronic > Industrial / Body Music > Industrial Dance',
  'Electronic > Industrial / Body Music > Noise': 'Experimental / Noise > Noise > Noise Music',
  'Electronic > Industrial / Body Music > Power Electronics': 'Experimental / Noise > Noise > Power Electronics',
  'Electronic > Rave / Hardcore > Breakcore': 'Electronic > Rave / Hardcore > Breakcore / Digital Hardcore',
  'Electronic > Rave / Hardcore > Digital Hardcore': 'Electronic > Rave / Hardcore > Breakcore / Digital Hardcore',
  'Electronic > Rave / Hardcore > Hard Dance': 'Electronic > Rave / Hardcore > Rave',
  'Electronic > Rave / Hardcore > Jungle Tekno': 'Electronic > Drum & Bass > Jungle',
  'Electronic > Rave / Hardcore > Neo Rave': 'Electronic > Rave / Hardcore > Rave',
  'Electronic > Rave / Hardcore > Speedcore': 'Electronic > Rave / Hardcore > Hardcore',
  'Electronic > Club / Global Electronic > Dancehall Electronic': 'Folk / Acoustic / World > World / Regional > Dancehall',
  'Electronic > Club / Global Electronic > Latin Electronic': 'Folk / Acoustic / World > World / Regional > Latin',
  'Electronic > Club / Global Electronic > Tribal Club': 'Electronic > House > Tribal',
  'Rock / Metal / Punk > Rock > Goth': 'Rock / Metal / Punk > Rock > Gothic Rock',
  'Rock / Metal / Punk > Rock > Post': 'Rock / Metal / Punk > Rock > Post-Rock',
  'Rock / Metal / Punk > Alternative > Rock': 'Rock / Metal / Punk > Alternative > Alternative Rock',
  'Rock / Metal / Punk > Punk > Hardcore': 'Rock / Metal / Punk > Punk > Hardcore Punk',
  'Rock / Metal / Punk > Punk > Post': 'Rock / Metal / Punk > Punk > Post-Punk',
  'Rock / Metal / Punk > Punk > Rock': 'Rock / Metal / Punk > Punk > Punk Rock',
  'Rock / Metal / Punk > Wave / Goth > Synthpop': 'Electronic > Disco / Synth > Synthpop',
  'Rock / Metal / Punk > Metal > Goth': 'Rock / Metal / Punk > Metal > Gothic Metal',
  'Rock / Metal / Punk > Metal > Post': 'Rock / Metal / Punk > Metal > Post-Metal',
  'Hip-Hop / Rap > Beats > Plugg': 'Hip-Hop / Rap > Hip-Hop / Rap > Plugg',
  'Hip-Hop / Rap > Hip-Hop / Rap > Grime': 'Electronic > Breakbeat / Bass > Grime',
  'Pop / Dance > Pop > Synthpop': 'Electronic > Disco / Synth > Synthpop',
  'Pop / Dance > Dance > Dance': 'Pop / Dance > Pop > Dance',
  'Jazz / Funk / Soul > Funk > Funk': 'Jazz / Funk / Soul > Funk > Classic Funk',
  'Experimental / Noise > Noise > Noise': 'Experimental / Noise > Noise > Noise Music',
  'Experimental / Noise > Noise > Industrial': 'Electronic > Industrial / Body Music > Industrial',
  'Folk / Acoustic / World > Folk > Rock': 'Folk / Acoustic / World > Folk > Folk Rock',
  'Folk / Acoustic / World > Acoustic > Acoustic': 'Folk / Acoustic / World > Acoustic > Acoustic Music',
  'Folk / Acoustic / World > Acoustic > Spoken Word': 'Experimental / Noise > Experimental > Spoken Word',
};

const musicGenreSearchAliases = {
  'Post-Punk': ['post punk', 'postpunk', 'постпанк', 'пост-панк'],
  'Post-Rock': ['post rock', 'postrock', 'построк', 'пост-рок'],
  'Gothic Rock': ['goth rock', 'gothic', 'готик-рок', 'готический рок'],
  'Tech House': ['techhouse', 'тек хаус', 'тех хаус'],
  Jakbeat: ['jak beat', 'jackbeat', 'jack beat', 'джакбит'],
  'Drum & Bass': ['drum and bass', 'dnb', 'драм-н-бейс', 'днб'],
  'Contemporary Classical': ['modern classical', 'современная классика'],
  'Neoclassical': ['neo classical', 'неоклассика'],
  'Alternative Country': ['alt country', 'альт-кантри'],
  'Soul / R&B': ['rnb', 'rhythm and blues', 'ритм-н-блюз'],
  Afrobeats: ['afro beats', 'афробитс'],
  'Electronic > Rave / Hardcore > Rave': ['neo rave', 'hard dance'],
  'Electronic > Drum & Bass > Jungle': ['jungle tekno'],
  'Electronic > Rave / Hardcore > Hardcore': ['speedcore'],
  'Folk / Acoustic / World > World / Regional > Dancehall': ['dancehall electronic'],
  'Folk / Acoustic / World > World / Regional > Latin': ['latin electronic'],
  'Electronic > House > Tribal': ['tribal club'],
  'Electronic > Breakbeat / Bass > Breakbeat / Breaks': ['breakbeat', 'breaks'],
  'Electronic > Breakbeat / Bass > UK Bass': ['140'],
  'Electronic > Breakbeat / Bass > Grime': ['grime rap'],
};

const contextualSubgenreDisplayNames = {
  House: {
    Acid: 'Acid House', Afro: 'Afro House', Bass: 'Bass House', Chicago: 'Chicago House',
    Classic: 'Classic House', Deep: 'Deep House', Detroit: 'Detroit House', Electro: 'Electro House',
    French: 'French House', Funky: 'Funky House', Ghetto: 'Ghetto House', Hard: 'Hard House',
    Italo: 'Italo House', Jackin: 'Jackin House', 'Lo-Fi': 'Lo-Fi House', Minimal: 'Minimal House',
    Organic: 'Organic House', Raw: 'Raw House', Tribal: 'Tribal House', UK: 'UK House',
  },
  Techno: {
    Acid: 'Acid Techno', Ambient: 'Ambient Techno', Berlin: 'Berlin Techno', Bleep: 'Bleep Techno',
    Detroit: 'Detroit Techno', Dub: 'Dub Techno', Hard: 'Hard Techno', Hypnotic: 'Hypnotic Techno',
    Industrial: 'Industrial Techno', Minimal: 'Minimal Techno', 'Peak Time': 'Peak Time Techno',
    Raw: 'Raw Techno', Tribal: 'Tribal Techno',
  },
  Electro: {
    Classic: 'Classic Electro', Detroit: 'Detroit Electro', Bass: 'Electro Bass',
    Modern: 'Modern Electro', Punk: 'Electro Punk',
  },
  Garage: {
    '2-Step': '2-Step Garage', Future: 'Future Garage', Speed: 'Speed Garage', UK: 'UK Garage',
  },
  Dubstep: {
    Deep: 'Deep Dubstep', Classic: 'Classic Dubstep', Post: 'Post-Dubstep', Riddim: 'Riddim Dubstep',
  },
  Trance: {
    Acid: 'Acid Trance', Classic: 'Classic Trance', Hard: 'Hard Trance',
    Progressive: 'Progressive Trance', Raw: 'Raw Trance', Uplifting: 'Uplifting Trance',
  },
  'Ambient / Drone': {
    Ambient: 'Ambient Music', Drone: 'Drone Music',
  },
  'Disco / Synth': {
    Cosmic: 'Cosmic Disco', Dark: 'Dark Disco', Italo: 'Italo Disco', Nu: 'Nu-Disco',
  },
  Rock: {
    Classic: 'Classic Rock', Garage: 'Garage Rock', Indie: 'Indie Rock', Noise: 'Noise Rock',
    Psychedelic: 'Psychedelic Rock', Stoner: 'Stoner Rock', Surf: 'Surf Rock',
  },
  Punk: {
    Anarcho: 'Anarcho-Punk', Garage: 'Garage Punk',
  },
  Hardcore: {
    Beatdown: 'Beatdown Hardcore', Crossover: 'Crossover Hardcore',
  },
  Metal: {
    Black: 'Black Metal', Death: 'Death Metal', Doom: 'Doom Metal', Heavy: 'Heavy Metal',
    Sludge: 'Sludge Metal', Thrash: 'Thrash Metal',
  },
  'Hip-Hop / Rap': {
    Alternative: 'Alternative Hip-Hop', Cloud: 'Cloud Rap', Conscious: 'Conscious Hip-Hop',
    'East Coast': 'East Coast Hip-Hop', Experimental: 'Experimental Hip-Hop',
    Grime: 'Grime Rap', Hardcore: 'Hardcore Hip-Hop', Instrumental: 'Instrumental Hip-Hop', 'Lo-Fi': 'Lo-Fi Hip-Hop',
    Memphis: 'Memphis Rap', 'Old School': 'Old School Hip-Hop', Rage: 'Rage Rap',
    Trap: 'Trap Rap', 'West Coast': 'West Coast Hip-Hop',
  },
  Pop: {
    Alt: 'Alternative Pop', Art: 'Art Pop', Bedroom: 'Bedroom Pop', Dance: 'Dance Pop',
    Indie: 'Indie Pop',
  },
  Jazz: {
    Acid: 'Acid Jazz', 'Avant-Garde': 'Avant-Garde Jazz', Free: 'Free Jazz',
    Fusion: 'Jazz Fusion', Spiritual: 'Spiritual Jazz',
  },
  Noise: {
    Harsh: 'Harsh Noise', 'Harsh Wall': 'Harsh Noise Wall',
  },
  Folk: {
    Anti: 'Anti-Folk', Contemporary: 'Contemporary Folk', Dark: 'Dark Folk',
  },
  'World / Regional': {
    Balkan: 'Balkan Music', Latin: 'Latin Music',
  },
  Classical: {
    Romantic: 'Romantic-Era Classical',
  },
};

function buildMusicGenreValue(category, genre, subgenre) {
  return subgenre ? `${category} > ${genre} > ${subgenre}` : `${category} > ${genre}`;
}

function canonicalizeMusicGenreValue(value) {
  const normalized = value.trim();
  return legacyMusicGenreAliases[normalized] || normalized;
}

function normalizeMusicGenreList(values, limit) {
  return Array.from(new Set(values.map(canonicalizeMusicGenreValue).filter(Boolean))).slice(0, limit);
}

const profileMusicGenreLimit = 18;
const releasePrimaryGenreLimit = 2;

function splitReleaseGenres(values) {
  const all = normalizeMusicGenreList(values, Number.MAX_SAFE_INTEGER);
  return {
    all,
    primary: all.slice(0, releasePrimaryGenreLimit),
    additional: all.slice(releasePrimaryGenreLimit),
  };
}

function isMusicSubgenreValue(value) {
  const normalized = canonicalizeMusicGenreValue(value);
  return musicTaxonomy.some((category) => category.genres.some((genre) => genre.subgenres.some(
    (subgenre) => buildMusicGenreValue(category.category, genre.name, subgenre) === normalized,
  )));
}

function isMusicGenreValue(value) {
  const normalized = canonicalizeMusicGenreValue(value);
  return musicTaxonomy.some((category) => category.genres.some((genre) => (
    buildMusicGenreValue(category.category, genre.name) === normalized
    || genre.subgenres.some((subgenre) => buildMusicGenreValue(category.category, genre.name, subgenre) === normalized)
  )));
}

function musicGenreSearchText(value) {
  const canonical = canonicalizeMusicGenreValue(value);
  const parts = canonical.split(' > ');
  const leaf = parts[parts.length - 1] || canonical;
  return [
    canonical,
    musicSubgenreDisplayName(canonical),
    ...(musicGenreSearchAliases[canonical] || []),
    ...(musicGenreSearchAliases[leaf] || []),
  ].join(' ');
}

function musicSubgenreDisplayName(value) {
  const canonical = canonicalizeMusicGenreValue(value);
  const parts = canonical.split(' > ');
  if (parts.length < 3) return parts[parts.length - 1] || canonical;
  const genre = parts[1];
  const subgenre = parts.slice(2).join(' > ');
  return contextualSubgenreDisplayNames[genre]?.[subgenre] || subgenre;
}

module.exports = {
  buildMusicGenreValue,
  canonicalizeMusicGenreValue,
  isMusicGenreValue,
  isMusicSubgenreValue,
  musicGenreSearchText,
  musicSubgenreDisplayName,
  musicTaxonomy,
  normalizeMusicGenreList,
  profileMusicGenreLimit,
  releasePrimaryGenreLimit,
  splitReleaseGenres,
};
