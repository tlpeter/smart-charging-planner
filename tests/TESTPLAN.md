# Test plan

This file is written by `tests/testplan.js` from the results of the last test run. GitHub runs every test after each push and updates this file, so it always matches the code. Run it yourself with `node tests/testplan.js all` (several minutes).

Three kinds of tests:

1. **Settings**: every setting, against a fake Home Assistant (`tests/fake-ha.js`). The real app starts with an empty data folder and is used through the same API as the page: what is saved, what is refused, what the plan does and what is sent to Home Assistant.
2. **Unit tests**: one part of the app at a time, without Home Assistant (brands, solar, batteries, price forecast, Ready Guard, more cars, more chargers, look ahead, saving).
3. **Matrix**: every charger brand with every home battery brand.

A separate check (`.github/workflows/ha-core-compat.yml`) runs the app against a real Home Assistant Core: the current version and the oldest one checked (2026.4.2). The Tests workflow also builds the app image for amd64 and aarch64.

## Summary

| Test | Passed |
|---|---|
| Settings A: Renault Megane E-Tech + Easee Charge | 194 of 194 ✓ |
| Settings B: Kia Niro EV (Kia Uvo) + Zaptec Go | 179 of 179 ✓ |
| Settings 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus | 180 of 180 ✓ |
| Unit tests (24 files) | 826 of 826 ✓ |
| Matrix (10 chargers × all batteries) | 960 of 960 ✓ |
| Cars (10 car integrations × Easee) | 50 of 50 ✓ |

Version: 0.36.7-dev.

# Settings

Set-ups, with entity names taken from the integrations' own source code:

- **A**: Renault Megane E-Tech + Easee Charge
- **B**: Kia Niro EV (Kia Uvo) + Zaptec Go
- **3**: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus

Both also have a P1 meter, a Fronius inverter, EnergyZero prices, a price sensor with a 7-day forecast, a solar forecast in the Energy dashboard, a Sigenergy home battery, a second car and charger, calendars (also a read-only iCloud calendar), helpers and notify actions.

Run one yourself (from the repository root, after `npm install` in `smart_charging_planner/app`), about a minute each:

```
node tests/settings.test.js
SCP_PROFILE=skoda_wallbox node tests/settings.test.js
SCP_PROFILE=kia_zaptec node tests/settings.test.js
```

## A. Fresh install and checklist

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| A1 | Fresh install: checklist says vehicle, charger and prices are missing | ✓ missing: vehicle, charger, prices | ✓ missing: vehicle, charger, prices | ✓ missing: vehicle, charger, prices |
| A2 | Frontend assets are served separately | ✓ 48 kB CSS, 262 kB JS | ✓ 48 kB CSS, 262 kB JS | ✓ 48 kB CSS, 262 kB JS |
| A3 | Fresh install: Allow control is off by default | ✓ | ✓ | ✓ |

## B. Vehicle

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| B1 | Detect finds the car with battery, plugged-in and charge limit | ✓ JLZ03X: plugged binary_sensor.jlz03x_plugged_in, limit number.jlz03x_target_charge_level | ✓ Niro EV: plugged binary_sensor.niro_ev_ev_battery_plug, limit number.niro_ev_ac_charging_limit | ✓ Enyaq: plugged binary_sensor.enyaq_charger_connected, limit number.enyaq_charge_limit |
| B2 | Refused: no battery sensor | ✓ A battery (SoC) sensor is required | ✓ A battery (SoC) sensor is required | ✓ A battery (SoC) sensor is required |
| B3 | Refused: battery capacity 500 kWh | ✓ Battery capacity must be between 0 and 300 kWh | ✓ Battery capacity must be between 0 and 300 kWh | ✓ Battery capacity must be between 0 and 300 kWh |
| B4 | Refused: a charge limit that is not on the car's device | ✓ That entity is not the car's charge limit | ✓ That entity is not the car's charge limit | ✓ That entity is not the car's charge limit |
| B5 | Refused: battery level 120 % entered by hand | ✓ Battery level must be between 0 and 100 % | ✓ Battery level must be between 0 and 100 % | ✓ Battery level must be between 0 and 100 % |
| B6 | No car integration: "enter level" needs a capacity | ✓ Battery capacity is required to estimate the battery level | ✓ Battery capacity is required to estimate the battery level | ✓ Battery capacity is required to estimate the battery level |
| B7 | No car integration: fixed amount must be 1–150 kWh | ✓ The amount per session must be between 1 and 150 kWh | ✓ The amount per session must be between 1 and 150 kWh | ✓ The amount per session must be between 1 and 150 kWh |
| B8 | Save the car (sensor mode, capacity, plugged-in sensor, charge limit) | ✓ | ✓ | ✓ |

## C. Charger

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| C1 | Detect finds the charger with status and power, and not the car | ✓ switch: none | ✓ switch: switch.zaptec_go_charging | ✓ switch: switch.wallbox_pulsar_plus_pause_resume |
| C2 | Refused: no entities chosen | ✓ Choose at least one entity | ✓ Choose at least one entity | ✓ Choose at least one entity |
| C3 | Refused: maximum current 100 A | ✓ Maximum current must be between 6 and 80 A | ✓ Maximum current must be between 6 and 80 A | ✓ Maximum current must be between 6 and 80 A |
| C4 | Refused: a switch as status entity | ✓ Invalid entity for status_entity | ✓ Invalid entity for status_entity | ✓ Invalid entity for status_entity |
| C5 | Save the charger (3 phases, 16 A) | ✓ | ✓ | ✓ |
| C6 | Control check finds a start/stop method and recommends one | ✓ recommended: Laadpaal Charger enabled | ✓ recommended: Buttons | ✓ recommended: Wallbox Pulsar Plus Pause/Resume |
| C7 | Maximum current 10 A: the plan uses 3 × 230 V × 10 A = 6.9 kW | ✓ | ✓ | ✓ |
| C8 | One phase, 16 A: the plan uses 3.7 kW | ✓ | ✓ | ✓ |
| C6b | Charger's own smart mode on (Eco-smart (select.wallbox_pulsar_plus_ecosmart)): the control check warns | – (not for this set-up) | – (not for this set-up) | ✓ own_mode_on |

## D. Grid

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| D1 | Detect finds the P1 meter | ✓ | ✓ | ✓ |
| D2 | Refused: main fuse 300 A | ✓ Main fuse must be between 6 and 200 A | ✓ Main fuse must be between 6 and 200 A | ✓ Main fuse must be between 6 and 200 A |
| D3 | Refused: no net or import sensor | ✓ Choose a net power sensor, or an import power sensor | ✓ Choose a net power sensor, or an import power sensor | ✓ Choose a net power sensor, or an import power sensor |
| D4 | Save the P1 meter (25 A, load balancer in the charger) | ✓ | ✓ | ✓ |

## E. Prices

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| E1 | Detect offers EnergyZero, the combined sensor and the fixed tariff | ✓ | ✓ | ✓ |
| E2 | Test shows all prices today and tomorrow (23/24/25 hours on DST days) | ✓ | ✓ | ✓ |
| E3 | Market price excl. VAT + fee + tax: all-in = (price + fee + tax) × 1.21 | ✓ 0.2 → 0.3872 | ✓ 0.2 → 0.3872 | ✓ 0.2 → 0.3872 |
| E4 | Market price incl. VAT: all-in = price + (fee + tax) × 1.21 | ✓ | ✓ | ✓ |
| E5 | All-in price: used as it is | ✓ | ✓ | ✓ |
| E6 | Refused: purchase fee 2, VAT 80 | ✓ | ✓ | ✓ |
| E7 | Fixed tariff: refused when low from = low until, or time "25:00" | ✓ | ✓ | ✓ |
| E8 | Day/night tariff: the plan charges in the low hours | ✓ planned hours 23,0,1 | ✓ planned hours 23,0,1 | ✓ planned hours 23,0,1,2 |
| E9 | Refused: forecast sensor with a bad name, margin 0.6 | ✓ | ✓ | ✓ |
| E10 | Chart looks back at least 12 hours; past blocks the charger charged in come back as "charged", future blocks never | ✓ 13 charged blocks, from 12.3 h back | ✓ 13 charged blocks, from 12.3 h back | ✓ 13 charged blocks, from 12.3 h back |
| E11 | Chart further back (24 h, 3 or 7 days): api/past gives the older prices and charging up to the plan's first block; anything else is 12 hours | ✓ 24 h: 12 blocks, 72 h: 60 blocks, 168 h: 156 blocks | ✓ 24 h: 12 blocks, 72 h: 60 blocks, 168 h: 156 blocks | ✓ 24 h: 12 blocks, 72 h: 60 blocks, 168 h: 156 blocks |
| E12 | A skipped forecast interval gives one warning while valid actual prices remain usable | ✓ one source/date warning; valid prices still used | ✓ one source/date warning; valid prices still used | ✓ one source/date warning; valid prices still used |
| E12b | Forecast price basis (#26): saving needs an explicit basis; an all-in forecast is not taxed again; the same hour shows VAT applied twice | ✓ wrong basis: ratio 1.210 with a warning; all-in: 0.2207 + 0.02 = 0.2407 | ✓ wrong basis: ratio 1.210 with a warning; all-in: 0.2207 + 0.02 = 0.2407 | ✓ wrong basis: ratio 1.210 with a warning; all-in: 0.2207 + 0.02 = 0.2407 |
| E13 | A genuinely missing price source remains an error | ✓ | ✓ | ✓ |

## F. Planning (departures)

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| F1 | Refused: battery level 5 %, time "7 uur", calendar buffer 500 | ✓ | ✓ | ✓ |
| F2 | Weekly schedule: next departure is tomorrow 06:30 at 85 % | ✓ | ✓ | ✓ |
| F3 | One-off departure wins over the schedule; refused in the past or after 7 days | ✓ | ✓ | ✓ |
| F4 | Calendar: "doel: 90" in an event becomes the departure, minus the buffer | ✓ | ✓ | ✓ |
| F5 | Helper: date/time and battery level helper | ✓ | ✓ | ✓ |
| F6 | Refused: helper on without a helper chosen; calendar on without a calendar | ✓ | ✓ | ✓ |
| F7 | No departure source: plan uses the cheapest known hours, note "no departure" | ✓ | ✓ | ✓ |
| F8 | Calendar with a keyword: only events with "EV" count, without a target the calendar level is used | ✓ | ✓ | ✓ |
| F8b | A calendar outage keeps the last confirmed departure, including after app restart | ✓ confirmed deadline preserved with an explicit stale-source warning | ✓ confirmed deadline preserved with an explicit stale-source warning | ✓ confirmed deadline preserved with an explicit stale-source warning |
| F8c | Successful rescheduling and cancellation replace cached events; expired cache is not reused | ✓ | ✓ | ✓ |
| F9 | Add trip with "Allow adding trips" off: test mode, nothing written | ✓ | ✓ | ✓ |
| F9b | Add trip language: "auto" follows Home Assistant (English here), Dutch on request, an unknown value falls back to auto | ✓ To Utrecht / Naar Utrecht | ✓ To Utrecht / Naar Utrecht | ✓ To Utrecht / Naar Utrecht |
| F10 | Looking ahead reaches 30 days (#4): the weekly schedule gives departures in weeks 3 and 4, and the plan says until when prices are known; Plan lists 7, 14 or 30 days as asked | ✓ 10 departures in 30 days · Plan 2 / 4 / 10 days with a departure | ✓ 10 departures in 30 days · Plan 2 / 4 / 10 days with a departure | ✓ 10 departures in 30 days · Plan 2 / 4 / 10 days with a departure |

## G. Rules

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| G1 | Refused: default minimum 50 %, force window 700 min, hysteresis 2 | ✓ | ✓ | ✓ |
| G2 | Minimum battery level: below it → charge now | ✓ | ✓ | ✓ |
| G2b | Below the minimum: the plan charges that part right away, marked as minimum (purple in the chart); the rest as planned | ✓ 5.7 kWh right away to 50% | ✓ 7.0 kWh right away to 50% | ✓ 8.5 kWh right away to 50% |
| G3 | Minimum with a price limit below the current price → not charged for the minimum | ✓ then: locked_block | ✓ then: locked_block | ✓ then: locked_block |
| G3b | Minimum taken from an entity (the car's own minimum, here 70 %) | ✓ | ✓ | ✓ |
| G4 | Preconditioning entity on → charge | ✓ | ✓ | ✓ |
| G5 | Force window: departure within the window → charge | ✓ ready_guard | ✓ ready_guard | ✓ ready_guard |
| G6 | Not in a planned block and not charging → pause | ✓ paused | ✓ paused | ✓ paused |
| G7 | Default minimum for quick choices is used on Home | ✓ | ✓ | ✓ |
| G8 | Allow control off: the car limit is not changed and the plan stops at the limit | ✓ | ✓ | ✓ |
| G9 | Allow control off: nothing is sent to Home Assistant | ✓ | ✓ | ✓ |

## H. Notifications

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| H1 | Refused: a notify action that does not exist | ✓ Choose a notify action from the list | ✓ Choose a notify action from the list | ✓ Choose a notify action from the list |
| H2 | Choose mobile_app_pixel_8 and send a test notification | ✓ | ✓ | ✓ |
| H2b | A tap on a phone notification opens the app page | ✓ | ✓ | ✓ |
| H3 | Test notification refused when no notify action is chosen | ✓ | ✓ | ✓ |
| H4 | Two recipients, each with its own messages: the test goes to one; a recipient without a notify action is refused | ✓ test → mobile_app_iphone_sam | ✓ test → mobile_app_iphone_sam | ✓ test → mobile_app_iphone_sam |
| H5 | Settings from before recipients (one notify action, "Notify every start and pause" off) become one recipient "My phone" with start, pause and home battery messages off | ✓ | ✓ | ✓ |

## I. Configuration tab in Home Assistant

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| I1 | Charging loss margin 20 %: more energy planned than with 10 % | ✓ 22.88 → 24.96 kWh | ✓ 28.16 → 30.72 kWh | ✓ 33.88 → 36.96 kWh |
| I2 | Invalid option values fall back to the defaults (loss 99 %, refresh 0) | ✓ | ✓ | ✓ |
| I3 | Continuous charging off: blocks may be split | ✓ 1 period(s) | ✓ 1 period(s) | ✓ 2 period(s) |
| I4 | Publish sensors on: sensor.smart_charging_* are written | ✓ 9 sensors | ✓ 9 sensors | ✓ 9 sensors |
| I5 | Publish sensors off: nothing is written | ✓ | ✓ | ✓ |

## J. Allow control on: quick choices and the car limit

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| J1 | Car limit follows the plan: tomorrow 90 % (one call) | ✓ number.set_value 90 | ✓ number.set_value 90 | ✓ number.set_value 90 |
| J2 | Plan is not capped at the old limit when the app manages it | ✓ | ✓ | ✓ |
| J3 | Ready for the day after tomorrow 95 %: minimum 30 % first, limit follows | ✓ 42.9 kWh before 10-29T06:00, limit sent 95 | ✓ 52.8 kWh before 10-29T06:00, limit sent 100 | ✓ 63.5 kWh before 10-29T06:00, limit sent 100 |
| J4 | Back to normal: limit goes down to the plan again | ✓ limit 90 | ✓ limit 90 | ✓ limit 90 |
| J4b | Ready for the day after tomorrow, chosen for a calendar trip; the trip is removed → the choice ends by itself | ✓ based on "Naar werk", ended; notified: The departure it was chosen for (Naar werk on 2026-10-30) is no longer planned. The car is planned for the next departure again. | ✓ based on "Naar werk", ended; notified: The departure it was chosen for (Naar werk on 2026-10-30) is no longer planned. The car is planned for the next departure again. | ✓ based on "Naar werk", ended; notified: The departure it was chosen for (Naar werk on 2026-10-30) is no longer planned. The car is planned for the next departure again. |
| J4c | Ready for tomorrow when no departure was planned that day: the choice stays | ✓ | ✓ | ✓ |
| J5 | Quickly to a minimum (35 %) does not lower the limit | ✓ | ✓ | ✓ |
| J5b | Quick minimum started: all of it is marked as minimum (purple in the chart) | ✓ 8.6 kWh to 35% | ✓ 10.6 kWh to 35% | ✓ 12.7 kWh to 35% |
| J6 | Charge now 100 %: limit up, charger started; stop: limit back | ✓ limit 100 → 90, start: switch.turn_on switch.laadpaal_charger_enabled | ✓ limit 100 → 90, start: button.press button.zaptec_go_resume_charging | ✓ limit 100 → 90, start: switch.turn_on switch.wallbox_pulsar_plus_pause_resume |
| J6b | Just turn it on (Charge now without a goal, also for a visitor's car): charger started right away, no end from car data, your car's limit is not touched | ✓ start sent, no end until Stop or unplug | ✓ start sent, no end until Stop or unplug | ✓ start sent, no end until Stop or unplug |
| J6c | Restart the car (option): the charger is on and ready, but the car takes no power (like a Renault that ended its session at 80 %); the app sets the car limit one step lower and back, and the car charges | ✓ limits 100 → 95, charging | ✓ not for this charger in the fake | ✓ not for this charger in the fake |
| J7 | Charge now as kWh: preview converts it to a level for the limit | ✓ | ✓ | ✓ |
| J8 | "Don't change the car's charge limit": nothing sent, plan capped at the limit | ✓ limit 80 %, battery 85 %: action needed + notification | ✓ limit 80 %, battery 85 %: action needed + notification | ✓ limit 80 %, battery 85 %: action needed + notification |
| J9 | Notification on start (notify every start and pause) | ✓ Car charge limit changed · Charging paused · Car charge limit changed · Ready Guard needs you | ✓ Car charge limit changed · Charging started · Charging paused · Ready Guard needs you | ✓ Car charge limit changed · Charging started · Charging paused · Ready Guard needs you |
| J9b | Manual test (Diagnostics): start and stop really sent | ✓ switch.turn_on switch.laadpaal_charger_enabled → switch.turn_off switch.laadpaal_charger_enabled | ✓ button.press button.zaptec_go_resume_charging → button.press button.zaptec_go_stop_charging | ✓ switch.turn_on switch.wallbox_pulsar_plus_pause_resume → switch.turn_off switch.wallbox_pulsar_plus_pause_resume |
| J12 | Target 85 %: limit rounded up to a step the car accepts, the plan still stops at 85 % | ✓ limit 85 %, at 85 %: at_target | ✓ limit 90 %, at 85 %: at_target | ✓ limit 90 %, at 85 %: at_target |
| J13 | Battery care (on by default): target 100 % tomorrow 23:00 — up to 80 % in the cheap night, the last part only in the 4 hours before departure; the car limit stays at 80 % until then | ✓ up to 80 %: 17.2 kWh in the night · last 11.4 kWh from 19:00 · car limit 80 % | ✓ up to 80 %: 21.1 kWh in the night · last 14.1 kWh from 19:00 · car limit 80 % | ✓ up to 80 %: 25.4 kWh in the night · last 16.9 kWh from 19:00 · car limit 80 % |
| J13b | Battery Care refill (#43): 79% and the 75% boundary wait for one priced session; below it gets an 80% session and a later 90% session; a hard minimum still charges | ✓ 75–79% waits; 74% shows 80% then 90%; explicit minimum remains immediate | ✓ 75–79% waits; 74% shows 80% then 90%; explicit minimum remains immediate | ✓ 75–79% waits; 74% shows 80% then 90%; explicit minimum remains immediate |
| J10 | Car unplugged: Charge now is refused | ✓ | ✓ | ✓ |
| J11 | A recipient with "Charging started" and "Charging paused" off: start is not notified; other messages still are | ✓ only: Car charge limit changed | ✓ only: Car charge limit changed | ✓ only: Car charge limit changed |

## S. Solar

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| S1 | Refused: solar up to 30 %, forecast sensor without a sensor, factor 2 | ✓ | ✓ | ✓ |
| S2 | Solar page: forecast from the Energy dashboard, inverter found, phase switching of the charger | ✓ forecast tomorrow 18 kWh, inverter Fronius, phase switching: Set charger phase mode, current: Set charger dynamic limit | ✓ forecast tomorrow 18 kWh, inverter Fronius, phase switching: not possible, current: Zaptec Go Charger max current | ✓ forecast tomorrow 18 kWh, inverter Fronius, phase switching: not possible, current: Wallbox Pulsar Plus Maximum Charging Current |
| S3 | Plan + solar, feed-in 0.03: the plan charges on tomorrow's sun (cheaper than the night at 0.05) | ✓ 23.4 kWh on solar, 10.9 kWh from the grid | ✓ 23.4 kWh on solar, 18.8 kWh from the grid | ✓ 23.4 kWh on solar, 27.4 kWh from the grid |
| S4 | Dynamic feed-in (market 0.20 − 0.02 = 0.18) vs grid all-in 0.21 at night: the sun is cheaper, also without salderen | ✓ 23.4 kWh on solar | ✓ 23.4 kWh on solar | ✓ 23.4 kWh on solar |
| S4b | Feed-in 0.25 (more than the night at 0.21): the night first; the sun only for what does not fit (day grid 0.39) | ✓ 33.1 kWh at night, 1.2 kWh on solar | ✓ 33.1 kWh at night, 9.1 kWh on solar | ✓ 33.1 kWh at night, 17.7 kWh on solar |
| S5 | Solar only: the plan uses only the sun | ✓ 23.4 kWh, notes: prices_incomplete, not_enough_known_time, solar_only | ✓ 23.4 kWh, notes: prices_incomplete, not_enough_known_time, solar_only | ✓ 23.4 kWh, notes: prices_incomplete, not_enough_known_time, solar_only |
| S6 | Live: 6 kW sun, car not charging → start on solar with a matching current | ✓ 7 A, sent: easee.set_charger_dynamic_limit {"device_id":"ch","current":7,"time_to_live":30} · switch.turn_on switch.laadpaal_charger_enabled | ✓ 7 A, sent: number.set_value number.zaptec_go_charger_max_current 7 · button.press button.zaptec_go_resume_charging | ✓ 7 A, sent: number.set_value number.wallbox_pulsar_plus_maximum_charging_current 7 · switch.turn_on switch.wallbox_pulsar_plus_pause_resume |
| S7 | Live: sun drops to 2.5 kW → one phase where the charger can, otherwise stop | ✓ one phase, 6 A · switch.turn_off switch.laadpaal_charger_enabled · easee.set_charger_phase_mode {"device_id":"ch","phase_mode":"1_phase"} · switch.turn_off switch.laadpaal_charger_enabled · easee.set_charger_dynamic_limit {"device_id":"ch","current":6,"time_to_live":30} · switch.turn_on switch.laadpaal_charger_enabled | ✓ paused (no phase switching) · button.press button.zaptec_go_stop_charging | ✓ paused (no phase switching) · switch.turn_off switch.wallbox_pulsar_plus_pause_resume |
| S8 | Charge now after solar: current back to the maximum (and three phases) | ✓ easee.set_charger_phase_mode {"device_id":"ch","phase_mode":"3_phase"} · switch.turn_off switch.laadpaal_charger_enabled · switch.turn_off switch.laadpaal_charger_enabled · switch.turn_off switch.laadpaal_charger_enabled · easee.set_charger_dynamic_limit {"device_id":"ch","current":16,"time_to_live":30} · switch.turn_on switch.laadpaal_charger_enabled | ✓ number.set_value number.zaptec_go_charger_max_current 16 · button.press button.zaptec_go_resume_charging | ✓ number.set_value number.wallbox_pulsar_plus_maximum_charging_current 16 · switch.turn_on switch.wallbox_pulsar_plus_pause_resume |
| S9 | Solar modes raise the car limit to "solar up to" (90 %) | ✓ | ✓ | ✓ |
| S10 | Grid meter sign "delivering is positive": the reading is turned around | ✓ | ✓ | ✓ |
| S12 | Easee Equalizer does solar: surplus charging on, charger on, no current or phase commands; Charge now: surplus off (full power) | ✓ switch.turn_on switch.laadpaal_charger_enabled · easee.set_surplus_charging true · Charge now: surplus false | ✓ | ✓ |
| S13 | Back to the app: the surplus charging the app switched on goes off; Equalizer surplus on in the Easee app is reported | ✓ | – (not for this set-up) | – (not for this set-up) |
| S11 | Mode buttons refused without solar; solar off → back to the price plan | ✓ | ✓ | ✓ |

## T. Home battery (Sigenergy)

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| T1 | Battery page finds the Sigenergy: level, power, capacity, what the app can do | ✓ can: auto, charge, discharge, hold | ✓ can: auto, charge, discharge, hold | ✓ can: auto, charge, discharge, hold |
| T2 | Refused: minimum above maximum, a battery that does not exist, capacity 0 | ✓ | ✓ | ✓ |
| T3 | Plan: charges from the grid in the cheap night (0.05) for the 0.20 hours, with a saving | ✓ charges in 3 block(s), saving €1.46 | ✓ charges in 3 block(s), saving €1.45 | ✓ charges in 3 block(s), saving €1.41 |
| T4 | Allow control on, home battery control off: nothing is sent to the battery | ✓ | ✓ | ✓ |
| T5 | Car charges, "never into the car": the battery holds (Remote EMS on, Standby) | ✓ turn_on · select_option Standby | ✓ turn_on · select_option Standby | ✓ turn_on · select_option Standby |
| T6 | Car stops: the battery goes back to its plan | ✓ now: auto · select_option Maximum Self Consumption · turn_off | ✓ now: auto · select_option Maximum Self Consumption · turn_off | ✓ now: auto · select_option Maximum Self Consumption · turn_off |
| T7 | "Only stored solar into the car": no solar in the battery → no discharging into the car | ✓ | ✓ | ✓ |
| T7b | "Between two levels" (80 % → 40 %): refused when the levels do not fit; car charges: below 80 % no help, from 80 % the battery helps, at 40 % it stops | ✓ 60 %: hold · 85 %: auto · 39 %: hold | ✓ 60 %: hold · 85 %: auto · 39 %: hold | ✓ 60 %: hold · 85 %: auto · 39 %: hold |
| T8 | Smart sun: the battery takes 2 kW of sun, the car needs energy → the car gets the sun, the battery waits | ✓ car on solar at 8 A · battery: turn_on · select_option Standby | ✓ car on solar at 8 A · battery: turn_on · select_option Standby | ✓ car on solar at 8 A · battery: turn_on · select_option Standby |
| T8b | Equalizer does solar, no sun (evening): the charger is on but the car waits, so the battery keeps covering the house | ✓ charger on, Equalizer waits; battery: auto (Battery plan: auto) | – (not for this set-up) | – (not for this set-up) |
| T9 | Diagnostics: battery test "charge" sends the Sigenergy commands | ✓ turn_on · set_value 5 · select_option Command Charging (Grid First) | ✓ turn_on · set_value 5 · select_option Command Charging (Grid First) | ✓ turn_on · set_value 5 · select_option Command Charging (Grid First) |
| T10 | Battery planning off: the battery goes back to normal (Remote EMS off) | ✓ | ✓ | ✓ |

## V. Car not reachable (the car's cloud is down)

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| V1 | Refused: car data old after 100 hours; 2 hours is saved | ✓ | ✓ | ✓ |
| V2 | Battery level "unavailable": the plan goes on from the last level plus what the charger delivered, the car limit is not sent, one notification | ✓ plans with 45% (last level 45% + 0.02 kWh charged since), decision not_planned | ✓ plans with 45% (last level 45% + 0.02 kWh charged since), decision not_planned | ✓ plans with 45% (last level 45% + 0.02 kWh charged since), decision not_planned |
| V3 | Battery level not read for 3 hours (old after 2): estimate from the last level; back: the real level, at most one message an hour | ✓ stale: 50% · back: 50% | ✓ stale: 50% · back: 50% | ✓ stale: 50% · back: 50% |
| V4 | Nothing known yet (fresh start, level unavailable): plans as if at the minimum (20 %) and charges | ✓ assumed 20%, planned 40.0 kWh | ✓ assumed 20%, planned 49.3 kWh | ✓ assumed 20%, planned 59.3 kWh |
| V5 | Just plugged in: the charger already says connected, the car's own sensor (through its cloud) still says not plugged in: the app sees the car as plugged in right away | ✓ charger: connected · car sensor: off → plugged in | ✓ charger: connected · car sensor: off → plugged in | ✓ charger: connected · car sensor: off → plugged in |

## K. Price forecast and checklist

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| K1 | Forecast on: plan waits for the cheap forecast day, never charges on it now | ✓ 31 forecast hours, planned: 10-30T10 (forecast) | ✓ 31 forecast hours, planned: 10-30T10 (forecast) | ✓ 31 forecast hours, planned: 10-30T10 (forecast) |
| K2 | Forecast is not used without a departure | ✓ | ✓ | ✓ |
| K3 | Checklist after setup: ready; shows the points that need attention | ✓ vehicle:ok charger:ok method:ok prices:ok forecast:ok departures:ok control:ok car_limit:ok conflicts:ok notify:ok grid:ok battery:optional solar:optional | ✓ vehicle:ok charger:ok method:ok prices:ok forecast:ok departures:ok control:ok car_limit:ok conflicts:ok notify:ok grid:ok battery:optional solar:optional | ✓ vehicle:ok charger:ok method:ok prices:ok forecast:ok departures:ok control:ok car_limit:ok conflicts:ok notify:ok grid:ok battery:optional solar:optional |

## L. Security

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| L1 | Refused: a change sent as text/plain (not JSON) | ✓ | ✓ | ✓ |
| L2 | Refused: a change from another site | ✓ | ✓ | ✓ |
| L3 | Refused: invalid JSON | ✓ | ✓ | ✓ |
| L4 | Download diagnostics: settings, control check, entities, log; no notify target, trip titles or token | ✓ 35 kB, 10 entities, 15 summarized log lines | ✓ 32 kB, 10 entities, 15 summarized log lines | ✓ 32 kB, 10 entities, 15 summarized log lines |

## M. Settings export and import

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| M1 | Export: all settings in one file, without the Configuration options (Allow control) | ✓ 15 parts, 4 kB | ✓ 15 parts, 4 kB | ✓ 15 parts, 4 kB |
| M2 | Refused: not a settings file, a file with unknown parts, a newer format | ✓ | ✓ | ✓ |
| M3 | Import in a fresh install (like the dev version): preview, then the same settings; Allow control stays as configured | ✓ car JLZ03X, charger Laadpaal, prices EnergyZero | ✓ car Niro EV, charger Zaptec Go, prices EnergyZero | ✓ car Enyaq, charger Wallbox Pulsar Plus, prices EnergyZero |
| M4 | Import with things this Home Assistant does not have: battery and notify action left out, entities listed | ✓ Not found in this Home Assistant: sensor.other_house_battery_soc / The home battery was left out: it was not found here / Left out 1 notification recipient(s): that notify action does not exist here | ✓ Not found in this Home Assistant: sensor.other_house_battery_soc / The home battery was left out: it was not found here / Left out 1 notification recipient(s): that notify action does not exist here | ✓ Not found in this Home Assistant: sensor.other_house_battery_soc / The home battery was left out: it was not found here / Left out 1 notification recipient(s): that notify action does not exist here |

## N. Reliability

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| N1 | A failed charger command is retried on the next control step | ✓ 1 successful retry | ✓ 1 successful retry | ✓ 1 successful retry |
| N2 | A Home Assistant reconnect immediately refreshes the cached plan | ✓ 22.9 -> 34.3 kWh | ✓ 28.2 -> 42.2 kWh | ✓ 33.9 -> 50.8 kWh |

## W. More than one car on one charger

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| W1 | Off by default: one car as before; adding a second car or choosing a car is refused | ✓ one car: JLZ03X (car1) | ✓ one car: Niro EV (car1) | ✓ one car: Enyaq (car1) |
| W2 | Turned on: a second car is added next to the first; the first keeps its id and settings | ✓ JLZ03X (car1), EV6 (car2) | ✓ Niro EV (car1), EV6 (car2) | ✓ Enyaq (car1), EV6 (car2) |
| W3 | Only the EV6 says it is plugged in: the plan is for the EV6 (its level, its capacity) | ✓ EV6 at 30% · needs 42.4 kWh | ✓ EV6 at 30% · needs 42.4 kWh | ✓ EV6 at 30% · needs 42.4 kWh |
| W4 | Only JLZ03X says it is plugged in: the plan is for JLZ03X | ✓ JLZ03X at 40% | ✓ Niro EV at 40% | ✓ Enyaq at 40% |
| W5 | Both say plugged in (one at a public charger): the app asks once, does not change a car limit; your choice wins until the charger is unplugged | ✓ asked once; chosen: EV6; unplugged: last = EV6 | ✓ asked once; chosen: EV6; unplugged: last = EV6 | ✓ asked once; chosen: EV6; unplugged: last = EV6 |
| W6 | A car without a plug sensor is the one when no other car says it is plugged in | ✓ EV6 (no_other) | ✓ EV6 (no_other) | ✓ EV6 (no_other) |
| W7 | Own departures for the EV6 (60 %); the other car keeps the shared ones (80 %) | ✓ EV6 → 60% · JLZ03X → 80% | ✓ EV6 → 60% · Niro EV → 80% | ✓ EV6 → 60% · Enyaq → 80% |
| W7b | One calendar for both cars: "auto:"/"car:" in an event is only for that car (name or brand), without it for every car, an unknown car counts for every car | ✓ EV6 → 70% (car: kia) · JLZ03X → 90% · new trip: "target: 75 precondition: yes car: EV6" | ✓ EV6 → 70% (car: EV6) · Niro EV → 90% · new trip: "target: 75 precondition: yes car: EV6" | ✓ EV6 → 70% (car: kia) · Enyaq → 90% · new trip: "target: 75 precondition: yes car: EV6" |
| W9 | Notifications per car: Alex gets both cars, Sam only the EV6; "Charging started" for the EV6 goes to both, for the other car only to Alex | ✓ EV6 → mobile_app_iphone_sam, mobile_app_pixel_8 · JLZ03X → mobile_app_pixel_8 | ✓ EV6 → mobile_app_iphone_sam, mobile_app_pixel_8 · Niro EV → mobile_app_pixel_8 | ✓ EV6 → mobile_app_iphone_sam, mobile_app_pixel_8 · Enyaq → mobile_app_pixel_8 |
| W8 | Turned off: the first car only, as before; the EV6 stays saved; removing it works | ✓ back to one car | ✓ back to one car | ✓ back to one car |

## Y. Looking ahead: the next goal and what a trip costs

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| Y1 | Target reached (100 %), trip with an address tomorrow: the next goal (Werk, 80 %) is shown, the trip costs ~46 % there and back (60 km by road, 18 kWh/100 km, +10 %), so ~54 % is expected after it, with the expected charging (orange) after the car is back | ✓ trip 60 km → 45.7% · back ~54.3% · next: Naar Werk 80% · expected 14.7 kWh, 14.7 kWh in known prices | ✓ trip 60 km → 37.1% · back ~62.9% · next: Naar Werk 80% · expected 12 kWh, 12.0 kWh in known prices | ✓ trip 60 km → 30.9% · back ~69.1% · next: Naar Werk 80% · expected 9.2 kWh, 9.2 kWh in known prices |
| Y2 | A return trip in the calendar ("Naar Thuis", 16:00–17:00): the car is back at 17:00 and the way home is not the next goal | ✓ back 16:00 UTC · next Naar Werk | ✓ back 16:00 UTC · next Naar Werk | ✓ back 16:00 UTC · next Naar Werk |
| Y3 | An extra calendar trip becomes the next stop, and the 100% long trip after it becomes the next goal instead of the later work trip | ✓ next stop Naar Harbourtown 60% · next goal Naar Lakeside 100% | ✓ next stop Naar Harbourtown 60% · next goal Naar Lakeside 100% | ✓ next stop Naar Harbourtown 60% · next goal Naar Lakeside 100% |
| Y2b | Lakeside on Sunday, then Naar Werk (company + address) and Naar Thuis (home address) on Monday: no trip home for Sunday, the next goal is Monday's Naar Werk, the company address is found without the company name | ✓ back Sun 20:00 · next goal Mon 06:00 Naar Werk · Werk ~60 km | ✓ back Sun 20:00 · next goal Mon 06:00 Naar Werk · Werk ~60 km | ✓ back Sun 20:00 · next goal Mon 06:00 Naar Werk · Werk ~60 km |
| Y5 | The coming days as one timeline: charging, leaving, back home, expected charging (orange), leaving again, …; the chart goes on to the expected charging | ✓ charge leave back expected leave back expected leave back | ✓ charge leave back expected leave back expected leave back | ✓ charge leave back expected leave back expected leave back |
| Y6 | My places: "Werk" and a company name ("Northwind Labs") are no address; Home offers to add "Werk" to My places; once saved, both Naar Werk trips show what they cost | ✓ Werk → 60 km, 45.7% there and back | ✓ Werk → 60 km, 37.1% there and back | ✓ Werk → 60 km, 30.9% there and back |
| Y7 | Zones in Home Assistant: a zone "Werk" (GPS) is used without an address, for "Werk" and for "Naar Werk" with "Northwind Labs"; Plan lists the zone, not Home | ✓ zone Werk → 60 km (route) | ✓ zone Werk → 60 km (route) | ✓ zone Werk → 60 km (route) |
| Y7b | Trip distances (#31): the choice is checked; offline sends nothing and uses a distance from My places; off shows no distance; back to OpenStreetMap | ✓ Gym → 15.5 km (manual); unknown address offline: routing_off | ✓ Gym → 15.5 km (manual); unknown address offline: routing_off | ✓ Gym → 15.5 km (manual); unknown address offline: routing_off |
| Y7c | Charging stops on the way (#37, #40): off by default; needs a key that is never shown; a trip that needs more than the battery holds gets stations along the route (country, power, connector, detour, not private), preferred operators first, one block per stop; every country on the route counts unless limited; offline sends nothing | ✓ Fastned + IONITY on the way; IONITY preferred → only IONITY; offline → nothing sent | ✓ Fastned + IONITY on the way; IONITY preferred → only IONITY; offline → nothing sent | ✓ Fastned + IONITY on the way; IONITY preferred → only IONITY; offline → nothing sent |
| Y7c1 | Open Charge Map key (#42): saved state survives reload and empty saves; replacement and explicit removal persist without returning the secret | ✓ save → reload → keep → replace → remove; responses never include the key | ✓ save → reload → keep → replace → remove; responses never include the key | ✓ save → reload → keep → replace → remove; responses never include the key |
| Y8 | Use per km from the range sensor (range at the level now): two trips of the same distance cost the same, also when the car leaves the second time with more battery | ✓ 60 km → 44% both times | ✓ 60 km → 33% both times | ✓ 60 km → 31.4% both times |
| Y9 | Minimum 60 % and back home below it: the timeline charges right away to 60 % when the car is back (purple), the rest in the cheapest hours | ✓ back 34.3% → right away to 60% (14.7 kWh), then 11.4 kWh to 80% | ✓ back 42.9% → right away to 60% (12 kWh), then 14.1 kWh to 80% | ✓ back 49.1% → right away to 60% (9.2 kWh), then 16.9 kWh to 80% |
| Y10 | Minimum charging after the third day is included in the chart, through the last expected charging in the timeline | ✓ day 4: right away to 60%, then charging for day 6; all expected blocks have chart prices | ✓ day 4: right away to 60%, then charging for day 6; all expected blocks have chart prices | ✓ day 4: right away to 60%, then charging for day 6; all expected blocks have chart prices |
| Y11 | The car is away and a trip home is in the calendar ("Naar huis" 16:00–17:00, even with a target): the trip home is not a departure, charging is planned only from 17:00, and the timeline starts with "Back home" | ✓ departure Naar Werk, charging from 16:00 UTC | ✓ departure Naar Werk, charging from 16:00 UTC | ✓ departure Naar Werk, charging from 16:00 UTC |
| Y24 | Car not plugged in, no car location, no person, no trip home (#46): the place is "unknown"; Looking ahead counts from the level now (50%), the planned charging is "if plugged in" and the level with it is shown next to it | ✓ leaves with 50% (80% if plugged in), charging shown as "if plugged in" | ✓ leaves with 50% (80% if plugged in), charging shown as "if plugged in" | ✓ leaves with 50% (80% if plugged in), charging shown as "if plugged in" |
| Y25 | Car location first, then the person, then the calendar (#46): car "not_home" wins over person "home"; car "unavailable" is skipped and person "not_home" decides; both unknown and "Naar huis" in the calendar: away until the trip home; a wrong entity type is not saved | ✓ car → person → calendar; wrong entity types are not saved | ✓ car → person → calendar; wrong entity types are not saved | ✓ car → person → calendar; wrong entity types are not saved |
| Y26 | Car location "home" while not plugged in (#46): at home, so the plan counts on the charging as before, also with "Naar huis" in the calendar; plugged in: no place check at all | ✓ at home: leaves with 80% | ✓ at home: leaves with 80% | ✓ at home: leaves with 80% |
| Y12 | More places in a row: Werk 06:00–16:30, then Sport 16:30–20:30, then Naar Thuis 20:30–22:00: one trip home → Werk → Sport → home (60 km each part), no charging at home in between, back at 22:00 | ✓ home → Werk → Sport → home: 180 km ≈ 68.5% · at Sport 34.3% · home 11.5% at 22:00 · with 40 kWh/100 km: home -72.3% | ✓ home → Werk → Sport → home: 180 km ≈ 55.7% · at Sport 42.9% · home 24.3% at 22:00 · with 40 kWh/100 km: home -43.8% | ✓ home → Werk → Sport → home: 180 km ≈ 46.3% · at Sport 49.1% · home 33.7% at 22:00 · with 40 kWh/100 km: home -22.9% |
| Y13 | Ask to charge more for a long trip (on, reserve 10 %): the trip costs more than 80 % leaves room for, so the phone gets one question with Yes/No buttons; a tap on Yes raises the target for this trip only | ✓ trip ≈ 114.2% → asked to charge to 100% · Yes on the phone → target 100% (Plan page too) · costs less → 87% · Sport removed → back to 80% | ✓ trip ≈ 114.5% → asked to charge to 100% · Yes on the phone → target 100% (Plan page too) · costs less → 87% · Sport removed → back to 80% | ✓ trip ≈ 77.1% → asked to charge to 88% · Yes on the phone → target 88% (Plan page too) · bigger trip → 100% · costs less → 88% · Sport removed → back to 80% |
| Y13b | Declined trip top-up (#43): the answer stays No while the banner follows the current trip cost and target, and hides an unavailable estimate | ✓ declined answer retained; current trip and banner agree; no repeated notification | ✓ declined answer retained; current trip and banner agree; no repeated notification | ✓ declined answer retained; current trip and banner agree; no repeated notification |
| Y4 | No route from OpenStreetMap: the straight line × 1.3, marked as an estimate; "Werk" is not an address: no cost, the next goal is still shown | ✓ estimate 57.5 km (straight line × 1.3) | ✓ estimate 57.5 km (straight line × 1.3) | ✓ estimate 57.5 km (straight line × 1.3) |

## Y2. Preconditioning before a departure

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| Y20 | Preconditioning (#44): off by default; the car's button is offered; only a switch or button can be chosen | ✓ offered: button.test_car_start_air_conditioner | ✓ offered: button.test_car_start_air_conditioner | ✓ offered: switch.enyaq_charging, switch.enyaq_battery_care_mode, button.test_car_start_air_conditioner |
| Y21 | Preconditioning (#44): a trip with "precondition: ja" in 10 minutes gets one press of the car's button (15 minutes before); a trip without it gets none; it shows in Looking ahead; the car does not need to be plugged in | ✓ one press for "precondition: ja", none without | ✓ one press for "precondition: ja", none without | ✓ one press for "precondition: ja", none without |
| Y22 | Preconditioning on the way back (#44): no event for the drive home and the setting on: one press 15 minutes before the event ends; a trip home in the calendar without "precondition" wins over the setting | ✓ way back: one press; a trip home without "precondition": none | ✓ way back: one press; a trip home without "precondition": none | ✓ way back: one press; a trip home without "precondition": none |
| Y23 | Preconditioning for the weekly schedule and a one-off departure (#45): the day's tick gives one press 15 minutes before; without the tick none; a one-off departure with its tick too | ✓ schedule wed 10:29: one press with the tick, none without; one-off: one press | ✓ schedule wed 10:29: one press with the tick, none without; one-off: one press | ✓ schedule wed 10:29: one press with the tick, none without; one-off: one press |

## Z. Apple iCloud calendar (read only)

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| Z1 | An iCloud calendar is read: "doel: 90" becomes the departure; it is marked read only and adding trips to it is refused with a clear reason | ✓ departure from iCloud: 90% · adding refused | ✓ departure from iCloud: 90% · adding refused | ✓ departure from iCloud: 90% · adding refused |

## U. Add trip (writes to the calendar)

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| U1 | One car: no car to choose (the trip is for that car), the event is "To <destination>" with the destination as location, "target: 90 precondition: yes" (English: Home Assistant has no Dutch language here) and lasts until "Back home at" | ✓ To Stationsplein 1, 3511 ED Utrecht · target: 90 precondition: yes | ✓ To Stationsplein 1, 3511 ED Utrecht · target: 90 precondition: yes | ✓ To Stationsplein 1, 3511 ED Utrecht · target: 90 precondition: yes |
| U2 | Added: written to the calendar once, and right away the departure on Plan and the next stop in Looking ahead, with the trip there and back (75 km by road each way) and back home at 17:30 | ✓ next stop To Stationsplein 1, 3511 ED Utrecht · 75 km → 57.1% there and back · back 32.9% | ✓ next stop To Stationsplein 1, 3511 ED Utrecht · 75 km → 46.4% there and back · back 43.6% | ✓ next stop To Stationsplein 1, 3511 ED Utrecht · 75 km → 38.6% there and back · back 51.4% |
| U3 | Added twice: the second time nothing is added (already in the calendar); the Plan tab lists the trip with its cost | ✓ | ✓ | ✓ |
| U3b | Changing the trip language skips existing English and old Dutch events in preview and writes | ✓ English ↔ Dutch, and upgrade to auto: zero extra calendar writes | ✓ English ↔ Dutch, and upgrade to auto: zero extra calendar writes | ✓ English ↔ Dutch, and upgrade to auto: zero extra calendar writes |
| U4 | Calendar read by keyword ("EV"): a trip added by the app (with "doel: 90") still counts | ✓ | ✓ | ✓ |
| U5 | Calendar not used for departures: Add trip is refused (the trip would never count), nothing written | ✓ | ✓ | ✓ |
| U5b | Refresh on Home fetches the calendar again first: a trip added in Google Calendar shows up right away; the background refresh does not | ✓ update_entity calendar.auto → departure Naar Gent | ✓ update_entity calendar.auto → departure Naar Gent | ✓ update_entity calendar.auto → departure Naar Gent |
| U6 | More cars: a trip for the EV6 gets "car: EV6" and only counts for the EV6; "Every car" gets no car and counts for both | ✓ car1: To Utrecht · EV6: To Stationsplein 1, 3511 ED Utrecht, To Utrecht | ✓ car1: To Utrecht · EV6: To Stationsplein 1, 3511 ED Utrecht, To Utrecht | ✓ car1: To Utrecht · EV6: To Stationsplein 1, 3511 ED Utrecht, To Utrecht |

## X. More than one charger

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Kia Niro EV (Kia Uvo) + Zaptec Go | 3: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|---|
| X1 | Off by default: one charger as before; adding a second charger is refused | ✓ one charger: Laadpaal (charger1) | – (not for this set-up) | – (not for this set-up) |
| X2 | Turned on: the Garage charger is added with its usual car (EV6); the first charger keeps its settings | ✓ Laadpaal (charger1) → car1, Garage (charger2) → car2 | – (not for this set-up) | – (not for this set-up) |
| X3 | Each charger has its own plan: Laadpaal for the first car, Garage for the EV6 (both plugged in) | ✓ JLZ03X: 22.9 kWh · EV6: 42.4 kWh | – (not for this set-up) | – (not for this set-up) |
| X4 | Both must charge now (below the minimum), main fuse 25 A: the EV6 (least room to spare) gets 16 A, the other the rest (6 A) | ✓ available 22.8 A: Garage (EV6) 16 A, Laadpaal 6 A | – (not for this set-up) | – (not for this set-up) |
| X5 | The house uses more (4.6 kW): too little left for the second car: it waits, the EV6 keeps charging | ✓ Laadpaal: Waiting: the connection is in use, EV6 goes first | – (not for this set-up) | – (not for this set-up) |
| X5a | Charge now goes first, also while that car is below its minimum: the Laadpaal moves before the EV6, and back after Charge now ends (#35) | ✓ EV6 first → Laadpaal first (Charge now, below minimum) → EV6 first | – (not for this set-up) | – (not for this set-up) |
| X5b | Both grid signs pause the first charger below minimum, even just after a manual start | ✓ 0/4/5 A pause; 6 A limit; import/export-positive meters | – (not for this set-up) | – (not for this set-up) |
| X5c | The first start/stop-only charger pauses when 10 A cannot fit its 16 A request | ✓ | – (not for this set-up) | – (not for this set-up) |
| X5d | Per phase (#29): two one-phase chargers on different phases both charge; same phase: the second waits; unknown phase: room kept on every phase; no fresh meter: one charger at 6 A | ✓ different phases: both 16 A · same phase: Laadpaal waits · unknown phase: limited by L2 · stale meter: one charger at 6 A | – (not for this set-up) | – (not for this set-up) |
| X5e | Load balancer for one charger only (#29): the app still shares the connection for the other charger | ✓ Laadpaal: Waiting: not enough connection capacity for this charger | – (not for this set-up) | – (not for this set-up) |
| X6 | Only the EV6 is home, at the Laadpaal (Garage empty): the Laadpaal plans for the EV6, the Garage for the other car | ✓ Laadpaal → EV6 · Garage → JLZ03X | – (not for this set-up) | – (not for this set-up) |
| X7 | Sensors and messages say which charger: sensor.smart_charging_garage_status; the first charger keeps its names | ✓ | – (not for this set-up) | – (not for this set-up) |
| X8 | Turned off: the first charger only, as before; the Garage stays saved | ✓ back to one charger | – (not for this set-up) | – (not for this set-up) |

## Not covered by these tests

- House load, learned charging power and Savings: they need long-term statistics, which the fake Home Assistant does not have.
- The real cars, chargers and inverters: response time of the car's cloud (Renault, MySkoda), the charger and the solar forecast. The fake reacts immediately.
- Car integrations without a test car (for example BMW, which left Home Assistant in 2025 and now has several community integrations). And the cars that are tested: only with their entity names from the source code, not with a real car.
- Phase switching on a real charger: some chargers pause the session while switching.
- Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.
- Look ahead with the real OpenStreetMap: the test uses a fake address search and route; real addresses can be found differently or not at all.
- Charging stops with the real Open Charge Map: the test uses fake stations; real station data can be incomplete, out of date or use other operator names.
- Two real chargers on one connection: the test checks the decisions, not how fast real chargers follow a lower current.
- Adding trips to a real calendar (Google, Local calendar, CalDAV): the fake calendar shows a new event right away; a real one can take a moment.
- The page itself (buttons, forms): checked with screenshots during development, not in this test.

# Unit tests

Each file runs on its own without Home Assistant: `node tests/<name>.test.js`.

| File | What | Passed |
|---|---|---|
| [batteryguard.test.js](#batteryguard) | Battery live bounds, original-setting snapshots, native reserves and site EV policies | 10 of 10 ✓ |
| [batterysafety.test.js](#batterysafety) | Real app: exact battery restoration, failure/restart recovery, fresh SoC guards and secondary charger protection | 9 of 9 ✓ |
| [diagnostics.test.js](#diagnostics) | Public diagnostic allowlist, consistent pseudonyms and reviewed-download behavior | 5 of 5 ✓ |
| [releaseguard.test.js](#releaseguard) | Release safeguards: DST delivery intervals, missing prices, live current caps, durable control ownership and per-car session estimates | 21 of 21 ✓ |
| [recovery.test.js](#recovery) | Real app failure and restart checks against fake HA: phase/current command order, zero limits, SoC after travel, battery release | 7 of 7 ✓ |
| [brands.test.js](#brands) | Chargers per brand: detection, start/stop, current, phase switching, status texts | 351 of 351 ✓ |
| [cars.test.js](#cars) | Cars per integration (Tesla ×3, Renault, Hyundai/Kia, Skoda, Volkswagen ID, Volvo, Polestar, Mercedes): which battery level, range, plug, charging and charge limit sensors the app picks, with their real entity names | 50 of 50 ✓ |
| [solar.test.js](#solar) | Inverters, solar forecasts, the value of own solar power, charging on surplus | 53 of 53 ✓ |
| [battery.test.js](#battery) | Home batteries: detection, commands, the guard, the battery plan | 84 of 84 ✓ |
| [forecast.test.js](#forecast) | Price forecast: reading it and planning with it | 74 of 74 ✓ |
| [reliability.test.js](#reliability) | Ready Guard: is the car ready in time, and what happens when it is not | 23 of 23 ✓ |
| [chargestate.test.js](#chargestate) | The charging status on Home: which state and colour (ready green, charging red, waiting yellow, problems orange) | 16 of 16 ✓ |
| [carplace.test.js](#carplace) | Where the car is when not plugged in: car location, then a person, then a trip home in the calendar, else not known (#46) | 7 of 7 ✓ |
| [notify.test.js](#notify) | Notifications: a message that reached no phone is tried again | 4 of 4 ✓ |
| [activecar.test.js](#activecar) | More than one car: connected car; calendar tags, trip language and duplicate prevention | 18 of 18 ✓ |
| [sharing.test.js](#sharing) | More than one charger: who charges first and how the connection is shared | 28 of 28 ✓ |
| [tripcost.test.js](#tripcost) | Look ahead: which calendar locations are addresses, the use per km, learning from trips | 10 of 10 ✓ |
| [pricebasis.test.js](#pricebasis) | Price basis: how one price is built (fee, tax, VAT, margin), an all-in forecast is not taxed again (#26) | 4 of 4 ✓ |
| [routing.test.js](#routing) | Trip distances and privacy: what is sent where for each choice, offline distances, the choice in settings and imports (#31) | 11 of 11 ✓ |
| [chargestops.test.js](#chargestops) | Charging stops on the way: the route line, which stations count (country, power, connector, detour, reach), preferred operators, what is sent to Open Charge Map (#37); all of Europe, routes across a border and more stops on a long trip (#40) | 17 of 17 ✓ |
| [persistence.test.js](#persistence) | Saving settings safely (a crash while saving loses nothing) | 1 of 1 ✓ |
| [precondition.test.js](#precondition) | Preconditioning before a departure: which drives (calendar first, then the way-back setting), when, one press and one retry, nothing with Allow control off, restart, turning a switch off again (#44) | 13 of 13 ✓ |
| [compat.test.js](#compat) | Compatibility matrix: COMPATIBILITY.md matches the fixtures and the physical test status; read-only devices are marked (#28) | 4 of 4 ✓ |
| [docs.test.js](#docs) | Documentation keeps up: README and RELEASE candidate match the version, every issue since the stable version is listed as implemented on dev | 6 of 6 ✓ |

## batteryguard

Battery live bounds, original-setting snapshots, native reserves and site EV policies.

<details><summary>10 of 10 passed – show every check</summary>

| Check | Result |
|---|---|
| charging is stopped at/near the live maximum, including measured auto charging | ✓ |
| discharging is stopped at the reserve, but charging can recover from below it | ✓ |
| old, missing, invalid and out-of-range SoC never authorize charging | ✓ |
| unsupported stop capabilities block control instead of pretending to enforce limits | ✓ |
| huawei_solar restores non-default limits/mode and zero reserve after a serialized restart | ✓ |
| victron restores non-default limits/mode and zero reserve after a serialized restart | ✓ |
| teslemetry restores non-default limits/mode and zero reserve after a serialized restart | ✓ |
| snapshot refuses unavailable settings and never invents a maximum for legacy recovery | ✓ |
| native reserve is never lowered below the original; a stronger EV reserve wins | ✓ |
| every charger participates in never/solar-only/range/always policies | ✓ |

</details>

## batterysafety

Real app: exact battery restoration, failure/restart recovery, fresh SoC guards and secondary charger protection.

<details><summary>9 of 9 passed – show every check</summary>

| Check | Result |
|---|---|
| huawei_solar restores exact non-default settings after restart | ✓ |
| victron restores exact non-default settings after restart | ✓ |
| teslemetry restores exact non-default settings after restart | ✓ |
| a failed restore retains its snapshot and succeeds on the next control step | ✓ |
| a native reserve is kept while enabled and restored to its original zero on release | ✓ |
| live upper/lower bounds stop unsafe manual and ongoing charge actions | ✓ |
| stale SoC blocks charging and holds instead; recovery waits for actual reported settings | ✓ |
| legacy ownership without originals needs explicit manual recovery, with no guessed writes | ✓ |
| site battery protection sees secondary and externally started charging, with both EV plans | ✓ |

</details>

## diagnostics

Public diagnostic allowlist, consistent pseudonyms and reviewed-download behavior.

<details><summary>5 of 5 passed – show every check</summary>

| Check | Result |
|---|---|
| public diagnostics omit personal text across every exported branch | ✓ |
| unknown schema keys and identity maps fail closed | ✓ |
| identifier prefixes cannot retain a personal namespace | ✓ |
| the diagnostic UI previews the same document before a separate download action | ✓ |
| preview and reviewed download use identical data | ✓ |

</details>

## releaseguard

Release safeguards: DST delivery intervals, missing prices, live current caps, durable control ownership and per-car session estimates.

<details><summary>21 of 21 passed – show every check</summary>

| Check | Result |
|---|---|
| release metadata matches both package version fields and the branch identity | ✓ |
| partial price warnings render once without claiming a total load failure | ✓ |
| SoC color follows the absolute level: empty red, middle yellow, full green | ✓ |
| confirmed calendar events survive restart but remain scoped and expire | ✓ |
| successful reschedules and cancellations replace the confirmed calendar immediately | ✓ |
| an offset-free repeated DST hour is rejected with an actionable warning | ✓ |
| both offset-tagged repeated hours remain distinct delivery intervals | ✓ |
| a nonexistent spring clock hour is rejected, an ordinary local time is retained | ✓ |
| price coverage uses 23 actual hours on 2026-03-29 | ✓ |
| price coverage uses 25 actual hours on 2026-10-25 | ✓ |
| missing price values do not become free slots; zero and negative prices remain valid | ✓ |
| zero current remains zero planning power | ✓ |
| a 0 A cap blocks boost, minimum, preheat and Ready Guard | ✓ |
| a 4 A cap blocks boost, minimum, preheat and Ready Guard | ✓ |
| a 5 A cap blocks boost, minimum, preheat and Ready Guard | ✓ |
| an old locked charging period cannot exceed a lower live cap | ✓ |
| device ownership survives a module reload and is isolated by charger and device | ✓ |
| stale estimates only use energy from the same car, charger and observed session | ✓ |
| a car change without a cable transition creates a new charging session | ✓ |
| a restart cannot assume cable continuity for stale SoC | ✓ |
| Ready Guard never confirms Ready now from an estimated battery level | ✓ |

</details>

## recovery

Real app failure and restart checks against fake HA: phase/current command order, zero limits, SoC after travel, battery release.

<details><summary>7 of 7 passed – show every check</summary>

| Check | Result |
|---|---|
| a failed phase change never enables charging or sends a one-phase current | ✓ |
| a failed current limit keeps the charger paused and is retried on the next step | ✓ |
| a live zero or 4 A limit blocks Charge now as well as the plan | ✓ |
| restart restores app-owned one-phase/current settings after solar is disabled | ✓ |
| a pre-trip SoC is not reused after unplugging and reconnecting | ✓ |
| a partial battery failure is retried without waiting for the normal refresh timeout | ✓ |
| a held home battery is released after restart with planning disabled | ✓ |

</details>

## brands

Chargers per brand: detection, start/stop, current, phase switching, status texts.

<details><summary>351 of 351 passed – show every check</summary>

| Part | Check | Result |
|---|---|---|
| Easee | detected as charger | ✓ |
|  | status sensor sensor.eh123456_status | ✓ |
|  | power sensor sensor.eh123456_power | ✓ |
|  | start/stop method switch | ✓ |
|  | uses switch.eh123456_charger_enabled | ✓ |
|  | no own_smart_charging_on | ✓ |
|  | start/stop commands allowed | ✓ |
|  | solar current: action_current:set_charger_dynamic_limit | ✓ |
|  | current command 10 A allowed | ✓ |
|  | phase switching: action_phase:1_phase/3_phase | ✓ |
|  | phase commands allowed | ✓ |
|  | status "awaiting_start" → plugged true, charging false | ✓ |
|  | status "awaiting_start" + car sensor on → plugged true | ✓ |
|  | status "awaiting_start" + car sensor off → plugged true | ✓ |
|  | status "charging" → plugged true, charging true | ✓ |
|  | status "charging" + car sensor on → plugged true | ✓ |
|  | status "charging" + car sensor off → plugged true | ✓ |
|  | status "disconnected" → plugged false, charging null | ✓ |
|  | status "disconnected" + car sensor on → plugged true | ✓ |
|  | status "disconnected" + car sensor off → plugged false | ✓ |
|  | status "completed" → plugged true, charging false | ✓ |
|  | status "completed" + car sensor on → plugged true | ✓ |
|  | status "completed" + car sensor off → plugged true | ✓ |
|  | status "ready_to_charge" → plugged true, charging false | ✓ |
|  | status "ready_to_charge" + car sensor on → plugged true | ✓ |
|  | status "ready_to_charge" + car sensor off → plugged true | ✓ |
|  | status "awaiting_authorization" → plugged true, charging false | ✓ |
|  | status "awaiting_authorization" + car sensor on → plugged true | ✓ |
|  | status "awaiting_authorization" + car sensor off → plugged true | ✓ |
|  | status "de_authorizing" → plugged true, charging null | ✓ |
|  | status "de_authorizing" + car sensor on → plugged true | ✓ |
|  | status "de_authorizing" + car sensor off → plugged true | ✓ |
|  | status "start_charging" → plugged true, charging null | ✓ |
|  | status "start_charging" + car sensor on → plugged true | ✓ |
|  | status "start_charging" + car sensor off → plugged true | ✓ |
|  | status "stop_charging" → plugged true, charging null | ✓ |
|  | status "stop_charging" + car sensor on → plugged true | ✓ |
|  | status "stop_charging" + car sensor off → plugged true | ✓ |
|  | status "awaiting_load_balancing" → plugged true, charging false | ✓ |
|  | status "awaiting_load_balancing" + car sensor on → plugged true | ✓ |
|  | status "awaiting_load_balancing" + car sensor off → plugged true | ✓ |
|  | status "awaiting_smart_start" → plugged true, charging false | ✓ |
|  | status "awaiting_smart_start" + car sensor on → plugged true | ✓ |
|  | status "awaiting_smart_start" + car sensor off → plugged true | ✓ |
|  | status "error" → a charger problem, not "plugged in" | ✓ |
|  | status "offline" → a charger problem, not "plugged in" | ✓ |
| Zaptec | detected as charger | ✓ |
|  | status sensor sensor.zaptec_go_charger_mode | ✓ |
|  | power sensor sensor.zaptec_go_charge_power | ✓ |
|  | start/stop method buttons | ✓ |
|  | start/stop commands allowed | ✓ |
|  | solar current: number:number.zaptec_go_charger_max_current | ✓ |
|  | current command 10 A allowed | ✓ |
|  | phase switching: not possible | ✓ |
|  | status "disconnected" → plugged false, charging null | ✓ |
|  | status "disconnected" + car sensor on → plugged true | ✓ |
|  | status "disconnected" + car sensor off → plugged false | ✓ |
|  | status "connected_requesting" → plugged true, charging false | ✓ |
|  | status "connected_requesting" + car sensor on → plugged true | ✓ |
|  | status "connected_requesting" + car sensor off → plugged true | ✓ |
|  | status "connected_charging" → plugged true, charging true | ✓ |
|  | status "connected_charging" + car sensor on → plugged true | ✓ |
|  | status "connected_charging" + car sensor off → plugged true | ✓ |
|  | status "connected_finished" → plugged true, charging false | ✓ |
|  | status "connected_finished" + car sensor on → plugged true | ✓ |
|  | status "connected_finished" + car sensor off → plugged true | ✓ |
|  | status "unknown" → a charger problem, not "plugged in" | ✓ |
| Alfen | detected as charger | ✓ |
|  | status sensor sensor.alfen_eve_status_code_socket_1 | ✓ |
|  | power sensor sensor.alfen_eve_active_power_total_socket_1 | ✓ |
|  | start/stop method switch | ✓ |
|  | warns own_mode_on | ✓ |
|  | warns alfen_single_login | ✓ |
|  | start/stop commands allowed | ✓ |
|  | solar current: number:number.alfen_eve_power_connector_max_current_socket_1 | ✓ |
|  | current command 10 A allowed | ✓ |
|  | phase switching: not possible | ✓ |
|  | status "Available" → plugged false, charging null | ✓ |
|  | status "Available" + car sensor on → plugged true | ✓ |
|  | status "Available" + car sensor off → plugged false | ✓ |
|  | status "Authorizing" → plugged true, charging null | ✓ |
|  | status "Authorizing" + car sensor on → plugged true | ✓ |
|  | status "Authorizing" + car sensor off → plugged true | ✓ |
|  | status "Authorized" → plugged true, charging null | ✓ |
|  | status "Authorized" + car sensor on → plugged true | ✓ |
|  | status "Authorized" + car sensor off → plugged true | ✓ |
|  | status "Cable connected" → plugged true, charging null | ✓ |
|  | status "Cable connected" + car sensor on → plugged true | ✓ |
|  | status "Cable connected" + car sensor off → plugged true | ✓ |
|  | status "EV Connected" → plugged true, charging null | ✓ |
|  | status "EV Connected" + car sensor on → plugged true | ✓ |
|  | status "EV Connected" + car sensor off → plugged true | ✓ |
|  | status "Preparing Charging" → plugged true, charging null | ✓ |
|  | status "Preparing Charging" + car sensor on → plugged true | ✓ |
|  | status "Preparing Charging" + car sensor off → plugged true | ✓ |
|  | status "Wait Vehicle Charging" → plugged true, charging false | ✓ |
|  | status "Wait Vehicle Charging" + car sensor on → plugged true | ✓ |
|  | status "Wait Vehicle Charging" + car sensor off → plugged true | ✓ |
|  | status "Charging Normal" → plugged true, charging true | ✓ |
|  | status "Charging Normal" + car sensor on → plugged true | ✓ |
|  | status "Charging Normal" + car sensor off → plugged true | ✓ |
|  | status "Charging Simplified" → plugged true, charging true | ✓ |
|  | status "Charging Simplified" + car sensor on → plugged true | ✓ |
|  | status "Charging Simplified" + car sensor off → plugged true | ✓ |
|  | status "Suspended Over-Current" → plugged true, charging false | ✓ |
|  | status "Suspended Over-Current" + car sensor on → plugged true | ✓ |
|  | status "Suspended Over-Current" + car sensor off → plugged true | ✓ |
|  | status "Suspended Over Current" → plugged true, charging false | ✓ |
|  | status "Suspended Over Current" + car sensor on → plugged true | ✓ |
|  | status "Suspended Over Current" + car sensor off → plugged true | ✓ |
|  | status "Suspended HF Switching" → plugged true, charging false | ✓ |
|  | status "Suspended HF Switching" + car sensor on → plugged true | ✓ |
|  | status "Suspended HF Switching" + car sensor off → plugged true | ✓ |
|  | status "Finish Wait Vehicle" → plugged true, charging false | ✓ |
|  | status "Finish Wait Vehicle" + car sensor on → plugged true | ✓ |
|  | status "Finish Wait Vehicle" + car sensor off → plugged true | ✓ |
|  | status "Finish Wait Disconnect" → plugged true, charging false | ✓ |
|  | status "Finish Wait Disconnect" + car sensor on → plugged true | ✓ |
|  | status "Finish Wait Disconnect" + car sensor off → plugged true | ✓ |
|  | status "Reserved" → plugged false, charging null | ✓ |
|  | status "Reserved" + car sensor on → plugged true | ✓ |
|  | status "Reserved" + car sensor off → plugged false | ✓ |
|  | status "Load Balancing Limited" → plugged true, charging null | ✓ |
|  | status "Load Balancing Limited" + car sensor on → plugged true | ✓ |
|  | status "Load Balancing Limited" + car sensor off → plugged true | ✓ |
|  | status "Load Balancing Forced Off" → plugged true, charging null | ✓ |
|  | status "Load Balancing Forced Off" + car sensor on → plugged true | ✓ |
|  | status "Load Balancing Forced Off" + car sensor off → plugged true | ✓ |
|  | status "Not Charging" → plugged true, charging false | ✓ |
|  | status "Not Charging" + car sensor on → plugged true | ✓ |
|  | status "Not Charging" + car sensor off → plugged true | ✓ |
|  | status "Solar Charging Wait" → plugged true, charging false | ✓ |
|  | status "Solar Charging Wait" + car sensor on → plugged true | ✓ |
|  | status "Solar Charging Wait" + car sensor off → plugged true | ✓ |
|  | status "Charging Non Charging" → plugged true, charging false | ✓ |
|  | status "Charging Non Charging" + car sensor on → plugged true | ✓ |
|  | status "Charging Non Charging" + car sensor off → plugged true | ✓ |
|  | status "Solar Charging" → plugged true, charging true | ✓ |
|  | status "Solar Charging" + car sensor on → plugged true | ✓ |
|  | status "Solar Charging" + car sensor off → plugged true | ✓ |
|  | status "Partial Solar Charging" → plugged true, charging true | ✓ |
|  | status "Partial Solar Charging" + car sensor on → plugged true | ✓ |
|  | status "Partial Solar Charging" + car sensor off → plugged true | ✓ |
|  | status "Charge Point Ready, Waiting For Power" → plugged true, charging false | ✓ |
|  | status "Charge Point Ready, Waiting For Power" + car sensor on → plugged true | ✓ |
|  | status "Charge Point Ready, Waiting For Power" + car sensor off → plugged true | ✓ |
|  | status "Unknown" → a charger problem, not "plugged in" | ✓ |
|  | status "Off" → a charger problem, not "plugged in" | ✓ |
|  | status "Booting" → a charger problem, not "plugged in" | ✓ |
|  | status "Check Mains" → a charger problem, not "plugged in" | ✓ |
|  | status "Error Protective Earth" → a charger problem, not "plugged in" | ✓ |
|  | status "Error Contactor Fault" → a charger problem, not "plugged in" | ✓ |
|  | status "Error Illegal CP Value" → a charger problem, not "plugged in" | ✓ |
|  | status "Error Message Time-Out" → a charger problem, not "plugged in" | ✓ |
|  | status "Error" → a charger problem, not "plugged in" | ✓ |
|  | status "In Operative" → a charger problem, not "plugged in" | ✓ |
| Wallbox | detected as charger | ✓ |
|  | status sensor sensor.wallbox_pulsar_plus_status_description | ✓ |
|  | power sensor sensor.wallbox_pulsar_plus_charging_power | ✓ |
|  | start/stop method switch | ✓ |
|  | warns own_mode_on | ✓ |
|  | start/stop commands allowed | ✓ |
|  | solar current: number:number.wallbox_pulsar_plus_maximum_charging_current | ✓ |
|  | current command 10 A allowed | ✓ |
|  | phase switching: not possible | ✓ |
|  | status "Charging" → plugged true, charging true | ✓ |
|  | status "Charging" + car sensor on → plugged true | ✓ |
|  | status "Charging" + car sensor off → plugged true | ✓ |
|  | status "Discharging" → plugged true, charging null | ✓ |
|  | status "Discharging" + car sensor on → plugged true | ✓ |
|  | status "Discharging" + car sensor off → plugged true | ✓ |
|  | status "Paused" → plugged true, charging false | ✓ |
|  | status "Paused" + car sensor on → plugged true | ✓ |
|  | status "Paused" + car sensor off → plugged true | ✓ |
|  | status "Scheduled" → plugged true, charging null | ✓ |
|  | status "Scheduled" + car sensor on → plugged true | ✓ |
|  | status "Scheduled" + car sensor off → plugged true | ✓ |
|  | status "Ready" → plugged false, charging null | ✓ |
|  | status "Ready" + car sensor on → plugged true | ✓ |
|  | status "Ready" + car sensor off → plugged false | ✓ |
|  | status "Disconnected" → plugged false, charging null | ✓ |
|  | status "Disconnected" + car sensor on → plugged true | ✓ |
|  | status "Disconnected" + car sensor off → plugged false | ✓ |
|  | status "Waiting for car demand" → plugged true, charging false | ✓ |
|  | status "Waiting for car demand" + car sensor on → plugged true | ✓ |
|  | status "Waiting for car demand" + car sensor off → plugged true | ✓ |
|  | status "Waiting" → plugged true, charging false | ✓ |
|  | status "Waiting" + car sensor on → plugged true | ✓ |
|  | status "Waiting" + car sensor off → plugged true | ✓ |
|  | status "Locked" → plugged false, charging null | ✓ |
|  | status "Locked" + car sensor on → plugged true | ✓ |
|  | status "Locked" + car sensor off → plugged false | ✓ |
|  | status "Locked, car connected" → plugged true, charging null | ✓ |
|  | status "Locked, car connected" + car sensor on → plugged true | ✓ |
|  | status "Locked, car connected" + car sensor off → plugged true | ✓ |
|  | status "Waiting in queue by Power Sharing" → plugged true, charging false | ✓ |
|  | status "Waiting in queue by Power Sharing" + car sensor on → plugged true | ✓ |
|  | status "Waiting in queue by Power Sharing" + car sensor off → plugged true | ✓ |
|  | status "Waiting in queue by Power Boost" → plugged true, charging false | ✓ |
|  | status "Waiting in queue by Power Boost" + car sensor on → plugged true | ✓ |
|  | status "Waiting in queue by Power Boost" + car sensor off → plugged true | ✓ |
|  | status "Waiting MID failed" → plugged true, charging false | ✓ |
|  | status "Waiting MID failed" + car sensor on → plugged true | ✓ |
|  | status "Waiting MID failed" + car sensor off → plugged true | ✓ |
|  | status "Waiting MID safety margin exceeded" → plugged true, charging false | ✓ |
|  | status "Waiting MID safety margin exceeded" + car sensor on → plugged true | ✓ |
|  | status "Waiting MID safety margin exceeded" + car sensor off → plugged true | ✓ |
|  | status "Waiting in queue by Eco-Smart" → plugged true, charging false | ✓ |
|  | status "Waiting in queue by Eco-Smart" + car sensor on → plugged true | ✓ |
|  | status "Waiting in queue by Eco-Smart" + car sensor off → plugged true | ✓ |
|  | status "Error" → a charger problem, not "plugged in" | ✓ |
|  | status "Updating" → a charger problem, not "plugged in" | ✓ |
|  | status "Unknown" → a charger problem, not "plugged in" | ✓ |
| go-e (marq24) | detected as charger | ✓ |
|  | status sensor sensor.goe_123456_car_value | ✓ |
|  | power sensor sensor.goe_123456_nrg_11 | ✓ |
|  | start/stop method select | ✓ |
|  | start = 2 | ✓ |
|  | stop = 1 | ✓ |
|  | start/stop commands allowed | ✓ |
|  | solar current: number:number.goe_123456_amp | ✓ |
|  | current command 10 A allowed | ✓ |
|  | phase switching: select_phase:1/2 | ✓ |
|  | phase commands allowed | ✓ |
|  | status "Idle" → plugged false, charging null | ✓ |
|  | status "Idle" + car sensor on → plugged true | ✓ |
|  | status "Idle" + car sensor off → plugged false | ✓ |
|  | status "Charging" → plugged true, charging true | ✓ |
|  | status "Charging" + car sensor on → plugged true | ✓ |
|  | status "Charging" + car sensor off → plugged true | ✓ |
|  | status "Wait for car" → plugged true, charging false | ✓ |
|  | status "Wait for car" + car sensor on → plugged true | ✓ |
|  | status "Wait for car" + car sensor off → plugged true | ✓ |
|  | status "Complete" → plugged true, charging false | ✓ |
|  | status "Complete" + car sensor on → plugged true | ✓ |
|  | status "Complete" + car sensor off → plugged true | ✓ |
|  | status "Unknown/Error" → a charger problem, not "plugged in" | ✓ |
|  | status "Error" → a charger problem, not "plugged in" | ✓ |
| go-e (cathiele) | detected as charger | ✓ |
|  | status sensor sensor.goecharger_home_car_status | ✓ |
|  | start/stop method switch | ✓ |
|  | start/stop commands allowed | ✓ |
|  | solar current: not possible | ✓ |
|  | phase switching: not possible | ✓ |
|  | status "Charger ready, no vehicle" → plugged false, charging null | ✓ |
|  | status "Charger ready, no vehicle" + car sensor on → plugged true | ✓ |
|  | status "Charger ready, no vehicle" + car sensor off → plugged false | ✓ |
|  | status "charging" → plugged true, charging true | ✓ |
|  | status "charging" + car sensor on → plugged true | ✓ |
|  | status "charging" + car sensor off → plugged true | ✓ |
|  | status "Waiting for vehicle" → plugged true, charging false | ✓ |
|  | status "Waiting for vehicle" + car sensor on → plugged true | ✓ |
|  | status "Waiting for vehicle" + car sensor off → plugged true | ✓ |
|  | status "charging finished, vehicle still connected" → plugged true, charging false | ✓ |
|  | status "charging finished, vehicle still connected" + car sensor on → plugged true | ✓ |
|  | status "charging finished, vehicle still connected" + car sensor off → plugged true | ✓ |
| Peblar | detected as charger | ✓ |
|  | status sensor sensor.peblar_ev_charger_state | ✓ |
|  | power sensor sensor.peblar_ev_charger_power | ✓ |
|  | start/stop method switch | ✓ |
|  | uses switch.peblar_ev_charger_charge | ✓ |
|  | no own_mode_on | ✓ |
|  | start/stop commands allowed | ✓ |
|  | solar current: number:number.peblar_ev_charger_charge_limit | ✓ |
|  | current command 10 A allowed | ✓ |
|  | phase switching: switch_phase:on/off | ✓ |
|  | phase commands allowed | ✓ |
|  | status "no_ev_connected" → plugged false, charging null | ✓ |
|  | status "no_ev_connected" + car sensor on → plugged true | ✓ |
|  | status "no_ev_connected" + car sensor off → plugged false | ✓ |
|  | status "charging" → plugged true, charging true | ✓ |
|  | status "charging" + car sensor on → plugged true | ✓ |
|  | status "charging" + car sensor off → plugged true | ✓ |
|  | status "suspended" → plugged true, charging false | ✓ |
|  | status "suspended" + car sensor on → plugged true | ✓ |
|  | status "suspended" + car sensor off → plugged true | ✓ |
|  | status "error" → a charger problem, not "plugged in" | ✓ |
|  | status "fault" → a charger problem, not "plugged in" | ✓ |
|  | status "invalid" → a charger problem, not "plugged in" | ✓ |
| OCPP | detected as charger | ✓ |
|  | status sensor sensor.charger_status_connector | ✓ |
|  | power sensor sensor.charger_power_active_import | ✓ |
|  | start/stop method switch | ✓ |
|  | uses switch.charger_charge_control | ✓ |
|  | warns ocpp_backend | ✓ |
|  | start/stop commands allowed | ✓ |
|  | solar current: number:number.charger_maximum_current | ✓ |
|  | current command 10 A allowed | ✓ |
|  | phase switching: not possible | ✓ |
|  | status "Available" → plugged false, charging null | ✓ |
|  | status "Available" + car sensor on → plugged true | ✓ |
|  | status "Available" + car sensor off → plugged false | ✓ |
|  | status "Preparing" → plugged true, charging false | ✓ |
|  | status "Preparing" + car sensor on → plugged true | ✓ |
|  | status "Preparing" + car sensor off → plugged true | ✓ |
|  | status "Charging" → plugged true, charging true | ✓ |
|  | status "Charging" + car sensor on → plugged true | ✓ |
|  | status "Charging" + car sensor off → plugged true | ✓ |
|  | status "SuspendedEV" → plugged true, charging false | ✓ |
|  | status "SuspendedEV" + car sensor on → plugged true | ✓ |
|  | status "SuspendedEV" + car sensor off → plugged true | ✓ |
|  | status "SuspendedEVSE" → plugged true, charging false | ✓ |
|  | status "SuspendedEVSE" + car sensor on → plugged true | ✓ |
|  | status "SuspendedEVSE" + car sensor off → plugged true | ✓ |
|  | status "Finishing" → plugged true, charging false | ✓ |
|  | status "Finishing" + car sensor on → plugged true | ✓ |
|  | status "Finishing" + car sensor off → plugged true | ✓ |
|  | status "Reserved" → plugged false, charging null | ✓ |
|  | status "Reserved" + car sensor on → plugged true | ✓ |
|  | status "Reserved" + car sensor off → plugged false | ✓ |
|  | status "Faulted" → a charger problem, not "plugged in" | ✓ |
|  | status "Unavailable" → a charger problem, not "plugged in" | ✓ |
| Ohme | detected as charger | ✓ |
|  | status sensor sensor.ohme_home_pro_status | ✓ |
|  | power sensor sensor.ohme_home_pro_power | ✓ |
|  | start/stop method select | ✓ |
|  | start = max_charge | ✓ |
|  | stop = paused | ✓ |
|  | warns own_mode_on | ✓ |
|  | start/stop commands allowed | ✓ |
|  | solar current: not possible | ✓ |
|  | phase switching: not possible | ✓ |
|  | status "unplugged" → plugged false, charging null | ✓ |
|  | status "unplugged" + car sensor on → plugged true | ✓ |
|  | status "unplugged" + car sensor off → plugged false | ✓ |
|  | status "plugged_in" → plugged true, charging false | ✓ |
|  | status "plugged_in" + car sensor on → plugged true | ✓ |
|  | status "plugged_in" + car sensor off → plugged true | ✓ |
|  | status "charging" → plugged true, charging true | ✓ |
|  | status "charging" + car sensor on → plugged true | ✓ |
|  | status "charging" + car sensor off → plugged true | ✓ |
|  | status "paused" → plugged true, charging false | ✓ |
|  | status "paused" + car sensor on → plugged true | ✓ |
|  | status "paused" + car sensor off → plugged true | ✓ |
|  | status "finished" → plugged true, charging false | ✓ |
|  | status "finished" + car sensor on → plugged true | ✓ |
|  | status "finished" + car sensor off → plugged true | ✓ |
|  | status "pending_approval" → plugged true, charging null | ✓ |
|  | status "pending_approval" + car sensor on → plugged true | ✓ |
|  | status "pending_approval" + car sensor off → plugged true | ✓ |
| On/off sensor as charger status | plug sensor off → not plugged in, not charging | ✓ |
|  | plug sensor off wins over a late car sensor that still says on | ✓ |
|  | plug sensor on → plugged in, charging not known (so the app can start it) | ✓ |
|  | plug sensor on + power 7 kW → charging | ✓ |
|  | plug sensor on + power 0 W → not charging | ✓ |
|  | charging sensor on → plugged in and charging | ✓ |
|  | charging sensor off + car sensor off → not plugged in | ✓ |
|  | charging sensor off + car sensor on → plugged in, not charging | ✓ |
|  | no device class: the name decides (…_status → plug) | ✓ |
|  | unavailable → status invalid, as before | ✓ |
| Tesla Wall Connector | says it can only read | ✓ |

</details>

## cars

Cars per integration (Tesla ×3, Renault, Hyundai/Kia, Skoda, Volkswagen ID, Volvo, Polestar, Mercedes): which battery level, range, plug, charging and charge limit sensors the app picks, with their real entity names.

<details><summary>50 of 50 passed – show every check</summary>

| Check | Result |
|---|---|
| Tesla (Tesla Fleet): found as a car, by its integration (tesla_fleet) | ✓ |
| Tesla (Tesla Fleet): picks the battery level, range, plug, charging and charge limit (sensor.model_y_battery_level · binary_sensor.model_y_charge_cable · number.model_y_charge_limit) | ✓ |
| Tesla (Tesla Fleet): entities that are off by default are not used | ✓ |
| Tesla (Tesla Fleet): the charge limit is found again for a car saved without it | ✓ |
| Tesla (Tesla Fleet): the plug sensor is read (plugged in and unplugged) ("on" / "off") | ✓ |
| Tesla (Teslemetry): found as a car, by its integration (teslemetry) | ✓ |
| Tesla (Teslemetry): picks the battery level, range, plug, charging and charge limit (sensor.model_3_battery_level · binary_sensor.model_3_charge_cable · number.model_3_charge_limit) | ✓ |
| Tesla (Teslemetry): entities that are off by default are not used | ✓ |
| Tesla (Teslemetry): the charge limit is found again for a car saved without it | ✓ |
| Tesla (Teslemetry): the plug sensor is read (plugged in and unplugged) ("on" / "off") | ✓ |
| Tesla (Tessie): found as a car, by its integration (tessie) | ✓ |
| Tesla (Tessie): picks the battery level, range, plug, charging and charge limit (sensor.model_s_battery_level · binary_sensor.model_s_charge_cable · number.model_s_charge_limit) | ✓ |
| Tesla (Tessie): entities that are off by default are not used | ✓ |
| Tesla (Tessie): the charge limit is found again for a car saved without it | ✓ |
| Tesla (Tessie): the plug sensor is read (plugged in and unplugged) ("on" / "off") | ✓ |
| Renault: found as a car, by its integration (renault) | ✓ |
| Renault: picks the battery level, range, plug, charging and charge limit (sensor.megane_battery · binary_sensor.megane_plug · number.megane_target_charge_level) | ✓ |
| Renault: entities that are off by default are not used | ✓ |
| Renault: the charge limit is found again for a car saved without it | ✓ |
| Renault: the plug sensor is read (plugged in and unplugged) ("on" / "off") | ✓ |
| Hyundai / Kia (Kia Uvo / Hyundai Bluelink): found as a car, by its integration (kia_uvo) | ✓ |
| Hyundai / Kia (Kia Uvo / Hyundai Bluelink): picks the battery level, range, plug, charging and charge limit (sensor.ioniq_5_ev_battery_level · binary_sensor.ioniq_5_ev_battery_plug · number.ioniq_5_ac_charging_limit) | ✓ |
| Hyundai / Kia (Kia Uvo / Hyundai Bluelink): entities that are off by default are not used | ✓ |
| Hyundai / Kia (Kia Uvo / Hyundai Bluelink): the charge limit is found again for a car saved without it | ✓ |
| Hyundai / Kia (Kia Uvo / Hyundai Bluelink): the plug sensor is read (plugged in and unplugged) ("on" / "off") | ✓ |
| Skoda (MySkoda): found as a car, by its integration (myskoda) | ✓ |
| Skoda (MySkoda): picks the battery level, range, plug, charging and charge limit (sensor.enyaq_battery_percentage · binary_sensor.enyaq_charger_connected · number.enyaq_charge_limit) | ✓ |
| Skoda (MySkoda): entities that are off by default are not used | ✓ |
| Skoda (MySkoda): the charge limit is found again for a car saved without it | ✓ |
| Skoda (MySkoda): the plug sensor is read (plugged in and unplugged) ("on" / "off") | ✓ |
| Volkswagen ID (WeConnect ID): found as a car, by its integration (volkswagen_we_connect_id) | ✓ |
| Volkswagen ID (WeConnect ID): picks the battery level, range, plug, charging and charge limit (sensor.id_4_state_of_charge · sensor.id_4_plug_connection_state · number.id_4_target_state_of_charge) | ✓ |
| Volkswagen ID (WeConnect ID): entities that are off by default are not used | ✓ |
| Volkswagen ID (WeConnect ID): the charge limit is found again for a car saved without it | ✓ |
| Volkswagen ID (WeConnect ID): the plug sensor is read (plugged in and unplugged) ("connected" / "disconnected") | ✓ |
| Volvo: found as a car, by its integration (volvo) | ✓ |
| Volvo: picks the battery level, range, plug, charging and charge limit (sensor.ex30_battery_charge_level · sensor.ex30_charging_connection_status · sensor.ex30_target_battery_charge_level) | ✓ |
| Volvo: entities that are off by default are not used | ✓ |
| Volvo: the charge limit is found again for a car saved without it | ✓ |
| Volvo: the plug sensor is read (plugged in and unplugged) ("connected" / "disconnected") | ✓ |
| Polestar: found as a car, by its integration (polestar_api) | ✓ |
| Polestar: picks the battery level, range, plug, charging and charge limit (sensor.polestar_2_battery_charge_level · sensor.polestar_2_charger_connection_status · sensor.polestar_2_charging_target_level) | ✓ |
| Polestar: entities that are off by default are not used | ✓ |
| Polestar: the charge limit is found again for a car saved without it | ✓ |
| Polestar: the plug sensor is read (plugged in and unplugged) ("Connected" / "Disconnected") | ✓ |
| Mercedes-Benz (mbapi2020): found as a car, by its integration (mbapi2020) | ✓ |
| Mercedes-Benz (mbapi2020): picks the battery level, range, plug, charging and charge limit (sensor.eqa_state_of_charge · no plug sensor · sensor.eqa_max_state_of_charge) | ✓ |
| Mercedes-Benz (mbapi2020): entities that are off by default are not used | ✓ |
| Mercedes-Benz (mbapi2020): the charge limit is found again for a car saved without it | ✓ |
| every car integration in the app has a test car, or is listed as untested here (tested: tesla_fleet, teslemetry, tessie, renault, kia_uvo, myskoda, volkswagen_we_connect_id, volvo, polestar_api, mbapi2020 · not tested yet: tesla_custom, bmw_connected_drive, volkswagencarnet, audiconnect, skodaconnect, nissan_leaf, fordpass, toyota, mazda, subaru, volvooncall, smart_hashtag, stellantis_vehicles, psa_car_controller, hyundai_kia_connect) | ✓ |

</details>

## solar

Inverters, solar forecasts, the value of own solar power, charging on surplus.

<details><summary>53 of 53 passed – show every check</summary>

| Part | Check | Result |
|---|---|---|
| SolarEdge (solaredge) | solar power sensor: sensor.solaredge_current_power or sensor.solaredge_solar_power | ✓ |
|  | not the grid, house or battery | ✓ |
|  | brand recognised, power in W | ✓ |
| Enphase (enphase_envoy) | solar power sensor: sensor.envoy_122_current_power_production | ✓ |
|  | not the grid, house or battery | ✓ |
|  | brand recognised, power in W | ✓ |
| SMA (sma) | solar power sensor: sensor.sn_3012345678_pv_power | ✓ |
|  | not the grid, house or battery | ✓ |
|  | brand recognised, power in W | ✓ |
| Fronius (fronius) | solar power sensor: sensor.solarnet_power_photovoltaics | ✓ |
|  | not the grid, house or battery | ✓ |
|  | brand recognised, power in W | ✓ |
| GoodWe (goodwe) | solar power sensor: sensor.pv_power | ✓ |
|  | not the grid, house or battery | ✓ |
|  | brand recognised, power in W | ✓ |
| Huawei (huawei_solar) – names from documentation | solar power sensor: sensor.inverter_input_power | ✓ |
|  | not the grid, house or battery | ✓ |
|  | brand recognised, power in W | ✓ |
| Sigenergy (sigen) – names from documentation | solar power sensor: sensor.sigen_plant_pv_power | ✓ |
|  | not the grid, house or battery | ✓ |
|  | brand recognised, power in W | ✓ |
| APsystems (apsystems) – names from documentation | solar power sensor: sensor.ez1_total_power | ✓ |
|  | not the grid, house or battery | ✓ |
|  | brand recognised, power in W | ✓ |
| Forecast.Solar / Solcast / Open-Meteo through the Energy dashboard | two forecast integrations summed per hour | ✓ |
| Solcast sensor (detailedHourly) | kW per hour read as Wh | ✓ |
| Open-Meteo Solar Forecast sensor (watts) | watts per time read (highest in the hour) | ✓ |
|  | 15-minute solar intervals give exactly 1 kWh per full hour | ✓ |
|  | 30-minute solar intervals give exactly 1 kWh per full hour | ✓ |
|  | 60-minute solar intervals give exactly 1 kWh per full hour | ✓ |
|  | solar merges today and tomorrow without summing duplicate coarse/fine lists | ✓ |
|  | explicit solar periods split energy across hour boundaries; gaps stay gaps | ✓ |
|  | solar conserves energy over the 23-hour clock-change day | ✓ |
|  | solar conserves energy over the 25-hour clock-change day | ✓ |
| Value of a kWh of own solar power (no more salderen from 2027) | dynamic: market price excl. VAT minus feed-in costs | ✓ |
|  | dynamic with 21 % VAT on the feed-in | ✓ |
|  | negative market price: exporting costs money | ✓ |
|  | fixed amount | ✓ |
|  | all-in price source: the fixed amount is used | ✓ |
| Grid meter | import positive (P1, HomeWizard) | ✓ |
|  | kW converted | ✓ |
|  | export positive turned around | ✓ |
|  | import and export sensors | ✓ |
| Charging on surplus (3 phases, max 16 A, start and stop after 5 minutes) | 5 kW surplus: waits 5 minutes before starting | ✓ |
|  | then charges at 7 A on 3 phases | ✓ |
|  | a short cloud (1 kW): keeps going at 6 A | ✓ |
|  | too little for 5 minutes: stops | ✓ |
|  | 11 kW+ surplus: capped at 16 A | ✓ |
|  | at "solar up to" (90 %): no solar charging | ✓ |
|  | with phase switching: 2.5 kW → one phase, 10 A | ✓ |
|  | back to three phases only after 10 minutes | ✓ |
|  | without current control: only from the full 11 kW | ✓ |
|  | no grid meter reading: nothing on solar | ✓ |

</details>

## battery

Home batteries: detection, commands, the guard, the battery plan.

<details><summary>84 of 84 passed – show every check</summary>

| Part | Check | Result |
|---|---|---|
| Sigenergy (sigen) – select options, Remote EMS switch, limits in kW | battery level sensor.sigen_plant_battery_state_of_charge | ✓ |
|  | power sensor.sigen_plant_battery_power | ✓ |
|  | capacity sensor.sigen_plant_rated_energy_capacity | ✓ |
|  | power -1.2 kW (positive = charging) | ✓ |
|  | can: auto, charge, discharge, hold | ✓ |
|  | every command allowed by the guard, nothing else | ✓ |
|  | charge: select.select_option:Command Charging (Grid First) | ✓ |
|  | no discharging falls back to hold (or is not possible) | ✓ |
| Huawei LUNA2000 (huawei_solar) – services forcible_charge/discharge (W, minutes), max (dis)charging power numbers | battery level sensor.batteries_state_of_capacity | ✓ |
|  | power sensor.batteries_charge_discharge_power | ✓ |
|  | power 0.8 kW (positive = charging) | ✓ |
|  | can: auto, charge, discharge, no_discharge, hold | ✓ |
|  | every command allowed by the guard, nothing else | ✓ |
|  | charge: huawei_solar.forcible_charge | ✓ |
| SolarEdge (solaredge_modbus_multi) – Storage Control Mode "Remote Control" + Command Mode | battery level sensor.solaredge_i1_b1_state_of_energy | ✓ |
|  | power sensor.solaredge_i1_b1_dc_power | ✓ |
|  | power -0.5 kW (positive = charging) | ✓ |
|  | can: auto, charge, discharge, hold, no_discharge | ✓ |
|  | every command allowed by the guard, nothing else | ✓ |
|  | charge: select.select_option:Charge from Solar Power and Grid | ✓ |
| Victron (victron) – ESS mode select, max discharge power (sfstar/hass-victron) | battery level sensor.victron_system_battery_soc | ✓ |
|  | power sensor.victron_system_battery_power | ✓ |
|  | power 1.2 kW (positive = charging) | ✓ |
|  | can: auto, charge, no_discharge | ✓ |
|  | every command allowed by the guard, nothing else | ✓ |
|  | charge: select.select_option:KEEP_CHARGED | ✓ |
| GoodWe (goodwe) – operation mode general / eco_charge / eco_discharge; battery power positive = discharging | battery level sensor.battery_state_of_charge | ✓ |
|  | power sensor.battery_power | ✓ |
|  | power -1.5 kW (positive = charging) | ✓ |
|  | can: auto, charge, discharge | ✓ |
|  | every command allowed by the guard, nothing else | ✓ |
|  | charge: select.select_option:eco_charge | ✓ |
|  | no discharging falls back to hold (or is not possible) | ✓ |
| Tesla Powerwall (teslemetry) – operation mode + backup reserve; no forced charging | battery level sensor.my_home_percentage_charged | ✓ |
|  | power sensor.my_home_battery_power | ✓ |
|  | can: auto, no_discharge | ✓ |
|  | every command allowed by the guard, nothing else | ✓ |
|  | no discharging: number.set_value:75 | ✓ |
| HomeWizard Plug-In Battery (homewizard) – battery group mode on the P1 meter: zero / to_full / standby / zero_charge_only | battery level sensor.plug_in_battery_state_of_charge | ✓ |
|  | power sensor.plug_in_battery_power | ✓ |
|  | power -0.4 kW (positive = charging) | ✓ |
|  | can: auto, charge, hold, no_discharge | ✓ |
|  | every command allowed by the guard, nothing else | ✓ |
|  | charge: select.select_option:to_full | ✓ |
| Marstek Venus (marstek_modbus) – RS485 control + force mode standby/charge/discharge, power in W | battery level sensor.marstek_venus_battery_soc | ✓ |
|  | power sensor.marstek_venus_battery_power | ✓ |
|  | can: auto, charge, discharge, hold | ✓ |
|  | every command allowed by the guard, nothing else | ✓ |
|  | charge: select.select_option:charge | ✓ |
|  | no discharging falls back to hold (or is not possible) | ✓ |
| Marstek Venus (marstek_local_api) – set_passive_mode (negative power = charge) + Auto mode button | battery level sensor.venus_battery_soc | ✓ |
|  | power sensor.venus_power | ✓ |
|  | can: charge, discharge, auto | ✓ |
|  | every command allowed by the guard, nothing else | ✓ |
|  | charge: marstek_local_api.set_passive_mode | ✓ |
|  | no discharging falls back to hold (or is not possible) | ✓ |
| Sessy (sessy) – power strategy select: idle for hold; setpoint sign not documented, so no charging | battery level sensor.sessy_a1b2_state_of_charge | ✓ |
|  | power sensor.sessy_a1b2_power | ✓ |
|  | power 1 kW (positive = charging) | ✓ |
|  | can: auto, hold | ✓ |
|  | every command allowed by the guard, nothing else | ✓ |
|  | no discharging falls back to hold (or is not possible) | ✓ |
| Zonneplan Nexus (zonneplan_one) – read only: Zonneplan steers the Nexus itself | battery level sensor.nexus_percentage | ✓ |
|  | read only, with the reason | ✓ |
| Growatt (growatt_server) – read only (time segments in %) | battery level sensor.growatt_tlx_statement_of_charge | ✓ |
|  | read only, with the reason | ✓ |
| Anker Solix (anker_solix) – read only (schedules and presets) | battery level sensor.solarbank_state_of_charge | ✓ |
|  | read only, with the reason | ✓ |
| EcoFlow (ecoflow_cloud) – read only | battery level sensor.powerocean_bpsoc | ✓ |
|  | read only, with the reason | ✓ |
| Tesla Powerwall (powerwall) – local Powerwall: read only | battery level sensor.powerwall_charge | ✓ |
|  | read only, with the reason | ✓ |
| Battery plan | big spread (0.10 at night, 0.45 in the evening): charges at night, saves money | ✓ |
|  | small spread (0.27 vs 0.28): never charges from the grid (losses and wear) | ✓ |
|  | grid charging off: no "charge" at all | ✓ |
|  | cheap morning, expensive evening: holds in the morning instead of emptying | ✓ |
|  | car charging at night, "never": the battery does not discharge into it | ✓ |
|  | car charging, "always": the battery may cover the car when that pays | ✓ |
|  | car charging, "between 80 % and 40 %", battery at 90 %: covers the car, never below 40 % | ✓ |
|  | car charging, "between 80 % and 40 %", battery at 70 % (below the start level), no grid charging: no discharging into the car | ✓ |
|  | "between 80 % and 40 %": at 60 % after it stopped (off), it does not start again; still on from before, it may continue to 40 % | ✓ |
|  | sun: fills from solar surplus, never above the maximum | ✓ |
|  | short first block, the same price later: no needless "hold" (small discharges are not rounded up to a whole step) | ✓ |
|  | never below the minimum | ✓ |

</details>

## forecast

Price forecast: reading it and planning with it.

<details><summary>74 of 74 passed – show every check</summary>

| Check | Result |
|---|---|
| 12 prices parsed | ✓ |
| 6 marked as forecast | ✓ |
| local time read in HA time zone | ✓ |
| real entries not marked | ✓ |
| plan picks the cheaper forecast hour | ✓ |
| period marked as forecast | ✓ |
| without forecast: real hour, no flag | ✓ |
| staged: minimum charged before the first departure | ✓ |
| staged: total energy planned | ✓ |
| staged: the rest in the cheap hours | ✓ |
| staged: cheaper than charging right away | ✓ |
| staged without minimum = normal plan | ✓ |
| staged: the minimum part is marked (min_kwh) | ✓ |
| minimum now: starts right away | ✓ |
| minimum now: 12 kWh marked as minimum | ✓ |
| minimum now: the rest in the cheap hours | ✓ |
| minimum with max price: not in expensive blocks | ✓ |
| minimum with max price: waits for the first block at or below it | ✓ |
| minimum without max price: right away, as before | ✓ |
| minimum + care: the minimum still right away | ✓ |
| minimum + care: all energy planned | ✓ |
| minimum + care: the part above the care level only in the window | ✓ |
| minimum + care: care info kept for Home | ✓ |
| Battery Care small dip 79%: one final session, no early top-up | ✓ |
| Battery Care small dip 79%: all energy, using the cheapest window slot | ✓ |
| Battery Care small dip 75% boundary: one final session, no early top-up | ✓ |
| Battery Care small dip 75% boundary: all energy, using the cheapest window slot | ✓ |
| Battery Care below 75%: the normal cheaper base charge remains | ✓ |
| Battery Care already-started early session: no mid-session deferral | ✓ |
| Battery Care insufficient final capacity: never defer the base charge | ✓ |
| Battery Care missing window prices: no deferred refill claim | ✓ |
| Battery Care final window already open: normal price planning | ✓ |
| Battery Care does not defer an explicit minimum | ✓ |
| minimum stops at the next departure | ✓ |
| minimum stops at the next departure: says the minimum is not reached | ✓ |
| plan table: one block is partly used | ✓ |
| plan table: the partly used block touches the others (no stop in between) | ✓ |
| EUR/kWh preserves explicit prices 6,7,8,9 | ✓ |
| EUR/kWh preserves explicit prices -6,-7,-8,-9 | ✓ |
| EUR/kWh preserves explicit prices 0,0,0,0 | ✓ |
| SEK/kWh preserves explicit prices 6,7,8,9 | ✓ |
| SEK/kWh preserves explicit prices -6,-7,-8,-9 | ✓ |
| SEK/kWh preserves explicit prices 0,0,0,0 | ✓ |
| NOK/kWh preserves explicit prices 6,7,8,9 | ✓ |
| NOK/kWh preserves explicit prices -6,-7,-8,-9 | ✓ |
| NOK/kWh preserves explicit prices 0,0,0,0 | ✓ |
| JPY/kWh preserves explicit prices 6,7,8,9 | ✓ |
| JPY/kWh preserves explicit prices -6,-7,-8,-9 | ✓ |
| JPY/kWh preserves explicit prices 0,0,0,0 | ✓ |
| explicit MWh converted once | ✓ |
| explicit cents converted once | ✓ |
| negative cents preserved | ✓ |
| ambiguous unit requires correction: null | ✓ |
| ambiguous unit requires correction: | ✓ |
| ambiguous unit requires correction: electricity | ✓ |
| ambiguous unit requires correction: currency | ✓ |
| an explicit foreign currency is rejected instead of silently compared | ✓ |
| Core Nord Pool: the action is offered | ✓ |
| Core Nord Pool: its sensor is not offered twice | ✓ |
| HACS Nord Pool: no action without get_prices_for_date | ✓ |
| HACS Nord Pool: the raw_today/raw_tomorrow sensor is offered | ✓ |
| HACS Nord Pool: VAT included by default, with a note | ✓ |
| Unknown services: the action is offered as before | ✓ |
| HACS unit from currency and unit | ✓ |
| HACS unit in cents | ✓ |
| HACS cents converted once | ✓ |
| HACS MWh converted once | ✓ |
| Other sensors keep their unit_of_measurement | ✓ |
| Tibber, two homes, none chosen: a clear error listing both | ✓ |
| Tibber, Home B chosen: its prices, not those of Home A | ✓ |
| Tibber, the chosen home is gone: a clear error, no other home | ✓ |
| Nord Pool, area SE4 chosen: its prices (per MWh → per kWh) | ✓ |
| Nord Pool, two areas, none chosen: a clear error | ✓ |
| Tibber, one home: used without choosing, as before | ✓ |

</details>

## reliability

Ready Guard: is the car ready in time, and what happens when it is not.

<details><summary>23 of 23 passed – show every check</summary>

| Check | Result |
|---|---|
| reports an affordable plan with time left as on track | ✓ |
| keeps the uninterrupted Ready Guard estimate when the known plan is incomplete | ✓ |
| starts protection after the latest safe start | ✓ |
| marks a physically impossible target and still protects it | ✓ |
| asks the user to plug in without pretending it can act | ✓ |
| makes a required intervention visibly advice-only when control is off | ✓ |
| controller gives Ready Guard priority over price and solar waiting | ✓ |
| can be disabled without changing the plan | ✓ |
| does nothing without a departure and accepts an already reached target | ✓ |
| time to spare in days and hours, not thousands of minutes | ✓ |
| prices not yet known up to departure: shown on the chip, status stays on track | ✓ |
| forecast failure alone does not downgrade a complete real-price plan | ✓ |
| the car's own charge limit below the wanted level is "action needed", not "ready" | ✓ |
| a plan that starts after the latest safe start says Ready Guard starts earlier | ✓ |
| below the minimum and the price allows it: charges for the minimum | ✓ |
| price above the maximum: a minimum-only block does not charge or lock | ✓ |
| above the minimum: a minimum-only block that is still in the plan does not charge | ✓ |
| a block that is partly for the minimum is still a planned block | ✓ |
| Battery Care deferred refill ignores a previous lock and price hysteresis (#43) | ✓ |
| Battery Care at the holding level stops instead of continuing to 90% | ✓ |
| Battery Care refill still respects a separately configured hard minimum | ✓ |
| Battery Care refill never delays explicit Charge now or Ready Guard | ✓ |
| Battery Care charges normally in the selected final-window price slot | ✓ |

</details>

## chargestate

The charging status on Home: which state and colour (ready green, charging red, waiting yellow, problems orange).

<details><summary>16 of 16 passed – show every check</summary>

| Check | Result |
|---|---|
| charging is red, with power, level and ready time | ✓ |
| below the minimum: "Charging to your minimum", up to the minimum, ready when the minimum part ends | ✓ |
| Charge now to a level: that level and its own end time | ✓ |
| Battery care: at the care level before the last hours, the status says when charging really starts (also when the charger is on) | ✓ |
| The app wants to charge and the charger switch is on, but no power flows: say so, with the charger status (no advice) | ✓ |
| Ready Guard and solar charging have their own title | ✓ |
| waiting for the plan is yellow, with the start time | ✓ |
| a plan that starts after the latest safe start shows the Ready Guard start | ✓ |
| ready is green | ✓ |
| the car's charge limit below the trip is orange (11 Oct 2026) | ✓ |
| problems are orange: charger offline, charger did not start, car not reachable, missing data | ✓ |
| the charger reports a problem (an error, a fault): orange, with its own words | ✓ |
| starting, the sun and the other charger are yellow | ✓ |
| not connected and nothing to do are grey; advice only is marked | ✓ |
| Battery Care early session shows 80% and its own end, rather than the final 90% overnight (#43) | ✓ |
| Battery Care deferred 79%: waiting is explicit; power still flowing is reported as pausing | ✓ |

</details>

## carplace

Where the car is when not plugged in: car location, then a person, then a trip home in the calendar, else not known (#46).

<details><summary>7 of 7 passed – show every check</summary>

| Check | Result |
|---|---|
| plugged in is always at home; plug state not known changes nothing | ✓ |
| the car location comes first | ✓ |
| an unclear car location is skipped: then the person | ✓ |
| then the calendar; away by car or person takes the time back from the calendar | ✓ |
| nothing known: unknown, never "at home" | ✓ |
| charging is "if plugged in" when not known, or away without a time back | ✓ |
| Home says where the car is | ✓ |

</details>

## notify

Notifications: a message that reached no phone is tried again.

<details><summary>4 of 4 passed – show every check</summary>

| Check | Result |
|---|---|
| reached no phone: not sent | ✓ |
| then it is tried again right away (not held back for 6 hours) | ✓ |
| once it reached a phone, the same message waits its time | ✓ |
| one phone fails, the other gets it: counted as sent | ✓ |

</details>

## activecar

More than one car: connected car; calendar tags, trip language and duplicate prevention.

<details><summary>18 of 18 passed – show every check</summary>

| Check | Result |
|---|---|
| one car: always that car | ✓ |
| exactly one plug sensor on: that car | ✓ |
| text states are understood ("plugged", "disconnected") | ✓ |
| both plugged in, only one charging while the charger charges: that car | ✓ |
| both plugged in, nothing else to go on: asks | ✓ |
| no plug sensor on, one car without a sensor: that car | ✓ |
| plug sensor unavailable counts as no sensor | ✓ |
| your choice wins, and holds until the charger is unplugged | ✓ |
| a choice made while nothing is plugged in counts for the next plug-in | ✓ |
| nothing connected: the last connected car, else the first | ✓ |
| saved cars without an id get stable ids (car1, car2), existing ids are kept | ✓ |
| calendar: "auto:" and "car:" (and "vehicle:", "voertuig:") say which car, in any place of the text | ✓ |
| calendar: the car is found by its calendar name, its name, or its brand when only one car has it | ✓ |
| calendar: precondition in Dutch and English | ✓ |
| calendar: trips the app writes are read back, in English and Dutch | ✓ |
| calendar: changing the writing language skips the same trip, including old Dutch events | ✓ |
| calendar: duplicate detection keeps different cars, destinations, titles and start times separate | ✓ |
| calendar: the two repeated DST hours are different trips | ✓ |

</details>

## sharing

More than one charger: who charges first and how the connection is shared.

<details><summary>28 of 28 passed – show every check</summary>

| Check | Result |
|---|---|
| the car with the earliest latest safe start goes first, not the one that leaves first | ✓ |
| Charge now goes before everything; a car below its minimum before a planned car | ✓ |
| Ready Guard protecting a car goes before a normal plan | ✓ |
| enough for everyone: nobody is limited | ✓ |
| the rest is shared fairly by the others | ✓ |
| less than 6 A each: the next car in line gets 6 A, the others wait | ✓ |
| a charger that can only start and stop gets its full current or waits | ✓ |
| the first car is lowered only when even it does not fit and its current can be set | ✓ |
| solar: only the first car charges on the sun | ✓ |
| unknown connection (no grid meter or a load balancer): nobody is limited | ✓ |
| available current: main fuse minus the house (grid minus the chargers) minus 1 A | ✓ |
| the first adjustable charger pauses below 6 A (0 A) | ✓ |
| the first adjustable charger pauses below 6 A (4 A) | ✓ |
| the first adjustable charger pauses below 6 A (5 A) | ✓ |
| the first adjustable charger can use exactly 6 A | ✓ |
| a first start/stop-only charger waits when its full current does not fit | ✓ |
| a first start/stop-only charger receives its full current when it fits | ✓ |
| both grid sign conventions give the same allocation for import and export | ✓ |
| two one-phase chargers on different phases both get their full current | ✓ |
| two one-phase chargers on the same phase share it: the second gets what is left or waits | ✓ |
| one phase with an unknown phase: the current is kept free on every phase | ✓ |
| mixed: a three-phase charger and a one-phase charger | ✓ |
| fair share per phase: chargers on other phases do not count | ✓ |
| changes take time: a charger only goes up as far as the others have come down | ✓ |
| a charger that stops wanting still counts with what it draws now | ✓ |
| home battery: grid charging only with what the chargers leave, the cars go first | ✓ |
| capacity per phase: main fuse minus the house on that phase (grid minus the chargers on it) minus 1 A | ✓ |
| no fresh reading: one charger at 6 A, the others wait, no grid charging for the battery | ✓ |

</details>

## tripcost

Look ahead: which calendar locations are addresses, the use per km, learning from trips.

<details><summary>10 of 10 passed – show every check</summary>

| Check | Result |
|---|---|
| addresses and place names are looked up; "Werk", "Thuis" and empty are not | ✓ |
| use per km from the range sensor: 300 km at 75 % → 0.25 % per km | ✓ |
| range in miles is converted | ✓ |
| without a range sensor: the consumption (18 kWh/100 km default) and the capacity | ✓ |
| learned from trips: the battery level when leaving and when back, after two trips it is used | ✓ |
| implausible trips are not learned: back after 3 days, charged on the way, or 3 % per km | ✓ |
| distance: home is 0 km, a word that is not an address is unknown, a new address is looked up (pending) | ✓ |
| straight line: Springfield to Bergschenhoek is about 100 km | ✓ |
| My places: "Werk" (location or title "Naar Werk") uses its address; a real address in the location wins; unknown names are suggested | ✓ |
| Zones in Home Assistant: "Werk" (by name or by the title) is a point with GPS; the home zone is not a place; My places go first | ✓ |

</details>

## pricebasis

Price basis: how one price is built (fee, tax, VAT, margin), an all-in forecast is not taxed again (#26).

<details><summary>4 of 4 passed – show every check</summary>

| Check | Result |
|---|---|
| an all-in forecast of 0.2207 with a 0.02 margin is compared as 0.2407 (not 0.287047) | ✓ |
| market excl. VAT: (price + fee + tax) × 1.21 | ✓ |
| market incl. VAT: price + (fee + tax) × 1.21 | ✓ |
| the breakdown total is always the price the plan uses | ✓ |

</details>

## routing

Trip distances and privacy: what is sent where for each choice, offline distances, the choice in settings and imports (#31).

<details><summary>11 of 11 passed – show every check</summary>

| Check | Result |
|---|---|
| not chosen yet: nothing is sent, the trip says to choose | ✓ |
| off: nothing is sent and no distance, not even for a zone | ✓ |
| offline: a zone gives the straight line × 1.3, nothing is sent | ✓ |
| offline: an address is not looked up; a distance in My places is used | ✓ |
| OpenStreetMap: the address goes to the address search, the coordinates to the router | ✓ |
| own servers: everything goes to your servers, nothing to the public ones | ✓ |
| a place looked up before keeps its distance offline, without asking again | ✓ |
| a lookup that was waiting is dropped when you switch to offline | ✓ |
| settings from before the choice keep OpenStreetMap, but unconfirmed | ✓ |
| a new install has not chosen: nothing is looked up | ✓ |
| an imported settings file can only hold a known choice and http(s) addresses | ✓ |

</details>

## chargestops

Charging stops on the way: the route line, which stations count (country, power, connector, detour, reach), preferred operators, what is sent to Open Charge Map (#37); all of Europe, routes across a border and more stops on a long trip (#40).

<details><summary>17 of 17 passed – show every check</summary>

| Check | Result |
|---|---|
| polyline: encode and decode give the same points (5 decimals) | ✓ |
| a long route line is thinned to at most 250 points, start and end kept | ✓ |
| where a station is: km along the route and km off it | ✓ |
| operators: Open Charge Map names are matched (Allego BV, Tesla Motors, IONITY GmbH, Shell Recharge Solutions) | ✓ |
| connectors: CCS is not counted as Type 2, CHAdeMO by id | ✓ |
| stations that are not used: out of order, private, no known connector, no position | ✓ |
| settings check: a key is needed when on, is kept when the page sends none, and has a safe form | ✓ |
| saved-key display (#42): reload, replacement, failed save, removal and discard never expose the key | ✓ |
| off, or the trip has enough: no suggestion and nothing sent | ✓ |
| offline trip distances or no key: nothing is sent, the trip says why | ✓ |
| the route and then the stations: the key goes in a header, the route as a line; only reachable stations | ✓ |
| the other side of the motorway (#41): its real detour by road counts; shown only when nothing else fits, marked as a longer detour | ✓ |
| enough to get there, short on the way back (#41): the stop is on the way back, its detour asked from the destination | ✓ |
| a route across a border (#40): stations in every country on the route count, unless you limit it to your countries | ✓ |
| arrive at a charger with at least (#40): below the level for a stop the car may drive on to a station where it arrives nearly empty, which comes first | ✓ |
| a long trip (#40): more than eight stops, each in reach of the one before, as far along as the battery allows | ✓ |
| a key Open Charge Map does not accept: the trip says so | ✓ |

</details>

## persistence

Saving settings safely (a crash while saving loses nothing).

<details><summary>1 of 1 passed – show every check</summary>

| Check | Result |
|---|---|
| all checks | ✓ |

</details>

## precondition

Preconditioning before a departure: which drives (calendar first, then the way-back setting), when, one press and one retry, nothing with Allow control off, restart, turning a switch off again (#44).

<details><summary>13 of 13 passed – show every check</summary>

| Check | Result |
|---|---|
| off: nothing is planned | ✓ |
| from home: only with "precondition: yes", 15 minutes before | ✓ |
| a trip home in the calendar decides the way back: with yes on, without off (the setting does not count then) | ✓ |
| no event for the drive home: the setting decides, 15 minutes before the event ends | ✓ |
| more places in a row: the next event decides each drive; the setting only for the last drive home | ✓ |
| a later trip from home the next day is not a "next event": the car is home in between | ✓ |
| weekly schedule, helper and one-off (#45): only a departure with its tick, 15 minutes before; no way back; nothing when off | ✓ |
| settings check: 5–60 minutes, only a switch or button, an entity when on | ✓ |
| the moment comes: the button is pressed once, not again the next minute; nothing before or after the window | ✓ |
| "Allow control" off: nothing is sent, the plan shows it as advice | ✓ |
| a failed command is tried once more, then not again | ✓ |
| restart while asking: not sent again (a second press could switch it off) | ✓ |
| a switch is turned off again only when the car did not leave (still plugged in, from home) | ✓ |

</details>

## compat

Compatibility matrix: COMPATIBILITY.md matches the fixtures and the physical test status; read-only devices are marked (#28).

<details><summary>4 of 4 passed – show every check</summary>

| Check | Result |
|---|---|
| COMPATIBILITY.md is up to date (run: node tests/compat.js write) | ✓ |
| every charger, car and home battery of the fixtures is listed | ✓ |
| read-only devices are marked and never shown as steerable | ✓ |
| physical test status only shows known states, and nothing personal | ✓ |

</details>

## docs

Documentation keeps up: README and RELEASE candidate match the version, every issue since the stable version is listed as implemented on dev.

<details><summary>6 of 6 passed – show every check</summary>

| Check | Result |
|---|---|
| config.yaml has a version | ✓ |
| README: development candidate has the same X.Y as config.yaml (0.36.7-dev) | ✓ |
| RELEASE: current candidate has the same X.Y as config.yaml (0.36.7-dev) | ✓ |
| README: every issue since 0.35.0 is under "Implemented on dev" (#40, #29, #46, #28) | ✓ |
| RELEASE: every issue since 0.35.0 is in the candidate scope | ✓ |
| changelog: the newest heading is the version in config.yaml | ✓ |

</details>

# Matrix: every charger with every home battery

`node tests/matrix.test.js` (several minutes; `SCP_CHARGERS=Easee,Zaptec` for a part). The real app against a fake Home Assistant with a Renault, one charger brand and, one after the other, every home battery brand from `tests/fixtures.js`. The fake charger reacts to exactly the start/stop command the app's control check chooses; `tests/brands.test.js` checks those commands per brand.

## Per charger

| Charger | Method | Charge now | Solar 6 kW | Solar 2.5 kW | Back to full power | Only own commands | Batteries |
|---|---|---|---|---|---|---|---|
| Easee | ✓ switch, current: action_current, phases: action_phase | ✓ switch.turn_on switch.eh123456_charger_enabled {} → switch.turn_off switch.eh123456_charger_enabled {} | ✓ 7 A · easee.set_charger_dynamic_limit {"device_id":"ch","current":7,"time_to_live":30} · switch.turn_on switch.eh123456_charger_enabled {} | ✓ one phase, 6 A · switch.turn_off switch.eh123456_charger_enabled {} · easee.set_charger_phase_mode {"device_id":"ch","phase_mode":"1_phase"}… | ✓ easee.set_charger_phase_mode {"device_id":"ch","phase_mode":"3_phase"} · switch.turn_off switch.eh123456_charger_enabled {} · switch.turn_of… | ✓ 20 commands | 90 of 90 ✓ |
| Zaptec | ✓ buttons, current: number, phases: none | ✓ button.press button.zaptec_go_resume_charging {} → button.press button.zaptec_go_stop_charging {} | ✓ 7 A · number.set_value number.zaptec_go_charger_max_current {"value":7} · button.press button.zaptec_go_resume_charging {} | ✓ paused · button.press button.zaptec_go_stop_charging {} | ✓ number.set_value number.zaptec_go_charger_max_current {"value":16} · button.press button.zaptec_go_resume_charging {} | ✓ 12 commands | 90 of 90 ✓ |
| Alfen | ✓ switch, current: number, phases: none | ✓ switch.turn_on switch.alfen_eve_charging {} → switch.turn_off switch.alfen_eve_charging {} | ✓ 7 A · number.set_value number.alfen_eve_power_connector_max_current_socket_1 {"value":7} · switch.turn_on switch.alfen_eve_charging {} | ✓ paused · switch.turn_off switch.alfen_eve_charging {} | ✓ number.set_value number.alfen_eve_power_connector_max_current_socket_1 {"value":16} · switch.turn_on switch.alfen_eve_charging {} | ✓ 12 commands | 90 of 90 ✓ |
| Wallbox | ✓ switch, current: number, phases: none | ✓ switch.turn_on switch.wallbox_pulsar_plus_pause_resume {} → switch.turn_off switch.wallbox_pulsar_plus_pause_resume {} | ✓ 7 A · number.set_value number.wallbox_pulsar_plus_maximum_charging_current {"value":7} · switch.turn_on switch.wallbox_pulsar_plus_pause_res… | ✓ paused · switch.turn_off switch.wallbox_pulsar_plus_pause_resume {} | ✓ number.set_value number.wallbox_pulsar_plus_maximum_charging_current {"value":16} · switch.turn_on switch.wallbox_pulsar_plus_pause_resume {… | ✓ 12 commands | 90 of 90 ✓ |
| go-e (marq24) | ✓ select, current: number, phases: select_phase | ✓ select.select_option select.goe_123456_frc {"option":"2"} → select.select_option select.goe_123456_frc {"option":"1"} | ✓ 7 A · number.set_value number.goe_123456_amp {"value":7} · select.select_option select.goe_123456_frc {"option":"2"} | ✓ one phase, 6 A · select.select_option select.goe_123456_frc {"option":"1"} · select.select_option select.goe_123456_psm {"option":"1"} · sel… | ✓ select.select_option select.goe_123456_psm {"option":"2"} · select.select_option select.goe_123456_frc {"option":"1"} · select.select_option… | ✓ 20 commands | 90 of 90 ✓ |
| go-e (cathiele) | ✓ switch, current: none, phases: none | ✓ switch.turn_on switch.goecharger_home_allow_charging {} → switch.turn_off switch.goecharger_home_allow_charging {} | ✓ no current control: waits for 11 kW | ✓ paused · was not charging | ✓ switch.turn_on switch.goecharger_home_allow_charging {} | ✓ 8 commands | 90 of 90 ✓ |
| Peblar | ✓ switch, current: number, phases: switch_phase | ✓ switch.turn_on switch.peblar_ev_charger_charge {} → switch.turn_off switch.peblar_ev_charger_charge {} | ✓ 7 A · number.set_value number.peblar_ev_charger_charge_limit {"value":7} · switch.turn_on switch.peblar_ev_charger_charge {} | ✓ one phase, 6 A · switch.turn_off switch.peblar_ev_charger_charge {} · switch.turn_on switch.peblar_ev_charger_force_single_phase {} · switch… | ✓ switch.turn_off switch.peblar_ev_charger_force_single_phase {} · switch.turn_off switch.peblar_ev_charger_charge {} · switch.turn_off switch… | ✓ 22 commands | 90 of 90 ✓ |
| OCPP | ✓ switch, current: number, phases: none | ✓ switch.turn_on switch.charger_charge_control {} → switch.turn_off switch.charger_charge_control {} | ✓ 7 A · number.set_value number.charger_maximum_current {"value":7} · switch.turn_on switch.charger_charge_control {} | ✓ paused · switch.turn_off switch.charger_charge_control {} | ✓ number.set_value number.charger_maximum_current {"value":16} · switch.turn_on switch.charger_charge_control {} | ✓ 12 commands | 90 of 90 ✓ |
| Ohme | ✓ select, current: none, phases: none | ✓ select.select_option select.ohme_home_pro_charge_mode {"option":"max_charge"} → select.select_option select.ohme_home_pro_charge_mode {"opti… | ✓ no current control: waits for 11 kW | ✓ paused · was not charging | ✓ select.select_option select.ohme_home_pro_charge_mode {"option":"max_charge"} | ✓ 8 commands | 90 of 90 ✓ |
| Tesla Wall Connector | ✓ read only: no start/stop | ✓ nothing sent (boost: 200) | ✓ nothing sent | ✓ nothing sent | ✓ nothing sent | ✓ 4 commands | 90 of 90 ✓ |

## Per battery (the same with every charger; notes from the run with Easee)

Per battery: 1 found, 2 switching from the previous battery puts that one back in its own mode, 3 car charges → no discharging into it, 4 car stops → back to its own mode, 5 car starts charging by itself → no discharging into it, 6 only commands to this charger, the car's limit or this battery.

| Battery | Can | Car charges | Car stops | Car charges by itself | All chargers |
|---|---|---|---|---|---|
| Sigenergy (sigen) | ✓ can: auto, charge, discharge, hold | ✓ hold (Battery plan: hold): turn_on · select_option Standby | ✓ original settings restored | ✓ hold (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| Huawei LUNA2000 (huawei_solar) | ✓ can: auto, charge, discharge, no_discharge, hold | ✓ hold (Battery plan: hold): stop_forcible_charge · set_value 0 · set_value 0 | ✓ original settings restored | ✓ no_discharge (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| SolarEdge (solaredge_modbus_multi) | ✓ can: auto, charge, discharge, hold, no_discharge | ✓ hold (Battery plan: hold): select_option Remote Control · set_value 120 · select_option Solar Power Only (Off) | ✓ original settings restored | ✓ no_discharge (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| Victron (victron) | ✓ can: auto, charge, no_discharge | ✓ no_discharge (Battery plan: no discharge): select_option SELF_CONSUMPTION_WITH_BATTERY_LIFE · set_value 0 | ✓ original settings restored | ✓ no_discharge (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| GoodWe (goodwe) | ✓ can: auto, charge, discharge · cannot stop discharging into the car (warned) | ✓ cannot prevent it: The minimum level cannot be protected by this integration; automatic control is not possible with these limits | ✓ nothing sent | ✓ cannot prevent it: The minimum level cannot be protected by this integration; automatic control is not possible with these limits | 60 of 60 ✓ |
| Tesla Powerwall (teslemetry) | ✓ can: auto, no_discharge | ✓ no_discharge (Battery plan: no discharge): select_option self_consumption · set_value 75 | ✓ original settings restored | ✓ no_discharge (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| HomeWizard Plug-In Battery (homewizard) | ✓ can: auto, charge, hold, no_discharge | ✓ hold (Battery plan: hold): select_option standby | ✓ original settings restored | ✓ no_discharge (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| Marstek Venus (marstek_modbus) | ✓ can: auto, charge, discharge, hold | ✓ hold (Battery plan: hold): turn_on · select_option standby | ✓ original settings restored | ✓ hold (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| Marstek Venus (marstek_local_api) | ✓ can: charge, discharge, auto · cannot stop discharging into the car (warned) | ✓ cannot prevent it: The minimum level cannot be protected by this integration; automatic control is not possible with these limits | ✓ nothing sent | ✓ cannot prevent it: The minimum level cannot be protected by this integration; automatic control is not possible with these limits | 60 of 60 ✓ |
| Sessy (sessy) | ✓ can: auto, hold | ✓ hold (Battery plan: hold): select_option idle | ✓ original settings restored | ✓ hold (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| Zonneplan Nexus (zonneplan_one) | ✓ read only | ✓ nothing sent (Zonneplan steers the Nexus itself (dynamic charging); the integration offers no charge or discharge command.) | ✓ nothing sent | ✓ nothing sent | 60 of 60 ✓ |
| Growatt (growatt_server) | ✓ read only | ✓ nothing sent (Growatt cloud only offers time segments in %, not commands; not supported yet.) | ✓ nothing sent | ✓ nothing sent | 60 of 60 ✓ |
| Anker Solix (anker_solix) | ✓ read only | ✓ nothing sent (Anker Solix is steered with schedules and presets, not with charge or discharge commands; not supported yet.) | ✓ nothing sent | ✓ nothing sent | 60 of 60 ✓ |
| EcoFlow (ecoflow_cloud) | ✓ read only | ✓ nothing sent (EcoFlow offers no charge or discharge command in Home Assistant.) | ✓ nothing sent | ✓ nothing sent | 60 of 60 ✓ |
| Tesla Powerwall (powerwall) | ✓ read only | ✓ nothing sent (The local Powerwall integration can only read the battery; use Teslemetry or Tesla Fleet to steer it.) | ✓ nothing sent | ✓ nothing sent | 60 of 60 ✓ |

## Per car (with Easee)

The real entity names of each car integration (`tests/fixtures.js`, CARS; `SCP_CARS=Tesla` for a part). 1 found with the right sensors, 2 the plan uses its battery level, 3 the charge limit follows the target (or is only read), 4 the car charges, 5 only commands to the charger or the car's limit.

| Car | Found | Battery level | Charge limit | Charges | Only own commands |
|---|---|---|---|---|---|
| Tesla (Tesla Fleet) | ✓ sensor.model_y_battery_level · binary_sensor.model_y_charge_cable | ✓ 40% → 85% | ✓ number.model_y_charge_limit → 85% | ✓ charging true, status ? | ✓ 1 to the car |
| Tesla (Teslemetry) | ✓ sensor.model_3_battery_level · binary_sensor.model_3_charge_cable | ✓ 40% → 85% | ✓ number.model_3_charge_limit → 85% | ✓ charging true, status ? | ✓ 1 to the car |
| Tesla (Tessie) | ✓ sensor.model_s_battery_level · binary_sensor.model_s_charge_cable | ✓ 40% → 85% | ✓ number.model_s_charge_limit → 85% | ✓ charging true, status ? | ✓ 1 to the car |
| Renault | ✓ sensor.megane_battery · binary_sensor.megane_plug | ✓ 40% → 85% | ✓ number.megane_target_charge_level → 85% | ✓ charging true, status ? | ✓ 1 to the car |
| Hyundai / Kia (Kia Uvo / Hyundai Bluelink) | ✓ sensor.ioniq_5_ev_battery_level · binary_sensor.ioniq_5_ev_battery_plug | ✓ 40% → 85% | ✓ number.ioniq_5_ac_charging_limit → 90% | ✓ charging true, status ? | ✓ 1 to the car |
| Skoda (MySkoda) | ✓ sensor.enyaq_battery_percentage · binary_sensor.enyaq_charger_connected | ✓ 40% → 85% | ✓ number.enyaq_charge_limit → 90% | ✓ charging true, status ? | ✓ 1 to the car |
| Volkswagen ID (WeConnect ID) | ✓ sensor.id_4_state_of_charge · sensor.id_4_plug_connection_state | ✓ 40% → 85% | ✓ number.id_4_target_state_of_charge → 90% | ✓ charging true, status ? | ✓ 1 to the car |
| Volvo | ✓ sensor.ex30_battery_charge_level · sensor.ex30_charging_connection_status | ✓ 40% → 85% | ✓ read only: 80% | ✓ charging true, status ? | ✓ 0 to the car |
| Polestar | ✓ sensor.polestar_2_battery_charge_level · sensor.polestar_2_charger_connection_status | ✓ 40% → 85% | ✓ read only: 80% | ✓ charging true, status ? | ✓ 0 to the car |
| Mercedes-Benz (mbapi2020) | ✓ sensor.eqa_state_of_charge · no plug sensor | ✓ 40% → 85% | ✓ read only: 80% | ✓ charging true, status ? | ✓ 0 to the car |

GoodWe and Marstek (Local API) cannot be told to stop discharging from Home Assistant: the app says so on Settings › Battery. The read-only brands are never sent anything.
