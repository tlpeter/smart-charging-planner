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
- **Reloading**: Home reloads every minute. What you opened or closed (a day in Looking ahead, Plan details, the plan table, Next days on Plan) stays that way, and a reload that changes nothing leaves the page as it is (#51).
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
- **Ask to charge more when a trip needs it** (Settings › Rules, off by default): when the next trip (with all its places in a row) costs more than the target leaves room for, plus a reserve to be back home with (**Be back home with at least**, default 10 %), the app asks once: "Charge to 95% for this trip?". On the phone (Home Assistant phone app) the message has **Yes** and **No** buttons; other notify actions get the text only. Home shows the same question with buttons. Only **Yes** raises the target, and only for that one departure; your weekly schedule and calendar stay as they are. **No**, or no answer, keeps the target. After No, the answer is remembered but the banner uses the current trip cost and current target, just like the timeline. If a current trip estimate is unavailable, the old cost banner is hidden; that does not reset your answer or send another question. When the trip grows later (a new place in the calendar), the app asks again. When it gets shorter after a Yes (a place removed), the raised target goes down with it, never below the target from the calendar or schedule; when it is not needed any more, the Yes ends. The message is "A trip needs more charge" under **Action needed** in Settings › Notifications.
- **Notifications**: where notifications go, and the sensors in Home Assistant.
- **Diagnostics**: the connection to Home Assistant, the **Manual test**, the setup wizard, **Preview diagnostics** and **Export / Import settings**.

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

## Price sources

Settings › Prices › **Detect** lists the price sources it finds:

- **Integration actions**: EnergyZero, easyEnergy, Tibber and Home Assistant's own **Nord Pool** integration. The app asks them for today's and tomorrow's prices. An action is only offered when Home Assistant really has it.
- **Price sensors**: any sensor with a list of timed prices in its attributes. The **Nord Pool integration from HACS** (custom-components/nordpool) has the same name as Home Assistant's own, but no price action: its sensor (with `raw_today` and `raw_tomorrow`) is offered as a price sensor. That sensor includes VAT by default, so the app suggests **Market price, incl. VAT**; if you turned VAT off in that integration, choose **Market price, excl. VAT**. The unit comes from its `currency`, `unit` and `price_in_cents` attributes.
- **More than one home or area**: a Tibber account with more homes, or a Nord Pool entry with more market areas, gives prices for each. After **Test**, choose yours under **Home** or **Area**; the test result shows which one, with the currency and time zone. The app never takes the first one silently: without a choice it says which ones there are. When the chosen home or area disappears, Home shows an error instead of switching to another one.

## Prices without a dynamic contract

Choose **Fixed or day/night tariff** in Settings › Prices and enter your prices per kWh as on your energy bill (all-in):

- **Day and night**: a normal and a low price, the low tariff hours (for example 23:00–07:00) and whether the weekend is low too. The plan charges in the low hours before your departure, as much as fits.
- **One price all day**: the plan cannot save money, so it charges right away and the car is ready as soon as possible. Everything else (departures, the car's limit, Charge now, notifications) works as usual.

## Price forecast

Real day-ahead prices are only known for today and, from about 13:00, tomorrow. If you have a sensor with expected prices for the coming days, choose it under **Settings › Prices › Price forecast**. The sensor needs a list of `{time, price}` (or similar) in its attributes, like the price sensors the app already reads.

- Only the hours after the last real price are used, up to the departure. Without a departure the forecast is not used.
- If a later day is expected to be cheaper, the plan waits. The app never charges on a forecast price; when the real prices come out the plan is recalculated, so a wrong forecast only costs the difference, never a late car.
- The **safety margin** is added to every forecast price, so the app only waits when the forecast is clearly cheaper.
- **Choose what the forecast price is** (market price excl. VAT, incl. VAT, or all-in). This is required and is never copied from the real prices: a forecast is often already a consumer price, and treating it as a market price would add VAT a second time. The fees, tax and VAT of the main source are used for a market-price forecast.
- **Test** shows how one forecast price is built (input → + fee and tax → × VAT → + margin). When the sensor also has prices for hours that have a real price, Test compares one such hour. A forecast that comes out about 21 % above the real price probably already includes VAT; one about 17 % below is probably without VAT. Both give a warning.
- Example: a combined sensor whose forecast is already all-in, 0.2207 per kWh, with a margin of 0.02: choose **All-in** and the app compares 0.2407. With "Market price, excl. VAT" it would wrongly compare 0.2207 × 1.21 + 0.02 = 0.2870.
- **Combined sensor recipe**: one sensor with real prices and a forecast (entries marked `source: forecast`). Choose it as the price source with the basis of its real prices, and as the forecast sensor with the basis of its forecast prices. Run Test and check the "Same hour" line: real and forecast should be close.
- Settings from before 0.34.1 took the basis over from the real prices. The Prices page asks to check it and save once.
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

**Control.** Only with **Allow control** and **Allow home battery control** both on. The app rechecks live state at each control step. Changed commands, failed transitions and changed limits are applied without the old same-action delay. Normal successful commands are refreshed after 15 minutes; timed Huawei, SolarEdge and Marstek Local API commands use short leases refreshed each minute. Diagnostics has a test button per action.

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

**Small refills after a trip:** within **5 percentage points** below the holding level (75–80% when the hold is 80%), the refill joins the final Battery Care window. The app still chooses the cheapest usable slots inside that window. It only defers when those slots can deliver the full target by departure; otherwise the normal staged plan remains. A session that is already charging keeps its holding-level goal rather than being interrupted when it crosses into the band. Below that band, the normal price plan can charge up to the holding level earlier. A separately configured **Always charge below a minimum**, explicit Charge now / Quick minimum, preconditioning, solar charging and departure protection retain their priority. This margin applies only while Battery Care is on and the final target is above its holding level.

**Session goals on Home:** an early session shows the holding-level goal (for example 74% → 80%) and the end of that session, rather than the final 90% and an overnight finish. Looking ahead shows the early and final sessions separately. When the app has requested a pause but power is still flowing, Home says it is waiting for the charger to stop. Old period locks and price hysteresis cannot carry an early session past the holding level.

Settings › Rules, on by default. For a target above 80 % (for example 100 % for a long trip), the app charges up to 80 % whenever it is cheapest, and the rest only in the last 4 hours before the departure, so the battery does not stand full for days. The level (50–95 %) and the hours (1–24) can be changed; when the rest needs more time than those hours, it starts earlier. The car's own charge limit follows: 80 % until the last hours, then the target. Charge now and charging on solar (up to its own level) still go higher right away. Below your minimum (Always charge below a minimum) the minimum is charged first, and Battery care still holds for the rest. Home › Plan details shows when the last part is charged.

## More than one car

Settings › Vehicle › **I have more than one car** (off by default; with it off, the app works with one car as always). Add up to 6 cars with **+ Add a car**.

- **Which car is connected?** The app looks at each car's **Plugged in** sensor. Exactly one car plugged in: that car. No car says so and one car has no plug sensor: that car. Two cars say so (for example one at a public charger): the one that is charging, otherwise Home asks which car it is (one notification). With nothing plugged in, the plan is for the last car that was connected.
- **Your choice on Home** (Connected car) wins, until the charger is unplugged. A choice made before plugging in counts for the next car.
- The plan, Ready Guard, the car's charge limit, "car not reachable" and the checklist follow the connected car. The car's charge limit is never changed while the app is not sure which car is connected.
- **Departures** are shared by all cars, unless a car has its own (Plan › choose the car › "has its own departures").
- **One calendar for more cars**: "car: EV6" in the event (also "vehicle:", or in Dutch "auto:", "voertuig:") says which car a trip is for; a trip without it is for every car. The car is found by its **Name in the calendar** (Settings › Vehicle), its name, or its brand when only one car has that brand. A car that is not recognised counts for every car and is marked on Plan. "Add trip" has a **For** choice.

## More than one charger

Settings › Charger › **I have more than one charger** (off by default). Add up to 4 chargers with **+ Add a charger**.

- Every charger has its own plan, Charge now, Ready later, charging mode, control, start/stop and current method, and log. The bar at the top chooses which charger Home, Plan, Rules and Activity show.
- Every charger can have a **Usual car**. A car another charger already has is not a candidate, so the cars can also be the other way round. With nothing plugged in, a charger plans for its usual car.
- **Sharing the connection** (needs the grid meter and main fuse in Settings › Grid): when the main fuse is too small for all chargers, Charge now goes first, then a car below its minimum or preconditioning, then a car Ready Guard protects, then the car with the **least room to spare** (the earliest latest safe start: what it still needs and when it leaves). So a car that leaves later for a long trip can go before a car that leaves early but needs little. What is left is shared fairly (at least 6 A each, where the current can be set); a charger that can only start and stop charges at full current or waits. This also applies to the first charger: below 6 A it waits, and a start/stop-only charger waits unless its full request fits. A connection-capacity pause takes precedence over the temporary manual-start grace period. The net meter uses the import/export sign configured in Solar, even when solar control is off. Free current = main fuse − what the house uses now (grid meter minus the chargers) − 1 A, **per phase** (L1, L2, L3):
  - With the phase current sensors of the grid meter, each phase is checked on its own. With net power only, the house is spread evenly over the phases (an estimate). A one-phase connection has only L1.
  - A three-phase charger uses all three phases. A one-phase charger (or a three-phase charger that switched to one phase on solar) uses the phase set under **Phase used when it charges on one phase** in Settings › Charger. **Not known** (the default): the app keeps its current free on all three phases, to be safe.
  - A reading older than 5 minutes, or unavailable, is not used. Without a fresh phase reading the app uses net power; without any fresh reading only the first charger charges, at 6 A, until the meter is back.
  - Changes take time: a charger is only allowed to go up as far as the others have already come down (per phase, the old and the new current of everyone must fit); the rest follows in the next step. Chargers that go down or pause are switched first, then the home battery, then the chargers that go up.
  - Load balancer: with **all** chargers ticked under "Chargers the load balancer protects" (Settings › Grid, more chargers only), the load balancer shares and the app does not limit. Untick the chargers it does not protect: the app shares what is left for those, and what the protected chargers draw counts as house load.
  - Home battery (battery planning on): it charges from the grid only when its charging power fits in what the chargers leave on its phases (**Connected on** and **Phase** in Settings › Home battery); otherwise it holds. The cars go first. A battery that discharges is not counted as extra room.
  - With one charger nothing changes: there is nothing to share.
- Only the car that goes first charges on the sun. The home battery and the Easee Equalizer are steered by the first charger.
- The plans are made per charger and shared at the moment of charging; they do not yet take each other into account.
- Notifications name the charger. The first charger keeps `sensor.smart_charging_*`; another gets `sensor.smart_charging_<charger>_*`.

## Calendars

Any calendar in Home Assistant works for departures: Google Calendar, Local calendar, CalDAV, Remote calendar and, from Home Assistant 2026.10, **Apple iCloud** (each iCloud calendar is a calendar entity). Write "target: 80" (or in Dutch "doel: 80") in the event's notes or title; "precondition: yes" and, with more cars, "car: EV6" work the same way.

### Calendar words

The app reads English and Dutch, also mixed in one calendar. Upper and lower case do not matter. These words count:

| What | English | Dutch | Good to know |
| --- | --- | --- | --- |
| **Target** (battery level for the trip) | `target: 80` | `doel: 80` | Also `soc: 80`, `charge: 80`, `laaddoel: 80`, `target=80`, or just `80%`. Between 10 and 100. |
| **Precondition** | `precondition: yes` / `no` | `precondition: ja` / `nee`, `voorverwarmen: ja`, `voorconditioneren: ja` | Also `preconditioning:`, and `on`/`off`, `true`/`false`, `aan`/`uit`, `1`/`0`. Starts preconditioning before that drive when **Preconditioning before a departure** is on (see below). |
| **Which car** (more cars) | `car: EV6`, `vehicle: EV6` | `auto: EV6`, `voertuig: EV6` | The car's **Name in the calendar**, its name, or its brand. |
| **Trip to a place** (title) | `To Work` | `Naar Werk` | The first word is left out to find the place. German `nach` and French `vers`/`à` also work. |
| **Trip home** (title) | `Home`, `To home`, `Back home`, `Going home`, `Go home` | `Thuis`, `Huis`, `Naar huis`, `Naar thuis`, `Terug` | Or your home address or the Home zone as location. A trip home is never a departure: it is when the car is back. |
| **Names that are not an address** | `Work`, `Office`, `School`, `Gym`, `Sport`, `Training`, `Shopping`, `Parents`, `Home` | `Werk`, `Kantoor`, `Boodschappen`, `Winkel`, `Opa`, `Oma`, `Ouders`, `Thuis`, `Huis` | Add them under **My places** (or make a zone) to get the trip cost. |

With **Which events are trips? → Events that contain a keyword**, the keyword is your own (default `EV`) and works in any language.

**Add trip** writes in the language you choose under Plan › Departures › Calendar › **Language for trips the app adds** (default: the same as Home Assistant; Dutch when Home Assistant is in Dutch, otherwise English):

| | English | Nederlands |
| --- | --- | --- |
| Title | `To <destination>` | `Naar <destination>` |
| Description | `target: 80 precondition: no` | `doel: 80 precondition: nee` |
| With more cars | `… car: EV6` | `… auto: EV6` |

**Duplicate trips:** an existing event with the same destination, start minute and car tag is skipped, also when the writing language changes between English and Dutch. The app recognizes its `To`/`Naar` prefix when it agrees with the event location; it does not translate place names. Different car tags, destinations and actual start times remain separate. Existing events are not edited: changing only the target does not replace an event. Edit that event in the calendar.

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

Always on. Home shows the coming **7, 14 or 30 days** (choose it above the list; this browser remembers it) with **one line per day**, for example "Tue 20 · ⚡ 02:00 to 100% · **Main Street** 11:00–16:00 · 100% → 32% · ⚡ 16:00 to 80%": charging (blue planned, orange expected, purple minimum), each trip with its times and the battery level when leaving and when back. A day where the battery falls short is orange. Tap a day to see its full timeline, in the order things happen, with the battery level on the right:

Prices are known for a day or two (longer with a price forecast). Days after the last known price are marked **estimate**: the levels count on your trips and targets, but when and at what price the car charges is not known yet; the note under the list says until when prices are known. Days without a trip or charging are left out. **Plan** follows the same choice: **Next 7/14/30 days**, and **Trips from your calendar** shows at least 14 days. The calendar is read 31 days ahead.

- **Charging** (blue): the real plan up to the first departure.
- **Leaving**: each departure with its target and what the trip costs. A trip home, such as "Home", "To home", "Back home" or in Dutch "Naar huis" (by its title, or with your home as location), is never a departure, also not with a target in it: it is when the car is back.
- **The car is away now**: when the car is not plugged in and the app knows it is away with a trip home in the calendar, the timeline starts with **Back home** at the end of that event, and charging is planned only from then (not while the car is still away). The battery level used is the last one the car reported; what the drive home costs is not taken off yet. How the app knows where the car is: see [Where is the car?](#where-is-the-car).
- **Back home**: when, and with about how much battery.
- **Expected charging** (orange): from the moment the car is back, in the cheapest known hours, up to the next departure's target. With **Always charge when the battery is below a minimum** on and the car back below it: first **right away to the minimum** (purple), then the rest in the cheapest hours. Without known prices for then: how much is needed. "Enough for the next trip" when no charging is needed.

When another trip is added to the calendar, it takes its place in the timeline right away.

- **Zones in Home Assistant** (Settings › Areas, labels & zones › Zones), such as "Work": used automatically, with their GPS position, so no address is needed. A trip whose location is the zone's name ("Work"), or whose title is "To Work", goes to that zone. The Home zone is your home.
- **My places** (Plan): names you use in the calendar, such as "Work" or "Gym", with their address, or a **distance** (km one way from home) you enter yourself. A distance goes before the address and is never looked up. For places that are not a zone. Works the same way as a zone, and goes before a zone with the same name. Plan lists the zones the app found.
- Which place a trip goes to, first match wins: the event's location is a name from My places or a zone → that place; the location is a real address (with a house number) → that address; the title ("To Work") is a name from My places or a zone → that place; otherwise the location as it is (looked up on OpenStreetMap). When the distance of a trip is not known, Home says why and offers to add its name to My places. My places are part of the settings export.
- **What a trip costs**: when the calendar event has an address in its location (for example "Main Street 12, 1234 AB Springfield"). Words like "Work" or "Home" are not addresses (see [Calendar words](#calendar-words)); put the full address in the location to see the cost.
  - **Distance**: depends on **Plan › Trip distances and privacy** (see below). With OpenStreetMap, the address is looked up with Nominatim and the distance by road with OSRM. The address is first searched in the country of your Home Assistant (so a short address finds the place at home); when it is not found there, it is searched in every country, so a trip abroad works too (#49). When the route cannot be found: the straight line × 1.3, marked as an estimate. Every address is looked up once and remembered; lookups run in the background, one per second. Your home is the location set in Home Assistant (Settings → System → General).
  - **There and back**: twice the distance, or there plus a later trip home in the calendar (within 36 hours).
  - **More places in a row**: when the next calendar trip starts before or when this one ends (for example "To Work" 06:00–16:30, then "To Gym" 16:30–20:30, then "Home"), the car does not come home in between. The trip is home → work → sport → home: each part is the distance from the place before, and no charging is expected at home in between. So let a trip end when you leave there. A gap between two trips means the car is home first.
  - **Use per km**, best first: **learned from your own trips** (the battery level when the car was unplugged for a trip with a known distance and when it was plugged in again; after two trips), the car's **range sensor** (range at the battery level now), or **Use per 100 km** in Settings › Vehicle (default 18 kWh/100 km) and the battery capacity. Plus 10 % margin.
- **Back home**: the end of the calendar event, or of the trip home. When the trip costs more than the battery holds, the timeline says so.

### Where is the car?

When the car is plugged in, it is at home. When it is not, the app checks, in this order, and the first clear answer wins:

1. **Car location** (Settings › Vehicle, optional): a device tracker of the car. Most car integrations have one (Tesla, Renault, Kia/Hyundai, Skoda, Volvo, Mercedes, …); in some cars you have to allow location sharing in the car or its app.
2. **Person who drives** (Settings › Vehicle, optional): a person in Home Assistant, for example you with the Home Assistant Companion app on your phone. Works for every car, but it is wrong when someone else drives.
3. **A trip home in the calendar**: "Naar huis", "Back home", or your home as location.
4. **None of these**: the app does not know where the car is.

`home` means at home; `not_home` or the name of another zone means away. A state that is `unknown` or `unavailable` (or an entity that is gone) is skipped, so a broken sensor never makes the plan worse than having no sensor.

What Home shows:

- **At home** (car location or person): as before; the plan counts on charging when you plug in.
- **Away, with a trip home in the calendar**: charging is planned from when the car is back (see "The car is away now" above).
- **Away without a time back, or not known**: Looking ahead starts from the battery level now. The planned charging is shown in orange as **If plugged in by then: charging to 80%**, and the departure shows both levels ("80% when the car is plugged in at home in time; 64% without charging"). A note above the list says why. The status on top says **Car away (car location)** or that the location is not known.

The app only reads these entities; it never changes them.

### Trip distances and privacy

To know what a trip costs, the app needs its distance by road. Under **Plan › Trip distances and privacy** you choose what may be sent:

| Choice | What is sent, and where | Distances |
| --- | --- | --- |
| **OpenStreetMap public services** | The location text of calendar trips and the addresses in My places to nominatim.openstreetmap.org; the coordinates of your home and the destination to router.project-osrm.org. | By road |
| **My own servers** | The same, but to a Nominatim- and an OSRM-compatible server you run yourself (http or https). | By road |
| **Offline** | Nothing. | Zones: straight line × 1.3. My places: the distance you entered. Places looked up before keep their distance. |
| **Off** | Nothing. | None; trips show no cost. Charging for departures works as before. |

No names, times or car data are sent. A **new install** sends nothing until you choose. An install from **before 0.34.1** keeps OpenStreetMap (as it did before) and shows a notice on Plan until you confirm or change it. Lookups that were waiting are dropped right away when you switch to Offline or Off. The choice is part of the settings export; the public diagnostics only show which choice it is, never the server addresses.

### Charging stops on the way

When a trip needs more than the battery holds, the app can suggest public charging stations along the route. Turn it on under **Plan › Charging stops on the way** (off by default). The suggestions are in the day's details under **Looking ahead**, below "Back home", one block per stop, and the day's line says **charge on the way** (with the number of stops when there is more than one).

- **When**: the level after the trip would drop below **Suggest a stop when the level drops below** (default 10 %). The app shows how much to charge on the way (in % and kWh) to stay above it.
- **Needs**: Trip distances set to OpenStreetMap or your own servers (the route is needed), a destination with a position (an address or a zone, not only a distance you entered), and your own free **Open Charge Map API key** (sign in on openchargemap.org › My profile › My apps).
- **Saved key**: after Save, a green **Key saved** badge and the field's placeholder confirm the key is stored, including after reloading. The key itself is never returned to the page. Leave the field empty to keep it; type a new key to replace it and Save. A typed replacement is marked **New key — not saved** until the save succeeds. **Remove key** stages removal and turns the suggestion switch off; Save applies both changes, while Discard keeps the saved key and settings. A failed save keeps the draft so you can retry.
- **What is sent**: the route from your home to the destination, and via each of the closest stations, goes to OSRM (the same server as for trip distances); that line, the minimum power and your key go to api.openchargemap.io (the key in a header, not in the address). A longer route asks for more stations (three per km, 300 to 5000). No names, times or car data. Routes are remembered for 30 days, stations for a day.
- **Countries**: every European country, in a list that opens and closes, with a search field; the ticked ones are named on the closed line. Tick more than one for trips across a border. The stations are asked for along the whole route, so a route through Belgium into Germany or France gets stations in every country on it. **Only suggest stops in these countries** (off by default) limits the suggestions to the countries you ticked. The ticked countries also choose which operators are listed.
- **Preferred operators** (optional): only stations of these operators are shown when one of them is on the way; otherwise the others, with a note. The chosen ones show as labels with ✕ above the list; **Choose operators** opens the list, with a search field and groups that open and close: across Europe, one per ticked country, chosen ones of other countries, and **Seen on your routes** (#48): the operators of the stations found along your trips that are not in the app's own list, recognised by their Open Charge Map number (so the name does not have to match). They appear after the first lookup; up to 500 are remembered with the stations, and up to 100 can be chosen. Across Europe: IONITY, Tesla Supercharger, Fastned, Allego, Electra, Shell Recharge, bp pulse, Aral pulse, TotalEnergies, Circle K, Mer, Recharge, Power Dot, E.ON Drive. National networks, for example: LEAP24, AVIA Volt, Tango (NL), Powerdale, DATS 24 (BE), EnBW, EWE Go (DE), SMATRICS (AT), GOFAST, MOVE (CH), Izivia (FR), Atlante, Ewiva, Enel X Way, Free To X, Be Charge (IT), Iberdrola, Zunder, Endesa X, Repsol, Wenea (ES), Clever (DK), OKQ8 (SE), Eviny (NO), Orlen Charge, GreenWay (PL), ČEZ (CZ), GRIDSERVE, InstaVolt, Osprey (UK), ESB ecars (IE). For normal charging: Chargy (LU), Engie Vianeo, Lidl, Vattenfall InCharge, Equans, Eneco, PitPoint, Blue Corner, Wattif, Pod Point. The operator is recognised by its name in the station data; the name variants follow the brand names and are not checked against every station on Open Charge Map, so an operator can be missed when the station data spells it differently.
- **Connector** (CCS, CHAdeMO, Type 2) and **Minimum power** (default 50 kW): a station needs at least one of the chosen connectors with at least this power.
- **Maximum detour** (default 5 km): the extra distance by road to visit the station, looked up with OSRM for the closest stations. A service area on the other side of a motorway gets its real detour (to the next exit and back), so it is not suggested as a stop on the way. When no station is within the maximum detour, stations up to a longer detour (25 km, or three times the maximum) are shown, marked as such.
- **Reach**: only stations the car reaches before it drops below the level above (with the same 10 % margin as the trip cost, or the trip's own cost when that is higher). The trip is there and back: a station can be a stop on the way there or on the way back, and on the way back its detour is counted from the destination, so the station is on the side of the road going home.
- **More stops** (#40): when one stop is not enough, the app plans the stops one after the other. Each stop is as late as the battery allows (#50): most cars charge fastest when nearly empty, so the app takes the stations where the car arrives below **Suggest a stop when the level drops below** (down to **Arrive at a charger with at least**), and at least those in the last 25 km of what it reaches; never an early station while a later one is in reach. The next stop is planned from the first station of the stop before. Up to 40 stops; when no station fits somewhere on the way, the trip says after how many km.
- **Arrive at a charger with at least** (default 10 %, 0–50 %, not above **Suggest a stop when the level drops below**): most cars charge fastest when the battery is nearly empty. Below the level for a stop the app looks for a station, and it may drive on to this level to reach one: the stop is where the car arrives between the two levels (#50). For example 10 % to look and 5 % at least. The same value as the level for a stop (the default) works as before. Back home the level stays above the level for a stop.
- **Route map** (#47, default **Off**): **OpenStreetMap** or **My own tile server** (an http(s) address with `{z}`, `{x}` and `{y}`, for example `https://tiles.example.lan/{z}/{x}/{y}.png`). A trip with charging stops then gets a map icon 🗺 in its line in **Looking ahead** (next to "charge on the way"): one click opens the route map in a big window, without opening the day; close it with ✕, Esc or a click next to it. In the day's details there is also **Show the route on a map**: the route, home (H), the destination (D), the stops (numbers) and their other stations (small dots), on map images from the tile server, with a link to open the route on openstreetmap.org. **Sent:** only when you open a map, the page loads the map images from the tile server, which shows it which area you look at (so roughly where the route goes). Nothing is loaded while the map is closed. The page draws the map itself, without an extra map library; it fits the whole route and is not a map you can drag or zoom. The route line and the positions are never in the public diagnostics.
- **Charge to at a stop** (default 80 %, 50–100 %, at least 20 % above the level for a stop): how far to charge at each stop when more stops follow. At the last stop only what the rest of the trip needs, at most this.
- **Order** (#50): among the stations of a stop, your preferred operators first, then the most power (in steps of 50 kW), then the most charging points, then the latest, then the smallest detour. The first is the recommended station; up to two others are shown under **Or:**. Every station shows the level on arrival, the power, the number of points and the detour. Each links to the station on Open Charge Map.

The station data is **not live**: a station can be busy, out of order or gone. Check it in your charging app before you go. Nothing is steered by it. A trip with more places in a row searches along the route from home to the first place. The API key is in the settings export (a backup stays private), never in the public diagnostics.

**The chart** goes on to the last expected charging (up to 7 days ahead), as far as prices are available: charging right away to the minimum in **purple**, the rest of the expected charging in **orange**, the time the car is away shaded, and every later departure as an orange dashed line with its target.

This is an expectation. Nothing is steered by it: when the car is back and plugged in, the app plans with the real battery level. The Plan tab shows the distance and the % per calendar trip too.

## Preconditioning before a departure

Under **Settings › Rules › Preconditioning before a departure** (per car, off by default) the app asks the car to heat or cool before it leaves.

- **What the app turns on**: one switch (turned on) or button (pressed) of your car, for example Renault's "Start air conditioner". Helpers, scripts, automations and climate entities are never controlled by this app; use a switch or button of the car's own integration.
- **When**: **Minutes before departure** (default 15, 5–60) before the drive.
- **Which drives** (the calendar first):
  1. From home: a calendar trip with `precondition: yes` (or `ja`), and a departure from the **weekly schedule** (the **Precondition** tick of that day), the **helper** (its tick, or an on/off entity you choose that is only read: "on" means precondition) or a **one-off departure** (its tick). On a day where a calendar trip wins, the calendar rules count. A Ready-for choice follows the departure it is based on.
  2. The next drive of a trip (on to the next place, for example work and then sport) and a trip home in the calendar ("To home" / "Naar huis"): that event decides. With `precondition: yes` on, without it (or with `no`) off; the setting below does not count then.
  3. No event for the drive home (the car comes home at the end of the event): **Preconditioning on the way back** decides. When on, the app asks the set minutes before the event ends (for example "Work 06:30–16:30" → 16:15).
- **Plugged in or not**: not needed. When the car is plugged in, the charger stays on during preconditioning, so the energy comes from the grid.
- **Once**: one request per drive, tried once more when the command fails. The request is saved before it is sent, so after a restart it is not sent twice (a second button press could switch it off again).
- **Switch off again**: a switch the app turned on for a drive from home is turned off 15 minutes after the departure time when the car is still plugged in (it did not leave). A button is never pressed again. On the way back nothing is turned off: the car is driving.
- **Allow control off**: nothing is sent; Looking ahead shows the moment as advice.
- **Visible**: Looking ahead shows "Preconditioning for …" with the time, and whether it was asked. Only calendar events have an end time, so the way back only follows calendar trips.

A command the car's cloud accepts is not proof that the car started: check it in the car's app the first times.

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

The full overview per charger, car and home battery integration (what is read, what is steered, what is read only and what was checked on real hardware) is in [COMPATIBILITY.md](../COMPATIBILITY.md).

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

The [project roadmap](../README.md#roadmap) lists planned improvements by priority with their GitHub issues. It distinguishes stable features, improvements awaiting release and remaining work.

## Recovery safeguards (0.32.8-dev)

A followed numeric current limit of 0–5 A pauses charging. This also applies to Charge now, minimum charging, preconditioning and Ready Guard. The live limit is read on each control step, even when the price plan is cached. A missing/unavailable limit and a real zero are different.

Required current settings are sent before enabling charging. Before a phase change, the app pauses and waits for charging power to stop. It sends the phase request, waits for settling, and checks the reported selection when the method exposes a readable switch/select. A failed phase or current command keeps charging paused and is retried at the next step. For service-only methods the response confirms acceptance of the request, not a physical measurement of all phases.

The app keeps a write-ahead ownership record in /data/device_control*.json and /data/battery_control.json. A normal restart or crash no longer forgets changes recorded by this version. The record is tied to the charger/battery identity. A successful return to the normal current or battery mode clears the relevant record; a failed release is kept. These records cannot reconstruct changes made by an older version that did not save them.

Recovery obeys Allow control and Allow home battery control. With control disabled the app sends no recovery commands. If you want the app to restore a device before disabling control, first return to the price plan/full-power mode and turn battery planning off while control is still allowed, then check the physical device. The app restores the original battery values saved before its writes. Older ownership records without these originals require manual restoration and an explicit confirmation in Settings › Battery.

An old car battery reading is extended with charger energy only when it belongs to the same vehicle, charger and observed plug-in session, and its timestamp is after that session began. A trip, a car change or app restart breaks that continuity. If the level is unavailable then, the plan starts from a conservative assumption (normally 20%, or the configured minimum) and marks it as assumed. Ready Guard does not confirm Ready now from an estimated level. Wait for a fresh car reading or use the manual battery-level mode when needed.

Price rows should use UTC, epoch values or ISO timestamps with a UTC offset. For example, 2026-10-25T02:00:00+02:00 and 2026-10-25T02:00:00+01:00 are distinct hours in Europe/Amsterdam. Offset-free times in a repeated or nonexistent clock hour are skipped with a warning. Coverage checks use the actual time between local midnights: 23/24/25 hours, or 92/96/100 quarter-hours. Missing/blank/boolean prices are rejected; an explicit numeric zero or negative price remains valid.

For a combined actual/forecast sensor, check both price bases. A forecast already calibrated against consumer tariffs should use All-in, with only the chosen forecast margin added. A raw market forecast should receive fees/tax/VAT exactly once. The app does not install or maintain an external scraping automation. See the custom-source recipe in README.md and #26/#27 for the remaining provider/preview improvements.

Release gates, remaining public-beta limitations and physical verification are described in [RELEASE.md](../RELEASE.md).


## Price data warnings (0.32.12-dev)

Home shows **Price data warning** when a price row was skipped or a forecast could not be loaded. Available prices remain in use. Identical warnings from a combined actual/forecast sensor appear once, with the source and affected time where available. A genuine failure to read the actual price source is still shown separately as an error.

At a clock change, preserve UTC, epoch or explicit-offset timestamps in custom sensors. For example, both `2026-10-25T02:00:00+02:00` and `2026-10-25T02:00:00+01:00` are needed for the repeated Amsterdam hour. The app does not invent the missing hour or choose an offset for an ambiguous source row.


## Battery level and temporary calendar outages (0.32.14-dev)

The Ready Guard battery bar uses the absolute 0–100% battery level for its color: red at empty, yellow in the middle and green at full. It does not turn green just because a lower target was reached. The target marker and Ready Guard status are separate. An unknown level does not appear as 0%.

When an enabled calendar temporarily fails, the app can use the last successfully read event set for **at most 24 hours from that successful read**. The local cache survives an app restart and is separated by charger, calendar and time zone. Home and Plan show the stale-source warning and confirmation/expiry time. Problem notifications include a Calendar temporarily unavailable message; existing recipient/category preferences apply.

A successful empty calendar response means the events were removed and clears the old set immediately. Rescheduled events replace old events. A malformed response counts as a read failure. With no recent matching cache, the app warns and uses other enabled departure sources. Check your next departure: changes or cancellations made during an outage cannot be known until the calendar recovers. Past departures are not resurrected. Disabling the calendar disables fallback too. Cached calendar events stay local and are not added to diagnostic exports.


## Solar periods and declared price units (0.32.15-dev)

Solar sensor lists are treated as alternative representations of the same installation: separate today/tomorrow lists are merged, while overlapping periods use the finest available duration and are not summed twice. Power is integrated over each period and split over real UTC hours, including 23/25-hour clock-change days when timestamps carry offsets. Explicit end times, duration_minutes and ISO periods such as PT30M are supported. Otherwise the next sample supplies the duration (up to an hour); the final sample uses the normal sampling cadence, or one hour for an isolated sample. Provide explicit durations when sampling is irregular. Separate physical solar arrays should be combined through the Energy dashboard's forecast integrations. Open-Meteo's watts-map handling is unchanged.

Price sources must declare their unit, for example EUR/kWh, SEK/kWh, EUR/MWh or ct/kWh. A high kWh price stays high; its magnitude never triggers a division by 1,000. Unsupported/missing units produce an actionable source error: correct the sensor/integration metadata rather than accepting a guessed conversion. Explicit currency codes and EUR/GBP symbols must match the Home Assistant currency. The app does not perform foreign-exchange conversion; a bare kWh/MWh unit relies on the integration's configured currency. Ambiguous dollar symbols do not identify a specific dollar currency.


## Battery live bounds, recovery and site protection (0.32.16-dev)

App-level minimum/maximum settings are checked against the latest valid 0–100% SoC. Data older than 15 minutes, missing timestamps and invalid readings do not authorize charging. The software allows for sample age and a two-minute response window using the configured power/capacity. Set these power values to the actual maximum expected device power when the integration cannot set power. Native SoC controls are used where the integration exposes compatible percentage controls; an existing higher reserve or lower ceiling is preserved.

These are software controls, not a guarantee of an exact physical cutoff during a network outage, app stop or slow device response. Configure the inverter/BMS limits too. If the integration lacks a required hold/no-discharge/native-bound control, the app blocks the unsupported control and explains why. GoodWe and Marstek Local API cannot protect a positive app minimum through their existing commands; Victron and Powerwall may lack an upper stop below 100%. Read-only devices remain advice only.

Before changing a writable number, select or switch, the app records its original value. Only settings it touched are restored. The record survives failure/restart and is cleared after the reported writable settings match the restoration. An unavailable battery or a failed/unconfirmed release keeps recovery pending and blocks switching to another battery. Always release while Allow control and Allow home battery control are still enabled. An old record without originals cannot recover past values: disable battery planning, restore the previous values in Home Assistant and use **Confirm I restored the settings**. That confirmation clears only the legacy record and sends no device commands.

The home battery uses one site-level decision across all enabled chargers. It includes desired and measured charging, even when the primary charger is idle or a secondary charger was started externally. All EV plans contribute to its forecast. Never/solar-only/range policies apply to the whole site. Energy with an unknown grid/solar origin is not credited as stored solar. With more chargers, grid charging also has to fit in the per-phase budget (see Sharing the connection, #29).

## Public diagnostics (0.32.16-dev)

**Preview diagnostics** shows the exact public JSON before a separate download action. The report uses a field allowlist and consistent pseudonyms for identifiers within that export. Names, calendar aliases, destinations, free-form reasons/errors, original-setting snapshots and raw app logs are omitted. Structured decision codes, selected numeric settings and a log count remain for troubleshooting. The identifier reverse map is not exported. Numeric values and timestamps can still reveal usage patterns, so review the report before sharing.

Settings export/import is a private backup and intentionally retains configuration. It is separate from public diagnostics and should not be posted publicly.


Timed-control references: [Huawei's service schema](https://github.com/wlcrs/huawei_solar/blob/main/services.py) accepts duration in minutes and validates requested power against the current maximum. [SolarEdge's timeout control](https://github.com/WillCodeForCats/solaredge-modbus-multi/blob/main/custom_components/solaredge_modbus_multi/number.py) and [Marstek's passive-mode service](https://github.com/jaapp/ha-marstek-local-api#passive-mode-control) use seconds. The app uses two-minute leases for these timed controls and renews them at the control cadence.
