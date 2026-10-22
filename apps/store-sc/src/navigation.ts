// The store's navigation: the mega-menu and the footer. Static content, so
// in the server-components twin it never reaches the client at all, and in
// the SPA twin it ships inside the bundle with the components that render it.
const KINDS = ["Daypack", "Rain Shell", "Merino Crew", "Canvas Tote", "Trail Runner", "Wool Beanie", "Field Jacket", "Linen Shirt"];

export const MENU = ["Women", "Men", "Kids", "Outdoor", "Home", "Accessories", "Sale", "Journal"].map((top, t) => ({
  top,
  columns: ["Featured", "Clothing", "Gear", "Collections"].map((h, c) => ({
    heading: h,
    links: Array.from({ length: 6 }, (_, k) => `${KINDS[(t + c + k) % KINDS.length]}${k % 2 ? "s" : ""}`)
  }))
}));

export const FOOTER = ["Shop", "Help", "About", "Stores", "Follow"].map((h, i) => ({
  heading: h,
  links: Array.from({ length: 7 }, (_, k) => `${["Gift cards", "Shipping", "Returns", "Repairs", "Careers", "Press", "Sustainability", "Store locator", "Contact"][(i * 2 + k) % 9]}`)
}));
