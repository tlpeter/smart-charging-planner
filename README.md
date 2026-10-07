# Smart Charging Planner

A Home Assistant app that plans EV and home battery charging around dynamic electricity prices.

> Status: early development. Charging plan, departures, savings and charger control. With "Allow control" off (default) everything is advice and a dry run; with it on, the app starts and pauses the charger itself; the home battery also needs "Allow home battery control".

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
- [ ] More than one charger

## Tests

`node tests/settings.test.js` tests every setting against a fake Home Assistant with a Renault and an Easee (about a minute); `SCP_PROFILE=skoda_wallbox node tests/settings.test.js` does the same with a Skoda Enyaq and a Wallbox. See `tests/TESTPLAN.md` for the test plan and the last result.

`node tests/solar.test.js` checks solar brand by brand: inverters, forecasts, the value of own solar power and charging on surplus.

`node tests/matrix.test.js` runs every charger with every home battery in the real app (several minutes).

`node tests/battery.test.js` checks the home battery brand by brand (detection, commands, the guard) and the battery plan.

`node tests/forecast.test.js` checks the price forecast (forecast entries, time zone, planner) and the planner with two goals.

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
