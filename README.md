# Smart Charging Planner

A Home Assistant app that plans EV and home battery charging around dynamic electricity prices.

> Status: public beta. With "Allow control" off (default) everything is advice and a dry run; with it on, the app starts and pauses the charger itself; the home battery also needs "Allow home battery control".

## Recovery candidate and compatibility

The current development candidate is **0.36.14-dev** (stable is 0.35.0). It repairs clock-change price input, zero/low current limits, charger command ordering, restart recovery and stale-car estimates. It also rejects missing prices instead of treating them as free energy. Connection sharing now pauses the first charger when it cannot fit and respects the configured grid sign. Partial price warnings are shown separately from source failures. The battery bar follows the actual SoC from red to green, and temporary calendar failures retain confirmed events for at most 24 hours with an explicit warning. Solar sensor periods are integrated without overlap, and price conversions use declared units instead of guessing from their magnitude. The latest candidate also checks live battery bounds, restores original battery settings, includes every charger in battery protection and previews anonymized public diagnostics. Trips can be written in English or Dutch; switching language skips an equivalent existing trip instead of creating it again. On dev since 0.34.0: an explicit choice of what is sent to look up trip distances, an explicit forecast price basis, and charging-stop suggestions along long trips in the Netherlands and Belgium. See [CHANGELOG.md](smart_charging_planner/CHANGELOG.md) and the [release checklist](RELEASE.md).

Changes on dev reach main after GitHub Actions and the owner's home check. A green test matrix means the expected commands work against the test fixtures; it does not mean every car, charger, firmware or battery has been physically verified.

**[COMPATIBILITY.md](COMPATIBILITY.md)** lists per charger, car and home battery integration what the app can read and steer, which devices are read only, and what was checked on real hardware. It is generated from the tests; report your own hardware with the issue form **Beta test report**.

| Capability | What to expect |
| --- | --- |
| Car and charger detection | Check the suggested sensors and control method. Some integrations can only read. The stable car-sensor fixes tracked in #21 are already on dev. |
| Solar phase switching | Requires supported hardware and current control. The app pauses, waits for the load to stop, applies the mode and allows settling before enabling again. Service-only phase methods acknowledge a requested mode; verify the real hardware during setup. |
| Home battery | Control checks fresh SoC, available stop capabilities and all chargers. App-owned settings are restored from a persistent snapshot. Unsupported bounds can make control unavailable; native inverter protections remain necessary. Read-only models remain advice only. |
| Multiple chargers | Live sharing is available, but site planning and physical phase allocation are not yet complete. Keep hardware load balancing in place. |
| Week prices | A forecast is optional. A custom sensor must provide timed price rows with a stated unit and an explicit raw/all-in basis. See the recipe below. |
| Public diagnostics | Preview the public report before downloading. Only selected technical fields and anonymous identifiers are included; raw logs and free text are omitted. Numeric values/timestamps can still reveal usage patterns. Keep settings backups private. |

Known limitations and remaining work are tracked in the [issues](https://github.com/tlpeter/smart-charging-planner/issues). Do not use the app as a substitute for the charger's electrical protections or a hardware load balancer.

## Installation

Choose **one** version before adding the repository:

| Version | Recommended for | Repository URL | Name in Home Assistant |
| --- | --- | --- | --- |
| **Stable (`main`)** | Published beta; check the limitations above | `https://github.com/tlpeter/smart-charging-planner` | **Smart Charging Planner** |
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

**Looking ahead** (always on): Home shows the coming 7, 14 or 30 days (your choice) as one timeline: charging, leaving, back home, expected charging, leaving again, … with the battery level at each step. For a trip with an address in the calendar event (or a zone in Home Assistant, or a name from **My places** on Plan, such as "Work") the app calculates what it costs there and back (the distance by road from OpenStreetMap, the car's use per km, +10 %). The expected charging after each trip is **orange**, in the timeline and in the chart (which also shades when the car is away). With the minimum rule on, charging right away to the minimum is **purple**. Days after the last known price are marked as an estimate. The chart reaches the last expected charging, up to 7 days ahead, as far as prices are available. It is an expectation and never steers anything.

### Plan: departures

| Source | What it does |
| --- | --- |
| **Weekly schedule** | A time and battery level per weekday. |
| **Calendar** | Trips from any Home Assistant calendar: Google, Local calendar, CalDAV, and Apple iCloud (Home Assistant 2026.10+, read only: add trips in the calendar app itself). Which events count: events with a target in the description ("target: 90", "85%", or in Dutch "doel: 90"), events with a keyword, or every event with a time. Be ready a number of minutes before the event. With more cars, "car: EV6" (Dutch: "auto: EV6") says which car the trip is for; a trip without it is for every car. English and Dutch words both work; the full list is in [DOCS.md](smart_charging_planner/DOCS.md#calendar-words). |
| **Helper** | An `input_datetime` (and optionally an `input_number` for the level), for example from a dashboard. |
| **One-off departure** | A trip that differs from normal; removed after it has passed. |
| **What a trip costs** | For calendar trips with an address in the location: the distance (OpenStreetMap) and the battery % there and back. A later "Home" or "To home" (or a trip with your home as location) is used as the way back. |
| **Add trip** | Writes trips to the calendar the app reads, as "To &lt;destination&gt;" with the destination as location and "target: … precondition: …" (or in Dutch, see **Language for trips the app adds** in the calendar settings); optional **Back home at** (test mode until **Allow adding trips to calendar** is on). With one car there is nothing to choose: the trip is for that car. |
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
| **Rules** | **Don't change the car's charge limit** (off: the limit follows every choice). **Default minimum for the quick choices** (30 %). **Always charge below a minimum** (off; optional entity and price limit). **Force charging before departure** (0 min). **Hysteresis** (0.03 per kWh). **Keep charging while the car preconditions**. **Ready Guard** (on, margin 30 min). **Battery care** (on: above 80 % only in the last 4 hours before departure; a small refill within 5 percentage points joins that session when it still fits). |
| **Notifications** | Recipients (phones or groups): per recipient its notify action, which cars, and which messages (5 groups, each message on or off); a test per recipient. |
| **Diagnostics** | Connection, manual start/stop test, the setup wizard, **Preview diagnostics** (public report for a bug report), **Export / Import settings** (backup, or move to the test version). |

### Configuration tab (in Home Assistant)

Settings → Apps → Smart Charging Planner → **Configuration**. Saving restarts the app.

| Option | Default | What it does |
| --- | --- | --- |
| **Allow control** | off | Master switch. Off: advice only. On: the app starts and pauses the charger and sets the car's charge limit. |
| **Allow home battery control** | off | With Allow control also on: the app steers the home battery. |
| **Allow adding trips to calendar** | off | Off: "Add trip" only shows what it would add. |
| **Publish sensors** | off | Writes `sensor.smart_charging_*` for dashboards and automations (with more chargers: `sensor.smart_charging_<charger>_*` for the others). |
| **Notify every start and pause** | on | Only used once, when updating from a version before recipients; choose messages per recipient in Settings › Notifications. |
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

## Custom combined price sensors

For a sensor containing actual and forecast prices:

- Use rows such as `{ "time": "2026-10-25T02:00:00+02:00", "price": 0.22, "source": "forecast" }`. Preserve UTC or the offset from the upstream data. The repeated hour `02:00+01:00` is a different delivery hour.
- Select the actual and forecast price bases separately. If a template already adds tax, supplier fees or an adjustment calibrated against an all-in tariff, do not add those amounts again in the app. For an already adjusted consumer forecast, choose **All-in** as its forecast basis, then add only the desired forecast margin.
- A raw market forecast should instead receive the configured taxes/fees once. A fixed learned adjustment against actual tariffs is an approximation, not an exact tax formula.
- Missing prices are gaps. They are not zero. On clock-change days an offset-free ambiguous or nonexistent hour is skipped and reported; the app never guesses which repeated hour a price means.
- The app does not install a scraping automation or depend on a particular public forecast endpoint. Keep the source's supported integration/API and freshness visible.

## Roadmap

GitHub issues track the scope, acceptance checks and current status. P1 comes before broader public promotion; P2 improves reliability and usability; P3 is a later extension. Features listed as available may still have [open bugs](https://github.com/tlpeter/smart-charging-planner/issues?q=is%3Aissue%20is%3Aopen%20label%3Abug); a completed feature is not a claim that every physical device is verified.

### Available features

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
- [x] Looking ahead 7, 14 or 30 days, with estimates marked beyond known prices
- [x] Calendar departures kept during temporary read failures, with a visible warning
- [x] Battery bar colored from red at empty to green at full
- [x] Explicit forecast price basis, so VAT is never added twice (#26)
- [x] Trip distances and privacy: choose what is sent, or work offline (#31)
- [x] Charging stops on the way (Netherlands and Belgium), on your side of the road (#37, #41, #42)
- [x] Battery Care: a small refill after a short trip joins the planned session (#43)
- [x] Preconditioning before a departure and on the way back, for every departure source (#44, #45)

### Before broader public promotion (P1)

- No open P1 items: #29 is implemented on dev (below).

### Reliability and usability (P2)

- [ ] Explain departure-source precedence and warn about ambiguous car tags or ignored calendar events. [#25](https://github.com/tlpeter/smart-charging-planner/issues/25)
- [ ] Provide a supported week-price forecast path with freshness, schema and price-basis checks. [#27](https://github.com/tlpeter/smart-charging-planner/issues/27)
- [ ] Plan all chargers against shared capacity before charging time, including realistic readiness estimates. [#30](https://github.com/tlpeter/smart-charging-planner/issues/30)
- [ ] Add Pause until and a guided release/recovery action for app-owned device settings. [#33](https://github.com/tlpeter/smart-charging-planner/issues/33)

### Later extensions (P3)


### Implemented on dev, awaiting a stable release

These enhancements are implemented on the [dev branch](https://github.com/tlpeter/smart-charging-planner/tree/dev), with the label `fixed in dev`. They are not yet part of stable main 0.35.0.

- [x] Sharing the connection per phase (L1, L2, L3): one-phase chargers on their own phase, room kept on every phase when the phase is not known, a fresh-reading check, step-by-step changes, a load balancer for some chargers only, and the home battery charging from the grid only with what the chargers leave. [#29](https://github.com/tlpeter/smart-charging-planner/issues/29)
- [x] Where is the car when it is not plugged in: car location, then a person, then a trip home in the calendar; when none knows, Home counts from the level now and shows planned charging as "if plugged in". [#46](https://github.com/tlpeter/smart-charging-planner/issues/46)
- [x] A compatibility matrix per integration (generated from the tests, read-only devices marked), a beta test report form for real-hardware results, a container build for amd64 and aarch64 and a check against an older Home Assistant Core. [#28](https://github.com/tlpeter/smart-charging-planner/issues/28)
- [x] Charging stops in all European countries, with operators per country; a route across a border gets stations in every country on it; a long trip gets more stops, each with the level on arrival and how far to charge; a separate lowest level to arrive with at a fast charger. [#40](https://github.com/tlpeter/smart-charging-planner/issues/40)
- [x] Charging stops settings: countries and operators in lists that open and close, with search; chosen operators as labels; operators found in the station data on your routes can be preferred too. [#48](https://github.com/tlpeter/smart-charging-planner/issues/48)
- [x] Fix: addresses abroad are found (the search tries your own country first, then every country). [#49](https://github.com/tlpeter/smart-charging-planner/issues/49)
- [x] Fix: a charging stop is as late as the battery allows, at the best station (preferred operator, most power, most points), with alternatives marked as such. [#50](https://github.com/tlpeter/smart-charging-planner/issues/50)
- [x] Fix: what you opened on Home (a day in Looking ahead, Plan details, the plan table) stays open when the page reloads every minute; a reload that changes nothing leaves the page as it is. [#51](https://github.com/tlpeter/smart-charging-planner/issues/51)
- [x] The route and the charging stops on a map (an option, off by default; OpenStreetMap or your own tile server; map images only when you open the map). [#47](https://github.com/tlpeter/smart-charging-planner/issues/47)
- [x] The charging stops on the Home Assistant map (an option, off by default), with a popup on this screen via Browser Mod. [#53](https://github.com/tlpeter/smart-charging-planner/issues/53)

## Tests

**[tests/TESTPLAN.md](tests/TESTPLAN.md)** shows every test and the result of the last run. GitHub writes it after every push, so it always matches the code; `node tests/testplan.js all` runs everything and writes it here (several minutes).

`node tests/settings.test.js` tests every setting against a fake Home Assistant with a Renault and an Easee (about a minute); `SCP_PROFILE=skoda_wallbox node tests/settings.test.js` does the same with a Skoda Enyaq and a Wallbox, and `SCP_PROFILE=kia_zaptec` with a Kia Niro EV (Kia Uvo) and a Zaptec Go.

`node tests/solar.test.js` checks solar brand by brand: inverters, forecasts, the value of own solar power and charging on surplus.

`node tests/matrix.test.js` runs every charger with every home battery in the real app (several minutes).

`node tests/battery.test.js` checks the home battery brand by brand (detection, commands, the guard) and the battery plan.

`node tests/forecast.test.js` checks the price forecast (forecast entries, time zone, planner) and the planner with two goals.

`node tests/activecar.test.js` checks which car is connected and the car in calendar events; `node tests/sharing.test.js` checks how more chargers share the connection; `node tests/reliability.test.js` checks Ready Guard.

`node tests/cars.test.js` checks, per car integration (Tesla Fleet, Teslemetry, Tessie, Renault, Hyundai/Kia, MySkoda, Volkswagen ID, Volvo, Polestar, Mercedes-Benz), which battery level, range, plug, charging and charge limit sensors the app picks, with their real entity names. `SCP_CARS=all SCP_CHARGERS=none node tests/matrix.test.js` runs each of these cars in the real app with an Easee.

`node tests/brands.test.js` checks detection, the control check and the status texts against the real entity and action names of the common charger integrations (Easee, Zaptec, Alfen, Wallbox, go-e, Peblar, OCPP, Ohme, Tesla Wall Connector). Run `npm install` in `smart_charging_planner/app` first.

## Release process

- `main` contains the stable version.
- `dev` contains the newest test version.
- Every push and pull request runs the complete GitHub Actions test suite.
- A version moves from `dev` to `main` only after the tests pass and it has run reliably for a while.
- On `main`, the app name and version do not contain `(dev)` or `-dev`.

## Reporting a problem

1. In the app: Settings › Diagnostics › **Preview diagnostics**, review the public report, then **Download reviewed report**. Identifiers are anonymous and free text/raw logs are omitted; review values and timestamps before sharing. A settings backup is private and must not be attached publicly.
2. Open a [bug report](https://github.com/tlpeter/smart-charging-planner/issues/new/choose) and attach the file.

Security problems: please report them privately, see [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE): free to use, change and share, also commercially, as long as the license text stays with it. No warranty.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for bug reports, proposed changes, validation and contribution licensing. Changes submitted for inclusion use the project's MIT License; preserve third-party notices.

## Credits

Icons: [Material Design Icons](https://pictogrammers.com/library/mdi/) (`@mdi/js` 7.4.47, Apache License 2.0), the same icons Home Assistant and Mushroom use. The look follows Home Assistant's default theme and the [Mushroom](https://github.com/piitaya/lovelace-mushroom) card style.
