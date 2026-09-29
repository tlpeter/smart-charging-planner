# Smart Charging Planner

Plans EV and home battery charging around dynamic electricity prices.

> Early development. The app only reads from Home Assistant, with two exceptions you switch on yourself: adding trips to your calendar, and (with "Allow control") starting and pausing the charger.

## What it does now

- **Overview**: a price chart for today and tomorrow, and a charging plan that shows the cheapest blocks to reach your target battery level before your "ready by" time, with the expected cost compared with charging right away.
- **Charge now** (on the Overview): charge right away instead of waiting for the plan, up to the plan's target, a battery level or an amount in kWh. The app first checks whether charging is already planned soon and shows what charging now costs extra. Stops by itself when the goal is reached or the car is unplugged. With "Allow control" on it really starts the charger, and pauses it again afterwards; with it off it only changes what the app would do.
- **Departures**: when the car must be ready and how full, from a weekly schedule, a Home Assistant helper, a calendar, or a one-off departure.
- **Savings**: per charging session in the last 30 days, what you actually paid, what charging right away would have cost, and what the plan would have cost.
- **Control**: what the app wants the charger to do right now and which command it sends (or, with "Allow control" off, would send), compared with what the charger is really doing, plus a log. Here you also choose how the charger is controlled and set the rules (minimum battery level, preconditioning, force window, hysteresis). A **Manual test** starts or stops the charger once, only when "Allow control" is on.
- **Vehicle**: finds your electric or plug-in hybrid vehicle in Home Assistant and lets you confirm which sensors to use for battery level, range, charging and plugged in.
- **Charger**: finds your EV charger and lets you confirm its status, charging power, current setting and start/stop switch. **Control check** shows how the app could control it (which actions or entities), without sending anything.
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

No integration for your car at all? Use **No car integration?** on the Vehicle tab: either enter the battery level on the Overview when you plug in, or charge a fixed amount each time. The app then follows the session through the charger (a charging power sensor on the Charger tab is needed to count the energy).

## Requirements

- A vehicle integration with a battery level sensor in %, or no integration (enter the level yourself, or a fixed amount per session).
- A charger integration in Home Assistant.
- A grid meter in Home Assistant, such as a P1 meter.
- A dynamic price integration, such as EnergyZero (no account needed) or Nord Pool.

## Departure priority

When several sources give a departure on the same day, the one-off departure wins, then the calendar, then the helper, then the weekly schedule. The plan always prepares for the earliest day that has a departure.

## Charging power

The plan uses the charger maximum (phases × 230 V × maximum current), unless the car really charges slower. With a charging power sensor on the Charger tab, the app learns from the last 10 days at what power the car typically charges at full speed (at least 30 minutes of charging is needed), and uses the lower of the two. The Overview shows which power the plan uses and why.

## House load

When the Grid tab is set up, the plan uses the last 14 days of your grid meter to estimate, per hour of the day, how much current is left for the charger under your main fuse. The charger's own power is subtracted when a charging power sensor is chosen on the Charger tab. Your grid meter needs long-term statistics (most P1 power sensors have them). This is an estimate; a load balancer such as the Easee Equalizer still does the real-time protection.

## Savings

The Savings tab needs a charging power sensor on the Charger tab (for example a separate kWh meter) with long-term statistics. With a plugged-in sensor on the Vehicle tab, sessions are compared over the whole time the car was connected; without one, only over the hours it was charging. Everything is calculated per hour, so the amounts are estimates. Prices are stored from the moment the app fetches them; EnergyZero, easyEnergy, Tibber and Nord Pool can also look back.

## Handing over from your own automation

If you already control your charger with your own automation, keep it running while "Allow control" is off: the Control log then compares the app with your automation. Before you turn on "Allow control", turn your own automation off (disable it in Settings → Automations), so the two do not fight. To go back, turn "Allow control" off and your automation on again.

## Configuration

- **Log level**: how much the app writes to its log. Use `debug` when reporting a problem.
- **Refresh interval**: how often (1 to 60 minutes) the app reads prices, departures and states and recalculates the plan in the background. Note that Home Assistant itself also has a refresh interval for some integrations; for example a Google calendar is updated by Home Assistant on its own schedule.
- **Allow adding trips to calendar**: off by default. While off, "Add trip" on the Departures tab is in test mode: it shows which calendar events it would create and writes nothing. When on, trips are added to the calendar chosen on the Departures tab. This does not allow any charger control.
- **Allow control**: master switch. While off (the default), the app only gives advice and never changes your charger, vehicle or home battery. When on, the app starts and pauses the charger itself, following the plan, Charge now and the rules on the Control tab, with the start/stop method chosen there. Only start/stop is sent; the charging current is not changed. Automations, scripts and helpers are never touched.

## Planned

Charging current control, home battery and solar forecast. See the [project README](https://github.com/tlpeter/smart-charging-planner) for the roadmap.
