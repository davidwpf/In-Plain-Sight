# In Plain Sight

**[Play In Plain Sight](https://in-plain-sight.davidwpfrancis.workers.dev)**

A social deduction game for an evening or weekend with friends and family. Everyone can play, including the admin. Every round randomly assigns fresh traitors. The interface centres on one current task, with extra information in small menus.

## Play

1. **Create game.** The admin enters their name and a Game name. Their private six-digit player code also unlocks Start, Call roundtable, Pause, Resume and End.
2. **Share code.** Share the six-character game code or invite link. Keep personal player codes private.
3. **Join.** A player chooses “Enter my player code” or “Join as a new player”. Joining gives them their own private six-digit code. Shared devices use **Switch player** to hide the current identity and sign in as someone else.
4. **Start.** The admin starts when everyone has joined. There must be at least three ready players. The admin receives a normal role and cannot inspect anyone else’s role.

| Active players this round | Traitors |
| --- | ---: |
| 3–5 | 1 |
| 6–9 | 2 |
| 10–30 | 3 |

The count is recalculated at each new deal. Every round makes a fresh, independent shuffle using the server’s cryptographic random generator. Previous roles do not affect the draw; the same players can be traitors again. With five players and one traitor, the same traitor across three rounds has a 1-in-25 chance.

## A round

- Everyone privately checks whether they are faithful or a traitor. Roles start hidden and hide when the page goes into the background.
- Multiple traitors receive the same ordinary question and particular reply to help recognise each other. Names remain secret. A lone traitor acts alone.
- All traitors receive the same murder task. At least one must perform it on their chosen faithful. Coordination happens in person, and actual actions use an honour system.
- After 60 minutes, the roundtable opens. The admin can open it sooner using **Call roundtable** in the admin menu. Faithful players accuse one other player. Traitors report one victim or “No murder”. Everyone’s submission is final. No victim or report is revealed during voting.
- At least half the active players submitting starts a five-minute deadline. All submissions in closes immediately. Before halfway, there is no voting deadline. Both accusation ballots and murder reports count towards submission progress. Everyone can see who has submitted and who has not, while roles and choices stay private until results.
- Reports confirm a murder only when a majority of the assigned traitors name the same faithful: 1 of 1, 2 of 2 or 2 of 3. Missing reports do not reduce the majority needed. Other named targets are attempted murders. Naming another traitor cannot murder them and produces a failed attempt.
- Roles, accusations, reports, murders, attempts and points appear together. A personal reveal can say: “You were murdered. Alice and Ben both killed you.”
- A 120-second break follows. Players can sit out or return without losing their score. New arrivals wait through the current vote and this break, then receive a role with everyone else. If fewer than three are ready, the Game returns to the lobby.
- The group chooses when to finish; the admin ends the Game. An unfinished round earns no points.

The admin can pause a round, voting or break. Pause freezes all countdowns and prevents ballot submissions. Joining, signing in and choosing next-round readiness remain available. Resume preserves the time that was remaining. Resume a paused Game before calling an early roundtable; this opens voting immediately and uses the usual halfway threshold and five-minute deadline.

## Scoring

“Caught” means receiving the highest faithful accusation total, including all ties and requiring at least one accusation. Traitor murder reports never count as accusations.

| Outcome | Points |
| --- | ---: |
| Faithful accuses any actual traitor | +4 |
| Faithful accuses another faithful | -1 |
| Faithful misses the vote | -1 |
| Faithful receives the most accusations | -1 extra |
| Faithful is murdered without a correct accusation, including no vote | -1 extra |
| Successful murderer escapes; no traitor caught | +4 |
| Successful murderer escapes; another traitor caught | +2 |
| Successful murderer is caught | +1 |
| No successful murder; escapes | 0 |
| No successful murder; caught | -3 |

Faithful penalties add together. The most-accusations penalty applies once per round, only to players sharing the highest accusation total across the whole group, including ties. With no accusations, nobody gets that penalty. A faithful who makes a wrong accusation and receives the most accusations loses 2 points; being murdered as well makes it 3. A correct accusation avoids the murder penalty, but the most-accusations penalty can still reduce +4 to +3.

Only the traitors who report the confirmed victim qualify for successful-murder scoring. A minority attempted murderer uses no-murder scoring, even when their teammates successfully murder someone else. Revised scoring applies when a round finishes; previously completed rounds keep their recorded points.

## Editable phrases and tasks

The complete library is in **[content/tasks.json](content/tasks.json)**. **[content/README.md](content/README.md)** explains how to add and edit entries. Editing the library is separate from gameplay; the admin does not choose or edit tasks. The engine validates required fields and duplicate identifiers.

The site includes a demo with sample players and controls to move through the stages. Demo progression controls do not exist in the live Game API.

## Private codes and storage

- Each player receives a unique six-digit code within their Game. The server keeps a salted SHA-256 hash of that code, not its plaintext. Code entry is throttled after eight failed attempts from the same network address in the same Game, with a one-minute block.
- Signing in creates a long, random bearer session. Up to five sessions per player can remain valid, allowing the same identity to return on another device. A personal code never grants access to other players.
- The current tab uses session storage for its own session and personal code. **Switch player** clears that tab’s credentials, role, ballot choice and cached Game view before presenting the entrance screen. It never keeps a selectable list of other players’ private codes.
- Roles, ballots, private-code hashes and authentication data remain server-side. Public responses include only the current player’s active secrets; completed rounds reveal everyone’s game information as agreed.
- D1 stores the shared state. Compare-and-swap updates prevent concurrent submissions from overwriting one another or awarding points twice.
- Timers use server timestamps. Visible phones synchronise every six seconds and when the page becomes visible. A phase advances on the next authenticated request after its deadline; no background alarm or notification is included.
- Games stop accepting access seven days after creation. Expired rows remain in storage until an operator removes them; automatic deletion is not implemented.
- Earlier prototype Games are not migrated. Their API response asks users to create a new Game. No version of the earlier prototype was published.

## Development

Requires Node.js 22.13+ and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
node scripts/configure-portable.mjs
pnpm build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_spicy_nemesis.sql
pnpm dev
```

Apply the initial migration only once to a new local database. There is no schema change for this revision; Game state and code hashes live within the existing JSON state column. `pnpm db:generate` is only needed after editing `db/schema.ts`.

```sh
pnpm test
pnpm check
# With a local preview running, exercise shared logins and a complete round:
node tests/live-flow.mjs
```

The live-flow script creates its own disposable local Game and uses local D1 updates to advance its deadlines. It refuses remote origins and never creates a progression endpoint in the deployed API. It checks ten independent players, shared-code sign-in, majority and minority murder scoring, exact reveal wording, paused voting, late arrivals, new-round assignment, concurrency and throttling.

## GitHub and deployment

Source repository: **[davidwpf/In-Plain-Sight](https://github.com/davidwpf/In-Plain-Sight)**. It includes the source, migrations, lockfile and GitHub Actions checks.

GitHub can store and build the project. [GitHub Pages provides static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), while this live game also needs a server and shared database. This implementation runs on Cloudflare Workers with D1, or on Sites with managed D1 provisioning.

### Publish automatically from GitHub

Use Cloudflare Workers with a D1 database on the Free plan. GitHub Pages alone cannot run the shared Game API.

1. In Cloudflare, create a D1 database named `in-plain-sight-games` and copy its database UUID.
2. Create a Worker by connecting the `davidwpf/In-Plain-Sight` GitHub repository. Limit the GitHub connection to this repository and select the `main` branch.
3. Set the build command to `pnpm test && pnpm check && pnpm build:cloudflare` and the deploy command to `pnpm deploy:cloudflare`. Leave the root directory at the repository root.
4. Add build variables: `NODE_VERSION=24`, `PNPM_VERSION=11.25.0`, and `CLOUDFLARE_D1_DATABASE_ID` set to the actual database UUID. These are configuration values, not login credentials. Do not commit account credentials or API tokens.
5. Deploy. The deploy command applies pending migrations before publishing. Cloudflare supplies a `workers.dev` address and publishes subsequent updates pushed to `main`.

See [Cloudflare Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/) for the connection and build settings. The database UUID must refer to a database in the same Cloudflare account as the Worker. `CLOUDFLARE_WORKER_NAME` can override the default `in-plain-sight`, and must match the Worker name in the dashboard.

Phones check for updates every six seconds while the Game is visible, and immediately when returning to the tab. The local countdown still updates every second. Twenty continuously visible screens use roughly 48,000 polling requests in four hours, plus other requests. The Workers Free limit is 100,000 requests per day across the account; long sessions or several Games can still reach it.

### Deploy from your computer

1. Install dependencies, select the portable profile and build as above.
2. Sign in to your Cloudflare account: `pnpm exec wrangler login`.
3. Create a database: `pnpm exec wrangler d1 create in-plain-sight-games`. Note the UUID returned by Cloudflare; see [D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/).
4. Prepare the generated deployment configuration, apply migrations, and deploy:

```sh
CLOUDFLARE_D1_DATABASE_ID=your-database-uuid node scripts/prepare-cloudflare.mjs
pnpm exec wrangler d1 migrations apply DB --remote --config dist/server/wrangler.standalone.json
pnpm exec wrangler deploy --config dist/server/wrangler.standalone.json
```

Use the actual database UUID. `CLOUDFLARE_WORKER_NAME` can override the default `in-plain-sight`. Configuration preparation itself does not deploy. Build output is ignored and must be regenerated for deployments. The live game is deployed to Cloudflare Workers with D1. Creation, joining, private codes, role privacy, pause/resume, early roundtables, voting, murder resolution and scoring have been checked against the live service.

### Sites deployment

`.openai/hosting.json` retains the original Sites project identity and `DB` binding for compatibility. The live game uses the standalone Cloudflare deployment above. If using Sites as an alternative, follow its source-sync and publishing workflow and preserve the selected Site’s access settings.

## Source map

- `app/page.tsx`: simple home, entrance, private role, ballot, results, player switching, admin controls and demo.
- `app/globals.css`: responsive styling.
- `app/api/game/route.ts`: Game API, player codes, sessions, throttling and durable updates.
- `lib/game/engine.mjs`: traitor ratios, timers, pauses, ballots, murder resolution and scoring.
- `content/tasks.json`: editable phrase and task library.
- `tests/`: rule checks and the complete local API-flow test.

In Plain Sight is an independent party game, with its own name, wording and design.
