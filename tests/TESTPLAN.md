# Test plan: settings

Every setting of the app, tested against a fake Home Assistant (`tests/fake-ha.js`). The test starts the real app with a temporary data folder and uses the same API as the page: what is saved, what is refused, what the plan does and what is sent to Home Assistant.

Two set-ups, with entity names taken from the integrations' own source code:

- **A**: Renault Megane E-Tech + Easee Charge
- **B**: Skoda Enyaq (MySkoda) + Wallbox Pulsar Plus

Both also have a P1 meter, a Fronius inverter, EnergyZero prices, a price sensor with a 7-day forecast, a solar forecast in the Energy dashboard, a Sigenergy home battery, a Sigenergy home battery, a Sigenergy home battery, a Sigenergy home battery, a Sigenergy home battery, a Sigenergy home battery, a Sigenergy home battery, a Sigenergy home battery, a Sigenergy home battery, a Sigenergy home battery, a calendar, helpers and notify actions.

Run (from the repository root, after `npm install` in `smart_charging_planner/app`), about a minute each:

```
node tests/settings.test.js
SCP_PROFILE=skoda_wallbox node tests/settings.test.js
```

Brand by brand, without Home Assistant: `node tests/brands.test.js` (chargers: detection, start/stop, current, phase switching, status texts), `node tests/solar.test.js` (inverters, solar forecasts, feed-in value, charging on surplus) and `node tests/battery.test.js` (home batteries: detection, commands, the guard, the battery plan).

Last run (v0.25.3): **A 115 of 115**, **B 114 of 114** passed.


## A. Fresh install and checklist

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| A1 | Fresh install: checklist says vehicle, charger and prices are missing | ✓ missing: vehicle, charger, prices | ✓ missing: vehicle, charger, prices |
| A2 | Fresh install: Allow control is off by default | ✓ | ✓ |
| A3 | Fresh install: plan asks for prices and vehicle | ✓ | ✓ |

## B. Vehicle

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
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

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
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

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| D1 | Detect finds the P1 meter | ✓ | ✓ |
| D2 | Refused: main fuse 300 A | ✓ Main fuse must be between 6 and 200 A | ✓ Main fuse must be between 6 and 200 A |
| D3 | Refused: no net or import sensor | ✓ Choose a net power sensor, or an import power sensor | ✓ Choose a net power sensor, or an import power sensor |
| D4 | Save the P1 meter (25 A, load balancer in the charger) | ✓ | ✓ |

## E. Prices

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| E1 | Detect offers EnergyZero, the combined sensor and the fixed tariff | ✓ | ✓ |
| E2 | Test shows 24 prices today and 24 tomorrow | ✓ | ✓ |
| E3 | Market price excl. VAT + fee + tax: all-in = (price + fee + tax) × 1.21 | ✓ 0.2 → 0.3872 | ✓ 0.2 → 0.3872 |
| E4 | Market price incl. VAT: all-in = price + (fee + tax) × 1.21 | ✓ | ✓ |
| E5 | All-in price: used as it is | ✓ | ✓ |
| E6 | Refused: purchase fee 2, VAT 80 | ✓ | ✓ |
| E7 | Fixed tariff: refused when low from = low until, or time "25:00" | ✓ | ✓ |
| E8 | Day/night tariff: the plan charges in the low hours | ✓ planned hours 23,0,1 | ✓ planned hours 23,0,1,2 |
| E9 | Refused: forecast sensor with a bad name, margin 0.6 | ✓ | ✓ |

## F. Planning (departures)

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
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

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| G1 | Refused: default minimum 50 %, force window 700 min, hysteresis 2 | ✓ | ✓ |
| G2 | Minimum battery level: below it → charge now | ✓ | ✓ |
| G3 | Minimum with a price limit below the current price → not charged for the minimum | ✓ then: not_planned | ✓ then: not_planned |
| G3b | Minimum taken from an entity (the car's own minimum, here 70 %) | ✓ | ✓ |
| G4 | Preconditioning entity on → charge | ✓ | ✓ |
| G5 | Force window: departure within the window → charge | ✓ force_window | ✓ force_window |
| G6 | Not in a planned block and not charging → pause | ✓ paused | ✓ paused |
| G7 | Default minimum for quick choices is used on Home | ✓ | ✓ |
| G8 | Allow control off: the car limit is not changed and the plan stops at the limit | ✓ | ✓ |
| G9 | Allow control off: nothing is sent to Home Assistant | ✓ | ✓ |

## H. Notifications

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| H1 | Refused: a notify action that does not exist | ✓ Choose a notify action from the list | ✓ Choose a notify action from the list |
| H2 | Choose mobile_app_pixel_8 and send a test notification | ✓ | ✓ |
| H3 | Test notification refused when no notify action is chosen | ✓ | ✓ |

## I. Configuration tab in Home Assistant

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| I1 | Charging loss margin 20 %: more energy planned than with 10 % | ✓ 22.88 → 24.96 kWh | ✓ 33.88 → 36.96 kWh |
| I2 | Invalid option values fall back to the defaults (loss 99 %, refresh 0) | ✓ | ✓ |
| I3 | Continuous charging off: blocks may be split | ✓ 1 period(s) | ✓ 2 period(s) |
| I4 | Publish sensors on: sensor.smart_charging_* are written | ✓ 8 sensors | ✓ 8 sensors |
| I5 | Publish sensors off: nothing is written | ✓ | ✓ |

## J. Allow control on: quick choices and the car limit

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| J1 | Car limit follows the plan: tomorrow 90 % (one call) | ✓ number.set_value 90 | ✓ number.set_value 90 |
| J2 | Plan is not capped at the old limit when the app manages it | ✓ | ✓ |
| J3 | Ready for the day after tomorrow 95 %: minimum 30 % first, limit follows | ✓ 42.9 kWh before 10-07T05:00, limit sent 95 | ✓ 63.5 kWh before 10-07T05:00, limit sent 100 |
| J4 | Back to normal: limit goes down to the plan again | ✓ limit 90 | ✓ limit 90 |
| J4b | Ready for the day after tomorrow, chosen for a calendar trip; the trip is removed → the choice ends by itself | ✓ based on "Naar werk", ended; notified: The departure it was chosen for (Naar werk on 2026-10-08) is no longer planned. The car is planned for the next departure again. | ✓ based on "Naar werk", ended; notified: The departure it was chosen for (Naar werk on 2026-10-08) is no longer planned. The car is planned for the next departure again. |
| J4c | Ready for tomorrow when no departure was planned that day: the choice stays | ✓ | ✓ |
| J5 | Quickly to a minimum (35 %) does not lower the limit | ✓ | ✓ |
| J6 | Charge now 100 %: limit up, charger started; stop: limit back | ✓ limit 100 → 90, start: switch.turn_on switch.laadpaal_charger_enabled | ✓ limit 100 → 90, start: switch.turn_on switch.wallbox_pulsar_plus_pause_resume |
| J7 | Charge now as kWh: preview converts it to a level for the limit | ✓ | ✓ |
| J8 | "Don't change the car's charge limit": nothing sent, plan capped at the limit | ✓ | ✓ |
| J9 | Notification on start (notify every start and pause) | ✓ Car charge limit changed · Charging started · Charging paused · Car charge limit changed | ✓ Car charge limit changed · Charging started · Charging paused · Car charge limit changed |
| J9b | Manual test (Diagnostics): start and stop really sent | ✓ switch.turn_on switch.laadpaal_charger_enabled → switch.turn_off switch.laadpaal_charger_enabled | ✓ switch.turn_on switch.wallbox_pulsar_plus_pause_resume → switch.turn_off switch.wallbox_pulsar_plus_pause_resume |
| J12 | Target 85 %: limit rounded up to a step the car accepts, the plan still stops at 85 % | ✓ limit 85 %, at 85 %: at_target | ✓ limit 90 %, at 85 %: at_target |
| J10 | Car unplugged: Charge now is refused | ✓ | ✓ |
| J11 | Notify every start and pause off: start is not notified | ✓ no notifications | ✓ no notifications |

## S. Solar

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| S1 | Refused: solar up to 30 %, forecast sensor without a sensor, factor 2 | ✓ | ✓ |
| S2 | Solar page: forecast from the Energy dashboard, inverter found, phase switching of the charger | ✓ forecast tomorrow 18 kWh, inverter Fronius, phase switching: Set charger phase mode, current: Set charger dynamic limit | ✓ forecast tomorrow 18 kWh, inverter Fronius, phase switching: not possible, current: Wallbox Pulsar Plus Maximum Charging Current |
| S3 | Plan + solar, feed-in 0.03: the plan charges on tomorrow's sun (cheaper than the night at 0.05) | ✓ 20.2 kWh on solar, 14.1 kWh from the grid | ✓ 20.1 kWh on solar, 30.7 kWh from the grid |
| S4 | Dynamic feed-in (market 0.20 − 0.02 = 0.18) vs grid all-in 0.21 at night: the sun is cheaper, also without salderen | ✓ 20.2 kWh on solar | ✓ 20.1 kWh on solar |
| S4b | Feed-in 0.25 (more than the night at 0.21): the night first; the sun only for what does not fit (day grid 0.39) | ✓ 33.1 kWh at night, 1.2 kWh on solar | ✓ 33.1 kWh at night, 17.7 kWh on solar |
| S5 | Solar only: the plan uses only the sun | ✓ 20.2 kWh, notes: prices_incomplete, not_enough_known_time, solar_only | ✓ 20.1 kWh, notes: prices_incomplete, not_enough_known_time, solar_only |
| S6 | Live: 6 kW sun, car not charging → start on solar with a matching current | ✓ 7 A, sent: switch.turn_on switch.laadpaal_charger_enabled · easee.set_charger_dynamic_limit {"device_id":"ch","current":7,"time_to_live":30} | ✓ 7 A, sent: switch.turn_on switch.wallbox_pulsar_plus_pause_resume · number.set_value number.wallbox_pulsar_plus_maximum_charging_current 7 |
| S7 | Live: sun drops to 2.5 kW → one phase where the charger can, otherwise stop | ✓ one phase, 6 A · easee.set_charger_phase_mode {"device_id":"ch","phase_mode":"1_phase"} · easee.set_charger_dynamic_limit {"device_id":"ch","current":6,"time_to_live":30} | ✓ paused (no phase switching) · switch.turn_off switch.wallbox_pulsar_plus_pause_resume |
| S8 | Charge now after solar: current back to the maximum (and three phases) | ✓ switch.turn_on switch.laadpaal_charger_enabled · easee.set_charger_phase_mode {"device_id":"ch","phase_mode":"3_phase"} · easee.set_charger_dynamic_limit {"device_id":"ch","current":16,"time_to_live":30} | ✓ switch.turn_on switch.wallbox_pulsar_plus_pause_resume · number.set_value number.wallbox_pulsar_plus_maximum_charging_current 16 |
| S9 | Solar modes raise the car limit to "solar up to" (90 %) | ✓ | ✓ |
| S10 | Grid meter sign "delivering is positive": the reading is turned around | ✓ | ✓ |
| S12 | Easee Equalizer does solar: surplus charging on, charger on, no current or phase commands; Charge now: surplus off (full power) | ✓ switch.turn_on switch.laadpaal_charger_enabled · easee.set_surplus_charging true · Charge now: surplus false | ✓ |
| S13 | Back to the app: the surplus charging the app switched on goes off; Equalizer surplus on in the Easee app is reported | ✓ | – (not for this set-up) |
| S11 | Mode buttons refused without solar; solar off → back to the price plan | ✓ | ✓ |

## T. Home battery (Sigenergy)

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| T1 | Battery page finds the Sigenergy: level, power, capacity, what the app can do | ✓ can: auto, charge, discharge, hold | ✓ can: auto, charge, discharge, hold |
| T2 | Refused: minimum above maximum, a battery that does not exist, capacity 0 | ✓ | ✓ |
| T3 | Plan: charges from the grid in the cheap night (0.05) for the 0.20 hours, with a saving | ✓ charges in 3 block(s), saving €1.49 | ✓ charges in 3 block(s), saving €1.40 |
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

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| V1 | Refused: car data old after 100 hours; 2 hours is saved | ✓ | ✓ |
| V2 | Battery level "unavailable": the plan goes on from the last level plus what the charger delivered, the car limit is not sent, one notification | ✓ plans with 48.2% (last level 45% + 1.84 kWh charged since), decision not_planned | ✓ plans with 47.2% (last level 45% + 1.84 kWh charged since), decision not_planned |
| V3 | Battery level not read for 3 hours (old after 2): estimate from the last level; back: the real level, at most one message an hour | ✓ stale: 50% · back: 50% | ✓ stale: 50% · back: 50% |
| V4 | Nothing known yet (fresh start, level unavailable): plans as if at the minimum (20 %) and charges | ✓ assumed 20%, planned 40.0 kWh | ✓ assumed 20%, planned 59.3 kWh |

## K. Price forecast and checklist

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| K1 | Forecast on: plan waits for the cheap forecast day, never charges on it now | ✓ 31 forecast hours, planned: 10-08T09 (forecast) | ✓ 31 forecast hours, planned: 10-08T09 (forecast) |
| K2 | Forecast is not used without a departure | ✓ | ✓ |
| K3 | Checklist after setup: ready; shows the points that need attention | ✓ vehicle:ok charger:ok method:ok prices:ok forecast:ok departures:ok control:ok car_limit:ok conflicts:ok notify:ok grid:ok battery:optional solar:optional | ✓ vehicle:ok charger:ok method:ok prices:ok forecast:ok departures:ok control:ok car_limit:ok conflicts:ok notify:ok grid:ok battery:optional solar:optional |

## L. Security

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| L1 | Refused: a change sent as text/plain (not JSON) | ✓ | ✓ |
| L2 | Refused: a change from another site | ✓ | ✓ |
| L3 | Refused: invalid JSON | ✓ | ✓ |
| L4 | Download diagnostics: settings, control check, entities, log; no notify target, trip titles or token | ✓ 51 kB, 10 entities, 14 log lines | ✓ 48 kB, 10 entities, 14 log lines |

## M. Settings export and import

| # | What is tested | A: Renault + Easee | B: Skoda + Wallbox |
|---|---|---|---|
| M1 | Export: all settings in one file, without the Configuration options (Allow control) | ✓ 10 parts, 3 kB | ✓ 10 parts, 3 kB |
| M2 | Refused: not a settings file, a file with unknown parts, a newer format | ✓ | ✓ |
| M3 | Import in a fresh install (like the dev version): preview, then the same settings; Allow control stays as configured | ✓ car JLZ03X, charger Laadpaal, prices EnergyZero | ✓ car Enyaq, charger Wallbox Pulsar Plus, prices EnergyZero |
| M4 | Import with things this Home Assistant does not have: battery and notify action left out, entities listed | ✓ Not found in this Home Assistant: sensor.other_house_battery_soc / The home battery was left out: it was not found here / Notifications were switched off: that notify action does not exist here | ✓ Not found in this Home Assistant: sensor.other_house_battery_soc / The home battery was left out: it was not found here / Notifications were switched off: that notify action does not exist here |

## Not covered by this test

- House load, learned charging power and Savings: they need long-term statistics, which the fake Home Assistant does not have.
- The real cars, chargers and inverters: response time of the car's cloud (Renault, MySkoda), the charger and the solar forecast. The fake reacts immediately.
- Phase switching on a real charger: some chargers pause the session while switching.
- Adding trips with "Allow adding trips to calendar" on (only test mode is tested).
- Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.
- Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.
- Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.
- Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.
- Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.
- Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.
- Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.
- Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.
- Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.
- Real home batteries: how fast they follow a command, and the power sign of brands marked unverified.
- The page itself (buttons, forms): checked with screenshots during development, not in this test.

# Matrix: every charger with every home battery

`node tests/matrix.test.js` (several minutes; `SCP_CHARGERS=Easee,Zaptec` for a part). The real app against a fake Home Assistant with a Renault, one charger brand and, one after the other, every home battery brand from `tests/fixtures.js`. The fake charger reacts to exactly the start/stop command the app's control check chooses; `tests/brands.test.js` checks those commands per brand.

Last run (v0.25.3): **960 of 960** passed (10 chargers × 15 batteries).

## Per charger

| Charger | Method | Charge now | Solar 6 kW | Solar 2.5 kW | Back to full power | Only own commands | Batteries |
|---|---|---|---|---|---|---|---|
| Easee | ✓ switch, current: action_current, phases: action_phase | ✓ switch.turn_on switch.emvgus3h_charger_enabled {} → switch.turn_off switch.emvgus3h_charger_enabled {} | ✓ 7 A · switch.turn_on switch.emvgus3h_charger_enabled {} · easee.set_charger_dynamic_limit {"device_id":"ch","current":7,"time_to_live":30} | ✓ one phase, 6 A · easee.set_charger_phase_mode {"device_id":"ch","phase_mode":"1_phase"} · easee.set_charger_dynamic_limit {"device_id":"ch", | ✓ switch.turn_on switch.emvgus3h_charger_enabled {} · easee.set_charger_phase_mode {"device_id":"ch","phase_mode":"3_phase"} · easee.set_charg | ✓ 11 commands | 90 of 90 ✓ |
| Zaptec | ✓ buttons, current: number, phases: none | ✓ button.press button.zaptec_go_resume_charging {} → button.press button.zaptec_go_stop_charging {} | ✓ 7 A · button.press button.zaptec_go_resume_charging {} · number.set_value number.zaptec_go_charger_max_current {"value":7} | ✓ paused · button.press button.zaptec_go_stop_charging {} | ✓ button.press button.zaptec_go_resume_charging {} · number.set_value number.zaptec_go_charger_max_current {"value":16} | ✓ 9 commands | 90 of 90 ✓ |
| Alfen | ✓ switch, current: number, phases: none | ✓ switch.turn_on switch.alfen_eve_charging {} → switch.turn_off switch.alfen_eve_charging {} | ✓ 7 A · switch.turn_on switch.alfen_eve_charging {} · number.set_value number.alfen_eve_power_connector_max_current_socket_1 {"value":7} | ✓ paused · switch.turn_off switch.alfen_eve_charging {} | ✓ switch.turn_on switch.alfen_eve_charging {} · number.set_value number.alfen_eve_power_connector_max_current_socket_1 {"value":16} | ✓ 9 commands | 90 of 90 ✓ |
| Wallbox | ✓ switch, current: number, phases: none | ✓ switch.turn_on switch.wallbox_pulsar_plus_pause_resume {} → switch.turn_off switch.wallbox_pulsar_plus_pause_resume {} | ✓ 7 A · switch.turn_on switch.wallbox_pulsar_plus_pause_resume {} · number.set_value number.wallbox_pulsar_plus_maximum_charging_current {"val | ✓ paused · switch.turn_off switch.wallbox_pulsar_plus_pause_resume {} | ✓ switch.turn_on switch.wallbox_pulsar_plus_pause_resume {} · number.set_value number.wallbox_pulsar_plus_maximum_charging_current {"value":16 | ✓ 9 commands | 90 of 90 ✓ |
| go-e (marq24) | ✓ select, current: number, phases: select_phase | ✓ select.select_option select.goe_123456_frc {"option":"2"} → select.select_option select.goe_123456_frc {"option":"1"} | ✓ 7 A · select.select_option select.goe_123456_frc {"option":"2"} · number.set_value number.goe_123456_amp {"value":7} | ✓ one phase, 6 A · select.select_option select.goe_123456_psm {"option":"1"} · number.set_value number.goe_123456_amp {"value":6} | ✓ select.select_option select.goe_123456_frc {"option":"2"} · select.select_option select.goe_123456_psm {"option":"2"} · number.set_value num | ✓ 11 commands | 90 of 90 ✓ |
| go-e (cathiele) | ✓ switch, current: none, phases: none | ✓ switch.turn_on switch.goecharger_home_allow_charging {} → switch.turn_off switch.goecharger_home_allow_charging {} | ✓ no current control: waits for 11 kW | ✓ paused · was not charging | ✓ switch.turn_on switch.goecharger_home_allow_charging {} | ✓ 5 commands | 90 of 90 ✓ |
| Peblar | ✓ switch, current: number, phases: switch_phase | ✓ switch.turn_on switch.peblar_ev_charger_charge {} → switch.turn_off switch.peblar_ev_charger_charge {} | ✓ 7 A · switch.turn_on switch.peblar_ev_charger_charge {} · number.set_value number.peblar_ev_charger_charge_limit {"value":7} | ✓ one phase, 6 A · switch.turn_on switch.peblar_ev_charger_force_single_phase {} · number.set_value number.peblar_ev_charger_charge_limit {"va | ✓ switch.turn_on switch.peblar_ev_charger_charge {} · switch.turn_off switch.peblar_ev_charger_force_single_phase {} · number.set_value number | ✓ 13 commands | 90 of 90 ✓ |
| OCPP | ✓ switch, current: number, phases: none | ✓ switch.turn_on switch.charger_charge_control {} → switch.turn_off switch.charger_charge_control {} | ✓ 7 A · switch.turn_on switch.charger_charge_control {} · number.set_value number.charger_maximum_current {"value":7} | ✓ paused · switch.turn_off switch.charger_charge_control {} | ✓ switch.turn_on switch.charger_charge_control {} · number.set_value number.charger_maximum_current {"value":16} | ✓ 9 commands | 90 of 90 ✓ |
| Ohme | ✓ select, current: none, phases: none | ✓ select.select_option select.ohme_home_pro_charge_mode {"option":"max_charge"} → select.select_option select.ohme_home_pro_charge_mode {"opti | ✓ no current control: waits for 11 kW | ✓ paused · was not charging | ✓ select.select_option select.ohme_home_pro_charge_mode {"option":"max_charge"} | ✓ 5 commands | 90 of 90 ✓ |
| Tesla Wall Connector | ✓ read only: no start/stop | ✓ nothing sent (boost: 200) | ✓ nothing sent | ✓ nothing sent | ✓ nothing sent | ✓ 1 commands | 90 of 90 ✓ |

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
