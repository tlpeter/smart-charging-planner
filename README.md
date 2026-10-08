# Smart Charging Planner

A Home Assistant app that plans EV and home battery charging around dynamic electricity prices.

> Status: early development. With "Allow control" off (default) everything is advice and a dry run; with it on, the app starts and pauses the charger itself; the home battery also needs "Allow home battery control".

## Installation

Choose **one** version before adding the repository:

| Version | Recommended for | Repository URL | Name in Home Assistant |
| --- | --- | --- | --- |
| **Stable (`main`)** | Most users | `https://github.com/tlpeter/smart-charging-planner` | **Smart Charging Planner** |
| **Test (`dev`)** | Testing the newest changes and reporting problems | `https://github.com/tlpeter/smart-charging-planner#dev` | **Smart Charging Planner (dev)** |

The test version may contain unfinished or less-tested changes. Its version number ends in `-dev`.

1. In Home Assistant, go to **Settings → Apps → App store**.
2. Open the menu (⋮) in the top right and choose **Repositories**.
3. Paste the repository URL for the version you chose and select **Add**.
4. Find the matching app name in the store and install it.
5. Start the app and open **Smart Charging** in the sidebar. A setup wizard walks you through the first steps.

> [!WARNING]
> Install only one version. Stable and test installations have separate settings, and if control is enabled in both, they may both try to control the same charger or home battery.

## What it does

The app makes a charging plan for your car in the cheapest hours before you leave, and (with **Allow control** on) starts and pauses the charger itself. Optionally it also plans your home battery, uses your solar power, and handles more cars and chargers.

The app has four pages:

- **Home**: what happens now and the quick choices you use day to day.
- **Plan**: when the car must be ready (departures and trips).
- **Activity**: savings and the log of every decision and command.
- **Settings**: things you set once.

The full explanation of every feature is in [DOCS.md](smart_charging_planner/DOCS.md) (also the **Documentation** tab of the app in Home Assistant).

### Home: quick choices

| Choice | What it does |
| --- | --- |
| **Charge now** | Charge right away instead of waiting for the plan: up to the plan's target, a battery level or an amount in kWh. Shows first what it costs extra. Stops by itself at the goal or when the car is unplugged. |
| **Quick minimum** | Charge right away up to 20–45 %, then the plan takes over. |
| **How to charge** (with solar) | **Price plan**, **Plan + solar** (default: the plan plus charging on surplus whenever there is some) or **Solar only**. |
| **Ready later** | Have the car ready tomorrow or the day after instead of at the next departure, when that is cheaper. Departures in between get a minimum. Ends by itself. |
| **Connected car** (more cars) | Which car is on the charger: recognised automatically, or choose it yourself until it is unplugged. |
| **Chargers** (more chargers) | All chargers at a glance: which car, its target, charging or waiting, and who goes first. |

Home also shows the **Ready Guard** card (will the car be ready in time, and the latest safe start), the price chart with the plan, the plan details and the home battery plan.

**Looking ahead** (always on): after the next departure, Home shows the **next goal**, also when the current target is already reached. When the trip has an address in the calendar event, the app calculates what it costs there and back (the distance by road from OpenStreetMap, the car's use per km, +10 %), the expected battery level when the car is back, and the expected charging for the next goal, in **orange** in the chart. Without known prices for then, the goal is shown without cost. It is an expectation and never steers anything.

### Plan: departures

| Source | What it does |
| --- | --- |
| **Weekly schedule** | A time and battery level per weekday. |
| **Calendar** | Trips from a Home Assistant calendar. Which events count: events with a target in the description ("doel: 80", "target: 90", "85%"), events with a keyword, or every event with a time. Be ready a number of minutes before the event. With more cars, "auto: renault" or "car: EV6" says which car the trip is for; a trip without it is for every car. |
| **Helper** | An `input_datetime` (and optionally an `input_number` for the level), for example from a dashboard. |
| **One-off departure** | A trip that differs from normal; removed after it has passed. |
| **What a trip costs** | For calendar trips with an address in the location: the distance (OpenStreetMap) and the battery % there and back. A later "Naar Thuis" (or a trip to "Thuis"/your home) is used as the way back. |
| **Add trip** | Writes trips to your calendar as "Naar &lt;destination&gt;" with "doel: … precondition: …" (test mode until **Allow adding trips to calendar** is on). |
| **Own departures per car** (more cars) | A car can have its own schedule, calendar and one-off departure; otherwise all cars share them. |

When several sources give a departure on one day: one-off, then calendar, then helper, then schedule.

### Settings

| Page | Options (default) |
| --- | --- |
| **Overview** | Checklist: is everything set up well, with a link to fix each point. |
| **Vehicle** | Detect the car or choose its sensors (battery level, range, charging, plugged in, the car's own charge limit). Battery capacity. **Use per 100 km** (optional, for trip estimates; the app learns it from your own trips, otherwise it uses the range sensor or 18 kWh/100 km). **Car data counts as old after** (3 h): when the car's cloud is down, the plan goes on with an estimate. **No car integration?**: enter the level when you plug in, or a fixed amount per session. **I have more than one car** (off): add up to 6 cars, each with an optional **Name in the calendar**. |
| **Charger** | Detect the charger or choose its entities, phases, maximum current (optionally follow the charger's own limit live). **Control check** and **How the app starts and stops charging** (start/stop method and current method). **I have more than one charger** (off): up to 4 chargers, each with its own plan and control, and a **Usual car**. |
| **Grid** | Grid meter (for example P1), **main fuse** and load balancer. Needed for the house load, solar, and sharing the connection between chargers. |
| **Prices** | A dynamic price source (EnergyZero, Nord Pool, Tibber, …) with your purchase fee, energy tax and VAT, or **Fixed or day/night tariff**. Optional **price forecast** with a safety margin, so the plan can wait for a cheaper day. |
| **Solar** | Solar forecast (Energy dashboard or a sensor), **Count on this part of the forecast** (80 %), house use, the **feed-in compensation** (dynamic or fixed), **Charge with solar up to** (90 %), **Grid power allowed while charging on solar**, start/stop delays, current control and one/three-phase switching. **Who follows the surplus?**: the app or the **Easee Equalizer**. |
| **Battery** | Home battery plan: charge from the grid when it pays, hold for expensive hours. Capacity, power, efficiency, wear per kWh, **Never below / Never above**. **May the home battery charge the car?** (never / only stored solar / always / between two levels). **Who gets the sun first?** (smart / car / battery). 10 brands steered (only with **Allow home battery control**). |
| **Rules** | **Don't change the car's charge limit** (off: the limit follows every choice). **Default minimum for the quick choices** (30 %). **Always charge below a minimum** (off; optional entity and price limit). **Force charging before departure** (0 min). **Hysteresis** (0.03 per kWh). **Keep charging while the car preconditions**. **Ready Guard** (on, margin 30 min). **Battery care** (on: above 80 % only in the last 4 hours before departure). |
| **Notifications** | Where notifications go (a notify action), and a test button. |
| **Diagnostics** | Connection, manual start/stop test, the setup wizard, **Download diagnostics** (for a bug report), **Export / Import settings** (backup, or move to the test version). |

### Configuration tab (in Home Assistant)

Settings → Apps → Smart Charging Planner → **Configuration**. Saving restarts the app.

| Option | Default | What it does |
| --- | --- | --- |
| **Allow control** | off | Master switch. Off: advice only. On: the app starts and pauses the charger and sets the car's charge limit. |
| **Allow home battery control** | off | With Allow control also on: the app steers the home battery. |
| **Allow adding trips to calendar** | off | Off: "Add trip" only shows what it would add. |
| **Publish sensors** | off | Writes `sensor.smart_charging_*` for dashboards and automations (with more chargers: `sensor.smart_charging_<charger>_*` for the others). |
| **Notify every start and pause** | on | Problems are always notified. |
| **Charging loss margin** | 10 % | Extra energy to plan for. |
| **Prefer one continuous charging period** | on | Charge in one go unless splitting saves at least… |
| **Split only when it saves at least** | 0.50 | …this amount. |
| **Account for house load** | on | Less room for the charger in hours the house uses more (needs Grid). |
| **Refresh interval** | 5 min | How often the plan is recalculated. |
| **Log level** | info | Use `debug` when reporting a problem. |

### How the app decides (every minute with Allow control on)

1. Car not plugged in → nothing to do.
2. Charger status invalid for a while → leave it as it is.
3. Below the minimum (and the price is OK) → charge.
4. Preconditioning → charge.
5. Charge now / quick minimum → charge.
6. Ready Guard: the latest safe start is reached → charge continuously.
7. Solar surplus (Plan + solar, Solar only) → charge on solar.
8. At the target → pause.
9. Within the force window before departure → charge.
10. A planned period that already started → finish it.
11. A planned block → charge.
12. Already charging and the price is close to the planned price (hysteresis) → keep charging.
13. Otherwise → pause.

With more chargers and too little room on the main fuse: Charge now first, then a car below its minimum or preconditioning, then a car Ready Guard protects, then the car with the least room to spare (the earliest latest safe start). The rest is shared fairly (at least 6 A each); a charger that can only start and stop charges at full current or waits.

## Roadmap

- [x] Setup checks: vehicle, charger, grid, price source
- [x] Charging plan as advice, with price chart
- [x] Departure times: schedule, helper, calendar, one-off
- [x] House load per hour
- [x] Savings overview
- [x] Charge now and manual start/stop (only when "Allow control" is on)
- [x] Charger control by the plan (only when "Allow control" is on)
- [x] Notifications and dashboard sensors
- [x] Price forecast, Ready for tomorrow / the day after tomorrow, the car's charge limit follows every choice
- [x] Solar: forecast in the plan, charging on surplus with current control and one/three-phase switching
- [x] Home battery: plan (charging from the grid, holding), smart sun, battery and car, 10 brands steered
- [x] Ready Guard: conservative safety margin, latest safe start and automatic full-power fallback
- [x] More than one car on one charger (an option): recognises the connected car, own departures per car
- [x] More than one charger (an option): a plan and control per charger, the car with the least room to spare goes first when the connection is too small
- [x] Battery care: above 80 % only in the last hours before departure
- [ ] Plans of more chargers that take each other into account (now they are shared at the moment of charging)

## Tests

`node tests/settings.test.js` tests every setting against a fake Home Assistant with a Renault and an Easee (about a minute); `SCP_PROFILE=skoda_wallbox node tests/settings.test.js` does the same with a Skoda Enyaq and a Wallbox. See `tests/TESTPLAN.md` for the test plan and the last result.

`node tests/solar.test.js` checks solar brand by brand: inverters, forecasts, the value of own solar power and charging on surplus.

`node tests/matrix.test.js` runs every charger with every home battery in the real app (several minutes).

`node tests/battery.test.js` checks the home battery brand by brand (detection, commands, the guard) and the battery plan.

`node tests/forecast.test.js` checks the price forecast (forecast entries, time zone, planner) and the planner with two goals.

`node tests/activecar.test.js` checks which car is connected and the car in calendar events; `node tests/sharing.test.js` checks how more chargers share the connection; `node tests/reliability.test.js` checks Ready Guard.

`node tests/brands.test.js` checks detection, the control check and the status texts against the real entity and action names of the common charger integrations (Easee, Zaptec, Alfen, Wallbox, go-e, Peblar, OCPP, Ohme, Tesla Wall Connector). Run `npm install` in `smart_charging_planner/app` first.

## Release process

- `main` contains the stable version.
- `dev` contains the newest test version.
- Every push and pull request runs the complete GitHub Actions test suite.
- A version moves from `dev` to `main` only after the tests pass and it has run reliably for a while.
- On `main`, the app name and version do not contain `(dev)` or `-dev`.

## Reporting a problem

1. In the app: Settings › Diagnostics › **Download diagnostics**. Names, trip titles, places and your notify target are removed from the file.
2. Open a [bug report](https://github.com/tlpeter/smart-charging-planner/issues/new/choose) and attach the file.

Security problems: please report them privately, see [SECURITY.md](SECURITY.md).

## Credits

Icons: [Material Design Icons](https://pictogrammers.com/library/mdi/) (`@mdi/js` 7.4.47, Apache License 2.0), the same icons Home Assistant and Mushroom use. The look follows Home Assistant's default theme and the [Mushroom](https://github.com/piitaya/lovelace-mushroom) card style.
