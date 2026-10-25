// The store's data source, store-sc/src/server/catalog.ts without its types:
// 48 products and their reviews from the same fixed seed, so all three apps
// serve the same catalog.
const BRANDS = ["Northfold", "Aster & Co", "Fieldwork", "Kestrel", "Lumen Studio", "Harbor Goods"];
const KINDS = ["Daypack", "Rain Shell", "Merino Crew", "Canvas Tote", "Trail Runner", "Wool Beanie", "Field Jacket", "Linen Shirt"];
const ADJ = ["Everyday", "Coastal", "Alpine", "Heritage", "Urban", "Weekend"];
const COLORS = ["#1f2937", "#b91c1c", "#047857", "#1d4ed8", "#a16207", "#6d28d9", "#be185d", "#0e7490"];
const COPY = [
  "Built to last with recycled materials and a lifetime repair promise. Every seam is taped and every zip is replaceable.",
  "A quiet favourite: simple lines, honest materials, nothing you don't need. Cut a little roomier for layering.",
  "Lightweight, weather-ready and designed in small batches with a family workshop we have worked with since day one.",
  "Our best seller three seasons running, now in new colours. Packs down small and dries overnight."
];
const DETAILS = [
  "100% recycled shell, PFC-free water repellent finish",
  "Machine wash cold, line dry",
  "Ethically made in Portugal",
  "Two-year warranty and free repairs for life",
  "Ships in plastic-free packaging",
  "Fits true to size; model is 185 cm wearing M"
];
const NAMES = ["Sam", "Priya", "Jonas", "Mei", "Alex", "Rosa", "Theo", "Ines", "Kai", "Noor"];
const TITLES = ["Exactly what I wanted", "Great quality", "Runs a bit large", "My second one", "Worth it", "Good, not perfect"];
const BODIES = [
  "Wore it every day for a month of travel and it still looks new. The fabric is softer than I expected and it packs down well.",
  "Solid construction and the colour is just like the photos. Sizing runs slightly large so I would go down one if between sizes.",
  "I bought this as a gift and ended up getting one for myself. Customer service was quick when I needed to swap the size.",
  "Comfortable straight away, no breaking in. The pockets are well placed and the zips feel sturdy. Would buy again."
];

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const PRODUCTS = Array.from({ length: 48 }, (_, i) => {
  const start = Math.floor(rnd() * COLORS.length);
  const price = 2900 + Math.floor(rnd() * 18000);
  return {
    id: i + 1,
    name: `${ADJ[i % ADJ.length]} ${KINDS[Math.floor(i / ADJ.length) % KINDS.length]}`,
    brand: BRANDS[i % BRANDS.length],
    category: KINDS[Math.floor(i / ADJ.length) % KINDS.length],
    description: COPY[i % COPY.length],
    details: DETAILS.filter((_, k) => (i + k) % 3 !== 0),
    price,
    compareAt: rnd() < 0.25 ? Math.round(price * 1.3) : undefined,
    colors: Array.from({ length: 2 + Math.floor(rnd() * 3) }, (_, k) => COLORS[(start + k) % COLORS.length]),
    sizes: ["XS", "S", "M", "L", "XL"].map(size => ({ size, stock: Math.floor(rnd() * 6) })),
    rating: 3 + Math.floor(rnd() * 3),
    reviewCount: 4 + Math.floor(rnd() * 300),
    badges: ["New", "Bestseller", "Eco"].filter(() => rnd() < 0.2)
  };
});

export const getProducts = async () => PRODUCTS;

export const getProduct = async id =>
  PRODUCTS.find(p => p.id === id);

export const getReviews = async id => reviewsFor(id);

const reviewsFor = id =>
  Array.from({ length: 12 }, (_, k) => ({
    author: NAMES[(id + k) % NAMES.length],
    rating: 3 + ((id + k) % 3),
    title: TITLES[(id * 3 + k) % TITLES.length],
    body: BODIES[(id + k * 7) % BODIES.length],
    date: `2026-0${1 + ((id + k) % 9)}-1${k % 9}`
  }));
