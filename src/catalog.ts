// Kilnhouse Coffee is a fictional roaster. The origins are real; the coffee names, notes and
// prices are invented for the demo. Each coffee is sold in two sizes, and the store and the
// ERP name every variant differently, as two real systems would.

export type Coffee = {
  slug: string;
  name: string;
  origin: string;
  notes: string;
  description: string;
  erpPrefix: string;
  prices: { "250": number; "1000": number };
};

export const COFFEES: Coffee[] = [
  { slug: "first-light", name: "First Light", origin: "Ethiopia", notes: "Jasmine, bergamot, white peach", description: "A bright, floral washed coffee for the first cup of the day.", erpPrefix: "KH-ETH", prices: { "250": 19, "1000": 64 } },
  { slug: "long-table", name: "Long Table", origin: "Colombia", notes: "Red apple, caramel, cocoa", description: "A sweet, balanced cup that suits everyone at the table.", erpPrefix: "KH-COL", prices: { "250": 17, "1000": 56 } },
  { slug: "slow-sunday", name: "Slow Sunday", origin: "Brazil", notes: "Hazelnut, milk chocolate", description: "Soft and nutty, made for a long breakfast with nowhere to be.", erpPrefix: "KH-BRA", prices: { "250": 15, "1000": 48 } },
  { slug: "night-shift", name: "Night Shift", origin: "Guatemala", notes: "Dark chocolate, plum, brown sugar", description: "Deep and chocolatey, with enough body to carry milk.", erpPrefix: "KH-GUA", prices: { "250": 17, "1000": 56 } },
  { slug: "high-ground", name: "High Ground", origin: "Kenya", notes: "Blackcurrant, grapefruit", description: "Juicy and sharp, for people who like their coffee to surprise them.", erpPrefix: "KH-KEN", prices: { "250": 21, "1000": 70 } },
  { slug: "house-blend", name: "Kilnhouse Blend", origin: "Brazil and Colombia", notes: "Toffee, cocoa, round body", description: "Our everyday coffee, roasted to taste the same every week.", erpPrefix: "KH-HSE", prices: { "250": 15, "1000": 46 } },
];

// Starting stock for the demo, the same in the store and the ERP: fictional numbers, small
// enough to watch them run out.
export const START_STOCK = { "250": 40, "1000": 12 } as const;

export const SIZES = ["250", "1000"] as const;
export type Size = (typeof SIZES)[number];

export const GRINDS = ["Whole bean", "Espresso", "Filter", "French press"] as const;

export type Variant = { shopifySku: string; erpCode: string; title: string; size: Size; price: number };

export function variants(): Variant[] {
  return COFFEES.flatMap((coffee) =>
    SIZES.map((size) => ({
      shopifySku: `${coffee.slug}-${size === "1000" ? "1kg" : "250"}`,
      erpCode: `${coffee.erpPrefix}-${size}`,
      title: `${coffee.name} · ${size === "1000" ? "1 kg" : "250 g"}`,
      size,
      price: coffee.prices[size],
    })),
  );
}
