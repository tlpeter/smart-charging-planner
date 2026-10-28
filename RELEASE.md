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

## Current candidate: 0.36.19-dev

Stable main is 0.35.0 (release v0.35.0: #26, #31, #37, #41, #42, #43, #44, #45). Earlier: 0.34.0 (#4, #16, #17, #35) and 0.33.0.

Scope on dev since 0.35.0: #28 (compatibility matrix generated from the tests, beta test report form and physical test status, container build for amd64 and aarch64, Core check against 2026.4.2 as well as 2026.10.4), #46 (where the car is when not plugged in: car location, person, calendar, else not known; Home no longer assumes the car is at home), #29 (sharing the connection per phase across chargers and the home battery, with load-balancer scope, fresh-reading check and step-by-step changes), #40 (charging stops in all European countries, routes across a border, more stops on a long trip, "Charge to at a stop", "Arrive at a charger with at least"), #48 (countries and operators as lists that open and close, with search; operators seen in the station data can be preferred), #49 (addresses abroad are found: own country first, then every country), #50 (a stop as late as possible, at the best station, alternatives marked), #51 (what you opened on Home stays open across the reload every minute), #47 (the route and the stops on a map, off by default; map icon in Looking ahead), #54 (zoom and drag with Leaflet, shipped with the app).

Not resolved: the operator name variants for #40 follow brand names and are not checked against live Open Charge Map data. #29 is fixture-tested only, not yet checked on real hardware. Native inverter limits and physical hardware verification remain necessary.

Home check for #29 (with two chargers): in Settings › Grid choose the phase current sensors of your P1 meter. Home › Chargers then shows the free current per phase. For a one-phase charger, set its phase in Settings › Charger and check that the free current drops on that phase only while it charges. If your load balancer only protects one charger, untick the other in Settings › Grid. Unplug the P1 meter for 5 minutes: only one charger should charge, at 6 A.

Home check for #46: set the car location (and, if you like, yourself as person) under Settings › Vehicle. Leave for work without plugging in: Home should say "Car away (car location)", and Looking ahead should start from the battery level now, with charging as "if plugged in". Back home and unplugged: "At home". Then clear the car location, set the person to a phone that is away: the person decides.

Home check for #40: under Plan › Charging stops on the way, tick Germany or France too and Save. Put a far trip in the calendar (for example 600 km away, there and back): Looking ahead should show "charge on the way (N stops)" and one block per stop with the level on arrival and "charge to". Check a few stations on the map: are they on the motorway, and are the operators you know recognised? Set "Arrive at a charger with at least" to 5 %: the stops should move further along, arriving between 5 and 10 %. Tick "Only suggest stops in these countries" with only the Netherlands: stations abroad should disappear.

Home check for #54: open the big map with the map icon: zoom in with + / − or two fingers, drag it, tap a numbered stop for its station. In the map in the day's details, the page should still scroll with the mouse wheel and one finger.

Home check for #47: set Route map to OpenStreetMap under Plan › Charging stops on the way. In Looking ahead, the line of a far trip should have a map icon 🗺: one click opens the big map without opening the day (close with ✕, Esc or next to it). Open a day with a far trip in Looking ahead and open "Show the route on a map": the map should show the route with H, D and the numbered stops, on the phone and on a computer. It should stay open when Home reloads. Try "Open on openstreetmap.org".

Home check for #51: open a day in Looking ahead and Plan details on Home and wait two minutes: both should stay open. Close one again: it should stay closed.

Home check for #50: on a far trip, every stop should arrive with about the level for a stop or less (down to "Arrive at a charger with at least"), not with a lot left. The first station of a stop should be the fastest with the most points; the others are under "Or:", each with its own level on arrival.

Home check for #49: a calendar trip to an address abroad should get a distance in Looking ahead within a minute instead of "The address was not found on OpenStreetMap". A trip to an address in the Netherlands should still go to the same place as before.

Home check for #48: open Plan › Charging stops on the way on your phone and on a computer. Countries and Choose operators should open and close; search for "fast" or a name. Tick an operator and remove it again with ✕ on its label: the Save bar should appear. After a far trip has been looked up, open "Seen on your routes": are there operators you know that are missing from the other groups?

Home check for #28: open COMPATIBILITY.md on GitHub and check your own charger, car and battery rows; tell which capabilities you have seen working at home, so the Physical test column can be filled. Try the Beta test report form once (Issues › New issue).

The MIT license and third-party icon notice are retained. Contribution expectations are in CONTRIBUTING.md.
