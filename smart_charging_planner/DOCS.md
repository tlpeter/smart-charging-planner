# Smart Charging Planner

Plans EV and home battery charging around dynamic electricity prices.

> Early development. The app only reads from Home Assistant, with a few exceptions you switch on yourself: adding trips to your calendar, starting and pausing the charger ("Allow control"), sending notifications, and writing its own sensors.

## What it does now

The app has five tabs:

- **Overview**: a price chart for today and tomorrow, and a charging plan that shows the cheapest blocks to reach your target battery level before your "ready by" time, with the expected cost compared with charging right away.
  - **Charge now**: charge right away instead of waiting for the plan, up to the plan's target, a battery level or an amount in kWh. The app first checks whether charging is already planned soon and shows what charging now costs extra. Stops by itself when the goal is reached or the car is unplugged; then the plan takes over again.
- **Departures**: when the car must be ready and how full, from a weekly schedule, a Home Assistant helper, a calendar, or a one-off departure.
- **Savings**: per charging session in the last 30 days, what you actually paid, what charging right away would have cost, and what the plan would have cost.
- **Log**: what the app wants the charger to do right now and which command it sends (or, with "Allow control" off, would send), compared with what the charger is really doing, plus a log of every change and every command sent. **Clear log** empties it.
- **⚙ Settings**, with these pages:
  - **Vehicle**: your electric or plug-in hybrid vehicle and which sensors to use for battery level, range, charging and plugged in.
  - **Charger**: your EV charger, its status, charging power, current setting and start/stop switch. **Control check** shows how the app could control it.
  - **Grid**: the meter for your grid connection (P1 meter, smart meter reader or load balancer), your main fuse and load balancing.
  - **Prices**: your dynamic price source, with your purchase fee, energy tax and VAT.
  - **Control**: how the charger is started and stopped, the rules (minimum battery level, preconditioning, force window, hysteresis) and a **Manual test**.
  - **Status**: the connection to Home Assistant, whether control is allowed, and a button to run the setup wizard again.

## Getting started

1. Start the app and open **Smart Charging** in the sidebar.
2. The **setup wizard** walks you through four steps:
   1. **Vehicle**: select **Detect vehicles**, check the suggested sensors, fill in the battery capacity and select **Use this vehicle**.
   2. **Charger**: select **Detect chargers**, check the suggested entities, set the phases and select **Use this charger**.
   3. **Grid** (optional): select **Detect grid meters**, check the suggested sensors, fill in your main fuse and choose your load balancing.
   4. **Prices**: select **Detect price sources**, fill in the costs from your energy contract, select **Test** and then **Save**.
3. On the **Departures** tab, set your weekly schedule, and optionally a helper or calendar.
4. Open **Overview** and check the plan.
5. Check the planning settings in the app's **Configuration** tab in Home Assistant.

Nothing found? Open **Not listed? Choose manually** and pick the entities yourself.

No integration for your car at all? Use **No car integration?** in Settings › Vehicle: either enter the battery level on the Overview when you plug in, or charge a fixed amount each time. The app then follows the session through the charger (a charging power sensor in Settings › Charger is needed to count the energy).

## Requirements

- A vehicle integration with a battery level sensor in %, or no integration (enter the level yourself, or a fixed amount per session).
- A charger integration in Home Assistant.
- A grid meter in Home Assistant, such as a P1 meter.
- A dynamic price integration, such as EnergyZero (no account needed) or Nord Pool.

## Departure priority

When several sources give a departure on the same day, the one-off departure wins, then the calendar, then the helper, then the weekly schedule. The plan always prepares for the earliest day that has a departure.

## Charging power

The plan uses the charger maximum (phases × 230 V × maximum current), unless the car really charges slower. With a charging power sensor in Settings › Charger, the app learns from the last 10 days at what power the car typically charges at full speed (at least 30 minutes of charging is needed), and uses the lower of the two. The Overview shows which power the plan uses and why.

## House load

When Settings › Grid is set up, the plan uses the last 14 days of your grid meter to estimate, per hour of the day, how much current is left for the charger under your main fuse. The charger's own power is subtracted when a charging power sensor is chosen in Settings › Charger. Your grid meter needs long-term statistics (most P1 power sensors have them). This is an estimate; a load balancer such as the Easee Equalizer still does the real-time protection.

## Savings

The Savings tab needs a charging power sensor in Settings › Charger (for example a separate kWh meter) with long-term statistics. With a plugged-in sensor in Settings › Vehicle, sessions are compared over the whole time the car was connected; without one, only over the hours it was charging. Everything is calculated per hour, so the amounts are estimates. Prices are stored from the moment the app fetches them; EnergyZero, easyEnergy, Tibber and Nord Pool can also look back.

## Notifications and sensors

Choose where notifications go in **Settings › Status** (a list of the notify actions in your Home Assistant, such as `notify.mobile_app_your_phone`) and select **Save**. You get:

- **Problems, always**: a command to the charger failed; the charger did not start (or pause) within 5 minutes after a command; the car will not be ready at the departure because not enough time is left.
- **Every start and pause**: when "Notify every start and pause" is on (the default), with the reason, for example "Planned charging block until Thu 03:10".

Settings › Status shows the last notification and has a **Send test notification** button.

Turn on **Publish sensors** to get these sensors for dashboards and automations:

- `sensor.smart_charging_status`: charging, paused, waiting or idle, with the reason
- `sensor.smart_charging_next_start` and `sensor.smart_charging_next_end`: the next planned charging period
- `sensor.smart_charging_planned_energy`, `sensor.smart_charging_planned_cost` and `sensor.smart_charging_saving`
- `sensor.smart_charging_departure`: the next departure, with the target battery level
- `binary_sensor.smart_charging_charge_now`: on while Charge now is active

These sensors are not stored by Home Assistant between restarts; the app writes them again right after Home Assistant is back. The app writes no other entities.

## Handing over from your own automation

If you already control your charger with your own automation, keep it running while "Allow control" is off: the Log tab then compares the app with your automation. Before you turn on "Allow control", turn your own automation off (disable it in Settings → Automations), so the two do not fight. To go back, turn "Allow control" off and your automation on again.

## Configuration

These are set in Home Assistant: Settings → Apps → Smart Charging Planner → **Configuration**. Saving restarts the app.

- **Allow control**: master switch. While off (the default), the app only gives advice and never changes your charger, vehicle or home battery. When on, the app starts and pauses the charger itself, following the plan, Charge now and the rules in Settings › Control, with the start/stop method chosen there. Only start/stop is sent; the charging current is not changed. Automations, scripts and helpers are never touched.
- **Allow adding trips to calendar**: off by default. While off, "Add trip" on the Departures tab is in test mode: it shows which calendar events it would create and writes nothing. When on, trips are added to the calendar chosen on the Departures tab. This does not allow any charger control.
- **Publish sensors**: write the app's own sensors to Home Assistant (default off). See Notifications and sensors.
- **Notify action**: optional; only used when no notify action is chosen in Settings › Status.
- **Notify every start and pause**: also notify each start and pause, not only problems (default on).
- **Charging loss margin (%)**: extra energy to plan for, because not all energy from the charger ends up in the battery (default 10).
- **Prefer one continuous charging period**: charge in one go instead of in several short periods (default on).
- **Split only when it saves at least**: the amount splitting must save before the plan charges in more periods (default 0.50).
- **Account for house load**: uses the last 14 days of your grid meter to estimate how much current is left for the charger at each hour (default on; needs Settings › Grid).
- **Refresh interval**: how often (1 to 60 minutes) the app reads prices, departures and states and recalculates the plan in the background. Note that Home Assistant itself also has a refresh interval for some integrations; for example a Google calendar is updated by Home Assistant on its own schedule.
- **Log level**: how much the app writes to its log. Use `debug` when reporting a problem.

## Planned

Charging current control, home battery and solar forecast. See the [project README](https://github.com/tlpeter/smart-charging-planner) for the roadmap.
