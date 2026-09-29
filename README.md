# Smart Charging Planner

A Home Assistant app that plans EV and home battery charging around dynamic electricity prices.

> Status: early development (v0.6.0). Setup checks, departure times, a charging plan with house load, savings overview and adding trips (test mode by default). Nothing is controlled.

## Installation

1. In Home Assistant, go to **Settings → Apps → App store**.
2. Open the menu (⋮) in the top right and choose **Repositories**.
3. Add `https://github.com/tlpeter/smart-charging-planner`.
4. Find **Smart Charging Planner** in the store and install it.
5. Start the app and open **Smart Charging** in the sidebar.

## Roadmap

- [x] Setup checks: vehicle, charger, grid, price source
- [x] Charging plan as advice, with price chart
- [x] Departure times: schedule, helper, calendar, one-off
- [x] House load per hour
- [x] Savings overview
- [ ] Charger control (only when "Allow control" is on)
- [ ] Home battery and solar forecast
- [ ] Multiple vehicles
