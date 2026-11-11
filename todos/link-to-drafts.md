---
title: Linking to drafts from the editor (spike)
---

Exploration only. No code, no mockups. The question: a post can link to another post that is still a draft. What should writing that link feel like, how does it stay out of the published site, and how far should "this post depends on that one" go?

## What exists today

- Posts link to each other by hand with a root-relative slug path: `[too many](/gear)`. The site serves a post at `/<slug>`.
- Every post has a permanent 6-char id (`posts.id`). The CMS serves `/p/<id>` and 307-redirects to `/posts/<slug>`, because slugs can change and ids cannot. Nothing in a post body uses ids yet.
- Publish renders the *whole* live set to `src/posts/<slug>.svx` every time (`renderSvxDirectory`), runs the blog build as a gate, commits, pushes. The live set is known at that moment (`buildLiveSet`), so "is X on the site" is answerable exactly where bodies become site text.
- `syncSiteText` compares each `.svx` body byte-for-byte with the published revision. Anything that makes the rendered body differ from the stored body registers as an edit made on the site. This is the one real constraint on the design below.
- The editor is Crepe. A plain click in a link places the caret; Crepe's link tooltip offers edit/copy/open. Nothing special-cases internal links.

The failure the feature guards against is already on the site. Three live links point at posts that do not exist in `content/posts`:

| post | link | why it is broken |
| --- | --- | --- |
| tailscale-auto-up | `/write-better-docs` | never written, or still a draft elsewhere |
| tailscale-auto-up | `/secure%20your%20web%20traffic%20using%20dns-level%20blocking` | a title pasted as a path |
| uv | `/runnable-py-scripts` | the post exists as `uv-python-scripts`; the slug moved |

So two separate problems hide under "links to drafts": links whose target is not live, and links whose target renamed. Ids fix the second for free and give the first a place to be decided.

## Decision 1: what an internal link is in the source

Three ways to write the target:

1. **Slug path**, as now: `[text](/gear)`. Zero machinery. Breaks on rename, says nothing about draft-ness, and the CMS cannot tell an internal link from an external one without guessing.
2. **Id reference**, resolved at publish: `[text](post:k7m3qx)`. The editor and the publish step understand it; the site never sees it. Rename-safe. A leak is a visibly dead `post:` href, not a quiet link to cms.xcc.es.
3. **Component**, resolved in the blog: `<PostLink id="k7m3qx"/>` in the svx, resolved by mdsvex. Pushes logic into the blog and stops being markdown in the editor.

Pick 2. It is the smallest change that makes the link mean "that post" instead of "that string", and `renderSvx` is already the single boundary where source becomes site text.

Variant worth noting: `/p/<id>` instead of `post:<id>`. The CMS already serves that path, so the editor would get "open in editor" for nothing, and if the publish step also shipped an id→slug map, the site could serve `/p/<id>` as a permanent URL that survives renames. The cost is ambiguity: on the site `/p/…` is a real path, so the lint cannot tell an unresolved reference from an intended one. A custom scheme fails loud. Start with `post:`; the permanent-URL idea can come later on its own merits.

The link *text* stays the writer's prose. The picker pre-fills the target's title; the writer edits it like any other words. The CMS can notice "target title changed since this link was written" later, but it should never rewrite prose.

## Decision 2: what happens at publish

`renderSvx` gets the live set it is rendering (it is already passed each entry; it needs the id→slug map of the set). For each `post:<id>` href:

- **id in the live set** → `/<slug>` from the live entry. Renames resolve because the slug comes from the set, not from the writer's text.
- **id not in the live set** (draft, unpublished, deleted, unknown) → a policy. Options:
  - *Block*: the Publish view refuses to stage the post until the target is staged too or the link is removed. Safe, annoying.
  - *Unlink*: drop the href, keep the text. "See runnable python scripts for more" reads fine. The sentence loses a link, not its sense.
  - *Fallback text*: the dependency mechanism in the next section.

Default to **unlink with a visible warning** in the Publish view, per link: "→ *Write better docs* (draft): ships as plain text". Two actions on the row: *stage it too*, *edit the link*. Blocking stays an option per post if it ever matters; for one writer the warning is the decision.

Because the whole set re-renders on every publish, an unlinked reference **heals itself**: when X goes live later, Y's svx re-renders with the link resolved, without restaging Y. The same mechanism cuts the other way: unpublishing or deleting X unlinks every live reference to it at that publish. The Publish view should say so on the unpublish row: "3 live posts link here; those links become plain text". Renaming X's slug re-renders every reference correctly, which today silently breaks them.

Three cheap lints belong in the same pass, independent of ids:

- A root-relative href whose first segment is not a live slug: "broken internal link" (catches all three cases in the table). When the segment matches a post by `slugKey`, offer *convert to id link*.
- Any href containing the CMS origin, or starting with `/posts/` (a CMS route, not a site one): **block**. This is the "accidentally published the CMS link" guard, and it is a regex.
- Any `post:` href that survived to the svx (should be impossible after resolution): block. Belt and braces.

### The site-text constraint

Once the rendered body can differ from the stored body, `syncSiteText` must compare against the *rendered* form, or every publish will look like an external edit and fast-forward `published_hash` onto rendered text, after which every post with a resolved link shows as `changed`. The fix is contained: the transform is a pure function of (body, id→slug map of published posts), and `getPublishedPosts()` is exactly the set the last publish rendered. So `readSiteBody(slug) === transform(publishedRevision.body, publishedMap)` is the new equality. The existing "edited on the site" detection keeps working; it just compares like with like.

The alternative that avoids touching `syncSiteText` at all: keep the svx body verbatim and resolve `post:` in the blog build with a small remark plugin reading a map the CMS writes into the publish commit. The invariant "svx body == revision body" stays, hand-edits to svx keep working, and the build gate still catches mistakes. The cost is logic split across two repos and a generated file the blog must not forget to read. Either works. Resolve in the CMS unless the blog grows other reasons to know about ids (the `/p/` permanent URL would be one).

## Editor UX

**Inserting.** Three entry points, any subset is fine:

- Select text, Cmd-K: the link dialog takes a URL *or* a search over posts (title, path, status badge). Picking a post inserts `post:<id>`. This is the Notion/Google Docs/Slack habit and needs no new syntax.
- Typing `[[` opens the same picker inline, Obsidian-style. Nice for people who have that reflex; skippable.
- Paste conversion: pasting a CMS URL (`cms.xcc.es/posts/<slug>`, `/p/<id>`) or a site URL (`xcc.es/<slug>`) over a selection becomes a `post:` link, with a small undo-able notice. This is the cheapest way to make the right thing the default, because the writer's instinct is to copy the address bar.

**Showing.** Internal links look different from external ones: a glyph or chip, and a status tint. Live target: normal. Draft target: dashed underline, micro-label "draft". Missing target (deleted id): the `--danger` colour. Status comes from the post list the editor already polls, so it stays current while writing. The tooltip says what will happen: "*Write better docs* · draft · ships as plain text until published".

**Clicking.** A plain click keeps placing the caret; that is what a contenteditable must do. The tooltip carries the actions:

- *Edit X* opens the target in the CMS editor, same tab, by `/p/<id>` so it survives renames. Cmd-click opens a new tab. Autosave means leaving mid-sentence costs nothing; browser back returns.
- *View on site*, enabled only when the target is live. Disabled with the reason otherwise.
- *Change* and *Unlink*, as Crepe's tooltip already offers.

Editor first, site second: while writing, the site may not have the target, and when it does, it is one more click. The reverse default only makes sense for a writer who reads live posts far more than they edit them, and a toggle for one person is clutter.

**Reading the target without leaving.** The reference pane already shows other versions of the current post as blocks to copy from. Showing a *linked* post there, read-only, is the same component with a different source, and it answers the common reason for following the link in the first place: "what exactly did I say there". Cheap once the pane takes a source selector; not needed for v1.

**Backlinks.** "Linked from: uv (live), gear (draft)" in the target's editor header is a body scan for `post:<id>`. It is what makes unpublishing and renaming safe decisions, and it costs almost nothing once ids are in bodies.

## Dependencies beyond links

The ask: a *section* of Y only makes sense once X is live, with alternate text until then.

```
live:   As we said in [post x](post:k7m3qx), the cache is per device, so …
draft:  We'll have more to say about caching soon.
```

Levels, cheapest first:

1. **Post-level**: frontmatter `after: [k7m3qx]`. Staging Y requires X live or staged in the same publish. No body syntax, no editor work, and the Publish view already has the vocabulary (blocked rows). It cannot express "publish Y now, in reduced form", which is the actual ask, but it is the honest floor: write Y for today's site, and restage it when X ships.

2. **Block-level conditional**, two branches, evaluated at publish against the live set like a link. Syntax candidates:
   - A container directive: `:::when post:k7m3qx` … `:::else` … `:::`. Clean to read and write. Needs remark-directive in Milkdown plus a node view showing both branches, labelled "when X is live" / "until then", with the branch the next publish would use highlighted. The real version; a few days.
   - HTML comment markers: `<!-- when post:k7m3qx -->` … `<!-- else -->` … `<!-- end -->`. Nothing to teach remark, a line-based transform at publish. Crepe renders comments as raw html nodes, so the editing experience is fragile and ugly. Not worth it.
   - A fenced block whose language is `when` and whose meta names the post. The editor already round-trips fence language and meta (`fence-meta.ts`), so the block survives editing untouched and the transform unwraps it at publish. The branch text is markdown inside a code box, so not WYSIWYG, and links inside it are not pickable. Robust and small; the writing experience is the price. A fair v1 if the feature is wanted at all.

   Whatever the syntax, the oracle is the same: the live set at the moment of rendering. The site stays static and knows nothing. And the whole-set re-render means Y flips to its live branch the publish after X ships, without restaging Y. That is the feature, but it is also text changing on a post the writer did not stage, so the Publish view should list it: "publishing X also changes: Y (conditional section)", with the diff. The existing per-post segment view can show it.

3. **Inline conditional** ("As we said in X, {clause only once X exists}"). Markdown has no inline container, and a WYSIWYG for one is a project. Do not. Two paragraphs in a block conditional say the same thing and read better.

Interaction with scheduled publish (`todos/publish-progress.md`): a dependency is an ordering constraint on schedules. The simple rule is that staging already bundles posts into one publish, so "schedule Y after X" is "stage both" or "X first, Y in the later batch". No solver needed.

Honest assessment for a one-person blog: the link policy plus the Publish view warnings cover almost every real case, and `after:` covers the rest. Block conditionals are worth building only after a second concrete post wants one; the self-healing re-render already removes the main reason to want them (forgetting to come back and add the link).

## How other platforms handle it

Three families:

- **Resolve at build, then gate.** Hugo's `ref`/`relref` resolve cross-references by document path at build; a missing target is an ERROR that fails the build by default, downgradable to WARNING, with `refLinksNotFoundURL` as a placeholder ([cross references](https://hugodocs.onrender.com/content-management/cross-references), [relref](https://gohugo.io/shortcodes/relref/)). Docusaurus checks every internal link in a production build and `onBrokenLinks` defaults to `throw` so a broken link never ships ([docusaurus config](https://docusaurus.io/docs/api/docusaurus-config)). Sphinx's `:doc:` role warns on a missing target and `-W` turns that into a failure (from memory). cfcms is this family: it already has a build gate; it lacks the resolver and the lint.
- **Decide at view time by permission.** Notion public pages show "Removed" or an unavailable page where a link or mention points at content that is not public ([why Notion public page shows Removed](https://wisechecker.com/?p=26828), [public pages](https://www.notion.com/zh-tw/help/public-pages-and-web-publishing)). Google Docs links to a restricted doc land on a request-access page (from memory). Graceful for the platform, not for the reader, and the writer has no say in the fallback. A static blog cannot do this and should not want to.
- **Forbid in the data model, escape through releases.** In Sanity a published document cannot hold a strong reference to unpublished content; a draft can only be pointed at weakly. Content Releases bundle documents so that a version may strongly reference another version in the same release, because they publish together ([drafts and versions](https://www.sanity.io/docs/content-lake/drafts-and-versions.md), [introducing content releases](https://sanity.io/blog/introducing-content-releases)). Staging in cfcms is already a release in miniature: "stage X too" on the warning row is the same move.

Two more data points:

- Obsidian Publish leaves links to unpublished notes broken on the site and offers *Add linked* in the publish dialog to pull the targets into the same publish ([publish and unpublish notes](https://help.obsidian.md/Obsidian+Publish/Publish+and+unpublish+notes), [links to unwritten notes](https://forum.obsidian.md/t/obsidian-publish-and-links-to-unwritten-notes/30144)). Same bundling instinct, no fallback.
- WordPress links a draft by its technical `?p=123` URL, which keeps working after publish because it is the id; the breakage people hit comes from pretty permalinks changing on publish ([permalink preview FAQ](https://www.blog2social.com/en/faq/content/4/193/en/how-can-i-change-the-permalink-in-the-post-preview-for-scheduled-social-media-posts.html), [trac 16477](https://core.trac.wordpress.org/ticket/16477)). Id links survive; slug links do not. That is the whole argument for `post:<id>`.

What none of them do, and a blog can do cheaply: let the link degrade to plain text and heal itself on the next publish. Static generators fail or warn; permission systems show a wall; release systems refuse. Unlink-and-warn is the small, writer-friendly option that fits a site that re-renders everything anyway.

## Suggested order, if any of this is built

1. **Lint, no new syntax.** In the publish pass: root-relative hrefs that are not live slugs (warn, offer convert), CMS-origin or `/posts/` hrefs (block). Fixes the three live broken links. Small.
2. **Id links.** `post:<id>` in bodies; resolution in `renderSvx` with unlink as the draft policy; `syncSiteText` compares against the transformed body; Cmd-K picker and paste conversion in the editor; tooltip with status, *Edit* and *View on site*. The Publish view lists per-link warnings with *stage it too*. This is the feature.
3. **Backlinks and consequence warnings.** "Linked from" in the editor; unpublish/delete/rename rows say which live links they affect.
4. **Later, only on demand.** `after:` post-level dependency; block conditionals (fenced `when` block first, directive if it earns it); `/p/<id>` as a permanent URL on the site.

## Open questions

- Does the blog have any route under `/posts/`? If not, that prefix is a safe CMS-only marker for the leak lint.
- Should `publish: true` on Y with a draft link ever be refused, or is the warning always enough? Proposed: warning only, blocking reserved for CMS-origin leaks.
- When X goes live and Y's rendered text changes without a restage, does Y's "updated" date on the site move? Today the svx carries only `date`, so no; worth deciding before block conditionals, where the change is prose rather than an href.
- The `.llm.md` drafts never publish. A link to one should be flagged as a permanent draft link, not an eventual one.
