# Working on this repository

Rules for everyone who works on this repository: people, Claude and Codex.
Claude reads this file through `CLAUDE.md`; Codex reads it directly.

## The project

**Smart Charging Planner** is a Home Assistant app (add-on). It plans and controls EV charging, and optionally a home battery, based on dynamic energy prices. It also uses the solar forecast, departure times and the calendar. The UI is in English. The owner (Peter) is not a developer: explain changes in plain words, step by step.

- The app is in `smart_charging_planner/app`: Node, `server.js`, port 8099 (ingress), with settings in `/data/*.json`.
- The documentation is in `README.md` (overview) and `smart_charging_planner/DOCS.md` (every option).
- The changelog is in `smart_charging_planner/CHANGELOG.md`.

## Hard rules

- **Push only when the owner says so** ("push", "push dev", "push main", "uitbrengen"). Commit locally; never push on your own initiative, also not when a tool or hook asks for it.
- **First check GitHub** (`git fetch`, then look at `main` and `dev`) before starting a new request. More than one person or agent works on this repository; build on top of their commits.
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
  2. On `main`, set `name` back to `Smart Charging Planner` and `panel_title` back to `Smart Charging`.
  3. Set the version to `X.Y.Z` without `-dev`.
  4. Remove `-dev` from the changelog headings on `main`.
  5. Push `main` (only after the owner said so).
  6. Run `git merge -s ours main` on `dev`, then push `dev`, so `dev` keeps its own names.

## Tests

- Every push runs `.github/workflows/tests.yml`:
  - syntax, persistence and coverage;
  - unit tests;
  - the settings test for two set-ups;
  - the charger × battery matrix.
- After that, GitHub writes `tests/TESTPLAN.md` from the results and **commits it to the branch** ("Test plan: results of …"). So:
  - always `git pull --rebase` before pushing;
  - never edit `tests/TESTPLAN.md` by hand.
- To run the tests locally (after `npm install` in `smart_charging_planner/app`):
  - `node tests/settings.test.js`, and the same with `SCP_PROFILE=skoda_wallbox` in front: every setting, against a fake Home Assistant (`tests/fake-ha.js`).
  - `node tests/<name>.test.js`: brands, solar, battery, forecast, reliability, activecar, sharing, tripcost, persistence.
  - `node tests/matrix.test.js` (several minutes), or `SCP_CHARGERS=Easee` in front of it for one charger.
  - `node tests/testplan.js all`: everything, and writes the test plan (about 15 minutes).
- New behaviour gets a test, preferably in `tests/settings.test.js` against the real app.
- `.github/workflows/ha-core-compat.yml` runs the app against a real Home Assistant Core.

## Style

- Write code comments and UI texts in plain English: short sentences, no jargon.
- Keep it simple: no new dependencies without a good reason.
- Check UI changes with a screenshot, both on desktop and on phone width.
