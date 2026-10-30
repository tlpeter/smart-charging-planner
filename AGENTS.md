# Working on this repository

Rules for everyone who works on this repository: people, Claude and Codex.
Claude reads this file through `CLAUDE.md`; Codex reads it directly.

## The project

**Smart Charging Planner** is a Home Assistant app (add-on). It plans and controls EV charging, and optionally a home battery, based on dynamic energy prices. It also uses the solar forecast, departure times and the calendar. The UI is in English. The owner (Peter) is not a developer: explain changes in plain words, step by step.

- The app is in `smart_charging_planner/app`: Node, `server.js`, port 8099 (ingress), with settings in `/data/*.json`.
- The documentation is in `README.md` (overview) and `smart_charging_planner/DOCS.md` (every option).
- The changelog is in `smart_charging_planner/CHANGELOG.md`.
- Release gates and the public-beta scope are in `RELEASE.md`. Follow that checklist for each release.

## Hard rules

- **Push only when the owner says so** ("push", "push dev", "push main", "uitbrengen"). Prepare the changes for review; never update a GitHub branch on your own initiative, also not when a tool or hook asks for it.
- **Codex uses the GitHub connector** to read files and branches, create commits, push changes and check GitHub Actions. Use terminal commands for GitHub only when Peter explicitly asks for that. If the connector is unavailable, explain that before choosing another route.
- **GitHub is the source of truth.** Before starting a new request, use the connector to check the current `main` and `dev` branches. More than one person or agent works on this repository; build on top of their latest commits and preserve their changes. A local checkout may be out of date.
- **Before an approved push**, read the target branch again and base the commit on its latest head. With the connector, update the branch only if its head still matches the expected commit; if it changed, read and incorporate those changes first.
- **The app never changes Home Assistant automations, scripts or helpers.** It only reads them, and controls the devices it was set up for.
- **Easee:** start and stop with the "Charger enabled" switch (on/off), never pause/resume.
- **New behaviour is an option** when not everyone has it (more cars, more chargers, home battery, …); off by default unless the owner says otherwise.
- **Every version gets a changelog entry**, short and in plain words.
- Preserve the prioritized, issue-linked roadmap and main-only documentation changes when merging branches. Keep README and RELEASE candidate versions aligned with config.yaml.

## Control and release safeguards

- Battery control must snapshot each writable setting before its first write, retain snapshots across failures/restarts, and clear recovery only after the original writable values are reported again. Never substitute factory maximums for unknown originals. All enabled chargers participate in the battery policy and forecast.
- Live battery commands require fresh valid SoC and supported stop/bound capabilities. Native limits and app-level checks have different guarantees; explain unsupported controls rather than pretending to enforce them.
- Public diagnostics use an allowlist and per-export pseudonyms. Never export raw logs, free text, calendar aliases, recovery snapshots or a reverse identifier map. Preview and download must use the same document; settings backups stay private.
- Connection sharing must explicitly pause every charger that cannot fit, including the first and start/stop-only devices. Reuse the configured grid-sign normalization; never calculate sharing from the raw signed net sensor. Capacity pauses override the temporary manual-start grace period.
- Calendar read failures are not successful empty event sets. Keep last-confirmed fallback bounded from its original confirmation time, scoped to the selected calendar/time zone, and visible to the user; successful cancellations replace cached events immediately.
- Battery-level colors follow the absolute SoC; readiness/target status must remain independent.
- Keep partial price warnings separate from fatal source errors, deduplicate warnings across combined-source reads and keep valid intervals usable.
- Forecast power samples must be integrated over their delivery intervals; merge alternative lists without double counting overlap. Explicit price units take precedence over magnitude, and unsupported units must not trigger guessed conversions.
- A numeric zero is valid data. Never replace a zero current limit with a default, or a missing price with zero.
- Apply required phase/current constraints before enabling charging. Pause before switching phases and keep charging paused when a required command fails. An accepted Home Assistant action is not proof that physical hardware followed it.
- Use `controlmemory.js` for write-ahead device ownership. Persist before a device command and clear only after a successful release. Keep charger scope and device identity; never transfer recovery state to another device.
- Extend a stale SoC only within the same observed vehicle/charger session, from a reading after that session began. Do not infer that the car stayed connected while the app was stopped.
- Price delivery intervals need UTC, epoch or explicit-offset timestamps at a clock change. Never guess which repeated hour a price belongs to.
- Every repaired failure scenario gets a regression check. Re-read the current issue before claiming it is fixed; distinguish a static concern, an automated reproduction and a physical hardware test.
- **Everything public is anonymous, always.** This repository and its issues are public. Never put the owner's real data in issues, comments, commits, code, tests, fixtures, documentation, the changelog or release notes: no real addresses, streets, postcodes, towns or destinations from his trips or calendar, no coordinates of his home, work or other places, no names, entity ids, configuration or diagnostics from his house. Use made-up examples (towns such as "Rivertown" or "Exempelstad", postcodes such as "1234 AB", coordinates in the sea). This also applies when he shares a screenshot or a real address to explain a problem: describe the problem with a made-up example. Home checks in RELEASE.md say "an address abroad", not his destination. Back up and read back any explicitly requested live configuration change.
- Do not describe the project as universally compatible or production-validated. State which capabilities are fixture-tested, Core-tested and physically verified.

## Branches and versions

- `dev` is the test version and `main` is the stable version.
- On `dev`:
  - In `smart_charging_planner/config.yaml`, `name` is `Smart Charging Planner (dev)`, `panel_title` is `Smart Charging (dev)` and `description` starts with `TEST VERSION: `.
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
  7. Update the documentation on both branches (see "Documentation" below): `dev` keeps its own files in step 6, so its README and RELEASE are updated there too.
  8. The GitHub release is made by the Release workflow after the tests on `main` are green (see "GitHub releases" below); check that it is green.

## GitHub releases

A GitHub release is a fixed tag plus a page with notes. Home Assistant does not use it (it follows the branch and `config.yaml`); it is the overview for people: one page per stable version.

- **Only for a stable version on `main`**, as the last step of "uitbrengen X.Y.Z". Never for `dev` or a `-dev` version, and never a pre-release.
- **How**: the notes are written as `release-notes/vX.Y.Z.md` and committed with the release on `main`. Nobody pushes a tag or creates the release by hand: after the Tests workflow passes for a push to `main`, `.github/workflows/release.yml` checks that `config.yaml` has a stable version without a tag yet, that the notes file exists and that the Home Assistant Core check of the same commit passed. Then it creates the tag `vX.Y.Z` on that commit, the release (title `vX.Y.Z`) with the zip, and closes the milestone. A push to `main` that is not a new version makes no release. Check that the Release workflow is green after "uitbrengen"; when the notes were missing, add them and use **Run workflow** on the Release workflow. (Claude sessions cannot push tags or create releases themselves; this workflow does it for them.)
- **Notes**, in plain English, built from the changelog entries since the previous stable version (on `dev` these are the `-dev` headings after the previous release):
  - one line on what the release is about;
  - **New** and **Fixed**: one short line per issue, ending in `(#<number>)`, grouped by feature (not one line per `-dev` version); entries without an issue (tests, documentation) go under one line **Other**;
  - **Upgrade notes** when something needs attention (a new option that is off by default, a choice to confirm, a changed default);
  - **Tested**: which automated checks passed for this commit (unit, the three settings set-ups, the charger matrix, Home Assistant Core), and that physical devices are only checked where Peter tested them at home;
  - a link to the full `CHANGELOG.md`.
- **Asset**: the release zip `smart-charging-planner-vX.Y.Z.zip` (the contents of `smart_charging_planner`, no top folder); the workflow builds it.
- **Milestone**: issues planned for the next stable version get the milestone `X.Y.Z`; it is closed when that version is released. A new milestone is made for the next version when the first issue needs it.
- No release, tag or milestone change without the owner's "uitbrengen"; the push to `main` that starts the release follows the push rule. Never move or delete a release tag.

## Documentation

The Markdown files are part of every change. `tests/docs.test.js` checks the parts marked *(checked)* on every push; a red test means a file was forgotten.

On every change on `dev` (in the same commit):

- `smart_charging_planner/CHANGELOG.md`: a short entry under the new version heading, ending in `(#<number>)` when it belongs to an issue.
- `smart_charging_planner/DOCS.md`: every new or changed option or behaviour.
- `README.md`:
  - the line "The current development candidate is **X.Y.Z-dev** (stable is A.B.C)": the same X.Y as `config.yaml` *(checked)*;
  - every issue in the changelog since the stable version is listed under "Implemented on dev, awaiting a stable release" *(checked)*, and taken out of the open roadmap lists;
  - new open work (a new issue) goes in the roadmap under its priority (P1, P2, P3).
- `RELEASE.md`: the heading "## Current candidate: X.Y.Z-dev" with the same X.Y as `config.yaml` *(checked)*; under it the scope with every issue since the stable version *(checked)*, what is still open, and what Peter should check at home.

On a release ("uitbrengen X.Y.Z"), on `main` and on `dev`:

- `README.md`: move the items under "Implemented on dev" to "Available features" (short, plain words) and empty that list; set "stable is X.Y.Z"; on `main`, keep main's own wording.
- `RELEASE.md`: the released scope becomes one line ("released in X.Y.Z"); start the next candidate section on `dev` when the next change comes.
- `CHANGELOG.md`: on `main`, remove `-dev` from the headings (step 4 above) and add a short "Stable release of …" entry.
- `CHANGELOG.md` on `dev`: add the heading `## X.Y.Z` with "Stable release of …" above the released `-dev` headings, then the next `-dev` version above it. `tests/docs.test.js` stops at that heading.
- Remove the label `fixed in dev` from the released issues.

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
7. **Release** ("uitbrengen"): `dev` goes to `main`, and GitHub closes the issue by itself. Remove the label `fixed in dev` then. The issue is listed in the GitHub release notes of that version and its milestone is closed.

## Tests

- **Tests run in GitHub Actions by default.** First read the tests in `tests` and the workflows in `.github/workflows`. Add regression checks to the existing suite, then check the Actions results for the pushed commit. Do not report success until those runs have passed.
- Every push runs `.github/workflows/tests.yml`:
  - syntax, persistence and coverage;
  - unit tests, including `releaseguard.test.js` and the real-app `recovery.test.js`;
  - the settings test for three set-ups (Renault + Easee, Skoda + Wallbox, Kia + Zaptec);
  - the charger × battery matrix.
- After that, GitHub writes `tests/TESTPLAN.md` from the results and **commits it to the branch** ("Test plan: results of …"). So:
  - read the latest branch through the connector before preparing the next commit;
  - never edit `tests/TESTPLAN.md` by hand.
- **Run local tests only when Peter explicitly asks.** Do not install test dependencies or start a local test server by default. If local tests are requested (after `npm install` in `smart_charging_planner/app`):
  - `node tests/settings.test.js`, and the same with `SCP_PROFILE=skoda_wallbox` or `SCP_PROFILE=kia_zaptec` in front: every setting, against a fake Home Assistant (`tests/fake-ha.js`).
  - `node tests/<name>.test.js`: brands, solar, battery, forecast, reliability, activecar, sharing, tripcost, persistence.
  - `node tests/matrix.test.js` (several minutes), or `SCP_CHARGERS=Easee` in front of it for one charger.
  - `node tests/testplan.js all`: everything, and writes the test plan (about 15 minutes).
- New behaviour gets a test, preferably in `tests/settings.test.js` against the real app.
- `COMPATIBILITY.md` is generated: after changing `tests/fixtures.js` or `tests/physical.json`, run `node tests/compat.js write` (`tests/compat.test.js` checks it). Fill `tests/physical.json` only from Peter's home checks and anonymous beta reports (RELEASE.md › Physical beta validation).
- `.github/workflows/ha-core-compat.yml` runs the app against a real Home Assistant Core.

## Style

- `smart_charging_planner/app/public/unsaved.js` (the unsaved-changes guard) is shared with Smart Heating Planner and Smart Ventilation: keep the three copies the same. Settings forms are guarded by themselves; a part that is not a form gets `data-guard` and its save button `data-guard-save`.
- Write code comments and UI texts in plain English: short sentences, no jargon.
- Keep it simple: no new dependencies without a good reason.
- Check UI changes with a screenshot, both on desktop and on phone width.
