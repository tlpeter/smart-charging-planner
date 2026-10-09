# Changelog

## 0.29.9-dev

- **Zones in Home Assistant** are used as places, automatically: a zone "Werk" makes "Naar Werk" (location "Werk", or a title "Naar Werk" with "IQ Messenger" as location) show what the trip costs, with the zone's GPS position. No address needed
- Plan › My places lists the zones the app found; a name in My places goes before a zone with the same name. The Home zone is your home
- Docs: which place a trip goes to (location, address, title, zone, My places)
- Tests: settings test Y7 and a tripcost check

## 0.29.8-dev

- **My places** (Plan): give names you use in the calendar an address, for example "Werk" → "Pieter Zeemanweg 57, Dordrecht". A trip whose location is that name ("Werk", "IQ Messenger"), or whose title is "Naar Werk", then shows what it costs, and the timeline knows the battery level when you are back. A real address in the event still wins
- When the distance of a trip is not known, Home says why ("Not an address", "not found on OpenStreetMap") and offers **Add "Werk" to My places**, which opens Plan with the name filled in
- My places are part of the settings export and import
- Tests: settings test Y6 and a tripcost check

## 0.29.7-dev

- **Looking ahead is now a timeline** of the coming days (up to 7 days, 6 departures), in the order things happen: charging (blue, the real plan), leaving (target and what the trip costs), back home (with about how much battery), expected charging (orange), leaving again, … The battery level is on the right of each step. Replaces "Next stop" and "Next goal", which repeated Ready Guard and were hard to follow
- **The chart** goes on past the departure to the expected charging (at most 3 days ahead): expected charging in orange, the time the car is away shaded ("away"), later departures as orange dashed lines with their target
- A trip that costs more than the battery holds says so ("charge on the way")
- Tests: settings test Y5 (a week with trips, back home and expected charging)

## 0.29.6-dev

- Fix: a trip added with **Add trip** did not show up on Plan and under Looking ahead until the next refresh (up to 5 minutes). Now it counts right away
- Fix: when OpenStreetMap has found an address (or the route), Plan and Home show what the trip costs right away instead of "Looking up the distance…" until the next refresh
- Fix: with the calendar read by keyword ("EV"), a trip added by the app was not read back (it has "doel: 80" but not the keyword). Events with "doel:" or "target:" in the description now always count
- Add trip is refused when the calendar is not used for departures (the trip would never count); the form already hid itself then
- Add trip: optional **Back home at**: the event lasts until then, so Looking ahead knows when the car is back (without it: 15 minutes, so the car was "back" right after leaving)
- With one car Add trip has no car to choose: the trip is for that car (the **For** choice only appears with more than one car)
- Tests: group U, Add trip for real (written to the calendar, shown right away on Plan and Home, duplicates, keyword calendar, calendar off, more cars)

## 0.29.5-dev

- **Test plan written automatically**: after every push GitHub runs all tests and writes `tests/TESTPLAN.md` from the results (settings, every unit test with every check, and the charger × battery matrix), and saves it in the branch when it changed. The plan can no longer fall behind the code
- `node tests/testplan.js all` does the same on your own computer
- The test plan now also lists the unit tests (more cars, more chargers, look ahead, Ready Guard, …) and has a summary at the top; doubled lines are gone
- The saved test plan is a small extra commit by GitHub ("Test plan: results of …"); pull before pushing again
- The results of each test run are also shown on the run's summary page in GitHub Actions

## 0.29.4-dev

- Fix: looking ahead took a trip home **after another trip** as the way back. Example: Outdoorvalley on Sunday, then Naar Werk and Naar Thuis on Monday: the car was "back" on Monday 16:45 and Monday's Naar Werk was skipped as next goal. Now only the very next calendar trip counts as the way back, and only when it is a trip home; otherwise the trip is counted there and back and the car is back at the end of its event
- A trip to your own home address (within 1 km of the home in Home Assistant) counts as a trip home, like "Thuis"
- Addresses with a company or place name in front ("IQ Messenger, Pieter Zeemanweg 57, …") are found: when OpenStreetMap does not find the whole text, the app tries again without the first part
- Plan shows "Address not found on OpenStreetMap" for a trip whose address cannot be found
- Tests: settings test Y2b (this calendar)

## 0.29.3-dev

- Ready Guard's **Expected ready** time now follows the end of the actual scheduled charging blocks instead of pretending charging starts continuously right now
- The uninterrupted charging estimate remains separate and is still used internally when Ready Guard must take over

## 0.29.2-dev

- **Apple iCloud calendars** (Home Assistant 2026.10+: each iCloud calendar is a calendar entity) work for departures like any other calendar: "doel: 80", "precondition: ja" and "auto: …" are read from the event
- iCloud calendars are read only in Home Assistant: the calendar list marks read-only calendars, and Add trip says so (and refuses with a clear reason) instead of failing; add those trips in the calendar app itself. The app checks the calendar's "create event" feature, so this works for every read-only calendar
- Docs: which calendars work
- Tests: settings test Z1 (departure from a read-only iCloud calendar, adding refused)

## 0.29.1-dev

- Looking ahead now separates **Next stop** (the first upcoming trip, including its required battery level) from **Next goal** (the departure after the car is back). An extra calendar trip such as Spijkenisse therefore moves in front of a later 100% trip automatically
- The fast Home Assistant simulator now reports Core 2026.10.0
- A separate free GitHub Actions compatibility test starts a real, isolated Home Assistant Core 2026.10.0 container every Monday, on relevant `dev` changes and on demand. It checks the WebSocket contracts and the app's vehicle, charger, grid, price, control and solar discovery routes

## 0.29.0-dev

- **Looking ahead**: Home shows the **next goal** after the coming departure, also when the current target is already reached and also when the prices for then are not known yet
- **What a trip costs**: for a calendar trip with an address in its location, the distance by road (OpenStreetMap: Nominatim and OSRM; the straight line × 1.3 when no route is found) and the battery % there and back (+10 % margin). A later trip home in the calendar ("Naar Thuis", or to "Thuis") is used as the way back
- The expected battery level when the car is back, and the expected charging for the next goal from then, in **orange** in the chart (with a "next goal" marker); the card is orange when the car is expected back below the next goal. An expectation only: nothing is steered by it
- Use per km, best first: learned from your own trips (battery level when the car leaves and when it is back), the car's range sensor, or the new **Use per 100 km** in Settings › Vehicle (default 18 kWh/100 km)
- The Plan tab shows the distance and % per calendar trip
- Home location and country from Home Assistant (Settings → System → General); every address is looked up once and remembered (places.json), one lookup per second
- Tests: settings test group Y (next goal with a reached target, trip cost, return trip, no route, not an address) and tests/tripcost.test.js

## 0.28.1-dev

- **Battery care** (Settings › Rules, on by default): for a target above 80 % (for example 100 % for a long trip), the app charges up to 80 % whenever it is cheapest and the rest only in the last 4 hours before departure, so the battery does not stand full for days. The level (50–95 %) and the hours (1–24) can be set; when the rest needs more time, it starts earlier
- The car's own charge limit follows: 80 % until the last hours, then the target. Charge now and solar charging (its own "up to" level) still go higher right away
- Home › Plan details explains it ("Battery care: up to 80 % when it is cheapest; the last part to 100 % from Sun 02:00")
- Tests: settings test J13 (up to 80 % in the cheap night, the rest from 19:00, car limit 80 %; off: everything in the night)
- Documentation: the README has an overview of every feature and option (where to find it and its default); DOCS.md (the Documentation tab) explains Ready Guard, Battery care, more cars and more chargers, and uses the new page names (Plan, Activity)

## 0.28.0-dev

- **More than one charger** (an option, off by default): Settings › Charger › "I have more than one charger". With it off, nothing changes
- With it on: add up to 4 chargers. Every charger has its own plan, Charge now, Ready for, charging mode, control, start/stop and current method, and log. A bar at the top chooses the charger that Home, Plan, Rules and Activity show
- Every charger can have a usual car. The app finds the car on each charger from the cars' plug sensors; a car that another charger already has is not a candidate, so the cars can also be the other way round. With nothing plugged in, a charger plans for its usual car
- **Sharing the connection**: when the main fuse is too small for all chargers, the car with the least room to spare goes first: the earliest "latest safe start" (Ready Guard: what it still needs and when it leaves). So a car that leaves later for a long trip can go before a car that leaves early but needs little. Charge now goes before everything, then a car below its minimum or preconditioning, then a car Ready Guard protects
- What is left is shared fairly by the other chargers (at least 6 A each, where the current can be set); a charger that can only start and stop charges with its full current or waits. Free current = main fuse − what the house uses now (grid meter minus the chargers) − 1 A. With a load balancer (Settings › Grid) the load balancer shares and the app does not limit
- Solar: only the car that goes first charges on the sun. The home battery and the Easee Equalizer are steered by the first charger
- Home shows all chargers at a glance: which car, its target, whether it charges, waits or goes first, and how much current is free
- Notifications name the charger; the first charger keeps sensor.smart_charging_*, another charger gets sensor.smart_charging_<charger>_*
- The checklist says how the connection is shared (or that the grid meter and main fuse are needed)
- Export/import and diagnostics include the chargers, the option and the last sharing
- Internal: everything the app keeps per charger lives in a scope per charger (scope.js); the first charger keeps its old files
- Tests: settings test group X (option off, adding a charger, a plan per charger, sharing 16 A + 6 A, waiting when the house uses more, cars the other way round, sensors per charger, turning it off) and tests/sharing.test.js

## 0.27.1-dev

- **One calendar for more cars**: "auto: renault" or "car: EV6" in a calendar event says which car the trip is for (Dutch and English both work, also "vehicle:" and "voertuig:"). A trip without it is for every car. The car is found by its new "Name in the calendar" (Settings › Vehicle), its name, or its brand when only one car has that brand; a car that is not recognised counts for every car and is marked on Plan
- Adding trips (Plan) has a "For" choice with more cars: the trip gets "auto: …" in the event, or nothing for every car
- "voorverwarmen: ja" / "voorconditioneren: ja" are read like "precondition: ja"
- Tests: settings test group W7b (one calendar, two cars) and calendar checks in tests/activecar.test.js

## 0.27.0-dev

- **More than one car on one charger** (an option, off by default): Settings › Vehicle › "I have more than one car". With it off, nothing changes
- With it on: add up to 6 cars (with or without a car integration) and switch between them in Settings › Vehicle
- The app recognises which car is connected by each car's "Plugged in" sensor. A car without one is recognised when no other car says it is plugged in. When both say they are plugged in (for example one at a public charger), the car that is charging decides; otherwise Home asks which car it is, with one notification
- Home shows the connected car and lets you choose it yourself; your choice holds until the charger is unplugged. With nothing plugged in, the plan is for the last car that was connected
- The plan, Ready Guard, the car's charge limit, "car not reachable" and the checklist follow the connected car. The car's charge limit is never changed while the app is not sure which car is connected
- Departures are shared by all cars, unless a car has its own (Plan › choose the car › "has its own departures"): schedule, calendar, helper and one-off departure per car
- With more than one car, "plugged in" for the charger comes from the charger status, because a car's own plug sensor also says "plugged in" at a public charger
- The status sensor (sensor.smart_charging_status) has the connected car as attribute; diagnostics and export/import include the cars and the option
- Tests: settings test group W (option off, adding a car, recognising the car, asking, your choice, a car without a plug sensor, own departures, turning it off) and tests/activecar.test.js

## 0.26.2-dev

- Plan, Activity and every Settings subpage now share the same Mushroom-style page headers, cards, spacing, controls and responsive layout as Home
- Settings Overview is a clear tile dashboard with status badges and direct links to Vehicle, Charger, Grid, Prices, Solar, Battery, Rules, Notifications and Diagnostics
- Plan uses a compact two-column desktop layout with a prominent next-departure card, clearer forms and mobile-friendly stacking
- Activity gives savings, charging decisions and log tables a stronger visual hierarchy without hiding technical detail
- Forms use consistent inset field tiles, switches, sliders and sticky save actions; status rows and tables use the same card language throughout
- Each functional area has a calm accent colour, including solar, battery, grid, prices and charging rules

## 0.26.1-dev

- **Home rebuilt around one Ready Guard card**: the duplicate status card is gone; technical plan information is available in a compact expandable section
- Desktop uses a focused two-column layout with the price plan on the left and Mushroom-style quick choices on the right; mobile collapses to one column
- Quick choices use clear action tiles, pill controls and a live minimum slider instead of long form-like rows
- Ready Guard only shows relevant facts: an already reached target no longer says "Continuous charging"; the battery bar shows both the current level and target marker
- The chart reserves separate label lanes for now, latest safe start and ready by, so close markers no longer overlap
- Settings use the same card, switch and slider language throughout; battery, solar and control sliders keep their own calm accent colours
- Long durations are readable ("3 d 14 h"), incomplete future prices are described honestly, and an unavailable optional forecast no longer marks an otherwise complete plan at risk
- Tests include the Ready Guard price-forecast regression

## 0.26.0-dev

- **Ready Guard / plan reliability**: every departure now gets an honest status (on track, at risk, action needed or not achievable), based on conservative charging power, connection, battery-data freshness and price coverage
- Ready Guard calculates a latest safe start with at least 30 minutes of margin; once that point is reached it temporarily overrides cheap-hour and solar-only waiting and charges continuously at full power
- Home has a clear Mushroom-style Ready Guard card with target progress, safety facts and the reasons behind the status; the price chart marks the latest safe start
- The full app uses a calmer Mushroom-inspired palette, softer cards and clearer navigation; bounded battery, target, timing and solar settings use touch-friendly sliders with live values
- A Home Assistant sensor exposes Ready Guard state, timing, margin and shortfall for dashboards and automations
- Tests cover Ready Guard decisions, advice-only mode and impossible targets


## 0.25.5

- Reliability: a charger command that Home Assistant rejects or cannot deliver is retried at the next control step instead of being suppressed for 15 minutes
- Reliability: after Home Assistant reconnects, the plan is recalculated immediately before live control resumes
- Storage: Charge now, Ready for, charging mode and remembered car data are saved atomically, preventing partial JSON after a power loss
- Settings import now validates nested structures and rejects malformed backups before anything is changed
- Maintenance: the frontend is split into HTML, CSS and JavaScript; persistence and import validation have their own modules
- Tests: reconnect and failed-command regressions, atomic persistence, syntax checking and minimum line/function/branch coverage


## 0.25.4

- **Import settings in the setup wizard**: a fresh install (for example the dev version) shows the setup wizard first, so Settings › Diagnostics could not be reached. The wizard now has "Have a settings file? Import it instead"; after the import the wizard closes by itself when car, charger and prices are in the file
- Fix: times on the page (for example in the import preview) failed before the first plan was loaded ("Cannot read properties of null (reading 'time_zone')"); they now use the browser's time zone until then

## 0.25.3

- **Export and import settings** (Settings › Diagnostics › Back up or move your settings): all settings of the app in one file (car, charger, grid, prices, departures, rules, solar, home battery, notifications, how to charge). Import shows first what is in the file and what this Home Assistant does not have, and only replaces your settings after you confirm. A car limit, home battery, Equalizer or notify action that is not found here is left out, with the same checks as when you set them by hand. "Allow control" and the other Configuration options are never in the file and never changed by an import
- Use it as a backup, or to move your settings to the test version (dev)
- Tests: settings test group M (export, refused files, import in a fresh install, things this Home Assistant does not have)

## 0.25.2

- **Car not reachable** (the car maker's cloud is down, for every car integration): when the battery level is unavailable or has not been read for longer than "Car data counts as old after" (Settings › Vehicle, default 3 hours), the plan goes on with the last good level plus the energy the charger delivered since. Before, the app stopped deciding ("leave as it is"), so a paused charger stayed paused. With no level known at all, it plans as if the car is at your minimum (or 20 %)
- While the car cannot be reached the app does not send the car's charge limit, and Home shows the estimate and why; one notification when it drops out and one when it is back
- The diagnostics file includes the car data state
- Tests: settings test group V (unavailable, not read for a long time, energy added since, nothing known yet, notifications)

## 0.25.1

- **Download diagnostics** (Settings › Diagnostics › Report a problem): one file with your settings, the control check, what the app found (chargers, cars, batteries, Equalizer, inverters), the entities it uses, the plan, the last decisions and log lines. Names, trip titles, places, e-mail addresses and the notify target are removed; tokens are never in it. Attach it to a bug report on GitHub
- **GitHub**: bug report and idea forms, a pull request checklist, SECURITY.md for private security reports, and all tests run automatically on every push and pull request (Actions → Tests)
- **Stable and test version**: `main` is stable, `dev` is the test version (add the repository with `#dev`). See the README
- The decision order at the top of `controller.js` now includes Charge now and solar
- Tests: settings test L4 (diagnostics, and that personal details are removed)

## 0.25.0

- **Easee Equalizer surplus charging**: with an Easee charger and an Equalizer, Settings › Solar asks who follows the solar surplus: the app, or the Easee Equalizer. With the Equalizer, the app switches its surplus charging on for solar and off for full power (planned blocks, Charge now, the minimum level) with `easee.set_surplus_charging`, keeps the charger on and sends no current or phase commands. When you go back to the app, surplus charging that the app switched on is switched off. With the app following the surplus, the page warns when Equalizer surplus charging is on (they would fight)
- **Home battery and the car: "Between two levels"**: a fourth choice next to Never / Only stored solar power / Always. The battery helps the car from a start level down to a stop level that stays for the house, and starts again only at the start level. Settings › Battery shows the levels on a bar with the level now; Home shows the rule. The battery plan follows the same levels
- Fix: with the Equalizer doing solar the charger is on all day, but the car only charges when there is surplus. The home battery now goes by what the car really does, so it keeps covering the house in the evening
- Tests: Equalizer (settings test S12, S13, T8b, with the old code T8b fails), "between two levels" in the plan and live (T7b), the fake Equalizer waits without sun

## 0.24.5

- **Easee: start and stop with the "Charger enabled" switch** (on/off), now the default start/stop method for Easee. Before, the app chose `easee.action_command` pause/resume, which Easee ignores while the charger is switched off: the charger stayed on "awaiting start". Charging current and phases (solar) still use Easee's own actions. A method you chose yourself in Settings › Charger stays as it is
- Tests: the fake Easee starts and stops with that switch; the matrix test no longer fails on two timing moments (a battery that first protects the car and then follows its plan; a pause that takes one more step)

## 0.24.4

- Home › Quick choices: "Solar" is only shown when solar is set up. Without solar there is nothing to choose there; setting it up stays in Settings › Solar (and in Settings › Overview)

## 0.24.3

- **Fix, Easee**: starting and pausing failed with "value should be a string at 'device_id'". The Easee actions (`action_command`, `set_charger_dynamic_limit`, `set_charger_phase_mode`) have a `device_id` field and no target; the app sent the device as a target, which Home Assistant passes on as a list. The device now goes in the data as text for every integration action with a `device_id` field (as a target only for actions that have one)
- Tests: the fake Home Assistant now checks `device_id` the same way (the old code fails on it); the Easee fixtures follow the integration's real `services.yaml`. The test prices no longer have cheap hours today, so the results no longer depend on the time of day the tests run

## 0.24.2

- **Ready for**: a choice made for a departure (schedule, calendar, helper) ends by itself when that departure is removed, with a notification. Before, it stayed until its time, so the plan kept aiming at a day you no longer leave
- **Ready for**: Home and the Planning tab show when the choice was made and for which departure; the Planning tab has a **Back to normal** button too, and says clearly that the plan uses the choice instead of the next departure
- **Home battery plan, fix**: small discharges were rounded up to a whole 0.25 kWh step, which made "hold" look cheaper than it is. With a short first block or a small house load the plan could hold the battery all day. The plan now reads the value between steps
- Tests: two Ready-for checks in the settings test, a battery plan check for the rounding; settings tests S3 and T6 no longer depend on the time of day

## 0.24.1

- **Home battery and the car**: the battery also stops discharging when the car charges without the app starting it (charging started by the car or the charger itself, or a charger the app cannot steer such as the Tesla Wall Connector). A pause the app just sent counts as stopping
- **Switching to another battery** first puts the previous one back in its own mode, and forgets its saved values (backup reserve, strategy)
- The battery test buttons in Diagnostics also remember the values to put back (Tesla backup reserve, Sessy strategy)
- "No discharging" that a brand does as "hold" is no longer sent again when the reason changes
- Settings › Battery warns when the battery cannot be stopped from discharging into the car (GoodWe, Marstek Local API)
- **New test** `tests/matrix.test.js`: every charger (Easee, Zaptec, Alfen, Wallbox, go-e ×2, Peblar, OCPP, Ohme, Tesla Wall Connector) with every home battery (15 integrations) in the real app: 960 checks. Charger and battery fixtures shared in `tests/fixtures.js`
- Settings test G6 no longer fails depending on the time of day (an earlier started period that is still being finished)

## 0.24.0

**Home battery**: the app plans and steers the home battery next to the car.

- **Settings › Battery**: battery (found automatically), capacity, charging and discharging power, never below / never above, round-trip efficiency, wear per kWh, sign of the power sensor, charging from the grid on/off, "May the home battery charge the car?" (never / only stored solar power / always) and "Who gets the sun first?" (smart / car / battery)
- **Plan**: per price block normal, charge from the grid, hold or no discharging, chosen over the whole period (dynamic programming over the battery level). Charging from the grid only when the difference covers losses and wear. Shown on Home with the expected saving, and in the chart
- **Smart sun**: while the car needs energy, the sun the battery would take counts for the car; the battery holds while the car charges on solar
- **Brands**, tested one by one against the integrations' own entity and action names: Sigenergy, Huawei, SolarEdge, Victron, GoodWe, Tesla (Teslemetry, Fleet), HomeWizard, Marstek (Modbus, Local API), Sessy. Read only: Zonneplan Nexus, Growatt, Anker Solix, EcoFlow, local Powerwall
- **New option Allow home battery control** (off by default): steering only with this and Allow control both on; a separate guard only lets through the battery's own entities and actions
- Diagnostics: battery status and a test button per action; Settings › Overview: a line for the battery
- Tests: `tests/battery.test.js` (15 brands and the plan) and a Home battery group in the settings test for both set-ups

## 0.23.0

**Solar**: charge with your own solar power.

- **Settings › Solar**: forecast (Energy dashboard: Forecast.Solar, Solcast, Open-Meteo; or a sensor), how much of it to count on, house use, the value of your own solar power, charging on surplus (start/stop delay, allowed grid power, "charge with solar up to"), the grid meter's sign, following the surplus with the charging current, switching to one phase, and an optional solar power sensor
- **Home › Quick choices › How to charge**: Price plan, Plan + solar or Solar only, with what happens now ("exporting 1.2 kW · charging on solar at 7 A")
- **No more salderen from 2027**: a kWh of sun is valued at the feed-in compensation (dynamic market price minus feed-in costs, or a fixed amount). The plan only uses the sun for the car when that is cheaper than buying at another time, with taxes included
- **Plan**: per block a solar part (expected surplus at its value) and a grid part. The chart shows the expected sun for the car (dashed line) and blocks on solar in yellow. "One continuous period" never holds back charging on the sun
- **Live**: every minute; starts on enough surplus for 6 A, follows it with the current, stops after too little surplus; phases switch at most every 10 minutes; current and phases go back to the maximum at full-power charging (only what the app changed itself)
- **Chargers, current and phases**: Easee (dynamic limit, phase mode), go-e (amp, psm), Peblar (charge limit, force single phase), Wallbox, Zaptec, Alfen, OCPP (current only); Ohme and go-e (cathiele) start/stop only
- **Inverters** found for the solar power now: SolarEdge, Enphase, SMA, Fronius, GoodWe, Huawei, Sigenergy, APsystems and more
- The car's charge limit follows "charge with solar up to" in the solar modes
- Fix: keeping charging when the price is close to the planned price (hysteresis) only continues a planned session, not charging that started on solar
- Settings › Overview: a line for solar
- Tests: `tests/solar.test.js` (inverters, forecasts, feed-in value, surplus logic, brand by brand), charger brands with current and phase switching, and a Solar group in the settings test for both set-ups

## 0.22.3

- Settings test with a second set-up: **Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus** (`SCP_PROFILE=skoda_wallbox node tests/settings.test.js`), next to Renault + Easee. Entity names from the integrations' own source code. All checks pass for both; `tests/TESTPLAN.md` shows both side by side
- New checks: the charger's own smart mode is warned about (Wallbox Eco-smart), and a target the car cannot set exactly (Enyaq: steps of 10 %) is rounded up for the car's limit while the plan still stops at the target
- No changes to the app itself

## 0.22.2

- New test of every setting: `node tests/settings.test.js` starts the real app against a fake Home Assistant (car, charger, P1 meter, prices with forecast, calendar, helpers, notifications) and checks what is saved, what is refused, what the plan does and what is sent. 77 checks; the plan and results are in `tests/TESTPLAN.md`
- The app port can be changed for tests (`SCP_PORT`); in Home Assistant it stays 8099

## 0.22.1

- Planning: the next-departure card shows an active **Ready for** choice from Home (ready when, at what level, and the minimum for departures before then)

## 0.22.0

New layout: what you use day to day is apart from what you set once.

- **Tabs**: **Home** (plan and quick choices), **Planning** (departures), **History** (Savings and Log) and **⚙ Settings**
- **Settings › Overview**: a checklist "is everything set up well?" with a link to fix each point (vehicle, battery capacity, charger, start/stop, prices, forecast, departures, Allow control, the car's charge limit, your own automations, notifications, grid), plus the planning settings from Home Assistant
- **Vehicle, Charger and Grid** are shown directly as filled-in forms, like Prices. Another device or choosing manually is under "Use a different …"; **Search again** keeps your settings
- How the app starts and stops charging moved to **Settings › Charger**; **Rules** keeps the rules; the **Manual test** and the status of the connection moved to **Settings › Diagnostics**; **Notifications** has its own page
- **Quick choices** on Home:
  - **Charge now** (as before)
  - **Quickly to a minimum**: 20–45 %, then the plan takes over
  - **Ready for tomorrow / the day after tomorrow**: time and battery level from your schedule or calendar, adjustable. Departures before then get a minimum (20–45 %), charged first in the cheapest hours before that departure; the rest before the chosen day. Shows whether the prices up to then are known or come from the forecast. Ends by itself, or with **Back to normal**
- **The car's charge limit follows every choice**, automatically when the car supports it (no more option to turn on, no more button): the highest active goal (departure, Charge now as a level or as kWh, Ready for), and back down when it ends. Every choice shows beforehand what happens with the limit. Turn it off only in Settings › Rules (**Don't change the car's charge limit**)
- New rule: the default minimum for the quick choices
- Planner: two goals (a minimum before a departure in between, the full target later)
- A started planned period is not finished when you make a new Ready-for choice
- Small screens: the main tabs wrap instead of scrolling

## 0.21.2

- Settings › Prices shows the settings right away as a form, filled with what is saved: source, costs and forecast. No more **Change** button; adjust a field and press Save. "Saved." confirms it
- On top: **Prices now**, the live summary of today, tomorrow and the forecast
- **Search for price sources again** keeps what is filled in
- A purchase fee or energy tax of 0 is shown as 0 instead of the grey example value

## 0.21.1

- **Change** no longer starts from empty forms. On Settings › Vehicle, Charger and Grid the form is filled with what is saved now (entities, battery capacity, phases, maximum current, following the charger's limit, main fuse, load balancer) and shown first. Nothing changes until you save
- A saved entity that is not found by the new detection stays available as "(saved)", so it is not lost by accident; the same for a saved price source on Settings › Prices
- New button **Cancel, keep the current settings**

## 0.21.0

- **Price forecast** (optional, Settings › Prices): choose a sensor with expected prices for the coming days, for example a template that combines the real prices with a weekly forecast. Only the hours after the last real price are used, up to your departure
  - When a later day is expected to be cheaper, the plan waits for it instead of charging today. The app never charges on a forecast price: as soon as the real prices come out (around 13:00 for the next day) the plan is recalculated
  - **Safety margin** (default 0.02 per kWh) is added to every forecast price, so the app only waits when the forecast is clearly cheaper. 0 = trust the forecast fully
  - The forecast can be market or all-in; the same fees, tax and VAT as the main source are used
  - Without a departure the forecast is not used, so the app never waits days for a cheap hour
- Overview: forecast prices are striped in the chart, forecast periods are marked in the plan table and headline, with a note that explains it. The chart's time labels are shown again, also for several days
- Price sensors whose list marks entries as a forecast (e.g. `source: forecast`) are recognised: as the main price source only the real prices are used
- Price times without a time zone (e.g. "2026-10-03 13:00:00") are now always read in Home Assistant's time zone
- Sensor `sensor.smart_charging_next_start` has an attribute `forecast`

## 0.20.0

New look, in the style of Home Assistant's default theme and Mushroom cards:

- Tabs and settings pages as rounded chips with icons
- Round tinted icons that show the state at a glance: charging (green), Charge now (amber), planned (blue), nothing to do (grey), missing data (red)
- Rounded cards, softer buttons and input fields, and the amounts on the Overview as small tiles with icons
- Light and dark mode follow your device, like Home Assistant
- Icons are Material Design Icons, the same set Home Assistant uses

## 0.19.0

- New price source **Fixed or day/night tariff**, for contracts without dynamic prices. Always offered in Settings › Prices:
  - **Day and night**: a normal and a low price, the low tariff hours (also across midnight, and on the quarter hour) and optionally the whole weekend low. The plan charges in the low hours before your departure
  - **One price all day**: the plan charges right away; departures, the car's limit, Charge now and notifications work as usual
  - Prices are entered all-in, as on the energy bill. The Savings tab calculates past days from the same tariff
- When no dynamic price integration is found, the Prices page now says so and offers the fixed tariff instead of stopping
- Documentation: the grid meter is optional (it was listed as required); the requirements now say what is required and why

## 0.18.2

- Settings › Control: the lists for preconditioning and the minimum battery level are much shorter. They show the entities of your car first ("From your car"), then only entities whose name fits (preconditioning, HVAC, airco; a minimum charge level), instead of every helper in Home Assistant
- The preconditioning rule is explained: while the chosen entity is on, the charger stays on, so heating or cooling the car uses grid power instead of the battery

## 0.18.1

- Settings › Control is split into clear sections: **Charger** (start/stop method), **Car** (managing the car's charge limit, minimum battery level), **Timing and price** (force window, keep charging, preconditioning) and **Manual test**
- Fields under an option are only shown when that option is on
- The Car section shows the car's current charge limit, and says when it cannot be changed or "Allow control" is off

## 0.18.0

Security review and fixes.

- **Only Home Assistant may talk to the app**: requests that do not come through Home Assistant ingress (for example from other apps on the internal network) are refused
- **Protection against other websites (CSRF)**: changes are only accepted as JSON from the same site; plain web forms and cross-site requests are refused
- **The charger must be a real charger**: the device and its integration are taken from Home Assistant's registry, and control only works for a device that is recognised as an EV charger. Settings can no longer point the app at another device, such as a garage door or a pump
- Control commands are limited to switches, buttons, choices and numbers, and the actions of known charger integrations
- **The car's charge limit** must be a % entity that looks like a charge limit, on the car's own device; values stay between 50 and 100 %
- Buttons are matched on whole words ("restart" is no longer seen as "start")
- Requests are limited to 100 kB; invalid requests get a clear error instead of a crash
- The installed library versions are fixed with a lock file (`npm ci`, with integrity checks)

## 0.17.0

- **Charger brands** checked against the real names of their Home Assistant integrations (from their source code), with a test per brand (`tests/brands.test.js`):
  - Easee (pause/resume action), Zaptec (resume/stop buttons), Alfen (charging switch), Wallbox (pause/resume switch), go-e (Force state choice, or the allow charging switch of the older integration), Peblar (charge switch), OCPP (Charge control switch), Ohme (Charge mode choice)
  - New start/stop method: a **choice (select)**, for go-e "Force state", Ohme "Charge mode" and, as a last resort, Alfen "Operation mode"
  - More status texts are understood, such as Zaptec `connected_charging`, Peblar `no_ev_connected`, Wallbox "Ready", OCPP "SuspendedEV", Alfen "Charging Normal" and go-e "charging finished"
  - Better suggestions for the status and power sensor per brand
  - Warnings when the charger's own smart or solar mode is on (Wallbox Eco-Smart, Peblar smart charging, Alfen solar mode, go-e PV surplus, Ohme smart charge); Easee's "Smart charging" switch is no longer reported, because it only changes the LED colour
  - Notes for Alfen (only one login at a time), OCPP (the charger must connect to Home Assistant) and Tesla Wall Connector (can only read, not control)
- **Possible conflicts**: the Log tab and Settings › Control list automations that are on and use the charger's start/stop, the charger itself or the car's charge limit, also through a script. Each can be ignored. The app never turns automations off

## 0.16.1

- Managing the car's charge limit: a new limit is now sent **right away, once** (for example back to your departure target as soon as Charge now ends). It is only sent again when the car still shows the old value after 15 minutes, at most twice; then you get a notification
- The Log tab no longer shows each sent command twice (only one command was sent)

## 0.16.0

- New rule in Settings › Control: **Let the app manage the car's own charge limit** (off by default, only with "Allow control" on)
  - While Charge now runs up to a level, the car's limit is set to that level (rounded up to a value the car accepts)
  - Otherwise the car's limit follows your next departure, for example "doel: 80" from the calendar
  - Only while the car is plugged in, and only when the limit differs
  - Right away when you start Charge now or use the button; otherwise at most once every 15 minutes since the last limit sent, because the car's cloud API limits the number of calls
  - Every change is logged in the Log tab and notified (with "Notify every start and pause")
- With the rule on, the plan and Charge now no longer stop at the car's current limit, because the app sets it

## 0.15.1

Charge now is a firmer overrule:

- The decision uses whether Charge now is on right now, not the last calculated plan. A plan calculated just before you pressed Charge now (or Stop) can no longer pause or start the charger
- After Charge now or Stop, the plan is calculated again once the running calculation is done, so it always includes your change
- For 3 minutes after you start charging (Charge now, manual test), the app does not pause the charger, whatever a calculation says
- Raising the car's limit rounds up to a value the car accepts (Renault: steps of 5, so 83% becomes 85%)

## 0.15.0

- The app now knows the **car's own charge limit** (for example Renault "Target charge level"). The car stops charging there, whatever the charger does
  - Found automatically on the car's device, also for vehicles set up earlier; can be chosen in Settings › Vehicle
  - The plan aims for the lower of your target and the car's limit, and says so on the Overview ("80% (car limit)")
  - Charge now warns when the chosen level is above the car's limit, and does not start; Charge now up to a level stops at the limit
  - With "Allow control" on, a button **Raise the car's limit to …%** sets the limit in the car (only that entity; logged in the Log tab). The app does not lower it again afterwards

## 0.14.2

- The "Notify action" field is removed from the Configuration tab. Choose where notifications go only from the list in the app, under Settings › Status

## 0.14.1

- Choose where notifications go from a **list** in Settings › Status: the app shows the notify actions that exist in your Home Assistant (your phones first). The Configuration tab cannot show such a list, so the "Notify action" field there is now only a fallback

## 0.14.0

- **Notifications** to your phone, with a notify action set in the Configuration tab ("Notify action")
  - Problems are always sent: a failed command, a charger that does not start or pause within 5 minutes after a command, and a car that will not be ready at the departure
  - Every start and pause, with the reason; can be switched off with "Notify every start and pause"
  - The same problem is not repeated for a while
- **Watchdog**: 5 minutes after each start or pause the app checks that the charger followed. If not, it is logged ("Charger did not react") and notified
- **Sensors for dashboards**, with "Publish sensors" in the Configuration tab: status, next start and end, planned energy and cost, saving, departure, and Charge now. They are written again after Home Assistant restarts
- Settings › Status shows notifications and sensors, with a **Send test notification** button
- Safety: the app can only send to the one notify action you set, and only write its own `sensor.smart_charging_*` and `binary_sensor.smart_charging_*` entities

## 0.13.0

New layout.

- **Five tabs**: Overview, Departures, Savings, Log and **⚙ Settings**
  - Settings has pages for Vehicle, Charger, Grid, Prices, Control and Status
  - The Log tab shows what the app wants right now and the log; the control method, the rules and the manual test moved to Settings › Control
- **Setup wizard** on first start: Vehicle → Charger → Grid (optional) → Prices. You can run it again from Settings › Status. Existing setups skip it
- The **planning settings** moved from the Overview to the app's **Configuration** tab in Home Assistant: charging loss margin, prefer one continuous period, minimum saving to split, and account for house load. The Overview shows the current values. Values saved earlier in the app are replaced by the Configuration tab (the defaults are the same as before)
- The Configuration tab is in a clearer order: control and calendar first, then planning, then refresh and log level
- The "Charging current" choice says that it is not used yet

## 0.12.1

- New **Clear log** button on the Control tab (click twice to confirm). The log keeps the last 500 lines; after clearing, the current decision is logged again right away

## 0.12.0

**Live control.** With "Allow control" on, the app now starts and pauses the charger by itself. With it off (the default) nothing changes: everything is advice and a dry run.

- The charger follows the plan, Charge now and the rules on the Control tab (minimum battery level, preconditioning, force window, locked period, hysteresis)
- Only start/stop is sent, with the method chosen on the Control tab. The charging current is not changed; your load balancer keeps doing that
- With a switch as start/stop method, its own on/off state decides whether a command is needed, so nothing is sent when it is already right
- The same command is not repeated within 15 minutes, so the app does not keep fighting with something else that changes the charger
- With control on, the charger is checked every minute between plan refreshes, so plugging in and the start of a planned period are followed quickly
- Charge now: when it ends, the plan takes over directly (instead of always pausing)
- Every command sent is shown as "SENT" in the Control log and as "SENDING to charger" in the app log
- Automations, scripts, helpers and other settings are still never touched

**Turn off your own charging automation** before turning on "Allow control", or the two will fight.

## 0.11.0

**First version that can really control the charger**, only when you turn on "Allow control" in the Configuration tab. The charging plan itself is still a dry run.

- **Charge now** really starts the charger when "Allow control" is on, and pauses it again when the goal is reached or you select **Stop charge now**. If the charger was already charging before, it is left alone. When the car is unplugged nothing is sent
- New **Manual test** on the Control tab: **Start charging** and **Stop charging** send one command, to check that control works with your charger
- Only the start/stop method chosen on the Control tab is used, and only its own action or entity. The charging current is not changed
- Safety:
  - With "Allow control" off (the default) nothing is sent; the log shows "Not sent"
  - Automations, scripts, scenes, helpers and other settings are never touched, whatever is chosen
  - Everything that is sent is logged in the app log ("SENDING to charger") and in the Control log ("SENT")
- Turn off your own charging automation while testing, or it may undo what the app does

## 0.10.0

Still a dry run: nothing is sent to the charger.

- New **Charge now** on the Overview, for when you need the car sooner than the plan
  - Choose how much: up to the plan's target, up to a battery level, or a fixed amount in kWh
  - **Check** first shows:
    - whether the plan is already charging now, or starts charging within the next hour
    - when charging now would be ready and what it costs, compared with the cheapest hours before your departure
  - **Charge now** then replaces the plan: the Overview and the chart show charging from now on, and the Control dry run wants to charge ("Charge now, started by you")
  - It stops by itself when the goal is reached or the car is unplugged, or with **Stop charge now**; then the normal plan takes over again
  - Can only be started while the car is plugged in

## 0.9.2

- The plan now uses the **real charging power**: the app learns from the charger power sensor (last 10 days) at what power the car really charges, and uses that when it is lower than the charger maximum. A load balancer, the car's own on-board charger or a lower voltage no longer make the plan too optimistic
- The Overview shows again what the charger is doing now ("charging now at 9.2 kW", measured), and on a separate line which power the plan uses and why
- Without a charging power sensor or enough measured charging, the plan uses the charger maximum as before, and says so

## 0.9.1

- Removed "charging at … kW" from the Overview. It showed the power the plan calculates with, not what the charger really does, which was confusing

## 0.9.0

- **Cars without an integration** are now supported. On the Vehicle tab, under "No car integration?", choose:
  - **I enter the battery level myself**: enter it on the Overview when you plug in; the app adds the energy charged since then (from the charger's power sensor) and estimates the level. The entered level is forgotten when the car is unplugged
  - **Charge a fixed amount each time**: for example 20 kWh per session; the app plans the rest of that amount after plugging in
- Plugging in and unplugging is followed through the charger status when there is no plugged-in sensor
- The Overview shows the estimated battery level or the amount charged in this session

## 0.8.0

Still a dry run: nothing is sent to the charger.

- **Choose how the charger is controlled** on the Control tab: any start/stop and current method found by the control check (for example an action with pause/resume, or a switch your own automation already uses), or no current setting at all
- New control **rules**, checked in this order:
  - Charger status briefly invalid (restart, hiccup): keep things as they are for up to 2 minutes
  - **Minimum battery level**: always charge below it, optionally only up to a maximum price; the level can come from an entity (such as the car's own minimum charge level)
  - **Preconditioning**: charge while a chosen entity is on
  - **Force window**: charge in the last X minutes before departure
  - **Locked period**: once a planned period has started, it is finished even if a new calculation would move it
  - **Hysteresis**: keep charging when the price is at most a set amount above the planned price, to avoid on-off-on
- The dry run shows when a period is locked

## 0.7.0

- New **Control** tab with a **dry run** of charger control (phase A)
  - At every refresh the app decides what it would do now: charge at a certain current, pause, or nothing (car not plugged in / data missing)
  - Shows the exact commands it would send, using the methods found by the control check (for Easee: `easee.action_command` pause/resume and `easee.set_charger_dynamic_limit`)
  - Compares with what the charger is really doing, and logs every change, so you can review a few nights
- **Nothing is sent**, also not when "Allow control" is on. Sending comes in a later version, after you have reviewed the dry run

## 0.6.2

- The maximum charging current is now read from the charger's own limit sensors, for any charger integration (for Easee: "Max charger limit" and "Max circuit limit")
  - The lowest limit is followed live: change it in the charger's own app and the plan follows
  - A manually entered maximum still works, as an extra cap
  - Limit sensors that exist but are disabled in Home Assistant are named, with where to enable them
- The Charger tab shows where the maximum current comes from

## 0.6.1

- Charger detection no longer suggests the charger's smart charging switch (or a switch that turns the whole charger off) as start/stop switch; it only suggests a real start/stop switch
- Long sensor values are rounded (9.15299987792969 kW is shown as 9.15 kW)

## 0.6.0

- New **Control check** on the Charger tab: the app finds out by itself how your charger could be controlled, for any charger integration
  - Looks at the actions of the charger's integration (with their fields and choices) and at the charger's own entities (current setting, switches, buttons)
  - Shows the method it would use for start/stop (preferring pause/resume) and for the charging current (preferring a temporary limit that expires by itself), plus the alternatives
  - Warns when the charger's own smart charging is on, when only a switch that turns the whole charger off is available, or when nothing suitable is found
  - Nothing is sent to the charger
- Reading the list of available actions is added to the read-only list

## 0.5.2

- New planning setting **Prefer one continuous charging period** (on by default): the plan charges in one go, unless splitting saves at least a set amount (default 0.50)
- The Overview says which choice was made and how much splitting would save
- Uses the same price blocks and house load as before; only the choice of blocks changes

## 0.5.1

- Departures: more trips from the same source on one day are no longer crossed out. They are shown as "later that day"; the plan prepares for the first departure of each day. Crossing out is only used when a higher priority source replaces a departure
- The departure time of a calendar trip is shown everywhere; with a buffer, "ready by" is shown next to it (also on the Overview)

## 0.5.0

- New **Add trip** form on the Departures tab: leave at, destination, target battery level, precondition, repeat on weekdays and weeks ahead
  - Creates events in the same format the app reads: "Naar <destination>", the destination as location, and "doel: 80 precondition: ja" as description
  - Trips that are already in the calendar (same title and time) are skipped
- **Test mode by default**: a new option **Allow adding trips to calendar** in the Configuration tab is off by default. While off, the form only shows which events it would add and nothing is written
- Adding a calendar event is the only write the app can do, and only when that option is on, and only to the calendar chosen on the Departures tab. Charger control stays off and separate ("Allow control")
- The Status tab shows whether adding trips is allowed

## 0.4.2

- New option **Refresh interval** in the app's Configuration tab (1 to 60 minutes, default 5)
- The app now reads prices, departures and states and recalculates the plan in the background at that interval, also when nobody has the page open
- Opening the page uses the latest plan instead of calculating it again; after a settings change the plan is recalculated right away
- The Overview shows when the plan was last updated, with a **Refresh now** link
- The Status tab shows the refresh interval and the last refresh

## 0.4.1

- Calendar trips reworked:
  - New choice which events are trips: events with a target in the description (such as "doel: 80"), events with a keyword, or every event with a time. New setups use the target
  - The target in an event ("doel: 80", "target: 90" or "85%") is used for that trip; otherwise the fallback level
  - The start of the event is the departure; the buffer before the event now defaults to 0 minutes
  - "precondition: ja/nee" and the event location are read and shown (not used yet)
  - New card "Trips from your calendar" on the Departures tab with the trips of the next 14 days
- Calendars set up in 0.2.0 keep working with their keyword

## 0.4.0

- New **Savings** tab: per charging session over the last 30 days
  - **Actually paid**: the energy the charger used per hour, times the all-in price of that hour
  - **Charging right away**: the same energy charged from the moment the car was plugged in
  - **With the plan**: the same energy in the cheapest hours while the car was plugged in
  - Totals, and how much your current way of charging saved compared with charging right away
- Charging sessions come from the history of the charger power sensor (Charger tab); plugged-in times from the vehicle's plugged-in sensor (Vehicle tab), when set
- The app now keeps a history of all prices it fetches. EnergyZero, easyEnergy, Tibber and Nord Pool can also look back for missing days
- Reading state history is added to the read-only list

## 0.3.0

- **House load**: the plan now estimates how much current is left for the charger in each block, like a load balancer does
  - Uses the last 14 days of long-term statistics of the grid meter (Grid tab), per hour of the day
  - The charger's own power is subtracted, so earlier charging sessions do not count as house load
  - Room for the charger = main fuse minus typical house load, capped at the charger's maximum current; below 6 A a block is skipped
  - The Overview shows the charging power range, the room for the charger per block (hover) and a summary of the typical house load
  - Can be switched off with "Account for house load" in the planning settings
- Reading long-term statistics is added to the read-only list

## 0.2.0

- New **Departures** tab with four sources for when the car must be ready and how full:
  - **Weekly schedule**: a time and battery level per day, each day on or off
  - **Home Assistant helper**: an `input_datetime` (date and time, or time only) and optionally an `input_number` for the battery level
  - **Calendar**: events with a keyword (default "EV") become a departure, with a buffer before the event; all-day events are skipped
  - **One-off departure**: for a trip that differs from normal; removed automatically after it has passed
- Priority on a day: one-off, then calendar, then helper, then schedule. The earliest day with a departure is planned for
- Overview of the next 7 days, showing which departures were replaced by a higher priority source
- The plan uses the next departure and its battery level; without a departure it uses the cheapest known blocks and the default level
- The earlier "ready by" and target settings are carried over into the weekly schedule
- A partly used price block is placed against the next planned block, so charging runs in one go
- Reading calendar events is added to the read-only list; nothing else can be called

## 0.1.1

- Saving the planning settings now shows clear feedback ("Saving…", then "Saved – plan updated") and scrolls to the updated plan

## 0.1.0

First planning version. **Advice only: nothing is controlled.**

- New **Overview** tab (now the first tab):
  - Price chart for today and tomorrow with the planned charging blocks highlighted, the current time and the "ready by" moment
  - Charging plan: how much energy is needed and in which blocks it is cheapest to charge before the deadline
  - Expected cost of the plan compared with charging right away after plugging in
  - Clear messages when data is missing, tomorrow's prices are not published yet, or there is not enough time
- Planning settings: target battery level (default 80%), ready by (default 07:00) and a charging loss margin (default 10%)
- Charging power follows the charger's phases and maximum current (16 A assumed when not set)
- Amounts are shown in the currency set in Home Assistant
- **Safety:** the app can now only send read-only commands to Home Assistant. Any other command is refused and logged, so nothing in your setup can be changed by the app
- Tabs scroll on small screens

## 0.0.6

- Added the **Prices** tab: detects and tests your dynamic electricity price source
  - Integration actions: EnergyZero, easyEnergy, Tibber and Nord Pool
  - Any sensor that keeps a list of prices in its attributes, such as ENTSO-e, Nord Pool (custom), EPEX Spot, Frank Energie and Zonneplan
  - Hourly and 15-minute prices; Nord Pool prices per MWh are converted to per kWh
  - Costs on top of the price: purchase fee, energy tax and VAT, to show what you really pay
  - **Test** shows the price now, lowest, highest and average today, and whether tomorrow's prices are published
- New options in the app's **Configuration** tab:
  - **Log level**: use debug when reporting a problem
  - **Allow control**: master switch, off by default. While off, the app never changes anything
- The **Status** tab shows whether control is allowed and the log level

## 0.0.5

- Added the **Grid** tab: detects the meter that measures your grid connection
  - Recognises P1 and smart meter readers (DSMR, HomeWizard P1, SlimmeLezer, P1 Monitor, Tibber Pulse)
  - A load balancer that measures the connection (such as the Easee Equalizer) can also be used
  - Meters for a single device (charger, washing machine, heat pump) are skipped
  - Suggests net power, or import and export power, and the current per phase
- Detects existing load balancers, with the choice "built into the charger or not in Home Assistant"
- Main fuse (A) and number of phases can be set

## 0.0.4

- Load balancers (such as the Easee Equalizer), kWh meters and P1 meters are no longer shown as a charger
- Devices that report no data are marked **Offline** and listed last, for both vehicles and chargers
- Charging power can now come from a sensor on another device, such as a separate kWh meter

## 0.0.3

- Added the **Charger** tab: detects EV chargers in Home Assistant
  - Recognises known charger integrations (Easee, Wallbox, Zaptec, go-e, OCPP, Alfen, Peblar and more)
  - Recognises other chargers by a charger-like name plus a power sensor or current setting
  - Vehicles are never shown as a charger, even when they have their own charging current setting
  - Suggests the status, charging power, current setting (A) and start/stop switch; each can be changed
  - Shows when a charger can only be controlled through actions
  - Phases and maximum current can be set
- Nothing is controlled yet: this version only checks what the charger offers

## 0.0.2

- Added the **Vehicle** tab: detects electric and plug-in hybrid vehicles in Home Assistant
  - Recognises known car integrations (Renault, Tesla, BMW, Kia/Hyundai, Volkswagen and more)
  - Recognises other vehicles by their sensors: a battery % sensor plus a range or distance sensor
  - Suggests the battery (SoC), range, charging and plugged-in entities; each can be changed
  - Manual choice of any % sensor when no vehicle is found
- The chosen vehicle is saved and shown with live values
- Optional battery capacity (kWh), needed later for planning
- Connection check moved to the **Status** tab, now also showing the time zone

## 0.0.1

- First version: app skeleton with ingress and a connection check to Home Assistant
