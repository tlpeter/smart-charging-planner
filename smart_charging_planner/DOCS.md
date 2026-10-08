# Smart Charging Planner

Plans EV and home battery charging around dynamic electricity prices.

> Early development. The app only reads from Home Assistant, with a few exceptions you switch on yourself: adding trips to your calendar, starting and pausing the charger ("Allow control"), sending notifications, and writing its own sensors.

## What it does now

The app is split in two: what you **use** day to day, and **settings** you set once.

**Use**

- **Home**: the charging plan with a price chart up to your departure, the expected cost compared with charging right away, and **Quick choices**:
  - **Charge now**: charge right away instead of waiting for the plan, up to the plan's target, a battery level or an amount in kWh. The app first checks whether charging is already planned soon and shows what charging now costs extra. Stops by itself when the goal is reached or the car is unplugged.
  - **Quick minimum**: charge right away up to 20–45 %, then the plan takes over.
  - **How to charge** (with solar set up): **Price plan**, **Plan + solar** or **Solar only**. See Solar below.
  - **Ready later** (tomorrow / the day after tomorrow): see below.
  - **Connected car** (with more cars) and **Chargers** (with more chargers): see below.
- **Ready Guard**: whether the car will be ready in time, and the latest safe start. See below.
- **Plan**: when the car must be ready and how full, from a weekly schedule, a Home Assistant helper, a calendar, or a one-off departure; adding trips to your calendar.
- **Activity**: **Savings** per charging session in the last 30 days, and the **Log** of what the app wanted and every command it sent.

**⚙ Settings**

- **Overview**: a checklist "is everything set up well?" with a link to fix each point, and the planning settings from Home Assistant.
- **Vehicle**, **Charger**, **Grid**, **Prices**, **Solar**: shown directly as filled-in forms; change a field and select **Save**. The Charger page also has the **Control check** and how the app starts and stops charging.
- **Battery**: the home battery (see below).
- **Rules**: the car's charge limit, the default minimum for the quick choices, always charging below a minimum, the force window, hysteresis, preconditioning, Ready Guard and Battery care.
- **Notifications**: where notifications go, and the sensors in Home Assistant.
- **Diagnostics**: the connection to Home Assistant, the **Manual test**, the setup wizard, **Download diagnostics** and **Export / Import settings**.

## Ready for tomorrow or the day after tomorrow

Normally the car is ready for the next departure. On Home, **Ready for** lets you choose a later day once, for example when the day after tomorrow is cheaper:

- The time and battery level of that day come from your schedule or calendar; you can change them.
- Departures before then get a **minimum** (20–45 %). The app charges that first, in the cheapest hours before that departure, and the rest before the chosen day.
- You see whether the prices up to then are known, come from the price forecast, or are not known yet.
- The car's charge limit follows the choice (see below).
- The choice ends by itself after the chosen time, or with **Back to normal** (on Home or on the Plan tab).
- A choice made for a departure on that day (from the schedule, calendar or helper) also ends by itself when that departure is removed, for example when you take a day off. You get a notification. A choice for a day without a departure stays until its time.
- Home and the Plan tab show when you made the choice and what it was for.

## Getting started

1. Start the app and open **Smart Charging** in the sidebar.
2. The **setup wizard** walks you through four steps:
   1. **Vehicle**: select **Detect vehicles**, check the suggested sensors, fill in the battery capacity and select **Use this vehicle**.
   2. **Charger**: select **Detect chargers**, check the suggested entities, set the phases and select **Use this charger**.
   3. **Grid** (optional, can be skipped): select **Detect grid meters**, check the suggested sensors, fill in your main fuse and choose your load balancing.
   4. **Prices**: select **Detect price sources**, fill in the costs from your energy contract (or choose **Fixed or day/night tariff**), select **Test** and then **Save**.
3. On the **Plan** tab, set your weekly schedule, and optionally a helper or calendar.
4. Open **Settings › Overview** to check that everything is set up, then **Home** to see the plan.
5. Check the planning settings in the app's **Configuration** tab in Home Assistant.

Nothing found? Open **Not listed? Choose manually** and pick the entities yourself.

No integration for your car at all? Use **No car integration?** in Settings › Vehicle: either enter the battery level on Home when you plug in, or charge a fixed amount each time. The app then follows the session through the charger (a charging power sensor in Settings › Charger is needed to count the energy).

## Requirements

Required:

- **A vehicle**: an integration with a battery level sensor in %, or no integration (enter the level yourself, or a fixed amount per session).
- **A charger** integration in Home Assistant (needed to control charging; the plan itself also works without).
- **Prices**: a dynamic price integration, such as EnergyZero (no account needed) or Nord Pool, or, without a dynamic contract, the built-in **Fixed or day/night tariff**. The plan needs prices to know which hours are cheapest.

Optional:

- **A grid meter**, such as a P1 meter, and your main fuse. Then the plan takes your house load into account. Without it, the plan assumes the charger can always charge at full power and your load balancer (if any) protects the main fuse.

## Prices without a dynamic contract

Choose **Fixed or day/night tariff** in Settings › Prices and enter your prices per kWh as on your energy bill (all-in):

- **Day and night**: a normal and a low price, the low tariff hours (for example 23:00–07:00) and whether the weekend is low too. The plan charges in the low hours before your departure, as much as fits.
- **One price all day**: the plan cannot save money, so it charges right away and the car is ready as soon as possible. Everything else (departures, the car's limit, Charge now, notifications) works as usual.

## Price forecast

Real day-ahead prices are only known for today and, from about 13:00, tomorrow. If you have a sensor with expected prices for the coming days, choose it under **Settings › Prices › Price forecast**. The sensor needs a list of `{time, price}` (or similar) in its attributes, like the price sensors the app already reads.

- Only the hours after the last real price are used, up to the departure. Without a departure the forecast is not used.
- If a later day is expected to be cheaper, the plan waits. The app never charges on a forecast price; when the real prices come out the plan is recalculated, so a wrong forecast only costs the difference, never a late car.
- The **safety margin** is added to every forecast price, so the app only waits when the forecast is clearly cheaper.
- Choose whether the forecast is a market price or all-in. The fees, tax and VAT of the main source are used.
- A sensor that combines real prices and a forecast can be used for both: entries marked as a forecast (for example `source: forecast`) are skipped as real prices.

## Solar

Set up in **Settings › Solar** (needs the grid meter in Settings › Grid: the app sees the surplus there). On Home you choose how to charge:

- **Price plan**: as without solar.
- **Plan + solar** (default once solar is on): the plan counts on the expected sun, and the app also charges on surplus whenever there is some.
- **Solar only**: only on surplus. Charge now, the minimum battery level and preconditioning still work.

**Forecast.** From the Energy dashboard (Forecast.Solar, Solcast, Open-Meteo Solar Forecast: whatever is chosen under Settings → Dashboards → Energy → Solar production forecast), or from a sensor with an hourly list (Solcast `detailedHourly`, Open-Meteo `watts`). The plan counts on a part of it (default 80 %) and subtracts the house use (from the grid meter history, otherwise a fixed amount).

**Value of your own solar power.** From 1 January 2027 "salderen" stops in the Netherlands: an exported kWh earns the feed-in compensation, not what you pay for a kWh. The plan therefore values a kWh of sun at the feed-in compensation: dynamic (the market price of that hour minus feed-in costs, optionally with VAT) or a fixed amount. With an all-in price source the market price is not known, so the fixed amount is used. The plan uses the sun for the car when that is cheaper than buying from the grid at another time; charging on the sun is never held back by "one continuous period".

**Charging on surplus.** Every minute (with Allow control on) the app looks at the grid meter: surplus = what you export + what the car uses now. It starts when the surplus is enough for 6 A for a few minutes, follows it with the charging current, and stops when it has been too low for a few minutes. Up to "Charge with solar up to" (default 90 %; the car's charge limit follows). A planned block with grid power in "Plan + solar" goes first, at full power. Without a way to set the current, charging on solar only starts when the surplus covers the full power.

**Easee Equalizer.** With an Easee charger and an Equalizer with surplus charging, Settings › Solar asks who follows the surplus: **the app** (as described above) or **the Easee Equalizer**. With the Equalizer, the app switches its surplus charging on while charging on solar and off when it charges at full power (a planned block, Charge now, the minimum level), with `easee.set_surplus_charging`. The charger stays switched on; the Equalizer starts, stops, sets the current and switches phases itself (Easee: after about 10 minutes of steady surplus, from 6 A). "Grid power allowed" is passed on as amps per phase on top of the surplus. The app sends no current or phase commands then. With the app following the surplus, turn surplus charging off in the Easee app: the page warns when it is on, because the two would fight.

**One or three phases.** Below 6 A on three phases (about 4.1 kW) the charger can switch to one phase (from about 1.4 kW), and back with enough sun, at most every 10 minutes. Possible with Easee (`easee.set_charger_phase_mode`), go-e (phase switch mode `psm`) and Peblar (`Force single phase`). Wallbox, Zaptec, Alfen, OCPP and Ohme cannot switch phases from Home Assistant.

**Current back to normal.** When the app charges at full power again (plan, Charge now), it sets the current back to the maximum and the phases back to three. A current the app never changed is left alone.

## Home battery

Set up in **Settings › Battery**. The app plans the home battery next to the car, per price block:

- **Charge from the grid** in cheap hours, only when the price difference covers the round-trip losses and the wear per kWh (default 0.03).
- **Hold (save)** the energy for expensive hours instead of emptying it in cheap ones.
- **Normal**: the battery's own mode (covering the house, taking the sun) the rest of the time.

The plan shows on Home (Home battery card) and in the chart (purple: charges, grey: holds), with the expected saving compared with leaving the battery alone.

**The car and the battery.** "May the home battery charge the car?": *Never* (default: the battery does not discharge while the car charges), *Only stored solar power* (the app counts how much of the battery's energy came from the sun), *Always* (when that pays), or *Between two levels*: the battery starts helping the car from a start level (for example 80 %) and stops at a stop level (for example 40 %) that stays for the house; after it stopped it only starts again when it is back at the start level. A bar on the page shows the levels and the level now. The plan follows the same levels. "Who gets the sun first?": *Smart* (default: the car while it still needs energy, otherwise the battery), *Car* or *Battery*.

**Brands.** Control goes through the integration's own entities and actions, checked against its source code:

| Brand | Integration | The app can |
|---|---|---|
| Sigenergy | Sigenergy Local Modbus | normal, charge, discharge, hold (Remote EMS) |
| Huawei LUNA2000 | Huawei Solar | normal, charge, discharge, hold, no discharging |
| SolarEdge | SolarEdge Modbus Multi | normal, charge, discharge, hold, no discharging (needs Remote Control) |
| Victron | sfstar/hass-victron | normal, charge, no discharging |
| GoodWe | GoodWe (core) | normal, charge, discharge (full power only) |
| Tesla Powerwall | Teslemetry, Tesla Fleet | normal, no discharging (backup reserve); no forced charging |
| HomeWizard Plug-In Battery | HomeWizard (core) | normal, charge, hold, no discharging |
| Marstek Venus | Marstek Venus Modbus, Marstek Local API | normal, charge, discharge, hold |
| Sessy | Sessy | normal, hold |
| Zonneplan Nexus, Growatt, Anker Solix, EcoFlow, Powerwall (local) | | read only (level and power shown, not steered) |

When a brand cannot "not discharge", the app uses "hold" instead, and the other way round. The battery power sign of some brands is not verified: check it on the Settings › Battery page and flip "Battery power sensor: positive means" when it is wrong.

The battery also stops discharging when the car charges without the app (started by the car or the charger, or a charger the app cannot steer). GoodWe and Marstek (Local API) cannot be told to stop discharging; Settings › Battery says so.

**Control.** Only with **Allow control** and **Allow home battery control** both on. The app sends a command when the wanted action changes, and again every 15 minutes (30 for brands with timed commands) so a battery that fell back to its own mode is steered again. Diagnostics has a test button per action.

## When the car cannot be reached

Car integrations depend on the car maker's cloud (Renault, MySkoda, Tesla …), and that is sometimes down. The app notices when the car's battery level is *unavailable*, or has not been read by Home Assistant for longer than **Car data counts as old after** (Settings › Vehicle, default 3 hours). Then:

- The plan goes on with the last good level plus the energy the charger delivered since (from the charger's power sensor, minus the loss margin). Home shows "~62% (estimated)" and why.
- When no level is known at all, the plan assumes the car is at your minimum level (Settings › Rules), or 20 %. It would rather charge a bit too much than too little.
- The car's own charge limit is not changed until the car is back: the call would fail, and car APIs limit the number of calls.
- You get one notification when the car drops out and one when it is back (at most one of each per hour).

## Ready Guard

Settings › Rules, on by default. For every departure Ready Guard checks whether the plan still has enough real-world margin: it counts with 90 % of the charging power and a safety margin (at least 30 minutes, or 15 % of the charging time when that is more). Home shows the status (on track, watch this plan, action needed, not achievable), the **latest safe start** and why. When the latest safe start is reached, Ready Guard charges continuously at full power, also over cheap hours and solar-only waiting, until the car is ready. With Publish sensors on, `sensor.smart_charging_ready_guard` shows the same.

## Battery care

Settings › Rules, on by default. For a target above 80 % (for example 100 % for a long trip), the app charges up to 80 % whenever it is cheapest, and the rest only in the last 4 hours before the departure, so the battery does not stand full for days. The level (50–95 %) and the hours (1–24) can be changed; when the rest needs more time than those hours, it starts earlier. The car's own charge limit follows: 80 % until the last hours, then the target. Charge now and charging on solar (up to its own level) still go higher right away. Home › Plan details shows when the last part is charged.

## More than one car

Settings › Vehicle › **I have more than one car** (off by default; with it off, the app works with one car as always). Add up to 6 cars with **+ Add a car**.

- **Which car is connected?** The app looks at each car's **Plugged in** sensor. Exactly one car plugged in: that car. No car says so and one car has no plug sensor: that car. Two cars say so (for example one at a public charger): the one that is charging, otherwise Home asks which car it is (one notification). With nothing plugged in, the plan is for the last car that was connected.
- **Your choice on Home** (Connected car) wins, until the charger is unplugged. A choice made before plugging in counts for the next car.
- The plan, Ready Guard, the car's charge limit, "car not reachable" and the checklist follow the connected car. The car's charge limit is never changed while the app is not sure which car is connected.
- **Departures** are shared by all cars, unless a car has its own (Plan › choose the car › "has its own departures").
- **One calendar for more cars**: "auto: renault" or "car: EV6" in the event (also "vehicle:", "voertuig:") says which car a trip is for; a trip without it is for every car. The car is found by its **Name in the calendar** (Settings › Vehicle), its name, or its brand when only one car has that brand. A car that is not recognised counts for every car and is marked on Plan. "Add trip" has a **For** choice.

## More than one charger

Settings › Charger › **I have more than one charger** (off by default). Add up to 4 chargers with **+ Add a charger**.

- Every charger has its own plan, Charge now, Ready later, charging mode, control, start/stop and current method, and log. The bar at the top chooses which charger Home, Plan, Rules and Activity show.
- Every charger can have a **Usual car**. A car another charger already has is not a candidate, so the cars can also be the other way round. With nothing plugged in, a charger plans for its usual car.
- **Sharing the connection** (needs the grid meter and main fuse in Settings › Grid): when the main fuse is too small for all chargers, Charge now goes first, then a car below its minimum or preconditioning, then a car Ready Guard protects, then the car with the **least room to spare** (the earliest latest safe start: what it still needs and when it leaves). So a car that leaves later for a long trip can go before a car that leaves early but needs little. What is left is shared fairly (at least 6 A each, where the current can be set); a charger that can only start and stop charges at full current or waits. Free current = main fuse − what the house uses now (grid meter minus the chargers) − 1 A. With a load balancer set in Settings › Grid, the load balancer shares and the app does not limit.
- Only the car that goes first charges on the sun. The home battery and the Easee Equalizer are steered by the first charger.
- The plans are made per charger and shared at the moment of charging; they do not yet take each other into account.
- Notifications name the charger. The first charger keeps `sensor.smart_charging_*`; another gets `sensor.smart_charging_<charger>_*`.

## Calendars

Any calendar in Home Assistant works for departures: Google Calendar, Local calendar, CalDAV, Remote calendar and, from Home Assistant 2026.10, **Apple iCloud** (each iCloud calendar is a calendar entity). Write "doel: 80" (or "target: 80") in the event's notes or title; "precondition: ja" and, with more cars, "auto: renault" work the same way.

**Add trip** (Plan) writes to the calendar the app reads departures from (Plan › Departures › Calendar must be on). The trip counts right away: on Plan and, when it is the next departure, as **Next stop** under Looking ahead on Home; a later trip is the **Next goal** or waits its turn. With an address as destination the app works out what the trip costs. **Back home at** (optional) is when the event ends: then the app knows when the car is back; without it the event lasts 15 minutes. **For** (which car) only appears with more than one car.

Add trip needs a calendar Home Assistant can add events to. Apple iCloud calendars are read only in Home Assistant: the calendar is marked "read only" in the list, and Add trip says so. Add those trips in the calendar app itself (for example on your iPhone); the app reads them as usual.

## Looking ahead: the next stop, next goal and what a trip costs

Always on. Home shows a card with:

- **The next stop**: the first upcoming trip with the battery level it requires. When another trip is added before it in the calendar, that trip automatically becomes the next stop.
- **The next goal**: the first departure after the car is back (a trip home, such as "Naar Thuis", does not count as a goal). It is shown also when the current target is already reached, and also when the prices for then are not known yet (then without cost).
- **What this trip costs**: when the calendar event has an address in its location (for example "Hoeksekade 141 2661 JL Bergschenhoek"). Words like "Werk" or "Thuis" are not addresses; put the full address in the location to see the cost.
  - **Distance**: the address is looked up on OpenStreetMap (Nominatim), the distance by road with OpenStreetMap routing (OSRM). When the route cannot be found: the straight line × 1.3, marked as an estimate. Every address is looked up once and remembered; lookups run in the background, one per second. Your home is the location set in Home Assistant (Settings → System → General).
  - **There and back**: twice the distance, or there plus a later trip home in the calendar (within 36 hours).
  - **Use per km**, best first: **learned from your own trips** (the battery level when the car was unplugged for a trip with a known distance and when it was plugged in again; after two trips), the car's **range sensor** (range at the battery level now), or **Use per 100 km** in Settings › Vehicle (default 18 kWh/100 km) and the battery capacity. Plus 10 % margin.
- **Back home**: when (the end of the calendar event, or of the trip home) and with about how much battery.
- **Expected charging** for the next goal, from the moment the car is back, in the cheapest hours: in **orange** in the chart, with "next goal" marked. The card is orange when the car is expected back below the next goal.

This is an expectation. Nothing is steered by it: when the car is back and plugged in, the app plans with the real battery level. The Plan tab shows the distance and the % per calendar trip too.

## Departure priority

When several sources give a departure on the same day, the one-off departure wins, then the calendar, then the helper, then the weekly schedule. The plan always prepares for the earliest day that has a departure.

## Charging power

The plan uses the charger maximum (phases × 230 V × maximum current), unless the car really charges slower. With a charging power sensor in Settings › Charger, the app learns from the last 10 days at what power the car typically charges at full speed (at least 30 minutes of charging is needed), and uses the lower of the two. Home shows which power the plan uses and why.

## House load

When Settings › Grid is set up, the plan uses the last 14 days of your grid meter to estimate, per hour of the day, how much current is left for the charger under your main fuse. The charger's own power is subtracted when a charging power sensor is chosen in Settings › Charger. Your grid meter needs long-term statistics (most P1 power sensors have them). This is an estimate; a load balancer such as the Easee Equalizer still does the real-time protection.

## Savings

The Savings tab needs a charging power sensor in Settings › Charger (for example a separate kWh meter) with long-term statistics. With a plugged-in sensor in Settings › Vehicle, sessions are compared over the whole time the car was connected; without one, only over the hours it was charging. Everything is calculated per hour, so the amounts are estimates. Prices are stored from the moment the app fetches them; EnergyZero, easyEnergy, Tibber and Nord Pool can also look back.

## The car's own charge limit

Many cars have their own charge limit (for example Renault "Target charge level"). The car stops charging there, even when the charger keeps going. The app finds this limit on the car's device (or you choose it in Settings › Vehicle).

**The limit follows every choice**, when the car supports changing it from Home Assistant and "Allow control" is on. The app sets it to the highest goal that is active: the battery level of your next departure, Charge now (a level, or an amount in kWh converted to a level), or Ready for tomorrow / the day after. A goal below that, such as Quickly to a minimum, never lowers it. When a goal ends, the limit goes back, also down. Every choice shows beforehand what happens with the limit.

- Only while the car is plugged in; the value is rounded up to a step the car accepts and kept between 50 and 100 %.
- A new limit is sent right away, once. Because the car's cloud is slow and limits the number of calls, it is only sent again when the car still shows the old value after 15 minutes (at most 3 times); then you get a notification.
- If the car does not support it, the app plans up to the car's limit and tells you to raise it in the car.
- Your own automation does this? Turn on **Don't change the car's charge limit** in Settings › Rules.

## Supported chargers

The app reads which actions and entities your charger's integration offers and picks the best way to start and stop. Checked against the integrations' source code:

| Charger | Integration | Start / stop | Notes |
|---|---|---|---|
| Easee | easee (HACS) | "Charger enabled" switch on / off | Pause/resume (`easee.action_command`) can be chosen in Settings › Charger, but does nothing while the charger is switched off. Current and phases (solar) through Easee's own actions |
| Zaptec | zaptec (HACS) | Resume / Stop charging buttons | Resume only works after a stop command |
| Alfen | alfen_wallbox (HACS) | Charging switch | One login at a time; solar mode may override |
| Wallbox | wallbox | Pause/resume switch | Eco-Smart and Wallbox schedules may override |
| go-e | goecharger_api2 (HACS) | Force state: Charge / Don't charge | Older goecharger: Allow charging switch |
| Peblar | peblar | Charge switch | Set Smart charging to "default" |
| OCPP (many brands) | ocpp (HACS) | Charge control switch | The charger must connect to Home Assistant |
| Ohme | ohme | Charge mode: Max charge / Paused | Ohme's own smart charging is replaced while the app controls |
| Tesla Wall Connector | tesla_wall_connector | – | Can only read; no control |

Other chargers work when their integration offers a pause/resume or start/stop action, start and stop buttons, a charging switch or a choice with charge / stop options.

## Possible conflicts

Automations that also start or stop the charger, or change the car's charge limit, undo what the app does. Activity › Log and Settings › Rules list automations that are on and use the charger's start/stop entity, the charger device or the car's charge limit (also through a script they call). Home Assistant only tells whether an automation uses an entity, not whether it changes it, so select **Ignore** for harmless ones such as notifications. The app never turns automations off.

## Notifications and sensors

Choose where notifications go in **Settings › Notifications** (a list of the notify actions in your Home Assistant, such as `notify.mobile_app_your_phone`) and select **Save**. You get:

- **Problems, always**: a command to the charger failed; the charger did not start (or pause) within 5 minutes after a command; Ready Guard: the target is at risk or Ready Guard took over; the car is not reachable (and back); which car is connected (more cars).
- **Every start and pause**: when "Notify every start and pause" is on (the default), with the reason, for example "Planned charging block until Thu 03:10".

Settings › Notifications shows the last notification and has a **Send test notification** button.

Turn on **Publish sensors** to get these sensors for dashboards and automations:

- `sensor.smart_charging_status`: charging, paused, waiting or idle, with the reason
- `sensor.smart_charging_next_start` and `sensor.smart_charging_next_end`: the next planned charging period
- `sensor.smart_charging_planned_energy`, `sensor.smart_charging_planned_cost` and `sensor.smart_charging_saving`
- `sensor.smart_charging_departure`: the next departure, with the target battery level
- `binary_sensor.smart_charging_charge_now`: on while Charge now is active
- `sensor.smart_charging_ready_guard`: the Ready Guard status, latest safe start, margin and shortfall

These sensors are not stored by Home Assistant between restarts; the app writes them again right after Home Assistant is back. The app writes no other entities.

## Handing over from your own automation

If you already control your charger with your own automation, keep it running while "Allow control" is off: the Log tab then compares the app with your automation. Before you turn on "Allow control", turn your own automation off (disable it in Settings → Automations), so the two do not fight. To go back, turn "Allow control" off and your automation on again.

## Backup and moving to another install

Settings › Diagnostics › **Export settings** saves all settings of the app in one file. **Import settings** puts them back, in this install or another one (for example the test version). Before anything changes you see what is in the file and what this Home Assistant does not have; parts that do not fit here (a car limit on another device, a battery or notify action that does not exist) are left out. "Allow control" and the other options in the Configuration tab are never part of the file.

## Security

- The app only accepts requests through Home Assistant ingress (the sidebar panel). Other apps on the internal network are refused.
- Changes are only accepted as JSON from the app's own page, not from other websites.
- The app reads from Home Assistant. Everything it can change is off by default and switched on by you: starting and pausing the charger and the car's charge limit ("Allow control"), adding trips to your calendar, notifications to the one notify action you choose, and its own `smart_charging_*` sensors.
- The home battery is only steered with Allow control and Allow home battery control both on, and only through the battery's own entities and actions.
- It never changes automations, scripts, helpers, locks, alarms, covers, lights or other devices. Control only works for a device that Home Assistant's registry shows as an EV charger.
- The Supervisor token is never logged or shown in the browser.
- Every command sent is logged in the Log tab and the app log.

## Configuration

These are set in Home Assistant: Settings → Apps → Smart Charging Planner → **Configuration**. Saving restarts the app.

- **Allow control**: master switch. While off (the default), the app only gives advice and never changes your charger, vehicle or home battery. When on, the app starts and pauses the charger itself, following the plan, Charge now and the rules in Settings › Rules, with the start/stop method chosen in Settings › Charger. Only start/stop is sent, plus the charging current and phases when charging on solar (Settings › Solar). Automations, scripts and helpers are never touched.
- **Allow home battery control**: off by default. With Allow control also on, the app steers the home battery following its plan (Settings › Battery). While off, the battery plan is advice only.
- **Allow adding trips to calendar**: off by default. While off, "Add trip" on the Plan tab is in test mode: it shows which calendar events it would create and writes nothing. When on, trips are added to the calendar chosen on the Plan tab. This does not allow any charger control.
- **Publish sensors**: write the app's own sensors to Home Assistant (default off). See Notifications and sensors.
- **Notify every start and pause**: also notify each start and pause, not only problems (default on).
- **Charging loss margin (%)**: extra energy to plan for, because not all energy from the charger ends up in the battery (default 10).
- **Prefer one continuous charging period**: charge in one go instead of in several short periods (default on).
- **Split only when it saves at least**: the amount splitting must save before the plan charges in more periods (default 0.50).
- **Account for house load**: uses the last 14 days of your grid meter to estimate how much current is left for the charger at each hour (default on; needs Settings › Grid).
- **Refresh interval**: how often (1 to 60 minutes) the app reads prices, departures and states and recalculates the plan in the background. Note that Home Assistant itself also has a refresh interval for some integrations; for example a Google calendar is updated by Home Assistant on its own schedule.
- **Log level**: how much the app writes to its log. Use `debug` when reporting a problem.

## Planned

Plans of more chargers that take each other into account. See the [project README](https://github.com/tlpeter/smart-charging-planner) for the roadmap and an overview of all options.
