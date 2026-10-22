import type { RouteParams, RouteSectionProps, ServerRouteArgs } from "@solidjs/router";
import type { JSX } from "solid-js";
import { dynamicComponent, respond } from "@solidjs/web";
import { GET } from "@solidjs/web/server-functions";
import type { Slot } from "@solidjs/web/frames";
import Toggle from "~/components/toggle";
import { cacheable } from "~/server/cache";
import * as hn from "~/server/hn";
import type { CommentDefinition } from "~/types";

// Client-component toggle variant: the thread is server markup, and each
// comment with replies places a client Toggle in a slot, passing its replies
// (server markup) through as a prop.
type ToggleSlot = Slot<{ replies: JSX.Element }>;

const getStory = GET(async ({ params }: ServerRouteArgs<RouteParams<"/stories/:id">>) => {
  "use server";
  const story = await hn.getStory(params.id);
  return respond(
    (props: { toggle: ToggleSlot }) => (
      <div class="item-view">
        <div class="item-view-header">
          <a href={story.url} target="_blank">
            <h1>{story.title}</h1>
          </a>
          {story.domain ? <span class="host">({story.domain})</span> : null}
          <p class="meta">
            {story.points} points | by <a href={`/users/${story.user}`}>{story.user}</a>{" "}
            {story.time_ago}
          </p>
        </div>
        <div class="item-view-comments">
          <p class="item-view-comments-header">
            {story.comments_count ? story.comments_count + " comments" : "No comments yet."}
          </p>
          <ul class="comment-children">
            {story.comments.map(comment => (
              <Comment comment={comment} toggle={props.toggle} />
            ))}
          </ul>
        </div>
      </div>
    ),
    cacheable
  );
});

function Comment(props: { comment: CommentDefinition; toggle: ToggleSlot }) {
  const c = props.comment;
  return (
    <li class="comment">
      <div class="by">
        <a href={`/users/${c.user}`}>{c.user}</a> {c.time_ago}
      </div>
      <div class="text" innerHTML={c.content} />
      {c.comments.length ? (
        <props.toggle
          replies={c.comments.map(reply => (
            <Comment comment={reply} toggle={props.toggle} />
          ))}
        />
      ) : null}
    </li>
  );
}

export default function Story(props: RouteSectionProps) {
  const Thread = dynamicComponent(() => getStory({ params: { id: String(props.params.id) } } as never));
  return <Thread toggle={p => <Toggle replies={p.replies} />} />;
}
