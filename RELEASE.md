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

## Stable release

- Preserve main's prioritized, issue-linked roadmap and any other main-only documentation changes when merging. MIT licensing is already published on both branches; include the dev contribution guide with the release.
- Get the owner's release instruction after the dev home check.
- Re-read both heads, merge tested dev into main and use the release version without -dev.
- On main remove (dev) from app/panel names and TEST VERSION from the description. Check all metadata and changelog headings.
- Run the full main checks, including Core compatibility, and inspect the resulting test plan.
- Close only issues whose complete acceptance criteria are met. Remove fixed in dev after those fixes are released; leave unrelated audit issues open.
- Keep dev's own files/names while recording the main merge in its history, as described in AGENTS.md.
- Release notes state the fixed issues, validation evidence, upgrade/recovery notes and known limitations.

## Current candidate: 0.35.5-dev

Stable main is 0.34.0. The 0.32.24-dev recovery scope (#18, #14, #6, #7, #8, #10, #13, #5, #22, #34, #24, #36, #12, #15, #19, #9, #11, #20, #38, #32) and #4, #16, #17, #35 are released.

Scope on dev since 0.34.0: #31 (trip-distance privacy choice and offline distances), #26 (explicit forecast price basis, no VAT twice) #37 (charging stops on the way, Netherlands and Belgium, from Open Charge Map), #41 (charging stops on the right side of the road: real detour by road, stops on the way back) and #42 (clear saved API-key state, replacement and removal without exposing the secret).

Candidate addition: #43 (Battery Care refill margin of 5 percentage points, separate session goals and current declined-trip estimates).

Not resolved: physical site/phase capacity allocation (#29), compatibility validation (#28) and charging stops outside the Netherlands and Belgium (#40). Native inverter limits and physical hardware verification remain necessary.

Home check for #37: with your own Open Charge Map key, a long trip in the calendar shows plausible stations along the real route; offline trip distances send nothing to Open Charge Map; the key never appears on the page, in diagnostics or in logs. For #41: on a motorway trip the suggested service areas are on your side of the road; a trip with enough to get there suggests a stop on the way back. Station data and operator names from Open Charge Map are not verified against the operators' own apps. For #26 with a combined forecast, check the raw/consumer basis and VAT exactly once.

Home check for #42: save an Open Charge Map key and reload Plan; the badge and field must still say Key saved. Save with the field empty to keep it. Remove key then Discard must keep it; Remove key then Save must remove it and turn charging stops off. A saved key is never displayed.

Home check for #43: with Battery Care at 80%, target 90% and enough known capacity before departure, reconnect at 79% (also check the 75% boundary): the small refill should wait for the final price-planned session. Below 75%, check the separate early session says 80%, then the later session 90%. An explicitly configured hard minimum remains immediate. Check that a previously declined trip-top-up banner follows the current trip estimate and agrees with the timeline. Fixture and Core checks do not establish the car's physical response.

The MIT license and third-party icon notice are retained. Contribution expectations are in CONTRIBUTING.md.
