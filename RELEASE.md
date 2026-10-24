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

- GitHub Actions Tests must pass: syntax/persistence/coverage, every unit suite, both settings profiles, each charger × battery matrix and the car matrix.
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

## Current recovery candidate: 0.32.24-dev

Scope: #18, #14, #6, #7, #8, #10, #13, #5, #22, #34, #24, #36, #12, #15, #19, #9, #11 and #20, plus #38 and the remaining contribution guidance for #32. English/Dutch trip writing from 0.32.21-dev is included. Existing dev fixes for #2, #3 and #21 are included in the candidate history.

This candidate does not resolve all audit findings. Physical site/phase capacity allocation (#29), explicit routing privacy (#31), full price-basis preview (#26) and compatibility validation (#28) remain separate work. Native inverter limits and physical hardware verification remain necessary. An older ownership record cannot reconstruct original battery settings that were never saved; validate the manual recovery flow before release. Verify the diagnostics preview at desktop/phone sizes and use synthetic secrets for the export check.

The MIT license and third-party icon notice are retained. Contribution expectations are in CONTRIBUTING.md. Switching the trip-writing language must not write an equivalent event again; check preview and Add trip with an existing Dutch/English event. Different car tags, destinations and distinct start instants remain separate.

The custom forecast setup correction associated with #26 is an installation configuration change. It does not close the broader enhancement for a price-breakdown preview.
