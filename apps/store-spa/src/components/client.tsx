import { createContext, createSignal, For, Show, useContext, type Accessor, type JSX } from "solid-js";

// The interactive parts of the store, identical in both twins: the header's
// cart, each listing tile's quick add and wishlist, and the product page's
// buy box. The cart lives in the shell and reaches the widgets through
// context, so a quick add anywhere updates the header's count.
export type CartLine = { id: number; name: string; price: number; size: string; qty: number };
type Cart = { lines: Accessor<CartLine[]>; add: (l: CartLine) => void };
const CartCtx = createContext<Cart>();
const money = (cents: number) => "$" + (cents / 100).toFixed(2);

export function StoreShell(props: { children: JSX.Element }) {
  const [lines, setLines] = createSignal<CartLine[]>([]);
  const [open, setOpen] = createSignal(false);
  const cart: Cart = { lines, add: l => setLines(c => [...c, l]) };
  return (
    <CartCtx value={cart}>
      <header class="header">
        <a class="logo" href="/">
          Solid Supply
        </a>
        <input class="search" type="search" placeholder="Search products" />
        <button class="cart-badge" onClick={() => setOpen(o => !o)}>
          Cart ({lines().reduce((n, l) => n + l.qty, 0)})
        </button>
      </header>
      <Show when={open()}>
        <div class="mini-cart">
          <For each={lines()}>{l => <p>{l.qty} × {l.name} ({l.size}) {money(l.price * l.qty)}</p>}</For>
          <p>Total {money(lines().reduce((n, l) => n + l.price * l.qty, 0))}</p>
        </div>
      </Show>
      {props.children}
    </CartCtx>
  );
}

export function QuickAdd(props: { id: number; name: string; price: number }) {
  const cart = useContext(CartCtx)!;
  const [fav, setFav] = createSignal(false);
  const [added, setAdded] = createSignal(false);
  return (
    <div class="quick">
      <button
        class="add"
        onClick={() => {
          cart.add({ id: props.id, name: props.name, price: props.price, size: "M", qty: 1 });
          setAdded(true);
        }}
      >
        {added() ? "Added ✓" : "Quick add"}
      </button>
      <button class={fav() ? "fav on" : "fav"} aria-pressed={fav()} onClick={() => setFav(f => !f)}>
        ♥
      </button>
    </div>
  );
}

export function BuyBox(props: {
  id: number;
  name: string;
  price: number;
  colors: string[];
  sizes: { size: string; stock: number }[];
}) {
  const cart = useContext(CartCtx)!;
  const [color, setColor] = createSignal(0);
  const [size, setSize] = createSignal<string | undefined>();
  const [qty, setQty] = createSignal(1);
  const stock = () => props.sizes.find(s => s.size === size())?.stock ?? 0;
  return (
    <div class="buybox">
      <div class="swatches">
        <For each={props.colors}>
          {(c, i) => (
            <button
              class={color() === i() ? "swatch on" : "swatch"}
              style={{ background: c }}
              aria-label={"colour " + (i() + 1)}
              onClick={() => setColor(i())}
            />
          )}
        </For>
      </div>
      <div class="sizes">
        <For each={props.sizes}>
          {s => (
            <button
              class={size() === s.size ? "size on" : "size"}
              disabled={!s.stock}
              onClick={() => setSize(s.size)}
            >
              {s.size}
            </button>
          )}
        </For>
      </div>
      <p class="stock">{size() ? (stock() < 3 ? `Only ${stock()} left` : "In stock") : "Choose a size"}</p>
      <div class="qty">
        <button class="dec" onClick={() => setQty(q => Math.max(1, q - 1))}>
          −
        </button>
        <span>{qty()}</span>
        <button class="inc" onClick={() => setQty(q => q + 1)}>
          +
        </button>
      </div>
      <button
        class="add"
        disabled={!size()}
        onClick={() => cart.add({ id: props.id, name: props.name, price: props.price, size: size()!, qty: qty() })}
      >
        Add to cart · {money(props.price * qty())}
      </button>
    </div>
  );
}
