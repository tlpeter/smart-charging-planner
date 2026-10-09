# Test plan

This file is written by `tests/testplan.js` from the results of the last test run. GitHub runs every test after each push and updates this file, so it always matches the code. Run it yourself with `node tests/testplan.js all` (several minutes).

Three kinds of tests:

1. **Settings**: every setting, against a fake Home Assistant (`tests/fake-ha.js`). The real app starts with an empty data folder and is used through the same API as the page: what is saved, what is refused, what the plan does and what is sent to Home Assistant.
2. **Unit tests**: one part of the app at a time, without Home Assistant (brands, solar, batteries, price forecast, Ready Guard, more cars, more chargers, look ahead, saving).
3. **Matrix**: every charger brand with every home battery brand.

A separate check (`.github/workflows/ha-core-compat.yml`) runs the app against a real Home Assistant Core.

## Summary

| Test | Passed |
|---|---|
| Settings A: Renault Megane E-Tech + Easee Charge | 151 of 151 ✓ |
| Settings B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus | 142 of 142 ✓ |
| Unit tests (9 files) | 317 of 317 ✓ |
| Matrix (10 chargers × all batteries) | 960 of 960 ✓ |

Version: 0.29.9-dev.

# Settings

Set-ups, with entity names taken from the integrations' own source code:

- **A**: Renault Megane E-Tech + Easee Charge
- **B**: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus

Both also have a P1 meter, a Fronius inverter, EnergyZero prices, a price sensor with a 7-day forecast, a solar forecast in the Energy dashboard, a Sigenergy home battery, a second car and charger, calendars (also a read-only iCloud calendar), helpers and notify actions.

Run one yourself (from the repository root, after `npm install` in `smart_charging_planner/app`), about a minute each:

```
node tests/settings.test.js
SCP_PROFILE=skoda_wallbox node tests/settings.test.js
```

## A. Fresh install and checklist

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| A1 | Fresh install: checklist says vehicle, charger and prices are missing | ✓ missing: vehicle, charger, prices | ✓ missing: vehicle, charger, prices |
| A2 | Frontend assets are served separately | ✓ 42 kB CSS, 206 kB JS | ✓ 42 kB CSS, 206 kB JS |
| A3 | Fresh install: Allow control is off by default | ✓ | ✓ |

## B. Vehicle

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| B1 | Detect finds the car with battery, plugged-in and charge limit | ✓ JLZ03X: plugged binary_sensor.jlz03x_plugged_in, limit number.jlz03x_target_charge_level | ✓ Enyaq: plugged binary_sensor.enyaq_charger_connected, limit number.enyaq_charge_limit |
| B2 | Refused: no battery sensor | ✓ A battery (SoC) sensor is required | ✓ A battery (SoC) sensor is required |
| B3 | Refused: battery capacity 500 kWh | ✓ Battery capacity must be between 0 and 300 kWh | ✓ Battery capacity must be between 0 and 300 kWh |
| B4 | Refused: a charge limit that is not on the car's device | ✓ That entity is not the car's charge limit | ✓ That entity is not the car's charge limit |
| B5 | Refused: battery level 120 % entered by hand | ✓ Battery level must be between 0 and 100 % | ✓ Battery level must be between 0 and 100 % |
| B6 | No car integration: "enter level" needs a capacity | ✓ Battery capacity is required to estimate the battery level | ✓ Battery capacity is required to estimate the battery level |
| B7 | No car integration: fixed amount must be 1–150 kWh | ✓ The amount per session must be between 1 and 150 kWh | ✓ The amount per session must be between 1 and 150 kWh |
| B8 | Save the car (sensor mode, capacity, plugged-in sensor, charge limit) | ✓ | ✓ |

## C. Charger

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| C1 | Detect finds the charger with status and power, and not the car | ✓ switch: none | ✓ switch: switch.wallbox_pulsar_plus_pause_resume |
| C2 | Refused: no entities chosen | ✓ Choose at least one entity | ✓ Choose at least one entity |
| C3 | Refused: maximum current 100 A | ✓ Maximum current must be between 6 and 80 A | ✓ Maximum current must be between 6 and 80 A |
| C4 | Refused: a switch as status entity | ✓ Invalid entity for status_entity | ✓ Invalid entity for status_entity |
| C5 | Save the charger (3 phases, 16 A) | ✓ | ✓ |
| C6 | Control check finds a start/stop method and recommends one | ✓ recommended: Laadpaal Charger enabled | ✓ recommended: Wallbox Pulsar Plus Pause/Resume |
| C7 | Maximum current 10 A: the plan uses 3 × 230 V × 10 A = 6.9 kW | ✓ | ✓ |
| C8 | One phase, 16 A: the plan uses 3.7 kW | ✓ | ✓ |
| C6b | Charger's own smart mode on (Eco-smart (select.wallbox_pulsar_plus_ecosmart)): the control check warns | – (not for this set-up) | ✓ own_mode_on |

## D. Grid

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| D1 | Detect finds the P1 meter | ✓ | ✓ |
| D2 | Refused: main fuse 300 A | ✓ Main fuse must be between 6 and 200 A | ✓ Main fuse must be between 6 and 200 A |
| D3 | Refused: no net or import sensor | ✓ Choose a net power sensor, or an import power sensor | ✓ Choose a net power sensor, or an import power sensor |
| D4 | Save the P1 meter (25 A, load balancer in the charger) | ✓ | ✓ |

## E. Prices

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| E1 | Detect offers EnergyZero, the combined sensor and the fixed tariff | ✓ | ✓ |
| E2 | Test shows 24 prices today and 24 tomorrow | ✓ | ✓ |
| E3 | Market price excl. VAT + fee + tax: all-in = (price + fee + tax) × 1.21 | ✓ 0.2 → 0.3872 | ✓ 0.2 → 0.3872 |
| E4 | Market price incl. VAT: all-in = price + (fee + tax) × 1.21 | ✓ | ✓ |
| E5 | All-in price: used as it is | ✓ | ✓ |
| E6 | Refused: purchase fee 2, VAT 80 | ✓ | ✓ |
| E7 | Fixed tariff: refused when low from = low until, or time "25:00" | ✓ | ✓ |
| E8 | Day/night tariff: the plan charges in the low hours | ✓ planned hours 6 | ✓ planned hours 6 |
| E9 | Refused: forecast sensor with a bad name, margin 0.6 | ✓ | ✓ |

## F. Planning (departures)

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| F1 | Refused: battery level 5 %, time "7 uur", calendar buffer 500 | ✓ | ✓ |
| F2 | Weekly schedule: next departure is tomorrow 06:30 at 85 % | ✓ | ✓ |
| F3 | One-off departure wins over the schedule; refused in the past or after 7 days | ✓ | ✓ |
| F4 | Calendar: "doel: 90" in an event becomes the departure, minus the buffer | ✓ | ✓ |
| F5 | Helper: date/time and battery level helper | ✓ | ✓ |
| F6 | Refused: helper on without a helper chosen; calendar on without a calendar | ✓ | ✓ |
| F7 | No departure source: plan uses the cheapest known hours, note "no departure" | ✓ | ✓ |
| F8 | Calendar with a keyword: only events with "EV" count, without a target the calendar level is used | ✓ | ✓ |
| F9 | Add trip with "Allow adding trips" off: test mode, nothing written | ✓ | ✓ |

## G. Rules

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| G1 | Refused: default minimum 50 %, force window 700 min, hysteresis 2 | ✓ | ✓ |
| G2 | Minimum battery level: below it → charge now | ✓ | ✓ |
| G3 | Minimum with a price limit below the current price → not charged for the minimum | ✓ then: not_planned | ✓ then: not_planned |
| G3b | Minimum taken from an entity (the car's own minimum, here 70 %) | ✓ | ✓ |
| G4 | Preconditioning entity on → charge | ✓ | ✓ |
| G5 | Force window: departure within the window → charge | ✓ ready_guard | ✓ ready_guard |
| G6 | Not in a planned block and not charging → pause | ✓ paused | ✓ paused |
| G7 | Default minimum for quick choices is used on Home | ✓ | ✓ |
| G8 | Allow control off: the car limit is not changed and the plan stops at the limit | ✓ | ✓ |
| G9 | Allow control off: nothing is sent to Home Assistant | ✓ | ✓ |

## H. Notifications

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| H1 | Refused: a notify action that does not exist | ✓ Choose a notify action from the list | ✓ Choose a notify action from the list |
| H2 | Choose mobile_app_pixel_8 and send a test notification | ✓ | ✓ |
| H3 | Test notification refused when no notify action is chosen | ✓ | ✓ |

## I. Configuration tab in Home Assistant

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| I1 | Charging loss margin 20 %: more energy planned than with 10 % | ✓ 22.88 → 24.96 kWh | ✓ 33.88 → 36.96 kWh |
| I2 | Invalid option values fall back to the defaults (loss 99 %, refresh 0) | ✓ | ✓ |
| I3 | Continuous charging off: blocks may be split | ✓ 1 period(s) | ✓ 2 period(s) |
| I4 | Publish sensors on: sensor.smart_charging_* are written | ✓ 9 sensors | ✓ 9 sensors |
| I5 | Publish sensors off: nothing is written | ✓ | ✓ |

## J. Allow control on: quick choices and the car limit

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| J1 | Car limit follows the plan: tomorrow 90 % (one call) | ✓ number.set_value 90 | ✓ number.set_value 90 |
| J2 | Plan is not capped at the old limit when the app manages it | ✓ | ✓ |
| J3 | Ready for the day after tomorrow 95 %: minimum 30 % first, limit follows | ✓ 42.9 kWh before 10-10T05:00, limit sent 95 | ✓ 63.5 kWh before 10-10T05:00, limit sent 100 |
| J4 | Back to normal: limit goes down to the plan again | ✓ limit 90 | ✓ limit 90 |
| J4b | Ready for the day after tomorrow, chosen for a calendar trip; the trip is removed → the choice ends by itself | ✓ based on "Naar werk", ended; notified: The departure it was chosen for (Naar werk on 2026-10-11) is no longer planned. The car is planned for the next departure again. | ✓ based on "Naar werk", ended; notified: The departure it was chosen for (Naar werk on 2026-10-11) is no longer planned. The car is planned for the next departure again. |
| J4c | Ready for tomorrow when no departure was planned that day: the choice stays | ✓ | ✓ |
| J5 | Quickly to a minimum (35 %) does not lower the limit | ✓ | ✓ |
| J6 | Charge now 100 %: limit up, charger started; stop: limit back | ✓ limit 100 → 90, start: switch.turn_on switch.laadpaal_charger_enabled | ✓ limit 100 → 90, start: switch.turn_on switch.wallbox_pulsar_plus_pause_resume |
| J7 | Charge now as kWh: preview converts it to a level for the limit | ✓ | ✓ |
| J8 | "Don't change the car's charge limit": nothing sent, plan capped at the limit | ✓ | ✓ |
| J9 | Notification on start (notify every start and pause) | ✓ Car charge limit changed · Charging started · Charging paused · Car charge limit changed | ✓ Car charge limit changed · Charging started · Charging paused · Car charge limit changed |
| J9b | Manual test (Diagnostics): start and stop really sent | ✓ switch.turn_on switch.laadpaal_charger_enabled → switch.turn_off switch.laadpaal_charger_enabled | ✓ switch.turn_on switch.wallbox_pulsar_plus_pause_resume → switch.turn_off switch.wallbox_pulsar_plus_pause_resume |
| J12 | Target 85 %: limit rounded up to a step the car accepts, the plan still stops at 85 % | ✓ limit 85 %, at 85 %: at_target | ✓ limit 90 %, at 85 %: at_target |
| J13 | Battery care (on by default): target 100 % tomorrow 23:00 — up to 80 % in the cheap night, the last part only in the 4 hours before departure; the car limit stays at 80 % until then | ✓ up to 80 %: 17.2 kWh in the night · last 11.4 kWh from 19:00 · car limit 80 % | ✓ up to 80 %: 25.4 kWh in the night · last 16.9 kWh from 19:00 · car limit 80 % |
| J10 | Car unplugged: Charge now is refused | ✓ | ✓ |
| J11 | Notify every start and pause off: start is not notified | ✓ no notifications | ✓ no notifications |

## S. Solar

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| S1 | Refused: solar up to 30 %, forecast sensor without a sensor, factor 2 | ✓ | ✓ |
| S2 | Solar page: forecast from the Energy dashboard, inverter found, phase switching of the charger | ✓ forecast tomorrow 18 kWh, inverter Fronius, phase switching: Set charger phase mode, current: Set charger dynamic limit | ✓ forecast tomorrow 18 kWh, inverter Fronius, phase switching: not possible, current: Wallbox Pulsar Plus Maximum Charging Current |
| S3 | Plan + solar, feed-in 0.03: the plan charges on tomorrow's sun (cheaper than the night at 0.05) | ✓ 24.0 kWh on solar, 10.3 kWh from the grid | ✓ 24.0 kWh on solar, 26.8 kWh from the grid |
| S4 | Dynamic feed-in (market 0.20 − 0.02 = 0.18) vs grid all-in 0.21 at night: the sun is cheaper, also without salderen | ✓ 24.0 kWh on solar | ✓ 24.0 kWh on solar |
| S4b | Feed-in 0.25 (more than the night at 0.21): the night first; the sun only for what does not fit (day grid 0.39) | ✓ 33.1 kWh at night, 1.2 kWh on solar | ✓ 33.1 kWh at night, 17.7 kWh on solar |
| S5 | Solar only: the plan uses only the sun | ✓ 24.0 kWh, notes: prices_incomplete, not_enough_known_time, solar_only | ✓ 24.0 kWh, notes: prices_incomplete, not_enough_known_time, solar_only |
| S6 | Live: 6 kW sun, car not charging → start on solar with a matching current | ✓ 7 A, sent: switch.turn_on switch.laadpaal_charger_enabled · easee.set_charger_dynamic_limit {"device_id":"ch","current":7,"time_to_live":30} | ✓ 7 A, sent: switch.turn_on switch.wallbox_pulsar_plus_pause_resume · number.set_value number.wallbox_pulsar_plus_maximum_charging_current 7 |
| S7 | Live: sun drops to 2.5 kW → one phase where the charger can, otherwise stop | ✓ one phase, 6 A · easee.set_charger_phase_mode {"device_id":"ch","phase_mode":"1_phase"} · easee.set_charger_dynamic_limit {"device_id":"ch","current":6,"time_to_live":30} | ✓ paused (no phase switching) · switch.turn_off switch.wallbox_pulsar_plus_pause_resume |
| S8 | Charge now after solar: current back to the maximum (and three phases) | ✓ switch.turn_on switch.laadpaal_charger_enabled · easee.set_charger_phase_mode {"device_id":"ch","phase_mode":"3_phase"} · easee.set_charger_dynamic_limit {"device_id":"ch","current":16,"time_to_live":30} | ✓ switch.turn_on switch.wallbox_pulsar_plus_pause_resume · number.set_value number.wallbox_pulsar_plus_maximum_charging_current 16 |
| S9 | Solar modes raise the car limit to "solar up to" (90 %) | ✓ | ✓ |
| S10 | Grid meter sign "delivering is positive": the reading is turned around | ✓ | ✓ |
| S12 | Easee Equalizer does solar: surplus charging on, charger on, no current or phase commands; Charge now: surplus off (full power) | ✓ switch.turn_on switch.laadpaal_charger_enabled · easee.set_surplus_charging true · Charge now: surplus false | ✓ |
| S13 | Back to the app: the surplus charging the app switched on goes off; Equalizer surplus on in the Easee app is reported | ✓ | – (not for this set-up) |
| S11 | Mode buttons refused without solar; solar off → back to the price plan | ✓ | ✓ |

## T. Home battery (Sigenergy)

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| T1 | Battery page finds the Sigenergy: level, power, capacity, what the app can do | ✓ can: auto, charge, discharge, hold | ✓ can: auto, charge, discharge, hold |
| T2 | Refused: minimum above maximum, a battery that does not exist, capacity 0 | ✓ | ✓ |
| T3 | Plan: charges from the grid in the cheap night (0.05) for the 0.20 hours, with a saving | ✓ charges in 3 block(s), saving €1.47 | ✓ charges in 3 block(s), saving €1.47 |
| T4 | Allow control on, home battery control off: nothing is sent to the battery | ✓ | ✓ |
| T5 | Car charges, "never into the car": the battery holds (Remote EMS on, Standby) | ✓ turn_on · select_option Standby | ✓ turn_on · select_option Standby |
| T6 | Car stops: the battery goes back to its plan | ✓ now: auto · turn_off | ✓ now: auto · turn_off |
| T7 | "Only stored solar into the car": no solar in the battery → no discharging into the car | ✓ | ✓ |
| T7b | "Between two levels" (80 % → 40 %): refused when the levels do not fit; car charges: below 80 % no help, from 80 % the battery helps, at 40 % it stops | ✓ 60 %: hold · 85 %: auto · 39 %: hold | ✓ 60 %: hold · 85 %: auto · 39 %: hold |
| T8 | Smart sun: the battery takes 2 kW of sun, the car needs energy → the car gets the sun, the battery waits | ✓ car on solar at 8 A · battery: turn_on · select_option Standby | ✓ car on solar at 8 A · battery: turn_on · select_option Standby |
| T8b | Equalizer does solar, no sun (evening): the charger is on but the car waits, so the battery keeps covering the house | ✓ charger on, Equalizer waits; battery: auto (Battery plan: auto) | – (not for this set-up) |
| T9 | Diagnostics: battery test "charge" sends the Sigenergy commands | ✓ turn_on · set_value 5 · select_option Command Charging (Grid First) | ✓ turn_on · set_value 5 · select_option Command Charging (Grid First) |
| T10 | Battery planning off: the battery goes back to normal (Remote EMS off) | ✓ | ✓ |

## V. Car not reachable (the car's cloud is down)

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| V1 | Refused: car data old after 100 hours; 2 hours is saved | ✓ | ✓ |
| V2 | Battery level "unavailable": the plan goes on from the last level plus what the charger delivered, the car limit is not sent, one notification | ✓ plans with 48.2% (last level 45% + 1.84 kWh charged since), decision not_planned | ✓ plans with 47.2% (last level 45% + 1.84 kWh charged since), decision not_planned |
| V3 | Battery level not read for 3 hours (old after 2): estimate from the last level; back: the real level, at most one message an hour | ✓ stale: 50% · back: 50% | ✓ stale: 50% · back: 50% |
| V4 | Nothing known yet (fresh start, level unavailable): plans as if at the minimum (20 %) and charges | ✓ assumed 20%, planned 40.0 kWh | ✓ assumed 20%, planned 59.3 kWh |

## K. Price forecast and checklist

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| K1 | Forecast on: plan waits for the cheap forecast day, never charges on it now | ✓ 31 forecast hours, planned: 10-11T09 (forecast) | ✓ 31 forecast hours, planned: 10-11T09 (forecast) |
| K2 | Forecast is not used without a departure | ✓ | ✓ |
| K3 | Checklist after setup: ready; shows the points that need attention | ✓ vehicle:ok charger:ok method:ok prices:ok forecast:ok departures:ok control:ok car_limit:ok conflicts:ok notify:ok grid:ok battery:optional solar:optional | ✓ vehicle:ok charger:ok method:ok prices:ok forecast:ok departures:ok control:ok car_limit:ok conflicts:ok notify:ok grid:ok battery:optional solar:optional |

## L. Security

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| L1 | Refused: a change sent as text/plain (not JSON) | ✓ | ✓ |
| L2 | Refused: a change from another site | ✓ | ✓ |
| L3 | Refused: invalid JSON | ✓ | ✓ |
| L4 | Download diagnostics: settings, control check, entities, log; no notify target, trip titles or token | ✓ 53 kB, 10 entities, 14 log lines | ✓ 49 kB, 10 entities, 14 log lines |

## M. Settings export and import

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| M1 | Export: all settings in one file, without the Configuration options (Allow control) | ✓ 13 parts, 3 kB | ✓ 13 parts, 4 kB |
| M2 | Refused: not a settings file, a file with unknown parts, a newer format | ✓ | ✓ |
| M3 | Import in a fresh install (like the dev version): preview, then the same settings; Allow control stays as configured | ✓ car JLZ03X, charger Laadpaal, prices EnergyZero | ✓ car Enyaq, charger Wallbox Pulsar Plus, prices EnergyZero |
| M4 | Import with things this Home Assistant does not have: battery and notify action left out, entities listed | ✓ Not found in this Home Assistant: sensor.other_house_battery_soc / The home battery was left out: it was not found here / Notifications were switched off: that notify action does not exist here | ✓ Not found in this Home Assistant: sensor.other_house_battery_soc / The home battery was left out: it was not found here / Notifications were switched off: that notify action does not exist here |

## N. Reliability

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| N1 | A failed charger command is retried on the next control step | ✓ 1 successful retry | ✓ 1 successful retry |
| N2 | A Home Assistant reconnect immediately refreshes the cached plan | ✓ 22.9 -> 34.3 kWh | ✓ 33.9 -> 50.8 kWh |

## W. More than one car on one charger

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| W1 | Off by default: one car as before; adding a second car or choosing a car is refused | ✓ one car: JLZ03X (car1) | ✓ one car: Enyaq (car1) |
| W2 | Turned on: a second car is added next to the first; the first keeps its id and settings | ✓ JLZ03X (car1), EV6 (car2) | ✓ Enyaq (car1), EV6 (car2) |
| W3 | Only the EV6 says it is plugged in: the plan is for the EV6 (its level, its capacity) | ✓ EV6 at 30% · needs 42.4 kWh | ✓ EV6 at 30% · needs 42.4 kWh |
| W4 | Only JLZ03X says it is plugged in: the plan is for JLZ03X | ✓ JLZ03X at 40% | ✓ Enyaq at 40% |
| W5 | Both say plugged in (one at a public charger): the app asks once, does not change a car limit; your choice wins until the charger is unplugged | ✓ asked once; chosen: EV6; unplugged: last = EV6 | ✓ asked once; chosen: EV6; unplugged: last = EV6 |
| W6 | A car without a plug sensor is the one when no other car says it is plugged in | ✓ EV6 (no_other) | ✓ EV6 (no_other) |
| W7 | Own departures for the EV6 (60 %); the other car keeps the shared ones (80 %) | ✓ EV6 → 60% · JLZ03X → 80% | ✓ EV6 → 60% · Enyaq → 80% |
| W7b | One calendar for both cars: "auto:"/"car:" in an event is only for that car (name or brand), without it for every car, an unknown car counts for every car | ✓ EV6 → 70% (car: kia) · JLZ03X → 90% · new trip: "doel: 75 precondition: ja auto: EV6" | ✓ EV6 → 70% (car: kia) · Enyaq → 90% · new trip: "doel: 75 precondition: ja auto: EV6" |
| W8 | Turned off: the first car only, as before; the EV6 stays saved; removing it works | ✓ back to one car | ✓ back to one car |

## Y. Looking ahead: the next goal and what a trip costs

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| Y1 | Target reached (100 %), trip with an address tomorrow: the next goal (Werk, 80 %) is shown, the trip costs ~46 % there and back (60 km by road, 18 kWh/100 km, +10 %), so ~54 % is expected after it, with the expected charging (orange) after the car is back | ✓ trip 60 km → 45.7% · back ~54.3% · next: Naar Werk 80% · expected 14.7 kWh, 14.7 kWh in known prices | ✓ trip 60 km → 30.9% · back ~69.1% · next: Naar Werk 80% · expected 9.2 kWh, 9.2 kWh in known prices |
| Y2 | A return trip in the calendar ("Naar Thuis", 16:00–17:00): the car is back at 17:00 and the way home is not the next goal | ✓ back 15:00 UTC · next Naar Werk | ✓ back 15:00 UTC · next Naar Werk |
| Y3 | An extra calendar trip becomes the next stop, and the 100% long trip after it becomes the next goal instead of the later work trip | ✓ next stop Naar Spijkenisse 60% · next goal Naar Outdoorvalley 100% | ✓ next stop Naar Spijkenisse 60% · next goal Naar Outdoorvalley 100% |
| Y2b | Outdoorvalley on Sunday, then Naar Werk (company + address) and Naar Thuis (home address) on Monday: no trip home for Sunday, the next goal is Monday's Naar Werk, the company address is found without the company name | ✓ back Sun 20:00 · next goal Mon 06:00 Naar Werk · Werk ~60 km | ✓ back Sun 20:00 · next goal Mon 06:00 Naar Werk · Werk ~60 km |
| Y5 | The coming days as one timeline: charging, leaving, back home, expected charging (orange), leaving again, …; the chart goes on to the expected charging | ✓ charge leave back expected leave back expected leave back | ✓ charge leave back expected leave back expected leave back |
| Y6 | My places: "Werk" and a company name ("IQ Messenger") are no address; Home offers to add "Werk" to My places; once saved, both Naar Werk trips show what they cost | ✓ Werk → 60 km, 45.7% there and back | ✓ Werk → 60 km, 30.9% there and back |
| Y7 | Zones in Home Assistant: a zone "Werk" (GPS) is used without an address, for "Werk" and for "Naar Werk" with "IQ Messenger"; Plan lists the zone, not Home | ✓ zone Werk → 60 km (route) | ✓ zone Werk → 60 km (route) |
| Y4 | No route from OpenStreetMap: the straight line × 1.3, marked as an estimate; "Werk" is not an address: no cost, the next goal is still shown | ✓ estimate 57.5 km (straight line × 1.3) | ✓ estimate 57.5 km (straight line × 1.3) |

## Z. Apple iCloud calendar (read only)

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| Z1 | An iCloud calendar is read: "doel: 90" becomes the departure; it is marked read only and adding trips to it is refused with a clear reason | ✓ departure from iCloud: 90% · adding refused | ✓ departure from iCloud: 90% · adding refused |

## U. Add trip (writes to the calendar)

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| U1 | One car: no car to choose (the trip is for that car), the event is "Naar <destination>" with the destination as location, "doel: 90 precondition: ja" and lasts until "Back home at" | ✓ Naar Stationsplein 1, 3511 ED Utrecht · doel: 90 precondition: ja | ✓ Naar Stationsplein 1, 3511 ED Utrecht · doel: 90 precondition: ja |
| U2 | Added: written to the calendar once, and right away the departure on Plan and the next stop in Looking ahead, with the trip there and back (75 km by road each way) and back home at 17:30 | ✓ next stop Naar Stationsplein 1, 3511 ED Utrecht · 75 km → 57.1% there and back · back 32.9% | ✓ next stop Naar Stationsplein 1, 3511 ED Utrecht · 75 km → 38.6% there and back · back 51.4% |
| U3 | Added twice: the second time nothing is added (already in the calendar); the Plan tab lists the trip with its cost | ✓ | ✓ |
| U4 | Calendar read by keyword ("EV"): a trip added by the app (with "doel: 90") still counts | ✓ | ✓ |
| U5 | Calendar not used for departures: Add trip is refused (the trip would never count), nothing written | ✓ | ✓ |
| U6 | More cars: a trip for the EV6 gets "auto: EV6" and only counts for the EV6; "Every car" gets no car and counts for both | ✓ car1: Naar Utrecht · EV6: Naar Stationsplein 1, 3511 ED Utrecht, Naar Utrecht | ✓ car1: Naar Utrecht · EV6: Naar Stationsplein 1, 3511 ED Utrecht, Naar Utrecht |

## X. More than one charger

| # | What is tested | A: Renault Megane E-Tech + Easee Charge | B: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus |
|---|---|---|---|
| X1 | Off by default: one charger as before; adding a second charger is refused | ✓ one charger: Laadpaal (charger1) | – (not for this set-up) |
| X2 | Turned on: the Garage charger is added with its usual car (EV6); the first charger keeps its settings | ✓ Laadpaal (charger1) → car1, Garage (charger2) → car2 | – (not for this set-up) |
| X3 | Each charger has its own plan: Laadpaal for the first car, Garage for the EV6 (both plugged in) | ✓ JLZ03X: 22.9 kWh · EV6: 42.4 kWh | – (not for this set-up) |
| X4 | Both must charge now (below the minimum), main fuse 25 A: the EV6 (least room to spare) gets 16 A, the other the rest (6 A) | ✓ available 22.8 A: Garage (EV6) 16 A, Laadpaal 6 A | – (not for this set-up) |
| X5 | The house uses more (4.6 kW): too little left for the second car: it waits, the EV6 keeps charging | ✓ Laadpaal: Waiting: the connection is in use, EV6 goes first | – (not for this set-up) |
| X6 | Only the EV6 is home, at the Laadpaal (Garage empty): the Laadpaal plans for the EV6, the Garage for the other car | ✓ Laadpaal → EV6 · Garage → JLZ03X | – (not for this set-up) |
| X7 | Sensors and messages say which charger: sensor.smart_charging_garage_status; the first charger keeps its names | ✓ | – (not for this set-up) |
| X8 | Turned off: the first charger only, as before; the Garage stays saved | ✓ back to one charger | – (not for this set-up) |

## Not covered by these tests

- House load, learned charging power and Savings: they need long-term statistics, which the fake Home Assistant does not have.
- The real cars, chargers and inverters: response time of the car's cloud (Renault, MySkoda), the charger and the solar forecast. The fake reacts immediately.
- Phase switching on a real charger: some chargers pause the session while switching.
- Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.
- Look ahead with the real OpenStreetMap: the test uses a fake address search and route; real addresses can be found differently or not at all.
- Two real chargers on one connection: the test checks the decisions, not how fast real chargers follow a lower current.
- Adding trips to a real calendar (Google, Local calendar, CalDAV): the fake calendar shows a new event right away; a real one can take a moment.
- The page itself (buttons, forms): checked with screenshots during development, not in this test.

# Unit tests

Each file runs on its own without Home Assistant: `node tests/<name>.test.js`.

| File | What | Passed |
|---|---|---|
| [brands.test.js](#brands) | Chargers per brand: detection, start/stop, current, phase switching, status texts | 127 of 127 ✓ |
| [solar.test.js](#solar) | Inverters, solar forecasts, the value of own solar power, charging on surplus | 46 of 46 ✓ |
| [battery.test.js](#battery) | Home batteries: detection, commands, the guard, the battery plan | 84 of 84 ✓ |
| [forecast.test.js](#forecast) | Price forecast: reading it and planning with it | 12 of 12 ✓ |
| [reliability.test.js](#reliability) | Ready Guard: is the car ready in time, and what happens when it is not | 12 of 12 ✓ |
| [activecar.test.js](#activecar) | More than one car: which car is connected; car, target and precondition in the calendar | 14 of 14 ✓ |
| [sharing.test.js](#sharing) | More than one charger: who charges first and how the connection is shared | 11 of 11 ✓ |
| [tripcost.test.js](#tripcost) | Look ahead: which calendar locations are addresses, the use per km, learning from trips | 10 of 10 ✓ |
| [persistence.test.js](#persistence) | Saving settings safely (a crash while saving loses nothing) | 1 of 1 ✓ |

## brands

Chargers per brand: detection, start/stop, current, phase switching, status texts.

<details><summary>127 of 127 passed – show every check</summary>

| Part | Check | Result |
|---|---|---|
| Easee | detected as charger | ✓ |
|  | status sensor sensor.emvgus3h_status | ✓ |
|  | power sensor sensor.emvgus3h_power | ✓ |
|  | start/stop method switch | ✓ |
|  | uses switch.emvgus3h_charger_enabled | ✓ |
|  | no own_smart_charging_on | ✓ |
|  | start/stop commands allowed | ✓ |
|  | solar current: action_current:set_charger_dynamic_limit | ✓ |
|  | current command 10 A allowed | ✓ |
|  | phase switching: action_phase:1_phase/3_phase | ✓ |
|  | phase commands allowed | ✓ |
|  | status "awaiting_start" → plugged true, charging false | ✓ |
|  | status "charging" → plugged true, charging true | ✓ |
|  | status "disconnected" → plugged false, charging null | ✓ |
|  | status "completed" → plugged true, charging false | ✓ |
|  | status "ready_to_charge" → plugged true, charging false | ✓ |
| Zaptec | detected as charger | ✓ |
|  | status sensor sensor.zaptec_go_charger_mode | ✓ |
|  | power sensor sensor.zaptec_go_charge_power | ✓ |
|  | start/stop method buttons | ✓ |
|  | start/stop commands allowed | ✓ |
|  | solar current: number:number.zaptec_go_charger_max_current | ✓ |
|  | current command 10 A allowed | ✓ |
|  | phase switching: not possible | ✓ |
|  | status "disconnected" → plugged false, charging null | ✓ |
|  | status "connected_requesting" → plugged true, charging false | ✓ |
|  | status "connected_charging" → plugged true, charging true | ✓ |
|  | status "connected_finished" → plugged true, charging false | ✓ |
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
|  | status "Charging Normal" → plugged true, charging true | ✓ |
|  | status "Suspended Over Current" → plugged true, charging false | ✓ |
|  | status "Finish Wait Disconnect" → plugged true, charging false | ✓ |
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
|  | status "Paused" → plugged true, charging false | ✓ |
|  | status "Ready" → plugged false, charging null | ✓ |
|  | status "Disconnected" → plugged false, charging null | ✓ |
|  | status "Waiting for car demand" → plugged true, charging false | ✓ |
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
|  | status "Charging" → plugged true, charging true | ✓ |
|  | status "Wait for car" → plugged true, charging false | ✓ |
|  | status "Complete" → plugged true, charging false | ✓ |
| go-e (cathiele) | detected as charger | ✓ |
|  | status sensor sensor.goecharger_home_car_status | ✓ |
|  | start/stop method switch | ✓ |
|  | start/stop commands allowed | ✓ |
|  | solar current: not possible | ✓ |
|  | phase switching: not possible | ✓ |
|  | status "Charger ready, no vehicle" → plugged false, charging null | ✓ |
|  | status "charging" → plugged true, charging true | ✓ |
|  | status "Waiting for vehicle" → plugged true, charging false | ✓ |
|  | status "charging finished, vehicle still connected" → plugged true, charging false | ✓ |
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
|  | status "charging" → plugged true, charging true | ✓ |
|  | status "suspended" → plugged true, charging false | ✓ |
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
|  | status "Preparing" → plugged true, charging false | ✓ |
|  | status "Charging" → plugged true, charging true | ✓ |
|  | status "SuspendedEV" → plugged true, charging false | ✓ |
|  | status "SuspendedEVSE" → plugged true, charging false | ✓ |
|  | status "Finishing" → plugged true, charging false | ✓ |
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
|  | status "plugged_in" → plugged true, charging false | ✓ |
|  | status "charging" → plugged true, charging true | ✓ |
|  | status "paused" → plugged true, charging false | ✓ |
|  | status "finished" → plugged true, charging false | ✓ |
| Tesla Wall Connector | says it can only read | ✓ |

</details>

## solar

Inverters, solar forecasts, the value of own solar power, charging on surplus.

<details><summary>46 of 46 passed – show every check</summary>

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

<details><summary>12 of 12 passed – show every check</summary>

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

</details>

## reliability

Ready Guard: is the car ready in time, and what happens when it is not.

<details><summary>12 of 12 passed – show every check</summary>

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

</details>

## activecar

More than one car: which car is connected; car, target and precondition in the calendar.

<details><summary>14 of 14 passed – show every check</summary>

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

</details>

## sharing

More than one charger: who charges first and how the connection is shared.

<details><summary>11 of 11 passed – show every check</summary>

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
| straight line: Reusel to Bergschenhoek is about 100 km | ✓ |
| My places: "Werk" (location or title "Naar Werk") uses its address; a real address in the location wins; unknown names are suggested | ✓ |
| Zones in Home Assistant: "Werk" (by name or by the title) is a point with GPS; the home zone is not a place; My places go first | ✓ |

</details>

## persistence

Saving settings safely (a crash while saving loses nothing).

<details><summary>1 of 1 passed – show every check</summary>

| Check | Result |
|---|---|
| all checks | ✓ |

</details>

# Matrix: every charger with every home battery

`node tests/matrix.test.js` (several minutes; `SCP_CHARGERS=Easee,Zaptec` for a part). The real app against a fake Home Assistant with a Renault, one charger brand and, one after the other, every home battery brand from `tests/fixtures.js`. The fake charger reacts to exactly the start/stop command the app's control check chooses; `tests/brands.test.js` checks those commands per brand.

## Per charger

| Charger | Method | Charge now | Solar 6 kW | Solar 2.5 kW | Back to full power | Only own commands | Batteries |
|---|---|---|---|---|---|---|---|
| Easee | ✓ switch, current: action_current, phases: action_phase | ✓ switch.turn_on switch.emvgus3h_charger_enabled {} → switch.turn_off switch.emvgus3h_charger_enabled {} | ✓ 7 A · switch.turn_on switch.emvgus3h_charger_enabled {} · easee.set_charger_dynamic_limit {"device_id":"ch","current":7,"time_to_live":30} | ✓ one phase, 6 A · easee.set_charger_phase_mode {"device_id":"ch","phase_mode":"1_phase"} · easee.set_charger_dynamic_limit {"device_id":"ch",… | ✓ switch.turn_on switch.emvgus3h_charger_enabled {} · easee.set_charger_phase_mode {"device_id":"ch","phase_mode":"3_phase"} · easee.set_charg… | ✓ 14 commands | 90 of 90 ✓ |
| Zaptec | ✓ buttons, current: number, phases: none | ✓ button.press button.zaptec_go_resume_charging {} → button.press button.zaptec_go_stop_charging {} | ✓ 7 A · button.press button.zaptec_go_resume_charging {} · number.set_value number.zaptec_go_charger_max_current {"value":7} | ✓ paused · button.press button.zaptec_go_stop_charging {} | ✓ button.press button.zaptec_go_resume_charging {} · number.set_value number.zaptec_go_charger_max_current {"value":16} | ✓ 12 commands | 90 of 90 ✓ |
| Alfen | ✓ switch, current: number, phases: none | ✓ switch.turn_on switch.alfen_eve_charging {} → switch.turn_off switch.alfen_eve_charging {} | ✓ 7 A · switch.turn_on switch.alfen_eve_charging {} · number.set_value number.alfen_eve_power_connector_max_current_socket_1 {"value":7} | ✓ paused · switch.turn_off switch.alfen_eve_charging {} | ✓ switch.turn_on switch.alfen_eve_charging {} · number.set_value number.alfen_eve_power_connector_max_current_socket_1 {"value":16} | ✓ 12 commands | 90 of 90 ✓ |
| Wallbox | ✓ switch, current: number, phases: none | ✓ switch.turn_on switch.wallbox_pulsar_plus_pause_resume {} → switch.turn_off switch.wallbox_pulsar_plus_pause_resume {} | ✓ 7 A · switch.turn_on switch.wallbox_pulsar_plus_pause_resume {} · number.set_value number.wallbox_pulsar_plus_maximum_charging_current {"val… | ✓ paused · switch.turn_off switch.wallbox_pulsar_plus_pause_resume {} | ✓ switch.turn_on switch.wallbox_pulsar_plus_pause_resume {} · number.set_value number.wallbox_pulsar_plus_maximum_charging_current {"value":16… | ✓ 12 commands | 90 of 90 ✓ |
| go-e (marq24) | ✓ select, current: number, phases: select_phase | ✓ select.select_option select.goe_123456_frc {"option":"2"} → select.select_option select.goe_123456_frc {"option":"1"} | ✓ 7 A · select.select_option select.goe_123456_frc {"option":"2"} · number.set_value number.goe_123456_amp {"value":7} | ✓ one phase, 6 A · select.select_option select.goe_123456_psm {"option":"1"} · number.set_value number.goe_123456_amp {"value":6} | ✓ select.select_option select.goe_123456_frc {"option":"2"} · select.select_option select.goe_123456_psm {"option":"2"} · number.set_value num… | ✓ 14 commands | 90 of 90 ✓ |
| go-e (cathiele) | ✓ switch, current: none, phases: none | ✓ switch.turn_on switch.goecharger_home_allow_charging {} → switch.turn_off switch.goecharger_home_allow_charging {} | ✓ no current control: waits for 11 kW | ✓ paused · was not charging | ✓ switch.turn_on switch.goecharger_home_allow_charging {} | ✓ 8 commands | 90 of 90 ✓ |
| Peblar | ✓ switch, current: number, phases: switch_phase | ✓ switch.turn_on switch.peblar_ev_charger_charge {} → switch.turn_off switch.peblar_ev_charger_charge {} | ✓ 7 A · switch.turn_on switch.peblar_ev_charger_charge {} · number.set_value number.peblar_ev_charger_charge_limit {"value":7} | ✓ one phase, 6 A · switch.turn_on switch.peblar_ev_charger_force_single_phase {} · number.set_value number.peblar_ev_charger_charge_limit {"va… | ✓ switch.turn_on switch.peblar_ev_charger_charge {} · switch.turn_off switch.peblar_ev_charger_force_single_phase {} · number.set_value number… | ✓ 16 commands | 90 of 90 ✓ |
| OCPP | ✓ switch, current: number, phases: none | ✓ switch.turn_on switch.charger_charge_control {} → switch.turn_off switch.charger_charge_control {} | ✓ 7 A · switch.turn_on switch.charger_charge_control {} · number.set_value number.charger_maximum_current {"value":7} | ✓ paused · switch.turn_off switch.charger_charge_control {} | ✓ switch.turn_on switch.charger_charge_control {} · number.set_value number.charger_maximum_current {"value":16} | ✓ 12 commands | 90 of 90 ✓ |
| Ohme | ✓ select, current: none, phases: none | ✓ select.select_option select.ohme_home_pro_charge_mode {"option":"max_charge"} → select.select_option select.ohme_home_pro_charge_mode {"opti… | ✓ no current control: waits for 11 kW | ✓ paused · was not charging | ✓ select.select_option select.ohme_home_pro_charge_mode {"option":"max_charge"} | ✓ 8 commands | 90 of 90 ✓ |
| Tesla Wall Connector | ✓ read only: no start/stop | ✓ nothing sent (boost: 200) | ✓ nothing sent | ✓ nothing sent | ✓ nothing sent | ✓ 4 commands | 90 of 90 ✓ |

## Per battery (the same with every charger; notes from the run with Easee)

Per battery: 1 found, 2 switching from the previous battery puts that one back in its own mode, 3 car charges → no discharging into it, 4 car stops → back to its own mode, 5 car starts charging by itself → no discharging into it, 6 only commands to this charger, the car's limit or this battery.

| Battery | Can | Car charges | Car stops | Car charges by itself | All chargers |
|---|---|---|---|---|---|
| Sigenergy (sigen) | ✓ can: auto, charge, discharge, hold | ✓ hold (Battery plan: hold): turn_on · select_option Standby | ✓ auto (Battery plan: auto): turn_off | ✓ hold (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| Huawei LUNA2000 (huawei_solar) | ✓ can: auto, charge, discharge, no_discharge, hold | ✓ hold (Battery plan: hold): stop_forcible_charge · set_value 0 · set_value 0 | ✓ auto (Battery plan: auto): stop_forcible_charge · set_value 5000 · set_value 5000 | ✓ no_discharge (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| SolarEdge (solaredge_modbus_multi) | ✓ can: auto, charge, discharge, hold, no_discharge | ✓ hold (Battery plan: hold): select_option Remote Control · set_value 3600 · select_option Solar Power Only (Off) | ✓ auto (Battery plan: auto): select_option Maximize Self Consumption | ✓ no_discharge (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| Victron (victron) | ✓ can: auto, charge, no_discharge | ✓ no_discharge (Battery plan: no discharge): select_option SELF_CONSUMPTION_WITH_BATTERY_LIFE · set_value 0 | ✓ auto (Battery plan: auto): select_option SELF_CONSUMPTION_WITH_BATTERY_LIFE · set_value 8000 | ✓ no_discharge (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| GoodWe (goodwe) | ✓ can: auto, charge, discharge · cannot stop discharging into the car (warned) | ✓ cannot prevent it: no_discharge is not possible with this battery | ✓ nothing sent | ✓ cannot prevent it: no_discharge is not possible with this battery | 60 of 60 ✓ |
| Tesla Powerwall (teslemetry) | ✓ can: auto, no_discharge | ✓ no_discharge (Battery plan: no discharge): select_option self_consumption · set_value 75 | ✓ auto (Battery plan: auto): set_value 20 | ✓ no_discharge (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| HomeWizard Plug-In Battery (homewizard) | ✓ can: auto, charge, hold, no_discharge | ✓ hold (Battery plan: hold): select_option standby | ✓ auto (Battery plan: auto): select_option zero | ✓ no_discharge (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| Marstek Venus (marstek_modbus) | ✓ can: auto, charge, discharge, hold | ✓ hold (Battery plan: hold): turn_on · select_option standby | ✓ auto (Battery plan: auto): turn_off | ✓ hold (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| Marstek Venus (marstek_local_api) | ✓ can: charge, discharge, auto · cannot stop discharging into the car (warned) | ✓ cannot prevent it: no_discharge is not possible with this battery | ✓ nothing sent | ✓ cannot prevent it: no_discharge is not possible with this battery | 60 of 60 ✓ |
| Sessy (sessy) | ✓ can: auto, hold | ✓ hold (Battery plan: hold): select_option idle | ✓ auto (Battery plan: auto): select_option roi | ✓ hold (The car is charging: the battery does not discharge into it) · car still charging | 60 of 60 ✓ |
| Zonneplan Nexus (zonneplan_one) | ✓ read only | ✓ nothing sent (Zonneplan steers the Nexus itself (dynamic charging); the integration offers no charge or discharge command.) | ✓ nothing sent | ✓ nothing sent | 60 of 60 ✓ |
| Growatt (growatt_server) | ✓ read only | ✓ nothing sent (Growatt cloud only offers time segments in %, not commands; not supported yet.) | ✓ nothing sent | ✓ nothing sent | 60 of 60 ✓ |
| Anker Solix (anker_solix) | ✓ read only | ✓ nothing sent (Anker Solix is steered with schedules and presets, not with charge or discharge commands; not supported yet.) | ✓ nothing sent | ✓ nothing sent | 60 of 60 ✓ |
| EcoFlow (ecoflow_cloud) | ✓ read only | ✓ nothing sent (EcoFlow offers no charge or discharge command in Home Assistant.) | ✓ nothing sent | ✓ nothing sent | 60 of 60 ✓ |
| Tesla Powerwall (powerwall) | ✓ read only | ✓ nothing sent (The local Powerwall integration can only read the battery; use Teslemetry or Tesla Fleet to steer it.) | ✓ nothing sent | ✓ nothing sent | 60 of 60 ✓ |

GoodWe and Marstek (Local API) cannot be told to stop discharging from Home Assistant: the app says so on Settings › Battery. The read-only brands are never sent anything.
