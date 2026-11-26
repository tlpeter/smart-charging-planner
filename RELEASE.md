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

## Current candidate: 0.39.15-dev

Stable main is 0.39.0 (release v0.39.0: #57, #58, #59, #60, #61, #62, #63, #64, #65). Earlier: 0.38.0 (#25, #33, #39, #55, #56), 0.36.0 (#28, #29, #40, #46, #47, #48, #49, #50, #51, #54), 0.35.0 (#26, #31, #37, #41, #42, #43, #44, #45), 0.34.0 (#4, #16, #17, #35) and 0.33.0.

Scope on dev since 0.39.0: #66 (route to the next trip on the phone, off by default), #67 (calendar: keywords as whole words with more words allowed, only events with a place and skip words, both off by default), #68 (search field for settings), #52 (Looking ahead: 24 hours), #27 (price forecast: freshness, list, unit and reach checks, recipe), #69 (Core check on 2026.11.2), #70 (wake a sleeping car, Ready Guard "The car is not charging"), #71 (calendar: only "doel:", "goal:" or "target:" makes an event a trip with Events with a target), #72 (Looking ahead: later days start at the target after the expected charging), #73 (trip estimates in winter: no indoor sensor as outside temperature, the cold not counted twice).

Home check for #66: turn on Settings › Rules › Send the route to my phone before a trip and "Route to the next trip" for your phone; add a calendar trip with an address abroad as location; at the set time one notification comes; a tap opens Google Maps with the route; Send to car shows it in the car; no second message.

Home check for #67: in Plan › Departures › Calendar turn on Only events with a place; a reminder without a location today is no longer the departure and charging does not start for it; a trip with a location or "To Work" still counts. Add skip words (with a comma) and check an event with one of them is not listed under Trips from your calendar. With Events that contain a keyword, enter two keywords and check both count.

Home check for #68: on Settings type "agenda" and "accu" in the search field; the results show where each setting is; a click opens the page and lights up the setting, also on the phone. With unsaved changes the app asks first.

Home check for #52: on Home choose 24 hours in Looking ahead; only tonight's charging and tomorrow's first trip (with its way back) are shown; after a reload 24 hours is still chosen, and Plan shows 7 days.

Home check for #27: on Settings › Prices press Test with your forecast sensor: it shows when the forecast was updated and until when it reaches. Set "Not used when older than" to 6 hours with a forecast that is older: the plan stops using it and Home warns; set it back to 48 afterwards.

Home check for #70 (important): Settings › Rules shows Wake the car on, with the car's Start charge button. With a trip that needs more than the car's current limit at night: the log shows the limit set, the charger on, and when no power flows within 2 minutes "pressed … to wake it", and the car charges. If it still does not charge, the phone gets "The car is not charging" within about 10 minutes.

Home check for #71: set Plan › Departures › Calendar › Which events are trips? to Events with a target. A meeting with a location and no target is not under Trips from your calendar and is not the next departure; a trip with "doel: 80" or "goal: 80" is, with that target. Preconditioning before a trip home with only "precondition: ja" still starts.

Home check for #72: on Home choose 7 days in Looking ahead. Days marked estimate (after the known prices) that follow a trip with "to 80% (prices not known yet)" start at 80 %, not at the level of the day before, and no later day goes below 0 % for a normal work trip.

Home check for #73: Activity › Trips names a real outdoor sensor under the totals (not a sensor in a room or of a heater), and after the next hourly refresh the drives show temperatures around the real outside temperature; after a few days "Extra per degree below 15 °C" gets a value. A daily work trip in Looking ahead costs about what the car really uses (compare with the drives on the Trips page), and its row shows the cold part.

Home checks still open from 0.39.0 and 0.38.0 (released before the owner's home check): #57–#65, and #55, #33, #25, #39 and #56. The steps are in those issues.

Not resolved: #29 is fixture-tested only, not yet checked on real hardware. The operator name variants for #40 follow brand names and are not checked against live Open Charge Map data. Native inverter limits and physical hardware verification remain necessary.

The MIT license and third-party icon notice are retained. Contribution expectations are in CONTRIBUTING.md.
