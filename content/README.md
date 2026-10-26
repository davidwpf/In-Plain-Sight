# Editing the phrases and tasks

Edit `tasks.json` in this folder. These are site content, not admin controls or player settings. You can also describe changes in plain English in Codex and ask it to update this list.

There are two independent lists. Add an entry by copying an existing one and changing its `id` and wording. Give every entry its own unique `id` within its list. Keep the JSON commas and quotation marks valid.

## Recognition phrases

```json
{
  "id": "cuppa",
  "prompt": "Fancy a cuppa?",
  "reply": "Only if you’re making it."
}
```

Both lines are shown to every traitor in that round. They are used in conversation; the app does not check spoken words. A lone traitor does not receive a recognition phrase. Prefer everyday British language that a twelve-year-old can understand, with a particular reply that helps distinguish it from chance conversation.

## Murder tasks

```json
{
  "id": "favourite-biscuit",
  "title": "Favourite biscuit",
  "kind": "spoken",
  "difficulty": "easy",
  "instruction": "Ask your chosen person ‘What’s your favourite biscuit?’ and get an answer. Any biscuit counts."
}
```

All traitors receive the same randomly chosen task. At least one must complete it. The app compares their victim reports at the roundtable; it does not observe the real-world action.

`kind` and `difficulty` are labels for maintaining the library. They do not change scoring or add settings to the Game. Current kinds are `spoken`, `action`, and `prop`; current difficulties are `easy` and `medium`. No task requires a person to eat or drink anything.

Keep tasks short, specific and feasible in an ordinary British home. Describe exactly what completes the task. Consider an alternative for tasks needing a prop.

## Edit on GitHub

Open [tasks.json on GitHub](https://github.com/davidwpf/In-Plain-Sight/blob/main/content/tasks.json), sign in and select the pencil icon. Edit the wording, then select **Commit changes** and save to `main`. GitHub checks the file and Cloudflare builds and publishes it automatically; allow a few minutes for the update.

- Under `recognition`, edit `prompt` (the question or phrase) and `reply` (the response).
- Under `murders`, edit `title` (the short name) and `instruction` (what the traitor must do).
- To add an entry, copy a whole existing entry and give it a new, unique `id`. Keep the commas and quotation marks in place.

[GitHub checks](https://github.com/davidwpf/In-Plain-Sight/actions) show whether the tests have passed. You can also ask Codex to edit the wording for you.

## Check and publish changes

Run `pnpm test` to check the content structure and game rules. Commit the change to `main` to publish through the connected Cloudflare build. The library is bundled with the app, so saved edits appear in the deployed game after a new build and deployment. Existing rounds keep their assigned task; new rounds draw from the updated list.
