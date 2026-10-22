import { createSignal, type JSX } from "solid-js";

// The client component a comment's replies sit in: it owns the open state,
// the label, and the click; the replies themselves are server markup passed
// through the slot.
export default function Toggle(props: { replies: JSX.Element }) {
  const [open, setOpen] = createSignal(true);
  return (
    <>
      <div class={open() ? "toggle open" : "toggle"}>
        <a onClick={() => setOpen(o => !o)}>{open() ? "[-]" : "[+] comments collapsed"}</a>
      </div>
      <ul class="comment-children" hidden={!open()}>
        {props.replies}
      </ul>
    </>
  );
}
