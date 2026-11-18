export type FishId = 'largemouth-bass' | 'bluegill' | 'yellow-perch' | 'common-carp' | 'rainbow-trout' | 'northern-pike'
  | 'pumpkinseed' | 'redear-sunfish' | 'green-sunfish' | 'black-crappie' | 'white-crappie' | 'rock-bass' | 'smallmouth-bass' | 'spotted-bass' | 'white-bass' | 'striped-bass' | 'walleye' | 'zander' | 'brown-trout' | 'brook-trout' | 'lake-trout' | 'atlantic-salmon' | 'chain-pickerel' | 'muskellunge' | 'grass-carp' | 'silver-carp' | 'crucian-carp' | 'common-bream' | 'roach' | 'tench';
export type SizeCrown = 'small-gold' | 'large-silver' | 'large-gold';
export interface FishSpecies {
  id: FishId;
  name: string;
  scientificName: string;
  description: string;
  habitat: string;
  diet: string;
  fieldNote: string;
  /** Game tuning, not biological limits or a surveyed wild size distribution. */
  size: { minCm: number; maxCm: number; smallGoldMaxCm: number; largeSilverMinCm: number; largeGoldMinCm: number };
  /** Game mass estimate: kg = coefficient × lengthCm³ × condition (0.85–1.15). */
  weightCoefficient: number;
}
export interface FishCatch {
  id: string;
  speciesId: FishId;
  lengthCm: number;
  weightKg: number;
  crown: SizeCrown | null;
  caughtAt: string;
}

export const FISH_SPECIES: readonly FishSpecies[] = [
  {
    id: 'largemouth-bass', name: 'Largemouth bass', scientificName: 'Micropterus nigricans',
    description: 'An olive-green ambush hunter with a dark stripe along its flank. Its upper jaw reaches beyond the eye, giving this member of the sunfish family its unmistakably generous mouth.',
    habitat: 'Vegetated lakes, ponds and quiet river backwaters. Submerged timber, weed beds and shaded edges provide cover.',
    diet: 'Adults take fish, crayfish and frogs; young bass begin with much smaller aquatic prey.',
    fieldNote: 'A bass can wait close to cover before making a short rush at passing prey. The male guards a shallow nest during spawning.',
    size: { minCm: 18, maxCm: 75, smallGoldMaxCm: 24, largeSilverMinCm: 52, largeGoldMinCm: 62 }, weightCoefficient: .000016,
  },
  {
    id: 'bluegill', name: 'Bluegill', scientificName: 'Lepomis macrochirus',
    description: 'A deep-bodied sunfish with a small mouth and a dark flap at the rear of its gill cover. Blue and violet tones on the cheek contrast with a warmer belly and softly barred sides.',
    habitat: 'Weedy shallows of lakes and ponds, with larger fish also using deeper water as the seasons change.',
    diet: 'Aquatic insects and other small invertebrates make up much of its food.',
    fieldNote: 'In the breeding season, males clear nests close together in shallow water and defend them. A small mouth suits small prey.',
    size: { minCm: 8, maxCm: 34, smallGoldMaxCm: 11, largeSilverMinCm: 26, largeGoldMinCm: 30 }, weightCoefficient: .000026,
  },
  {
    id: 'yellow-perch', name: 'Yellow perch', scientificName: 'Perca flavescens',
    description: 'Dark vertical bars break up golden sides on this familiar schooling fish. Rather than guarding a nest, yellow perch scatter their eggs and leave the young unguarded.',
    habitat: 'Cool freshwater lakes and their connected waters. Schools move between feeding areas, including deeper water.',
    diet: 'Minnows, insect larvae, plankton and worms are among its varied foods.',
    fieldNote: 'A school may contain hundreds of fish. Its deliberate feeding near the bottom can produce a much quieter bite than a rushing predator.',
    size: { minCm: 10, maxCm: 43, smallGoldMaxCm: 14, largeSilverMinCm: 32, largeGoldMinCm: 38 }, weightCoefficient: .000012,
  },
  {
    id: 'common-carp', name: 'Common carp', scientificName: 'Cyprinus carpio',
    description: 'Large scales, a broad body and small barbels at the corners of the mouth distinguish this adaptable bottom-feeder. Its colors range from pale gold to dark brown.',
    habitat: 'Lakes, reservoirs and slow rivers, often in shallow, muddy areas with aquatic plants.',
    diet: 'An omnivore that searches bottom sediment for insect larvae, crustaceans, snails and plant material.',
    fieldNote: 'Rooting through sediment can cloud the water. The barbels help distinguish a carp from similar-looking suckers.',
    size: { minCm: 25, maxCm: 105, smallGoldMaxCm: 35, largeSilverMinCm: 80, largeGoldMinCm: 95 }, weightCoefficient: .000018,
  },
  {
    id: 'rainbow-trout', name: 'Rainbow trout', scientificName: 'Oncorhynchus mykiss',
    description: 'A pink-to-red stripe crosses silvery sides scattered with small dark spots. The small adipose fin and spotted tail are useful details to notice on this cold-water fish.',
    habitat: 'Cool lakes and clear streams with pools, rocky cover and well-oxygenated water.',
    diet: 'Aquatic and land insects, other invertebrates and, in larger fish, small fish.',
    fieldNote: 'Feeding follows available food: insects may be taken at the surface, in the water column or along the bottom. Spawning usually takes place over stream gravel.',
    size: { minCm: 18, maxCm: 85, smallGoldMaxCm: 24, largeSilverMinCm: 62, largeGoldMinCm: 75 }, weightCoefficient: .000012,
  },
  {
    id: 'northern-pike', name: 'Northern pike', scientificName: 'Esox lucius',
    description: 'A long, muscular predator with a flattened snout, pale spots and a dorsal fin set close to the tail. Its pointed teeth hold slippery prey after a sudden lunge.',
    habitat: 'Clear, vegetated lakes, quiet river pools and backwaters, with cooler water important to larger fish.',
    diet: 'Mainly fish, with invertebrates and amphibians also taken when available.',
    fieldNote: 'Weed beds offer concealment for an ambush. In spring, pike scatter adhesive eggs over flooded vegetation rather than building a guarded nest.',
    size: { minCm: 25, maxCm: 125, smallGoldMaxCm: 35, largeSilverMinCm: 95, largeGoldMinCm: 112 }, weightCoefficient: .0000065,
  },
  {
    id: "pumpkinseed", name: "Pumpkinseed", scientificName: "Lepomis gibbosus",
    description: "A little sunfish dressed in copper, orange and blue. Wavy turquoise lines cross its cheeks, while a red patch marks the back of the dark gill flap.",
    habitat: "Plant-rich ponds, lakes and quiet stream margins, especially around sheltered cover.",
    diet: "Small aquatic insects, snails and other invertebrates; larger fish also take small fish.",
    fieldNote: "Look at the cheek and gill flap together: the red patch and blue lines help separate it from a bluegill.",
    size: { minCm: 8, maxCm: 28, smallGoldMaxCm: 11, largeSilverMinCm: 22, largeGoldMinCm: 25 }, weightCoefficient: 2.5e-05,
  },
  {
    id: "redear-sunfish", name: "Redear sunfish", scientificName: "Lepomis microlophus",
    description: "A broad golden-olive sunfish with a small mouth and a red or orange edge to its black ear flap. The pale belly often has a warm yellow cast.",
    habitat: "Warm, clear ponds and lakes with plants and little current; sheltered river bays.",
    diet: "Snails and other mollusks, crushed by specialized teeth in the throat.",
    fieldNote: "Its nickname, shellcracker, describes a feeding tool you cannot see in a side portrait: flattened crushing teeth behind the mouth.",
    size: { minCm: 10, maxCm: 38, smallGoldMaxCm: 14, largeSilverMinCm: 29, largeGoldMinCm: 34 }, weightCoefficient: 2.5e-05,
  },
  {
    id: "green-sunfish", name: "Green sunfish", scientificName: "Lepomis cyanellus",
    description: "Stockier and larger-mouthed than many small sunfish. Blue-green marks brighten the face, and pale cream to salmon-pink edging can outline the fins.",
    habitat: "Ponds, slow streams and sheltered margins, often close to rocks or vegetation.",
    diet: "Insect larvae, crayfish and small fish; its wide mouth admits relatively large prey.",
    fieldNote: "Check the mouth as well as the color. A green sunfish has a noticeably broader gape than a bluegill of similar size.",
    size: { minCm: 8, maxCm: 30, smallGoldMaxCm: 11, largeSilverMinCm: 23, largeGoldMinCm: 27 }, weightCoefficient: 2.3e-05,
  },
  {
    id: "black-crappie", name: "Black crappie", scientificName: "Pomoxis nigromaculatus",
    description: "A tall, flattened silver-green fish, scattered with dark marks like ink on wet paper. Its large mouth and extended dorsal and anal fins make a distinctive silhouette.",
    habitat: "Lakes, ponds and river backwaters with reasonably clear water and submerged cover.",
    diet: "Small fish, aquatic insects and crustaceans.",
    fieldNote: "The dark markings are irregular blotches, rather than the clearer vertical bands of a white crappie. Seven or eight dorsal spines provide another clue.",
    size: { minCm: 12, maxCm: 45, smallGoldMaxCm: 17, largeSilverMinCm: 34, largeGoldMinCm: 40 }, weightCoefficient: 1.7e-05,
  },
  {
    id: "white-crappie", name: "White crappie", scientificName: "Pomoxis annularis",
    description: "Silvery sides carry loose vertical bands beneath a long, spiny dorsal fin. The body is deep and thin from side to side, with an unexpectedly large mouth.",
    habitat: "Slow rivers, reservoirs and lakes; more tolerant of cloudy water than black crappie.",
    diet: "Small fish and aquatic invertebrates.",
    fieldNote: "Count six dorsal spines if the markings leave you unsure. Color varies, so a pale fish is not automatically a white crappie.",
    size: { minCm: 12, maxCm: 46, smallGoldMaxCm: 17, largeSilverMinCm: 35, largeGoldMinCm: 41 }, weightCoefficient: 1.6e-05,
  },
  {
    id: "rock-bass", name: "Rock bass", scientificName: "Ambloplites rupestris",
    description: "A compact sunfish with a generous head, mottled brown-green sides and striking reddish eyes. Small dark spots line up along many of its scales.",
    habitat: "Clear lakes and slow stream pools with rocky bottoms and places to shelter.",
    diet: "Aquatic insects, crayfish and small fish.",
    fieldNote: "Its broken pattern blends into stones. The red eye is memorable, but body markings and the large mouth make a better combined identification.",
    size: { minCm: 10, maxCm: 34, smallGoldMaxCm: 14, largeSilverMinCm: 26, largeGoldMinCm: 30 }, weightCoefficient: 2.2e-05,
  },
  {
    id: "smallmouth-bass", name: "Smallmouth bass", scientificName: "Micropterus dolomieu",
    description: "Bronze and olive sides carry dark bars rather than a bold lengthwise stripe. In adults, the upper jaw ends around the rear of the eye.",
    habitat: "Clear lakes and flowing waters with rock or gravel, often near sheltered edges of current.",
    diet: "Crayfish, fish and larger aquatic insects.",
    fieldNote: "A clean rocky margin is a useful place to begin looking. The smaller jaw separates this bronzeback from a largemouth bass.",
    size: { minCm: 18, maxCm: 65, smallGoldMaxCm: 25, largeSilverMinCm: 49, largeGoldMinCm: 58 }, weightCoefficient: 1.5e-05,
  },
  {
    id: "spotted-bass", name: "Spotted bass", scientificName: "Micropterus punctulatus",
    description: "A green black bass with a dark lateral band and rows of small spots below it. Its connected dorsal fins and relatively small cheek scales reward a closer look.",
    habitat: "Flowing rivers and reservoirs, including deeper water than some other black basses use.",
    diet: "Crayfish, small fish and immature aquatic insects.",
    fieldNote: "The dotted rows below the dark side stripe are a stronger clue than the word bass. Its jaw is shorter than a largemouth’s.",
    size: { minCm: 16, maxCm: 58, smallGoldMaxCm: 22, largeSilverMinCm: 43, largeGoldMinCm: 51 }, weightCoefficient: 1.4e-05,
  },
  {
    id: "white-bass", name: "White bass", scientificName: "Morone chrysops",
    description: "A silver schooling predator crossed by several dark horizontal lines. Its high back and compact body distinguish it from the more elongated striped bass.",
    habitat: "Open lake and reservoir water and deeper river pools, often over sand or rock.",
    diet: "Small fish, with insects and other small aquatic prey also taken.",
    fieldNote: "Feeding schools can push baitfish toward the surface. This is a temperate bass, rather than a member of the sunfish family.",
    size: { minCm: 15, maxCm: 48, smallGoldMaxCm: 20, largeSilverMinCm: 36, largeGoldMinCm: 43 }, weightCoefficient: 1.7e-05,
  },
  {
    id: "striped-bass", name: "Striped bass", scientificName: "Morone saxatilis",
    description: "Long, clean dark stripes run along a muscular silver body. An olive back and pale belly frame the pattern that gives this temperate bass its name.",
    habitat: "Coastal waters, estuaries and rivers; freshwater populations also inhabit suitable reservoirs.",
    diet: "Fish and crustaceans, varying with size and the available prey.",
    fieldNote: "Some populations move between sea and river, while others live inland. Flowing water keeps the drifting eggs moving during reproduction.",
    size: { minCm: 30, maxCm: 120, smallGoldMaxCm: 42, largeSilverMinCm: 88, largeGoldMinCm: 106 }, weightCoefficient: 1.4e-05,
  },
  {
    id: "walleye", name: "Walleye", scientificName: "Sander vitreus",
    description: "A gold-olive predator with a pearly eye and a pale mark at the lower tail tip. Two separate dorsal fins and a toothed mouth give it a purposeful outline.",
    habitat: "Lakes and rivers with rocky or gravel areas, using deeper water or shade in bright conditions.",
    diet: "Primarily smaller fish, including perch; young fish begin with smaller aquatic prey.",
    fieldNote: "A reflective layer in the eye improves low-light vision. Dawn, dusk and shaded cover suit this fish better than an exposed bright margin.",
    size: { minCm: 20, maxCm: 90, smallGoldMaxCm: 28, largeSilverMinCm: 66, largeGoldMinCm: 79 }, weightCoefficient: 1e-05,
  },
  {
    id: "zander", name: "Zander", scientificName: "Sander lucioperca",
    description: "A long-bodied perch relative with glassy eyes, spiny dorsal fins and conspicuous teeth. Muted dark bands break up its grey-green sides.",
    habitat: "Lakes, rivers and canals, including turbid water and shaded areas close to the bottom.",
    diet: "Mainly other fish.",
    fieldNote: "It can hunt in dim or cloudy water. Despite the similar pointed teeth, a zander is a perch relative rather than a pike.",
    size: { minCm: 25, maxCm: 105, smallGoldMaxCm: 35, largeSilverMinCm: 78, largeGoldMinCm: 93 }, weightCoefficient: 9e-06,
  },
  {
    id: "brown-trout", name: "Brown trout", scientificName: "Salmo trutta",
    description: "Dark spots, often mixed with red ones, scatter across warm brown or golden sides. Color changes with habitat, and lake fish can be much more silvery.",
    habitat: "Cool streams, rivers and lakes, with cover and oxygenated water.",
    diet: "Aquatic and land insects, other invertebrates and increasingly fish as it grows.",
    fieldNote: "The same species can look very different in stream and lake habitats. Look for the spotted pattern before relying on the brown color.",
    size: { minCm: 18, maxCm: 90, smallGoldMaxCm: 25, largeSilverMinCm: 66, largeGoldMinCm: 79 }, weightCoefficient: 1.2e-05,
  },
  {
    id: "brook-trout", name: "Brook trout", scientificName: "Salvelinus fontinalis",
    description: "Pale marbling winds across a dark back, above colored spots and a warm lower flank. Bright white leading edges accent its lower fins.",
    habitat: "Cool spring-fed streams, ponds and lakes, with clean gravel and shelter.",
    diet: "Mostly insects and other small invertebrates; larger fish also take fish.",
    fieldNote: "Despite its common name, it belongs to the char group. Groundwater-fed gravel can provide suitable places for its eggs.",
    size: { minCm: 12, maxCm: 62, smallGoldMaxCm: 18, largeSilverMinCm: 45, largeGoldMinCm: 55 }, weightCoefficient: 1.3e-05,
  },
  {
    id: "lake-trout", name: "Lake trout", scientificName: "Salvelinus namaycush",
    description: "A pale-spotted char with a dark grey-green body and deeply forked tail. The restrained colors suit a fish associated with cold, deep water.",
    habitat: "Cold lakes, often deep, and some connected deep freshwater rivers.",
    diet: "Young fish take plankton and invertebrates; many adults feed mainly on other fish.",
    fieldNote: "This char scatters eggs among rocks rather than digging a trout-like nest. Some populations remain small and continue feeding heavily on plankton.",
    size: { minCm: 25, maxCm: 120, smallGoldMaxCm: 35, largeSilverMinCm: 88, largeGoldMinCm: 106 }, weightCoefficient: 1.1e-05,
  },
  {
    id: "atlantic-salmon", name: "Atlantic salmon", scientificName: "Salmo salar",
    description: "A streamlined salmon with silvery sides and small dark spots above the lateral line. A narrow tail wrist leads into a lightly forked tail.",
    habitat: "Cold rivers and the North Atlantic; landlocked populations complete their lives in freshwater.",
    diet: "Young fish take insects; growing fish feed on invertebrates and smaller fish.",
    fieldNote: "This lake’s salmon spend their lives in fresh water. Their sea-running relatives travel to the ocean before returning to their home rivers to spawn.",
    size: { minCm: 25, maxCm: 110, smallGoldMaxCm: 35, largeSilverMinCm: 81, largeGoldMinCm: 97 }, weightCoefficient: 1.1e-05,
  },
  {
    id: "chain-pickerel", name: "Chain pickerel", scientificName: "Esox niger",
    description: "Dark linked markings form a chain over bright yellow-green sides. A dark bar drops beneath the eye, and the long snout points toward hidden prey.",
    habitat: "Weedy ponds, lakes and slow river margins, particularly sheltered shallows.",
    diet: "Mostly fish, with other small aquatic animals also taken.",
    fieldNote: "The chain pattern and the dark mark below the eye distinguish this smaller pike relative from the pale-spotted northern pike.",
    size: { minCm: 20, maxCm: 75, smallGoldMaxCm: 28, largeSilverMinCm: 55, largeGoldMinCm: 66 }, weightCoefficient: 6.5e-06,
  },
  {
    id: "muskellunge", name: "Muskellunge", scientificName: "Esox masquinongy",
    description: "A long, powerful pike relative with a broad toothed mouth. Dark bars or spots can cross a pale background, though markings vary between fish.",
    habitat: "Clear lakes and rivers with vegetation, timber, drop-offs and open-water feeding areas.",
    diet: "Predominantly fish, including prey much larger than those taken by small panfish.",
    fieldNote: "Unlike a northern pike’s light spots on a dark body, a marked muskie often reverses that contrast. Pattern alone should never be the only clue.",
    size: { minCm: 35, maxCm: 145, smallGoldMaxCm: 48, largeSilverMinCm: 108, largeGoldMinCm: 129 }, weightCoefficient: 7e-06,
  },
  {
    id: "grass-carp", name: "Grass carp", scientificName: "Ctenopharyngodon idella",
    description: "An elongated silver-to-olive fish with large, dark-edged scales and a broad head. It lacks the small mouth barbels of a common carp.",
    habitat: "Vegetated lakes, ponds and slow or still areas of large river systems.",
    diet: "Primarily aquatic plants, processed by specialized teeth in the throat.",
    fieldNote: "Follow the long body and large scale pattern. Its plant-feeding habits differ from the common carp’s search through bottom sediment.",
    size: { minCm: 30, maxCm: 135, smallGoldMaxCm: 42, largeSilverMinCm: 100, largeGoldMinCm: 119 }, weightCoefficient: 1.3e-05,
  },
  {
    id: "silver-carp", name: "Silver carp", scientificName: "Hypophthalmichthys molitrix",
    description: "Bright silver flanks, a deep body and low-set eyes make an unusual profile. The upward mouth and specialized gills suit filtering tiny food from water.",
    habitat: "Large rivers and connected waters, including productive slow-moving areas.",
    diet: "Plankton filtered from the water, especially microscopic algae.",
    fieldNote: "Its low-set eyes sit below the mouth. Fine gill structures strain plankton from the water; this big-bodied wanderer often reveals itself with a sudden leap.",
    size: { minCm: 25, maxCm: 110, smallGoldMaxCm: 35, largeSilverMinCm: 81, largeGoldMinCm: 97 }, weightCoefficient: 1.7e-05,
  },
  {
    id: "crucian-carp", name: "Crucian carp", scientificName: "Carassius carassius",
    description: "A deep bronze-gold fish with a long rounded dorsal fin. The small mouth has no barbels, unlike that of a common carp.",
    habitat: "Still ponds, shallow lakes and quiet, plant-rich slow waters.",
    diet: "Small invertebrates, plankton and plant material.",
    fieldNote: "The absence of barbels and the rounded dorsal outline help identify it. A delicate mouthful can move a float only slightly.",
    size: { minCm: 10, maxCm: 50, smallGoldMaxCm: 16, largeSilverMinCm: 37, largeGoldMinCm: 44 }, weightCoefficient: 2.3e-05,
  },
  {
    id: "common-bream", name: "Common bream", scientificName: "Abramis brama",
    description: "A high-backed, flattened fish with a small mouth and long anal fin. Young fish are silver, while larger individuals often take on a bronze tone.",
    habitat: "Lakes, reservoirs, canals and slow rivers, frequently over softer bottoms.",
    diet: "Midge larvae, worms, small mollusks and other tiny bottom-dwelling animals.",
    fieldNote: "A shoal can work slowly across the bottom. The high body and long lower fin make its shadow easy to recognize beside a slimmer roach.",
    size: { minCm: 18, maxCm: 80, smallGoldMaxCm: 26, largeSilverMinCm: 59, largeGoldMinCm: 71 }, weightCoefficient: 2e-05,
  },
  {
    id: "roach", name: "Roach", scientificName: "Rutilus rutilus",
    description: "Silver scales, reddish eyes and warm red-orange lower fins distinguish this modest schooling fish. Its mouth points forward rather than strongly upward.",
    habitat: "Lakes, ponds, canals and rivers, including sheltered areas with aquatic plants.",
    diet: "Insect larvae, small snails, crustaceans and plant material.",
    fieldNote: "Roach and rudd can look similar. The mouth shape and the position of the pelvic fins relative to the dorsal fin offer more reliable clues than red fins alone.",
    size: { minCm: 10, maxCm: 43, smallGoldMaxCm: 15, largeSilverMinCm: 32, largeGoldMinCm: 38 }, weightCoefficient: 1.6e-05,
  },
  {
    id: "tench", name: "Tench", scientificName: "Tinca tinca",
    description: "A smooth-looking olive fish with tiny scales, reddish eyes and softly rounded fins. A small barbel sits at each corner of the mouth.",
    habitat: "Quiet lakes, ponds and slow waterways with soft bottoms and dense plant cover.",
    diet: "Snails, small mussels, insect larvae and other bottom foods, with some plant material.",
    fieldNote: "Its thick outline and rounded fins distinguish it from a common carp. Calm vegetated water gives this shy feeder places to shelter.",
    size: { minCm: 18, maxCm: 75, smallGoldMaxCm: 26, largeSilverMinCm: 55, largeGoldMinCm: 66 }, weightCoefficient: 2.1e-05,
  },
];

export const CROWN_RATES = Object.freeze({ smallGold: .05, normal: .82, largeSilver: .10, largeGold: .03 });
export function isFishId(value: unknown): value is FishId { return FISH_SPECIES.some(species => species.id === value); }
export function getFishSpecies(id: FishId): FishSpecies {
  const species = FISH_SPECIES.find(item => item.id === id);
  if (!species) throw new RangeError(`Unknown fish species: ${String(id)}`);
  return species;
}
export function crownForLength(id: FishId, lengthCm: number): SizeCrown | null {
  const size = getFishSpecies(id).size;
  if (!Number.isFinite(lengthCm) || lengthCm < size.minCm || lengthCm > size.maxCm) return null;
  if (lengthCm <= size.smallGoldMaxCm) return 'small-gold';
  if (lengthCm >= size.largeGoldMinCm) return 'large-gold';
  if (lengthCm >= size.largeSilverMinCm) return 'large-silver';
  return null;
}
const roundWeight = (value: number) => Math.round(value * 1000) / 1000;
export function fishWeightBounds(id: FishId, lengthCm: number) {
  const base = getFishSpecies(id).weightCoefficient * lengthCm ** 3;
  return { minKg: roundWeight(base * .85), maxKg: roundWeight(base * 1.15) };
}
function sample(random: () => number) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Fish RNG must return a finite number between 0 and 1');
  return Math.min(1 - Number.EPSILON, value);
}
let fallbackSequence = 0;
export function generateFishCatch(random: () => number = Math.random, options: { speciesId?: FishId; id?: string; caughtAt?: string } = {}): FishCatch {
  const species = options.speciesId ? getFishSpecies(options.speciesId) : FISH_SPECIES[Math.floor(sample(random) * FISH_SPECIES.length)];
  const size = species.size, roll = sample(random);
  let low: number, high: number;
  if (roll < .05) { low = size.minCm; high = size.smallGoldMaxCm; }
  else if (roll < .87) { low = size.smallGoldMaxCm + .1; high = size.largeSilverMinCm - .1; }
  else if (roll < .97) { low = size.largeSilverMinCm; high = size.largeGoldMinCm - .1; }
  else { low = size.largeGoldMinCm; high = size.maxCm; }
  const lowTenths = Math.round(low * 10), highTenths = Math.round(high * 10);
  const lengthCm = (lowTenths + Math.floor(sample(random) * (highTenths - lowTenths + 1))) / 10;
  const weightKg = roundWeight(species.weightCoefficient * lengthCm ** 3 * (.85 + sample(random) * .30));
  const fish: FishCatch = {
    id: options.id ?? globalThis.crypto?.randomUUID?.() ?? `catch-${Date.now().toString(36)}-${++fallbackSequence}`,
    speciesId: species.id, lengthCm, weightKg, crown: crownForLength(species.id, lengthCm), caughtAt: options.caughtAt ?? new Date().toISOString(),
  };
  if (!isFishCatch(fish)) throw new RangeError('Invalid generated fish catch metadata');
  return fish;
}

/** Validate persisted/input data, including a crown supported by its actual size. */
export function isFishCatch(value: unknown): value is FishCatch {
  if (!value || typeof value !== 'object') return false;
  const fish = value as Record<string, unknown>;
  if (typeof fish.id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(fish.id) || !isFishId(fish.speciesId)) return false;
  if (typeof fish.lengthCm !== 'number' || !Number.isFinite(fish.lengthCm) || typeof fish.weightKg !== 'number' || !Number.isFinite(fish.weightKg)) return false;
  const size = getFishSpecies(fish.speciesId).size;
  if (fish.lengthCm < size.minCm || fish.lengthCm > size.maxCm || Math.abs(fish.lengthCm * 10 - Math.round(fish.lengthCm * 10)) > 1e-7) return false;
  const weight = fishWeightBounds(fish.speciesId, fish.lengthCm);
  if (fish.weightKg < weight.minKg || fish.weightKg > weight.maxKg || fish.crown !== crownForLength(fish.speciesId, fish.lengthCm)) return false;
  if (typeof fish.caughtAt !== 'string') return false;
  const date = new Date(fish.caughtAt);
  return Number.isFinite(date.getTime()) && date.toISOString() === fish.caughtAt;
}
