# Smart Charging Planner

A Home Assistant app that plans EV and home battery charging around dynamic electricity prices.

> Status: early development (v0.22.0). Charging plan, departures, savings and charger control. With "Allow control" off (default) everything is advice and a dry run; with it on, the app starts and pauses the charger itself.

## Installation

1. In Home Assistant, go to **Settings → Apps → App store**.
2. Open the menu (⋮) in the top right and choose **Repositories**.
3. Add `https://github.com/tlpeter/smart-charging-planner`.
4. Find **Smart Charging Planner** in the store and install it.
5. Start the app and open **Smart Charging** in the sidebar. A setup wizard walks you through the first steps.

## Roadmap

- [x] Setup checks: vehicle, charger, grid, price source
- [x] Charging plan as advice, with price chart
- [x] Departure times: schedule, helper, calendar, one-off
- [x] House load per hour
- [x] Savings overview
- [x] Charge now and manual start/stop (only when "Allow control" is on)
- [x] Charger control by the plan (only when "Allow control" is on)
- [x] Notifications and dashboard sensors
- [ ] Charging current control
- [ ] Home battery and solar forecast
- [ ] Multiple vehicles

## Tests

`node tests/forecast.test.js` checks the price forecast (forecast entries, time zone, planner) and the planner with two goals.

`node tests/brands.test.js` checks detection, the control check and the status texts against the real entity and action names of the common charger integrations (Easee, Zaptec, Alfen, Wallbox, go-e, Peblar, OCPP, Ohme, Tesla Wall Connector). Run `npm install` in `smart_charging_planner/app` first.

## Credits

Icons: [Material Design Icons](https://pictogrammers.com/library/mdi/) (`@mdi/js` 7.4.47, Apache License 2.0), the same icons Home Assistant and Mushroom use. The look follows Home Assistant's default theme and the [Mushroom](https://github.com/piitaya/lovelace-mushroom) card style.
