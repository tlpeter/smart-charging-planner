# Smart Charging Planner

Plans EV and home battery charging around dynamic electricity prices.

> Early development. The app only reads from Home Assistant, with a few exceptions you switch on yourself: adding trips to your calendar, starting and pausing the charger ("Allow control"), sending notifications, and writing its own sensors.

## What it does now

The app is split in two: what you **use** day to day, and **settings** you set once.

**Use**

- **Charging status** (the card on top of Home, checked every minute): one line with what happens now, in one colour. **Green** ready (at the target). **Red** charging, with the power, the level it charges to and when it gets there: the plan's target, your **minimum** ("Charging to your minimum", when the battery is below it: that part first, then the plan), or the goal of **Charge now** / **Quick minimum**. **Yellow** waiting (for the next planned block, the sun, the other charger, or **Battery care**: "Battery care · charging starts at 09:36" while the car stays at the care level until the last hours, also when the charger is already on). **Orange** something is in the way (the car's charge limit is too low, the charger did not start, the car or charger cannot be reached, or the charger reports a problem such as an error, a fault or an update; then it shows the charger's own words). **Grey** nothing to do (not plugged in). When the app wants to charge and the charger is switched on, but no power flows for more than a minute, the card is orange: **"The charger is on, but the car takes no power"**, with the charger's own status and since when it is on.
  - **Why?** (under the status): the facts behind it, as the app sees them at the last check: what the app wants and why, the charger switch (on/off and since when), the charger's status in its own words with what it means, the power now, the car (plugged in, battery, charge limit, target), Battery care (holding back or not, until when), Ready Guard, Charge now, and the next planned charging. Only facts, no advice.
- **Home**: the charging plan with a price chart from 12 hours back (or 24 hours, 3 or 7 days: choose it above the chart; this browser remembers it) up to your departure. Blocks the car really charged in are **yellow**, from the charger power sensor (Home Assistant keeps its 5-minute values for 10 days). Older prices come from the app's price history (stored from the moment the app fetched them) or the fixed tariff. Planned charging is **blue**; charging for a **minimum** is **purple** (see below). **Show plan table** below the chart lists the charging periods and, **per block**, the price and the energy. A block that is only **partly** needed shows the time it really charges (for example "partly: 11:22–11:30, 8 of 15 min"): the app uses the more expensive block for that part and puts it right against the other planned blocks, so charging runs in one go. Further: the expected cost compared with charging right away, and **Quick choices**:
  - **Charge now**: charge right away instead of waiting for the plan, up to the plan's target, a battery level or an amount in kWh. The app first checks whether charging is already planned soon and shows what charging now costs extra. Stops by itself when the goal is reached or the car is unplugged.
  - **Just turn it on** (under Charge now): one tap, and the charger charges right away, with no goal, no cheap hours and no car data. For a visitor's car, or any car the app does not know. It keeps charging until you press **Stop** or the car is unplugged (a full car stops by itself). While it is on, the app does not change your own car's charge limit and does not count this as a trip of your car.
  - **Quick minimum**: charge right away up to 20–45 % (the default comes from **Default minimum for the quick choices** in Settings › Rules), then the plan takes over. Shown in **purple** in the chart.
  - **How to charge** (with solar set up): **Price plan**, **Plan + solar** or **Solar only**. See Solar below.
  - **Ready later** (tomorrow / the day after tomorrow): see below.
  - **Connected car** (with more cars) and **Chargers** (with more chargers): see below.
- **Charging status** (on top): what the charger does right now, checked every minute, in one line with a colour:
  - **green**: **Ready** (at the target, the charger is off);
  - **red**: **Charging now** (with the power, the level and when it is ready), **Ready Guard charging** or **Charging on solar**;
  - **yellow**: **Not charging now · starts at …** (the cheapest hours, or Ready Guard starting earlier for the safety margin), **Starting to charge**, **Waiting for the sun** (solar only) or **Waiting for the other charger**;
  - **orange**: something is in the way: **the car's charge limit** is below your trip, **the charger did not start**, **charger not reachable**, **car not reachable** (its cloud does not answer) or **cannot plan** (battery level or size missing);
  - **grey**: **Car not connected**, or nothing to do. With Allow control off it says **Advice only** in grey.
- **Ready Guard**: whether the car will be ready in time, and the latest safe start. See below.
- **Plan**: when the car must be ready and how full, from a weekly schedule, a Home Assistant helper, a calendar, or a one-off departure; adding trips to your calendar.
- **Activity**: **Savings** per charging session in the last 30 days, and the **Log** of what the app wanted and every command it sent.

**⚙ Settings**

- **Overview**: a checklist "is everything set up well?" with a link to fix each point, and the planning settings from Home Assistant.
- **Vehicle**, **Charger**, **Grid**, **Prices**, **Solar**: shown directly as filled-in forms; change a field and select **Save**. The Charger page also has the **Control check** and how the app starts and stops charging.
- **Battery**: the home battery (see below).
- **Rules**: the car's charge limit, **Restart the car when it takes no power** (off by default; see below), the default minimum for the quick choices, always charging below a minimum, the force window, hysteresis, preconditioning, Ready Guard and Battery care. **Always charge when the battery is below a minimum**: below that level the car charges right away, at any price (or only up to a maximum price: then that part is planned in the first blocks at or below that price, and it stops as soon as the price is higher or the battery is at the minimum); in the chart that part is **purple**, the rest is planned as usual. A minimum above the departure's target counts too: the car charges up to the minimum, and the plan and the chart show that (unless the car's own charge limit is lower). In Looking ahead, the minimum after a trip is planned only until the next departure. **Default minimum for the quick choices** is not a switch: it is the level Quick minimum and Ready for start with. **Restart the car when it takes no power**: some cars (for example Renault) end their charging session at their own limit (say 80 % at night, for Battery care) and do not start again when the app raises the limit later: the charger is on and ready, but the car asks for no power. With this option on, when the app wants to charge and no power flows for 2 minutes, it sets the car's limit one step lower (100 % → 95 %) and at the next check back to the goal; that change starts the car again. At most once every 30 minutes, only when the app manages the car's limit and the car is below it. It shows under **Why?** on Home and in the log.
- **Ask to charge more when a trip needs it** (Settings › Rules, off by default): when the next trip (with all its places in a row) costs more than the target leaves room for, plus a reserve to be back home with (**Be back home with at least**, default 10 %), the app asks once: "Charge to 95% for this trip?". On the phone (Home Assistant phone app) the message has **Yes** and **No** buttons; other notify actions get the text only. Home shows the same question with buttons. Only **Yes** raises the target, and only for that one departure; your weekly schedule and calendar stay as they are. **No**, or no answer, keeps the target. When the trip grows later (a new place in the calendar), the app asks again. The message is "A trip needs more charge" under **Action needed** in Settings › Notifications.
- **Notifications**: where notifications go, and the sensors in Home Assistant.
- **Diagnostics**: the connection to Home Assistant, the **Manual test**, the setup wizard, **Download diagnostics** and **Export / Import settings**.

## Ready for tomorrow or the day after tomorrow

Normally the car is ready for the next departure. On Home, **Ready for** lets you choose a later day once, for example when the day after tomorrow is cheaper:

- The time and battery level of that day come from your schedule or calendar; you can change them.
- Departures before then get a **minimum** (20–45 %). The app charges that first, in the cheapest hours before that departure (**purple** in the chart), and the rest before the chosen day.
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

Changes in Settings count only after you save them. While a page has unsaved changes an orange bar shows **Save** and **Discard**, and leaving the page first asks whether to save, discard or stay.

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

The plan shows on Home (Home battery card) and in the chart (turquoise: charges, grey: holds), with the expected saving compared with leaving the battery alone.

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

**Plugged in.** The charger sees the cable right away; the car's own "Plugged in" sensor often comes through the car's cloud, minutes later. So when the charger says a car is connected, the app counts the car as plugged in at once. The car's sensor is used when the charger cannot tell (for example a car plugged in at a public charger). An **on/off sensor** as charger status works too: a "plug" sensor tells whether a car is connected (on) or not (off); a "charging" sensor tells whether the car charges, and when it is off the car's own sensor tells whether it is plugged in. The status texts of Easee, Zaptec, Alfen, Wallbox, go-e, Peblar, OCPP and Ohme are all known to the app. A text that means "no car" (for example Wallbox **Locked** or OCPP **Reserved**) counts as not plugged in; a text that means a problem (an error, a fault, booting, updating, Alfen **Off**) counts as a charger problem: the app waits 2 minutes, then pauses charging.

## Ready Guard

Settings › Rules, on by default. For every departure Ready Guard checks whether the plan still has enough real-world margin: it counts with 90 % of the charging power and a safety margin (at least 30 minutes, or 15 % of the charging time when that is more). Home shows the status (on track, watch this plan, action needed, not achievable), the **latest safe start** and why. When the cheapest plan starts after the latest safe start, Ready Guard says so (**Ready Guard starts earlier**) instead of "On track". When the car's own charge limit is below the wanted level and the app may not change it ("Don't change the car's charge limit" in Settings › Rules, or a car that only shows its limit), the status is **action needed** with the limit, and you get the notification "Ready Guard needs you". When the latest safe start is reached, Ready Guard charges continuously at full power, also over cheap hours and solar-only waiting, until the car is ready. With Publish sensors on, `sensor.smart_charging_ready_guard` shows the same.

## Battery care

Settings › Rules, on by default. For a target above 80 % (for example 100 % for a long trip), the app charges up to 80 % whenever it is cheapest, and the rest only in the last 4 hours before the departure, so the battery does not stand full for days. The level (50–95 %) and the hours (1–24) can be changed; when the rest needs more time than those hours, it starts earlier. The car's own charge limit follows: 80 % until the last hours, then the target. Charge now and charging on solar (up to its own level) still go higher right away. Below your minimum (Always charge below a minimum) the minimum is charged first, and Battery care still holds for the rest. Home › Plan details shows when the last part is charged.

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

**Add trip** (Plan) writes to the calendar the app reads departures from (Plan › Departures › Calendar must be on). The trip counts right away: on Plan and in the timeline under Looking ahead on Home. With an address as destination the app works out what the trip costs. **Back home at** (optional) is when the event ends: then the app knows when the car is back; without it the event lasts 15 minutes. **For** (which car) only appears with more than one car.

### A trip added in Google Calendar (or another online calendar)

Home Assistant does not hear about a new event in an online calendar right away: it fetches the calendar again on its own schedule (for Google Calendar every few minutes; the exact interval depends on the integration). Until then the app does not see the trip either.

- **Refresh** on Home (next to "Updated") first asks Home Assistant to fetch the departures calendar again, waits a moment, and then calculates the plan. A trip you just added is then in the plan right away. This is the only thing the app asks Home Assistant to do with your calendar besides reading it (and adding trips, when you allow that); it changes nothing.
- The automatic recalculation every few minutes does **not** fetch the calendar again, so it does not add calls to your calendar.
- Trips added with **Add trip** count right away; no refresh needed.

**Fetching the calendar more often yourself (optional).** To have Home Assistant fetch the calendar every 5 minutes, also without pressing Refresh, add an automation:

1. In Home Assistant go to **Settings › Automations & scenes › Create automation › Create new automation**.
2. Open the menu (three dots) › **Edit in YAML** and paste this, with your own calendar entity:

```yaml
alias: Fetch the trips calendar every 5 minutes
triggers:
  - trigger: time_pattern
    minutes: "/5"
  - trigger: homeassistant
    event: start
actions:
  - action: homeassistant.update_entity
    target:
      entity_id: calendar.your_calendar
mode: single
```

3. Select **Save**. The app reads the calendar as usual; this only makes Home Assistant fetch it more often.

A button on your own dashboard that does the same: create a **Button** helper (Settings › Devices & services › Helpers › Create helper › Button), and add it as a third trigger: `trigger: state` with `entity_id: input_button.<your button>`. Pressing the button then fetches the calendar.

Add trip needs a calendar Home Assistant can add events to. Apple iCloud calendars are read only in Home Assistant: the calendar is marked "read only" in the list, and Add trip says so. Add those trips in the calendar app itself (for example on your iPhone); the app reads them as usual.

## Looking ahead: the coming days and what a trip costs

Always on. Home shows the coming days (up to 7 days, 6 departures) with **one line per day**, for example "Tue 20 · ⚡ 02:00 to 100% · **Main Street** 11:00–16:00 · 100% → 32% · ⚡ 16:00 to 80%": charging (blue planned, orange expected, purple minimum), each trip with its times and the battery level when leaving and when back. A day where the battery falls short is orange. Tap a day to see its full timeline, in the order things happen, with the battery level on the right:

- **Charging** (blue): the real plan up to the first departure.
- **Leaving**: each departure with its target and what the trip costs. A trip home, such as "Naar Thuis", "Naar huis", "Home" or "Naar Home" (by its title, or with your home as location), is never a departure, also not with a target in it: it is when the car is back.
- **The car is away now**: when the car is not plugged in and a trip home is in the calendar, the timeline starts with **Back home** at the end of that event, and charging is planned only from then (not while the car is still away). The battery level used is the last one the car reported; what the drive home costs is not taken off yet.
- **Back home**: when, and with about how much battery.
- **Expected charging** (orange): from the moment the car is back, in the cheapest known hours, up to the next departure's target. With **Always charge when the battery is below a minimum** on and the car back below it: first **right away to the minimum** (purple), then the rest in the cheapest hours. Without known prices for then: how much is needed. "Enough for the next trip" when no charging is needed.

When another trip is added to the calendar, it takes its place in the timeline right away.

- **Zones in Home Assistant** (Settings › Areas, labels & zones › Zones), such as "Werk": used automatically, with their GPS position, so no address is needed. A trip whose location is the zone's name ("Werk"), or whose title is "Naar Werk", goes to that zone. The Home zone is your home.
- **My places** (Plan): names you use in the calendar, such as "Werk" or "Northwind Labs", with their address. For places that are not a zone. Works the same way as a zone, and goes before a zone with the same name. Plan lists the zones the app found.
- Which place a trip goes to, first match wins: the event's location is a name from My places or a zone → that place; the location is a real address (with a house number) → that address; the title ("Naar Werk") is a name from My places or a zone → that place; otherwise the location as it is (looked up on OpenStreetMap). When the distance of a trip is not known, Home says why and offers to add its name to My places. My places are part of the settings export.
- **What a trip costs**: when the calendar event has an address in its location (for example "Hoofdweg 1 2661 AA Bergschenhoek"). Words like "Werk" or "Thuis" are not addresses; put the full address in the location to see the cost.
  - **Distance**: the address is looked up on OpenStreetMap (Nominatim), the distance by road with OpenStreetMap routing (OSRM). When the route cannot be found: the straight line × 1.3, marked as an estimate. Every address is looked up once and remembered; lookups run in the background, one per second. Your home is the location set in Home Assistant (Settings → System → General).
  - **There and back**: twice the distance, or there plus a later trip home in the calendar (within 36 hours).
  - **More places in a row**: when the next calendar trip starts before or when this one ends (for example "Naar Werk" 06:00–16:30, then "Naar Sport" 16:30–20:30, then "Naar Thuis"), the car does not come home in between. The trip is home → work → sport → home: each part is the distance from the place before, and no charging is expected at home in between. So let a trip end when you leave there. A gap between two trips means the car is home first.
  - **Use per km**, best first: **learned from your own trips** (the battery level when the car was unplugged for a trip with a known distance and when it was plugged in again; after two trips), the car's **range sensor** (range at the battery level now), or **Use per 100 km** in Settings › Vehicle (default 18 kWh/100 km) and the battery capacity. Plus 10 % margin.
- **Back home**: the end of the calendar event, or of the trip home. When the trip costs more than the battery holds, the timeline says so.

**The chart** goes on to the last expected charging (up to 7 days ahead, like the timeline), as far as prices are available: charging right away to the minimum in **purple**, the rest of the expected charging in **orange**, the time the car is away shaded, and every later departure as an orange dashed line with its target.

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

In **Settings › Notifications** you add **recipients**: every phone (or group) that should get messages. Per recipient:

- **Name** and **Notify action** (a notify action in your Home Assistant, such as `notify.mobile_app_your_phone`, or a notify group).
- **For which cars** (only with more than one car): all cars, or the cars you tick. A message about a car only goes to recipients who chose that car. Home battery messages are not about a car.
- **Messages**, in five groups. A group switch turns all its messages on or off; open the group to choose message by message:

| Group | Messages |
|---|---|
| **Problems** | Charger command failed · Charger did not start or pause (within 5 minutes after a command) · Easee Equalizer command failed · Car charge limit not changed |
| **Action needed** | Ready Guard: target at risk · Ready Guard takes over · A trip needs more charge (Yes/No) · Ready Guard needs you (plug in, allow control, the car's charge limit too low) · Which car is connected? |
| **Car** | Car not reachable · Car reachable again · Car charge limit changed · Ready-for choice ended |
| **Start and pause** | Charging started · Charging paused (with the reason, for example "Planned charging block until Thu 03:10") |
| **Home battery** | What the home battery does now · Home battery command failed |

Tapping a notification in the Home Assistant phone app (`notify.mobile_app_…`) opens the Smart Charging page (the app must be shown in the sidebar). A new message type in a later version is on for every recipient. **Send test** sends a test to one recipient (save first). The page shows per recipient the last message and whether it was sent. Up to 10 recipients. Some messages are sent at most every few hours (for example Ready Guard every 6 hours); a message that reached no phone does not count, so it is tried again at the next check.

From a version before recipients: your notify action becomes one recipient, "My phone", for all cars. When "Notify every start and pause" was off, its start, pause and home battery messages are off. After that, the option in the Configuration tab is not used any more.

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
- The app reads from Home Assistant. Everything it can change is off by default and switched on by you: starting and pausing the charger and the car's charge limit ("Allow control"), adding trips to your calendar, notifications to the notify actions you choose as recipients, and its own `smart_charging_*` sensors. One harmless call needs no switch: **Refresh** on Home asks Home Assistant to fetch the departures calendar again (`homeassistant.update_entity` for that one calendar).
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
- **Notify every start and pause**: only used once, when you update from a version before recipients (see Notifications). Choose the messages per recipient in Settings › Notifications.
- **Charging loss margin (%)**: extra energy to plan for, because not all energy from the charger ends up in the battery (default 10).
- **Prefer one continuous charging period**: charge in one go instead of in several short periods (default on).
- **Split only when it saves at least**: the amount splitting must save before the plan charges in more periods (default 0.50).
- **Account for house load**: uses the last 14 days of your grid meter to estimate how much current is left for the charger at each hour (default on; needs Settings › Grid).
- **Refresh interval**: how often (1 to 60 minutes) the app reads prices, departures and states and recalculates the plan in the background. Note that Home Assistant itself also has a refresh interval for some integrations; for example a Google calendar is updated by Home Assistant on its own schedule.
- **Log level**: how much the app writes to its log. Use `debug` when reporting a problem.

## Planned

The [project roadmap](https://github.com/tlpeter/smart-charging-planner/blob/main/README.md#roadmap) lists the planned improvements by priority, each linked to its GitHub issue. It covers public-release readiness, prices, privacy, physical site capacity, calendar clarity, shared charging plans, pause/recovery controls, longer look-ahead and en-route charging suggestions. Enhancements already implemented on dev are listed separately until they reach a stable release.
