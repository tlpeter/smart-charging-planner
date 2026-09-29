# Smart Charging Planner

Plans EV and home battery charging around dynamic electricity prices.

> Early development. The app gives advice only and cannot change anything in Home Assistant: it only sends read-only commands.

## What it does now

- **Overview**: a price chart for today and tomorrow, and a charging plan that shows the cheapest blocks to reach your target battery level before your "ready by" time, with the expected cost compared with charging right away.
- **Departures**: when the car must be ready and how full, from a weekly schedule, a Home Assistant helper, a calendar, or a one-off departure.
- **Vehicle**: finds your electric or plug-in hybrid vehicle in Home Assistant and lets you confirm which sensors to use for battery level, range, charging and plugged in.
- **Charger**: finds your EV charger and lets you confirm its status, charging power, current setting and start/stop switch. Nothing is controlled yet.
- **Grid**: finds the meter for your grid connection (P1 meter, smart meter reader or load balancer), and asks for your main fuse and whether a load balancer is present.
- **Prices**: finds your dynamic price source, adds your purchase fee, energy tax and VAT, and tests it.
- **Status**: shows the connection to Home Assistant and whether control is allowed.

## Getting started

1. Start the app and open **Smart Charging** in the sidebar.
2. On the **Vehicle** tab, select **Detect vehicles**.
3. Check the suggested sensors, fill in the battery capacity if you know it, and select **Use this vehicle**.
4. On the **Charger** tab, select **Detect chargers**, check the suggested entities, set the phases and select **Use this charger**.
5. On the **Grid** tab, select **Detect grid meters**, check the suggested sensors, fill in your main fuse and choose your load balancing.
6. On the **Prices** tab, select **Detect price sources**, fill in the costs from your energy contract, select **Test** and then **Save**.
7. On the **Departures** tab, set your weekly schedule, and optionally a helper or calendar.
8. Open **Overview** and check the plan.

Nothing found? Open **Not listed? Choose manually** and pick the entities yourself.

## Requirements

- A vehicle integration that provides at least a battery level sensor in %.
- A charger integration in Home Assistant.
- A grid meter in Home Assistant, such as a P1 meter.
- A dynamic price integration, such as EnergyZero (no account needed) or Nord Pool.

## Departure priority

When several sources give a departure on the same day, the one-off departure wins, then the calendar, then the helper, then the weekly schedule. The plan always prepares for the earliest day that has a departure.

## House load

When the Grid tab is set up, the plan uses the last 14 days of your grid meter to estimate, per hour of the day, how much current is left for the charger under your main fuse. The charger's own power is subtracted when a charging power sensor is chosen on the Charger tab. Your grid meter needs long-term statistics (most P1 power sensors have them). This is an estimate; a load balancer such as the Easee Equalizer still does the real-time protection.

## Configuration

- **Log level**: how much the app writes to its log. Use `debug` when reporting a problem.
- **Allow control**: master switch. While off (the default), the app only gives advice and never changes your charger, vehicle or home battery.

## Planned

Price sources, charging schedules, charger control, departure times, savings overview, home battery and solar forecast. See the [project README](https://github.com/tlpeter/smart-charging-planner) for the roadmap.
