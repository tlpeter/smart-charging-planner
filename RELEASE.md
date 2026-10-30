# Release checklist

Smart Charging Planner is a public beta. A published version is not a claim that every car, charger or battery is physically verified.

## Before updating dev

- Read the current main/dev heads through the GitHub connector. Preserve concurrent work.
- Scope the release to named issues, reproduce the affected behaviour in regression checks, and document any remaining limitations.
- Increment config.yaml, package.json and both package-lock.json version fields together. Keep the dev name, panel title and TEST VERSION description.
- Update CHANGELOG.md, README.md and DOCS.md when behaviour or expectations change.
- Push only within the owner's authorization. Re-read the branch head and use an expected-head check.
- Do not edit tests/TESTPLAN.md by hand; the workflow writes it.

## Automated validation

- GitHub Actions Tests must pass: syntax/persistence/coverage, every unit suite, all three settings profiles, each charger × battery matrix and the car matrix.
- Home Assistant Core compatibility must pass for the same candidate code.
- Check failed jobs and their logs. Do not mark an issue fixed based on a queued run or a different commit.
- Report exactly which checks ran. Fixture/fake-HA and Core contract checks are not physical device tests.

## Home check before main

Peter checks the dev version at home before a stable release:

- A normal scheduled charge and Charge now; a pause and a later restart.
- Current limit changes, including zero; hardware load balancing remains active.
- Solar current changes and one/three-phase recovery, where that hardware supports them.
- App restart while it owns a charger/battery setting, then return to normal operation.
- Temporary missing vehicle data; compare the estimate and ready status with the real car.
- Calendar departure and a price preview against the supplier. For a combined forecast, check the raw/consumer basis and VAT exactly once.

Use the regression fixtures for fault injection; do not create hazardous real-world electrical conditions for testing. Record physical checks honestly, including checks that were not performed.

## Physical beta validation

[COMPATIBILITY.md](COMPATIBILITY.md) shows per integration what is fixture-tested, Core-tested and physically verified. Its **Physical test** column comes from `tests/physical.json`:

- Results come from Peter's home checks and from **Beta test report** issues (label `beta report`). Only anonymous details: brand, model, integration and its version, Home Assistant version, app version, and which capabilities were seen working on the device itself.
- Per integration: `verified` (every capability in its row worked on real hardware), `partly` (with a short note which ones), or `problem` (a real-hardware problem with an open issue). Never names, addresses, entity ids or serial numbers.
- After editing `tests/physical.json` or `tests/fixtures.js`, run `node tests/compat.js write`; `tests/compat.test.js` fails otherwise.
- A stable release does not claim physical support beyond what that column says.

## Stable release

- Preserve main's prioritized, issue-linked roadmap and any other main-only documentation changes when merging. MIT licensing is already published on both branches; include the dev contribution guide with the release.
- Get the owner's release instruction after the dev home check.
- Re-read both heads, merge tested dev into main and use the release version without -dev.
- On main remove (dev) from app/panel names and TEST VERSION from the description. Check all metadata and changelog headings.
- Run the full main checks, including Core compatibility, and inspect the resulting test plan.
- Close only issues whose complete acceptance criteria are met. Remove fixed in dev after those fixes are released; leave unrelated audit issues open.
- Keep dev's own files/names while recording the main merge in its history, as described in AGENTS.md.
- Release notes state the fixed issues, validation evidence, upgrade/recovery notes and known limitations. They are written as `release-notes/vX.Y.Z.md` in the release commit on main; after green tests on main the Release workflow creates the tag `vX.Y.Z` and the GitHub release with the zip, and closes the milestone `X.Y.Z` (AGENTS.md › GitHub releases).

## Current candidate: 0.37.0-dev

Stable main is 0.36.0 (release v0.36.0: #28, #29, #40, #46, #47, #48, #49, #50, #51, #54). Earlier: 0.35.0 (#26, #31, #37, #41, #42, #43, #44, #45), 0.34.0 (#4, #16, #17, #35) and 0.33.0.

Scope on dev since 0.36.0: none yet.

Not resolved: #29 is fixture-tested only, not yet checked on real hardware. The operator name variants for #40 follow brand names and are not checked against live Open Charge Map data. Native inverter limits and physical hardware verification remain necessary.

The MIT license and third-party icon notice are retained. Contribution expectations are in CONTRIBUTING.md.
