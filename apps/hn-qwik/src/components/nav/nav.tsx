import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";

export default component$(() => {
  return (
    <header class="header">
      <nav class="inner">
        <Link href="/">
          <strong>HN</strong>
        </Link>
        <Link href="/new">
          <strong>New</strong>
        </Link>
        <Link href="/show">
          <strong>Show</strong>
        </Link>
        <Link href="/ask">
          <strong>Ask</strong>
        </Link>
        <Link href="/job">
          <strong>Jobs</strong>
        </Link>
        {/* Benchmark: Qwik City routes only its own <Link>s on the client, so the
            navigation runner clicks this invisible one (the feed reads the live
            HN API, which the benchmark doesn't count on). */}
        <Link href="/stories/30186326" data-bench-story style="position:fixed;right:0;bottom:0;opacity:0">
          story
        </Link>
        <a
          class="github"
          href="http://github.com/builderio/qwik"
          target="_blank"
          rel="noreferrer"
        >
          Built with Qwik
        </a>
      </nav>
    </header>
  );
});
