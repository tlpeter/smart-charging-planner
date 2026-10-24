# Working on this repository

Rules for everyone who works on this repository: people, Claude and Codex.
Claude reads this file through `CLAUDE.md`; Codex reads it directly.

## The project

**Smart Charging Planner** is a Home Assistant app (add-on). It plans and controls EV charging, and optionally a home battery, based on dynamic energy prices. It also uses the solar forecast, departure times and the calendar. The UI is in English. The owner (Peter) is not a developer: explain changes in plain words, step by step.

- The app is in `smart_charging_planner/app`: Node, `server.js`, port 8099 (ingress), with settings in `/data/*.json`.
- The documentation is in `README.md` (overview) and `smart_charging_planner/DOCS.md` (every option).
- The changelog is in `smart_charging_planner/CHANGELOG.md`.

## Hard rules

- **Push only when the owner says so** ("push", "push dev", "push main", "uitbrengen"). Prepare the changes for review; never update a GitHub branch on your own initiative, also not when a tool or hook asks for it.
- **Codex uses the GitHub connector** to read files and branches, create commits, push changes and check GitHub Actions. Use terminal commands for GitHub only when Peter explicitly asks for that. If the connector is unavailable, explain that before choosing another route.
- **GitHub is the source of truth.** Before starting a new request, use the connector to check the current `main` and `dev` branches. More than one person or agent works on this repository; build on top of their latest commits and preserve their changes. A local checkout may be out of date.
- **Before an approved push**, read the target branch again and base the commit on its latest head. With the connector, update the branch only if its head still matches the expected commit; if it changed, read and incorporate those changes first.
- **The app never changes Home Assistant automations, scripts or helpers.** It only reads them, and controls the devices it was set up for.
- **Easee:** start and stop with the "Charger enabled" switch (on/off), never pause/resume.
- **New behaviour is an option** when not everyone has it (more cars, more chargers, home battery, …); off by default unless the owner says otherwise.
- **Every version gets a changelog entry**, short and in plain words.

## Branches and versions

- `dev` is the test version and `main` is the stable version.
- On `dev`:
  - In `smart_charging_planner/config.yaml`, `name` is `Smart Charging Planner (dev)` and `panel_title` is `Smart Charging (dev)`.
  - The version ends in `-dev`, for example `0.29.7-dev`.
  - Bump the version on every change, in three places:
    - `smart_charging_planner/config.yaml` (with `-dev`);
    - `smart_charging_planner/app/package.json` (without `-dev`);
    - `smart_charging_planner/app/package-lock.json` (without `-dev`, two places).
- **Release** ("uitbrengen X.Y.Z"):
  1. Merge `dev` into `main`.
  2. On `main`, set `name` back to `Smart Charging Planner` and `panel_title` back to `Smart Charging`, and remove `TEST VERSION: ` from the start of `description` (only `dev` is a test version).
  3. Set the version to `X.Y.Z` without `-dev`.
  4. Remove `-dev` from the changelog headings on `main`.
  5. Push `main` (only after the owner said so).
  6. Merge `main` into the history of `dev` while keeping the current files of `dev` (the equivalent of `git merge -s ours main`), then push `dev`, so `dev` keeps its own names. Codex does this through the connector.

## Issues (bugs and wishes on GitHub)

How a GitHub issue is handled, from report to release:

1. **Report:** a bug or wish goes in a GitHub issue (label `bug` or `enhancement`): what happens, what should happen, the version, and where in the code it probably is.
2. **Fix on `dev`:** the fix is made on `dev` (no separate branch), with a test that would have caught it, a version bump and a changelog entry ending in `(#<number>)`.
3. **Commit message:** contains `Fixes #<number>`. GitHub then links the commit to the issue. The issue does not close yet: GitHub only closes it when the commit reaches `main`.
4. **Push** only when Peter says so, as always.
5. **When the tests in GitHub Actions are green:** add a comment to the issue and the label `fixed in dev`. The repository is public, so the comment explains the fix for someone who reads it later, in plain English, with these parts:
   - **Fixed in** X.Y.Z-dev, with a link to the commit (the full code change is there; do not paste code into the issue);
   - **Affected:** which versions had the problem, and whether `main` has it;
   - **What was wrong:** the cause, in a few sentences;
   - **What changed:** what the user sees now, with a before/after example (a small table when there are numbers);
   - **What did not change**, when that matters (for example: only the display, not the planning);
   - **Code:** the main idea of the change in one sentence, then the files and functions;
   - **Test:** which test checks it now, and that it is green;
   - **How to check:** a few steps to try it yourself;
   - the last line: "Closes when released to main."
6. **Peter tests** the dev version at home. If it is not right, the issue gets a comment and the label is removed again.
7. **Release** ("uitbrengen"): `dev` goes to `main`, and GitHub closes the issue by itself. Remove the label `fixed in dev` then.

## Tests

- **Tests run in GitHub Actions by default.** First read the tests in `tests` and the workflows in `.github/workflows`. Add regression checks to the existing suite, then check the Actions results for the pushed commit. Do not report success until those runs have passed.
- Every push runs `.github/workflows/tests.yml`:
  - syntax, persistence and coverage;
  - unit tests;
  - the settings test for two set-ups;
  - the charger × battery matrix.
- After that, GitHub writes `tests/TESTPLAN.md` from the results and **commits it to the branch** ("Test plan: results of …"). So:
  - read the latest branch through the connector before preparing the next commit;
  - never edit `tests/TESTPLAN.md` by hand.
- **Run local tests only when Peter explicitly asks.** Do not install test dependencies or start a local test server by default. If local tests are requested (after `npm install` in `smart_charging_planner/app`):
  - `node tests/settings.test.js`, and the same with `SCP_PROFILE=skoda_wallbox` in front: every setting, against a fake Home Assistant (`tests/fake-ha.js`).
  - `node tests/<name>.test.js`: brands, solar, battery, forecast, reliability, activecar, sharing, tripcost, persistence.
  - `node tests/matrix.test.js` (several minutes), or `SCP_CHARGERS=Easee` in front of it for one charger.
  - `node tests/testplan.js all`: everything, and writes the test plan (about 15 minutes).
- New behaviour gets a test, preferably in `tests/settings.test.js` against the real app.
- `.github/workflows/ha-core-compat.yml` runs the app against a real Home Assistant Core.

## Style

- `smart_charging_planner/app/public/unsaved.js` (the unsaved-changes guard) is shared with Smart Heating Planner and Smart Ventilation: keep the three copies the same. Settings forms are guarded by themselves; a part that is not a form gets `data-guard` and its save button `data-guard-save`.
- Write code comments and UI texts in plain English: short sentences, no jargon.
- Keep it simple: no new dependencies without a good reason.
- Check UI changes with a screenshot, both on desktop and on phone width.
