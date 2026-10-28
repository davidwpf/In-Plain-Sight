# Editing recognition signals and murder tasks

Edit `tasks.json` in this folder. The library contains 34 recognition signals and 23 distinct murder tasks. These are site content, separate from admin controls and player settings.

There are two independent lists. Add an entry by copying an existing one and changing its `id` and wording. Every entry needs a unique `id` within its list. Keep the JSON commas and quotation marks valid.

## Recognition signals

```json
{
  "id": "pickle",
  "prompt": "Say “pickle” during a conversation."
}
```

`prompt` describes the word, phrase, sound or gesture to use. Every killer receives the same signal and looks for others using it. A lone killer receives no recognition signal. The app does not observe or verify real-world actions.

Only `id` and `prompt` are required. Older question-and-answer entries can still include a non-empty `reply`; their two-part display is retained for rounds already in progress. The new single-signal entries leave `reply` out.

## Murder tasks

```json
{
  "id": "hold-object",
  "title": "Hold an object",
  "kind": "prop",
  "difficulty": "easy",
  "instruction": "Get your chosen person to hold an object for you."
}
```

All killers receive the same task. At least one must complete it. The app compares their victim reports at the roundtable; it does not observe the real-world action.

- `title`: the short name shown on the killer screen and beside a confirmed victim in results.
- `instruction`: what the killer must do and what completes the task.
- `kind`: `spoken`, `action` or `prop`.
- `difficulty`: `easy` or `medium`.

Kind and difficulty help maintain the library; they do not change scoring or add Game settings. These tasks require the action described in the instruction to happen. Keep wording broad enough to suit different settings. Keep one entry per distinct task, rather than adding duplicate entries that would make a task more likely to be offered.

## Variety between rounds

Each Game draws from each list randomly without repeating an entry until the whole list has been used. It then starts a new random cycle, avoiding an immediate repeat when alternatives exist. A solo Killer can change their task twice per round before the roundtable, with confirmation. Every replacement counts as a draw and excludes all tasks already offered that round, including across a deck-cycle boundary. Discarded tasks cannot be restored. The count is saved with the round and resets only at the next deal. Multiple Killers cannot change their shared task. A player must keep a task once they have completed it on anyone; the app cannot verify in-person completion.

Recognition signals are only used up in rounds with multiple killers. The two lists cycle independently, and draw history is saved with the Game.

Edits take effect for new rounds and solo task replacements after publication. Current rounds retain their assigned signal and task unless an eligible solo Killer chooses a replacement. New entries become available in the current cycle; removed entries are no longer drawn. Keep an existing entry's `id` when changing only its wording so the Game can recognise that it has already been used.

## Edit on GitHub

Open [tasks.json on GitHub](https://github.com/davidwpf/In-Plain-Sight/blob/main/content/tasks.json), sign in and select the pencil icon. Edit the wording, then select **Commit changes** and save to `main`. GitHub checks the file and Cloudflare builds and publishes it automatically; allow a few minutes for the update.

- Under `recognition`, edit `prompt`.
- Under `murders`, edit `title` and `instruction`.
- To add an entry, copy a whole existing entry and give it a new, unique `id`.

[GitHub checks](https://github.com/davidwpf/In-Plain-Sight/actions) show whether the tests have passed. You can also describe changes in plain English in Codex and ask it to update the library.

## Check changes locally

Run `pnpm test` to check the content structure, draw cycles and game rules. The library is bundled with the app, so editing the file requires a new build and deployment before it appears on the live site.
