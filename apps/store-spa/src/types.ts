// The catalog's shapes, shared by the data layer and the components.
export type Variant = { size: string; stock: number };
export type Review = { author: string; rating: number; title: string; body: string; date: string };
export type Product = {
  id: number;
  name: string;
  brand: string;
  category: string;
  description: string;
  details: string[];
  price: number; // cents
  compareAt?: number;
  colors: string[];
  sizes: Variant[];
  rating: number;
  reviewCount: number;
  badges: string[];
};
