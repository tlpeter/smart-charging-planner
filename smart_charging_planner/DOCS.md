# Smart Charging Planner

Plans EV and home battery charging around dynamic electricity prices.

> Early development. The app does not control anything yet.

## What it does now

- **Vehicle**: finds your electric or plug-in hybrid vehicle in Home Assistant and lets you confirm which sensors to use for battery level, range, charging and plugged in.
- **Charger**: finds your EV charger and lets you confirm its status, charging power, current setting and start/stop switch. Nothing is controlled yet.
- **Status**: shows whether the app is connected to Home Assistant.

## Getting started

1. Start the app and open **Smart Charging** in the sidebar.
2. On the **Vehicle** tab, select **Detect vehicles**.
3. Check the suggested sensors, fill in the battery capacity if you know it, and select **Use this vehicle**.
4. On the **Charger** tab, select **Detect chargers**, check the suggested entities, set the phases and select **Use this charger**.

Nothing found? Open **Not listed? Choose manually** and pick the entities yourself.

## Requirements

- A vehicle integration that provides at least a battery level sensor in %.
- A charger integration in Home Assistant.

## Planned

Price sources, charging schedules, charger control, departure times, savings overview, home battery and solar forecast. See the [project README](https://github.com/tlpeter/smart-charging-planner) for the roadmap.
