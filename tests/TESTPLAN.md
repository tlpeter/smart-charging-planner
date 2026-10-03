# Test plan: settings

Every setting of the app, tested against a fake Home Assistant (`tests/fake-ha.js`: Renault, Easee, P1 meter, EnergyZero, a price sensor with a 7-day forecast, a calendar, helpers and notify actions). The test starts the real app with a temporary data folder and uses the same API as the page.

Run it: `node tests/settings.test.js` (from the repository root, after `npm install` in `smart_charging_planner/app`). About a minute.

Result of the last run: **77 of 77 passed** (v0.22.2).


## A. Fresh install and checklist

| # | What is tested | Result |
|---|---|---|
| A1 | Fresh install: checklist says vehicle, charger and prices are missing | ✓ – missing: vehicle, charger, prices |
| A2 | Fresh install: Allow control is off by default | ✓ |
| A3 | Fresh install: plan asks for prices and vehicle | ✓ |

## B. Vehicle

| # | What is tested | Result |
|---|---|---|
| B1 | Detect finds the Renault with battery, plugged-in and charge limit | ✓ – plugged: binary_sensor.jlz03x_plugged_in |
| B2 | Refused: no battery sensor | ✓ – A battery (SoC) sensor is required |
| B3 | Refused: battery capacity 500 kWh | ✓ – Battery capacity must be between 0 and 300 kWh |
| B4 | Refused: a charge limit that is not on the car's device | ✓ – That entity is not the car's charge limit |
| B5 | Refused: battery level 120 % entered by hand | ✓ – Battery level must be between 0 and 100 % |
| B6 | No car integration: "enter level" needs a capacity | ✓ – Battery capacity is required to estimate the battery level |
| B7 | No car integration: fixed amount must be 1–150 kWh | ✓ – The amount per session must be between 1 and 150 kWh |
| B8 | Save the Renault (sensor mode, 52 kWh, plugged-in sensor, charge limit) | ✓ |

## C. Charger

| # | What is tested | Result |
|---|---|---|
| C1 | Detect finds the Easee with status, power and switch | ✓ |
| C2 | Refused: no entities chosen | ✓ – Choose at least one entity |
| C3 | Refused: maximum current 100 A | ✓ – Maximum current must be between 6 and 80 A |
| C4 | Refused: a switch as status entity | ✓ – Invalid entity for status_entity |
| C5 | Save the Easee (3 phases, 16 A) | ✓ |
| C6 | Control check finds a start/stop method and recommends one | ✓ – recommended: action_command |
| C7 | Maximum current 10 A: the plan uses 3 × 230 V × 10 A = 6.9 kW | ✓ |
| C8 | One phase, 16 A: the plan uses 3.7 kW | ✓ |

## D. Grid

| # | What is tested | Result |
|---|---|---|
| D1 | Detect finds the P1 meter | ✓ |
| D2 | Refused: main fuse 300 A | ✓ – Main fuse must be between 6 and 200 A |
| D3 | Refused: no net or import sensor | ✓ – Choose a net power sensor, or an import power sensor |
| D4 | Save the P1 meter (25 A, load balancer in the charger) | ✓ |

## E. Prices

| # | What is tested | Result |
|---|---|---|
| E1 | Detect offers EnergyZero, the combined sensor and the fixed tariff | ✓ |
| E2 | Test shows 24 prices today and 24 tomorrow | ✓ |
| E3 | Market price excl. VAT + fee + tax: all-in = (price + fee + tax) × 1.21 | ✓ – 0.2 → 0.3872 |
| E4 | Market price incl. VAT: all-in = price + (fee + tax) × 1.21 | ✓ |
| E5 | All-in price: used as it is | ✓ |
| E6 | Refused: purchase fee 2, VAT 80 | ✓ |
| E7 | Fixed tariff: refused when low from = low until, or time "25:00" | ✓ |
| E8 | Day/night tariff: the plan charges in the low hours | ✓ – planned hours 23,0,1 |
| E9 | Refused: forecast sensor with a bad name, margin 0.6 | ✓ |

## F. Planning (departures)

| # | What is tested | Result |
|---|---|---|
| F1 | Refused: battery level 5 %, time "7 uur", calendar buffer 500 | ✓ |
| F2 | Weekly schedule: next departure is tomorrow 06:30 at 85 % | ✓ |
| F3 | One-off departure wins over the schedule; refused in the past or after 7 days | ✓ |
| F4 | Calendar: "doel: 90" in an event becomes the departure, minus the buffer | ✓ |
| F5 | Helper: date/time and battery level helper | ✓ |
| F6 | Refused: helper on without a helper chosen; calendar on without a calendar | ✓ |
| F7 | No departure source: plan uses the cheapest known hours, note "no departure" | ✓ |
| F8 | Calendar with a keyword: only events with "EV" count, without a target the calendar level is used | ✓ |
| F9 | Add trip with "Allow adding trips" off: test mode, nothing written | ✓ |

## G. Rules

| # | What is tested | Result |
|---|---|---|
| G1 | Refused: default minimum 50 %, force window 700 min, hysteresis 2 | ✓ |
| G2 | Minimum battery level: below it → charge now | ✓ |
| G3 | Minimum with a price limit below the current price → not charged for the minimum | ✓ – then: not_planned |
| G3b | Minimum taken from an entity (the car's own minimum, here 70 %) | ✓ |
| G4 | Preconditioning entity on → charge | ✓ |
| G5 | Force window: departure within the window → charge | ✓ – force_window |
| G6 | Not in a planned block and not charging → pause | ✓ – paused |
| G7 | Default minimum for quick choices is used on Home | ✓ |
| G8 | Allow control off: the car limit is not changed and the plan stops at the limit | ✓ |
| G9 | Allow control off: nothing is sent to Home Assistant | ✓ |

## H. Notifications

| # | What is tested | Result |
|---|---|---|
| H1 | Refused: a notify action that does not exist | ✓ – Choose a notify action from the list |
| H2 | Choose mobile_app_pixel_8 and send a test notification | ✓ |
| H3 | Test notification refused when no notify action is chosen | ✓ |

## I. Configuration tab in Home Assistant

| # | What is tested | Result |
|---|---|---|
| I1 | Charging loss margin 20 %: more energy planned than with 10 % | ✓ – 22.88 → 24.96 kWh |
| I2 | Invalid option values fall back to the defaults (loss 99 %, refresh 0) | ✓ |
| I3 | Continuous charging off: blocks may be split | ✓ – 1 period(s) |
| I4 | Publish sensors on: sensor.smart_charging_* are written | ✓ – 8 sensors |
| I5 | Publish sensors off: nothing is written | ✓ |

## J. Allow control on: quick choices and the car limit

| # | What is tested | Result |
|---|---|---|
| J1 | Car limit follows the plan: tomorrow 90 % → limit 90 (one call) | ✓ – number.set_value 90 |
| J2 | Plan is not capped at the old limit when the app manages it | ✓ |
| J3 | Ready for the day after tomorrow 95 %: minimum 30 % first, limit → 95 | ✓ – 42.9 kWh before 10-04T05:00, limit sent 95 |
| J4 | Back to normal: limit goes down to the plan again (90) | ✓ |
| J5 | Quickly to a minimum (35 %) does not lower the limit | ✓ |
| J6 | Charge now 100 %: limit → 100, charger started, then stop → back to 90 | ✓ – start: easee.action_command resume |
| J7 | Charge now as kWh: preview converts it to a level for the limit | ✓ |
| J8 | "Don't change the car's charge limit": nothing sent, plan capped at the limit | ✓ |
| J9 | Notification on start (notify every start and pause) | ✓ – Car charge limit changed · Car charge limit changed · Charging started · Car charge limit changed |
| J9b | Manual test (Diagnostics): start and stop really sent | ✓ – resume → pause |
| J10 | Car unplugged: Charge now is refused | ✓ |
| J11 | Notify every start and pause off: start is not notified | ✓ – no notifications |

## K. Price forecast and checklist

| # | What is tested | Result |
|---|---|---|
| K1 | Forecast on: plan waits for the cheap forecast day, never charges on it now | ✓ – 31 forecast hours, planned: 10-05T09 (forecast) |
| K2 | Forecast is not used without a departure | ✓ |
| K3 | Checklist after setup: ready; shows the points that need attention | ✓ – vehicle:ok charger:ok method:ok prices:ok forecast:ok departures:ok control:ok car_limit:ok conflicts:ok notify:ok grid:ok |

## L. Security

| # | What is tested | Result |
|---|---|---|
| L1 | Refused: a change sent as text/plain (not JSON) | ✓ |
| L2 | Refused: a change from another site | ✓ |
| L3 | Refused: invalid JSON | ✓ |

## Not covered by this test

- House load, learned charging power and Savings: they need long-term statistics, which the fake Home Assistant does not have. Covered by earlier manual tests.
- The real cars and chargers: response time of the Renault cloud and the Easee. The fake reacts immediately.
- Adding trips with "Allow adding trips to calendar" on (only test mode is tested).
- The page itself (buttons, forms): checked with screenshots during development, not in this test.
