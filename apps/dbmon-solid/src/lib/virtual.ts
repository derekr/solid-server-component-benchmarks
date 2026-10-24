// TanStack Virtual's framework-agnostic core on Solid 2 signals. The
// @tanstack/solid-virtual adapter targets Solid 1, so this is the same few
// lines of glue it has: a Virtualizer over the scroll element, re-read on
// every change. Rows here have a fixed height, so no measuring.
import { createEffect, createSignal, onCleanup } from "solid-js";
import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from "@tanstack/virtual-core";

/**
 * The rows to render, `[first, end)`, overscan included, for a list of
 * `count()` rows of `rowHeight` px, and the ref that attaches the scroll
 * element.
 */
export function createVirtualRange(opts: { count: () => number; rowHeight: number; overscan: number }) {
  let scrollElement: HTMLElement | null = null;
  const [range, setRange] = createSignal<readonly [number, number]>([0, 0]);
  const read = (v: Virtualizer<HTMLElement, Element>) => {
    const items = v.getVirtualItems();
    const next = items.length ? ([items[0].index, items[items.length - 1].index + 1] as const) : ([0, 0] as const);
    const [a, b] = range();
    if (next[0] !== a || next[1] !== b) setRange(next);
  };
  const options = (count: number) => ({
    count,
    estimateSize: () => opts.rowHeight,
    overscan: opts.overscan,
    getScrollElement: () => scrollElement,
    scrollToFn: elementScroll,
    observeElementRect,
    observeElementOffset,
    onChange: read
  });
  const virtualizer = new Virtualizer<HTMLElement, Element>(options(0));
  createEffect(opts.count, count => {
    virtualizer.setOptions(options(count));
    virtualizer._willUpdate();
    read(virtualizer);
  });
  onCleanup(virtualizer._didMount());
  // A ref runs before its element is in the page, when it still belongs to
  // the template's document (no window, so no ResizeObserver): attach once
  // it is connected.
  const ref = (el: HTMLElement) => {
    const attach = () => {
      if (!el.isConnected) return void requestAnimationFrame(attach);
      scrollElement = el;
      virtualizer._willUpdate();
      read(virtualizer);
    };
    attach();
  };
  return [range, ref] as const;
}
