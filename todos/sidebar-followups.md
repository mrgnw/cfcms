---
title: Sidebar follow-ups after the stage stepper (PR #48)
---

- `postAction` in `Sidebar.svelte` posts `FormData` to `/?/action` and calls `refreshAll()`. Move queue add/remove/reorder and trash to remote functions (`command()`) for a typed API.
- Split the swipe-to-delete and queue drag-and-drop handling out of `Sidebar.svelte` into a `PostList` component, leaving `Sidebar` as layout.
- Phones can't remove a post from the editing queue from the list, only from the editor. Add swipe-to-remove on queue rows if that turns out to be missed.
- Long-press reorder (300 ms `delayTouchStart`) is untested on a real iPhone.
