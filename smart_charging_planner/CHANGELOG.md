# Changelog

## 0.22.1

- Planning: the next-departure card shows an active **Ready for** choice from Home (ready when, at what level, and the minimum for departures before then)

## 0.22.0

New layout: what you use day to day is apart from what you set once.

- **Tabs**: **Home** (plan and quick choices), **Planning** (departures), **History** (Savings and Log) and **⚙ Settings**
- **Settings › Overview**: a checklist "is everything set up well?" with a link to fix each point (vehicle, battery capacity, charger, start/stop, prices, forecast, departures, Allow control, the car's charge limit, your own automations, notifications, grid), plus the planning settings from Home Assistant
- **Vehicle, Charger and Grid** are shown directly as filled-in forms, like Prices. Another device or choosing manually is under "Use a different …"; **Search again** keeps your settings
- How the app starts and stops charging moved to **Settings › Charger**; **Rules** keeps the rules; the **Manual test** and the status of the connection moved to **Settings › Diagnostics**; **Notifications** has its own page
- **Quick choices** on Home:
  - **Charge now** (as before)
  - **Quickly to a minimum**: 20–45 %, then the plan takes over
  - **Ready for tomorrow / the day after tomorrow**: time and battery level from your schedule or calendar, adjustable. Departures before then get a minimum (20–45 %), charged first in the cheapest hours before that departure; the rest before the chosen day. Shows whether the prices up to then are known or come from the forecast. Ends by itself, or with **Back to normal**
- **The car's charge limit follows every choice**, automatically when the car supports it (no more option to turn on, no more button): the highest active goal (departure, Charge now as a level or as kWh, Ready for), and back down when it ends. Every choice shows beforehand what happens with the limit. Turn it off only in Settings › Rules (**Don't change the car's charge limit**)
- New rule: the default minimum for the quick choices
- Planner: two goals (a minimum before a departure in between, the full target later)
- A started planned period is not finished when you make a new Ready-for choice
- Small screens: the main tabs wrap instead of scrolling

## 0.21.2

- Settings › Prices shows the settings right away as a form, filled with what is saved: source, costs and forecast. No more **Change** button; adjust a field and press Save. "Saved." confirms it
- On top: **Prices now**, the live summary of today, tomorrow and the forecast
- **Search for price sources again** keeps what is filled in
- A purchase fee or energy tax of 0 is shown as 0 instead of the grey example value

## 0.21.1

- **Change** no longer starts from empty forms. On Settings › Vehicle, Charger and Grid the form is filled with what is saved now (entities, battery capacity, phases, maximum current, following the charger's limit, main fuse, load balancer) and shown first. Nothing changes until you save
- A saved entity that is not found by the new detection stays available as "(saved)", so it is not lost by accident; the same for a saved price source on Settings › Prices
- New button **Cancel, keep the current settings**

## 0.21.0

- **Price forecast** (optional, Settings › Prices): choose a sensor with expected prices for the coming days, for example a template that combines the real prices with a weekly forecast. Only the hours after the last real price are used, up to your departure
  - When a later day is expected to be cheaper, the plan waits for it instead of charging today. The app never charges on a forecast price: as soon as the real prices come out (around 13:00 for the next day) the plan is recalculated
  - **Safety margin** (default 0.02 per kWh) is added to every forecast price, so the app only waits when the forecast is clearly cheaper. 0 = trust the forecast fully
  - The forecast can be market or all-in; the same fees, tax and VAT as the main source are used
  - Without a departure the forecast is not used, so the app never waits days for a cheap hour
- Overview: forecast prices are striped in the chart, forecast periods are marked in the plan table and headline, with a note that explains it. The chart's time labels are shown again, also for several days
- Price sensors whose list marks entries as a forecast (e.g. `source: forecast`) are recognised: as the main price source only the real prices are used
- Price times without a time zone (e.g. "2026-10-03 13:00:00") are now always read in Home Assistant's time zone
- Sensor `sensor.smart_charging_next_start` has an attribute `forecast`

## 0.20.0

New look, in the style of Home Assistant's default theme and Mushroom cards:

- Tabs and settings pages as rounded chips with icons
- Round tinted icons that show the state at a glance: charging (green), Charge now (amber), planned (blue), nothing to do (grey), missing data (red)
- Rounded cards, softer buttons and input fields, and the amounts on the Overview as small tiles with icons
- Light and dark mode follow your device, like Home Assistant
- Icons are Material Design Icons, the same set Home Assistant uses

## 0.19.0

- New price source **Fixed or day/night tariff**, for contracts without dynamic prices. Always offered in Settings › Prices:
  - **Day and night**: a normal and a low price, the low tariff hours (also across midnight, and on the quarter hour) and optionally the whole weekend low. The plan charges in the low hours before your departure
  - **One price all day**: the plan charges right away; departures, the car's limit, Charge now and notifications work as usual
  - Prices are entered all-in, as on the energy bill. The Savings tab calculates past days from the same tariff
- When no dynamic price integration is found, the Prices page now says so and offers the fixed tariff instead of stopping
- Documentation: the grid meter is optional (it was listed as required); the requirements now say what is required and why

## 0.18.2

- Settings › Control: the lists for preconditioning and the minimum battery level are much shorter. They show the entities of your car first ("From your car"), then only entities whose name fits (preconditioning, HVAC, airco; a minimum charge level), instead of every helper in Home Assistant
- The preconditioning rule is explained: while the chosen entity is on, the charger stays on, so heating or cooling the car uses grid power instead of the battery

## 0.18.1

- Settings › Control is split into clear sections: **Charger** (start/stop method), **Car** (managing the car's charge limit, minimum battery level), **Timing and price** (force window, keep charging, preconditioning) and **Manual test**
- Fields under an option are only shown when that option is on
- The Car section shows the car's current charge limit, and says when it cannot be changed or "Allow control" is off

## 0.18.0

Security review and fixes.

- **Only Home Assistant may talk to the app**: requests that do not come through Home Assistant ingress (for example from other apps on the internal network) are refused
- **Protection against other websites (CSRF)**: changes are only accepted as JSON from the same site; plain web forms and cross-site requests are refused
- **The charger must be a real charger**: the device and its integration are taken from Home Assistant's registry, and control only works for a device that is recognised as an EV charger. Settings can no longer point the app at another device, such as a garage door or a pump
- Control commands are limited to switches, buttons, choices and numbers, and the actions of known charger integrations
- **The car's charge limit** must be a % entity that looks like a charge limit, on the car's own device; values stay between 50 and 100 %
- Buttons are matched on whole words ("restart" is no longer seen as "start")
- Requests are limited to 100 kB; invalid requests get a clear error instead of a crash
- The installed library versions are fixed with a lock file (`npm ci`, with integrity checks)

## 0.17.0

- **Charger brands** checked against the real names of their Home Assistant integrations (from their source code), with a test per brand (`tests/brands.test.js`):
  - Easee (pause/resume action), Zaptec (resume/stop buttons), Alfen (charging switch), Wallbox (pause/resume switch), go-e (Force state choice, or the allow charging switch of the older integration), Peblar (charge switch), OCPP (Charge control switch), Ohme (Charge mode choice)
  - New start/stop method: a **choice (select)**, for go-e "Force state", Ohme "Charge mode" and, as a last resort, Alfen "Operation mode"
  - More status texts are understood, such as Zaptec `connected_charging`, Peblar `no_ev_connected`, Wallbox "Ready", OCPP "SuspendedEV", Alfen "Charging Normal" and go-e "charging finished"
  - Better suggestions for the status and power sensor per brand
  - Warnings when the charger's own smart or solar mode is on (Wallbox Eco-Smart, Peblar smart charging, Alfen solar mode, go-e PV surplus, Ohme smart charge); Easee's "Smart charging" switch is no longer reported, because it only changes the LED colour
  - Notes for Alfen (only one login at a time), OCPP (the charger must connect to Home Assistant) and Tesla Wall Connector (can only read, not control)
- **Possible conflicts**: the Log tab and Settings › Control list automations that are on and use the charger's start/stop, the charger itself or the car's charge limit, also through a script. Each can be ignored. The app never turns automations off

## 0.16.1

- Managing the car's charge limit: a new limit is now sent **right away, once** (for example back to your departure target as soon as Charge now ends). It is only sent again when the car still shows the old value after 15 minutes, at most twice; then you get a notification
- The Log tab no longer shows each sent command twice (only one command was sent)

## 0.16.0

- New rule in Settings › Control: **Let the app manage the car's own charge limit** (off by default, only with "Allow control" on)
  - While Charge now runs up to a level, the car's limit is set to that level (rounded up to a value the car accepts)
  - Otherwise the car's limit follows your next departure, for example "doel: 80" from the calendar
  - Only while the car is plugged in, and only when the limit differs
  - Right away when you start Charge now or use the button; otherwise at most once every 15 minutes since the last limit sent, because the car's cloud API limits the number of calls
  - Every change is logged in the Log tab and notified (with "Notify every start and pause")
- With the rule on, the plan and Charge now no longer stop at the car's current limit, because the app sets it

## 0.15.1

Charge now is a firmer overrule:

- The decision uses whether Charge now is on right now, not the last calculated plan. A plan calculated just before you pressed Charge now (or Stop) can no longer pause or start the charger
- After Charge now or Stop, the plan is calculated again once the running calculation is done, so it always includes your change
- For 3 minutes after you start charging (Charge now, manual test), the app does not pause the charger, whatever a calculation says
- Raising the car's limit rounds up to a value the car accepts (Renault: steps of 5, so 83% becomes 85%)

## 0.15.0

- The app now knows the **car's own charge limit** (for example Renault "Target charge level"). The car stops charging there, whatever the charger does
  - Found automatically on the car's device, also for vehicles set up earlier; can be chosen in Settings › Vehicle
  - The plan aims for the lower of your target and the car's limit, and says so on the Overview ("80% (car limit)")
  - Charge now warns when the chosen level is above the car's limit, and does not start; Charge now up to a level stops at the limit
  - With "Allow control" on, a button **Raise the car's limit to …%** sets the limit in the car (only that entity; logged in the Log tab). The app does not lower it again afterwards

## 0.14.2

- The "Notify action" field is removed from the Configuration tab. Choose where notifications go only from the list in the app, under Settings › Status

## 0.14.1

- Choose where notifications go from a **list** in Settings › Status: the app shows the notify actions that exist in your Home Assistant (your phones first). The Configuration tab cannot show such a list, so the "Notify action" field there is now only a fallback

## 0.14.0

- **Notifications** to your phone, with a notify action set in the Configuration tab ("Notify action")
  - Problems are always sent: a failed command, a charger that does not start or pause within 5 minutes after a command, and a car that will not be ready at the departure
  - Every start and pause, with the reason; can be switched off with "Notify every start and pause"
  - The same problem is not repeated for a while
- **Watchdog**: 5 minutes after each start or pause the app checks that the charger followed. If not, it is logged ("Charger did not react") and notified
- **Sensors for dashboards**, with "Publish sensors" in the Configuration tab: status, next start and end, planned energy and cost, saving, departure, and Charge now. They are written again after Home Assistant restarts
- Settings › Status shows notifications and sensors, with a **Send test notification** button
- Safety: the app can only send to the one notify action you set, and only write its own `sensor.smart_charging_*` and `binary_sensor.smart_charging_*` entities

## 0.13.0

New layout.

- **Five tabs**: Overview, Departures, Savings, Log and **⚙ Settings**
  - Settings has pages for Vehicle, Charger, Grid, Prices, Control and Status
  - The Log tab shows what the app wants right now and the log; the control method, the rules and the manual test moved to Settings › Control
- **Setup wizard** on first start: Vehicle → Charger → Grid (optional) → Prices. You can run it again from Settings › Status. Existing setups skip it
- The **planning settings** moved from the Overview to the app's **Configuration** tab in Home Assistant: charging loss margin, prefer one continuous period, minimum saving to split, and account for house load. The Overview shows the current values. Values saved earlier in the app are replaced by the Configuration tab (the defaults are the same as before)
- The Configuration tab is in a clearer order: control and calendar first, then planning, then refresh and log level
- The "Charging current" choice says that it is not used yet

## 0.12.1

- New **Clear log** button on the Control tab (click twice to confirm). The log keeps the last 500 lines; after clearing, the current decision is logged again right away

## 0.12.0

**Live control.** With "Allow control" on, the app now starts and pauses the charger by itself. With it off (the default) nothing changes: everything is advice and a dry run.

- The charger follows the plan, Charge now and the rules on the Control tab (minimum battery level, preconditioning, force window, locked period, hysteresis)
- Only start/stop is sent, with the method chosen on the Control tab. The charging current is not changed; your load balancer keeps doing that
- With a switch as start/stop method, its own on/off state decides whether a command is needed, so nothing is sent when it is already right
- The same command is not repeated within 15 minutes, so the app does not keep fighting with something else that changes the charger
- With control on, the charger is checked every minute between plan refreshes, so plugging in and the start of a planned period are followed quickly
- Charge now: when it ends, the plan takes over directly (instead of always pausing)
- Every command sent is shown as "SENT" in the Control log and as "SENDING to charger" in the app log
- Automations, scripts, helpers and other settings are still never touched

**Turn off your own charging automation** before turning on "Allow control", or the two will fight.

## 0.11.0

**First version that can really control the charger**, only when you turn on "Allow control" in the Configuration tab. The charging plan itself is still a dry run.

- **Charge now** really starts the charger when "Allow control" is on, and pauses it again when the goal is reached or you select **Stop charge now**. If the charger was already charging before, it is left alone. When the car is unplugged nothing is sent
- New **Manual test** on the Control tab: **Start charging** and **Stop charging** send one command, to check that control works with your charger
- Only the start/stop method chosen on the Control tab is used, and only its own action or entity. The charging current is not changed
- Safety:
  - With "Allow control" off (the default) nothing is sent; the log shows "Not sent"
  - Automations, scripts, scenes, helpers and other settings are never touched, whatever is chosen
  - Everything that is sent is logged in the app log ("SENDING to charger") and in the Control log ("SENT")
- Turn off your own charging automation while testing, or it may undo what the app does

## 0.10.0

Still a dry run: nothing is sent to the charger.

- New **Charge now** on the Overview, for when you need the car sooner than the plan
  - Choose how much: up to the plan's target, up to a battery level, or a fixed amount in kWh
  - **Check** first shows:
    - whether the plan is already charging now, or starts charging within the next hour
    - when charging now would be ready and what it costs, compared with the cheapest hours before your departure
  - **Charge now** then replaces the plan: the Overview and the chart show charging from now on, and the Control dry run wants to charge ("Charge now, started by you")
  - It stops by itself when the goal is reached or the car is unplugged, or with **Stop charge now**; then the normal plan takes over again
  - Can only be started while the car is plugged in

## 0.9.2

- The plan now uses the **real charging power**: the app learns from the charger power sensor (last 10 days) at what power the car really charges, and uses that when it is lower than the charger maximum. A load balancer, the car's own on-board charger or a lower voltage no longer make the plan too optimistic
- The Overview shows again what the charger is doing now ("charging now at 9.2 kW", measured), and on a separate line which power the plan uses and why
- Without a charging power sensor or enough measured charging, the plan uses the charger maximum as before, and says so

## 0.9.1

- Removed "charging at … kW" from the Overview. It showed the power the plan calculates with, not what the charger really does, which was confusing

## 0.9.0

- **Cars without an integration** are now supported. On the Vehicle tab, under "No car integration?", choose:
  - **I enter the battery level myself**: enter it on the Overview when you plug in; the app adds the energy charged since then (from the charger's power sensor) and estimates the level. The entered level is forgotten when the car is unplugged
  - **Charge a fixed amount each time**: for example 20 kWh per session; the app plans the rest of that amount after plugging in
- Plugging in and unplugging is followed through the charger status when there is no plugged-in sensor
- The Overview shows the estimated battery level or the amount charged in this session

## 0.8.0

Still a dry run: nothing is sent to the charger.

- **Choose how the charger is controlled** on the Control tab: any start/stop and current method found by the control check (for example an action with pause/resume, or a switch your own automation already uses), or no current setting at all
- New control **rules**, checked in this order:
  - Charger status briefly invalid (restart, hiccup): keep things as they are for up to 2 minutes
  - **Minimum battery level**: always charge below it, optionally only up to a maximum price; the level can come from an entity (such as the car's own minimum charge level)
  - **Preconditioning**: charge while a chosen entity is on
  - **Force window**: charge in the last X minutes before departure
  - **Locked period**: once a planned period has started, it is finished even if a new calculation would move it
  - **Hysteresis**: keep charging when the price is at most a set amount above the planned price, to avoid on-off-on
- The dry run shows when a period is locked

## 0.7.0

- New **Control** tab with a **dry run** of charger control (phase A)
  - At every refresh the app decides what it would do now: charge at a certain current, pause, or nothing (car not plugged in / data missing)
  - Shows the exact commands it would send, using the methods found by the control check (for Easee: `easee.action_command` pause/resume and `easee.set_charger_dynamic_limit`)
  - Compares with what the charger is really doing, and logs every change, so you can review a few nights
- **Nothing is sent**, also not when "Allow control" is on. Sending comes in a later version, after you have reviewed the dry run

## 0.6.2

- The maximum charging current is now read from the charger's own limit sensors, for any charger integration (for Easee: "Max charger limit" and "Max circuit limit")
  - The lowest limit is followed live: change it in the charger's own app and the plan follows
  - A manually entered maximum still works, as an extra cap
  - Limit sensors that exist but are disabled in Home Assistant are named, with where to enable them
- The Charger tab shows where the maximum current comes from

## 0.6.1

- Charger detection no longer suggests the charger's smart charging switch (or a switch that turns the whole charger off) as start/stop switch; it only suggests a real start/stop switch
- Long sensor values are rounded (9.15299987792969 kW is shown as 9.15 kW)

## 0.6.0

- New **Control check** on the Charger tab: the app finds out by itself how your charger could be controlled, for any charger integration
  - Looks at the actions of the charger's integration (with their fields and choices) and at the charger's own entities (current setting, switches, buttons)
  - Shows the method it would use for start/stop (preferring pause/resume) and for the charging current (preferring a temporary limit that expires by itself), plus the alternatives
  - Warns when the charger's own smart charging is on, when only a switch that turns the whole charger off is available, or when nothing suitable is found
  - Nothing is sent to the charger
- Reading the list of available actions is added to the read-only list

## 0.5.2

- New planning setting **Prefer one continuous charging period** (on by default): the plan charges in one go, unless splitting saves at least a set amount (default 0.50)
- The Overview says which choice was made and how much splitting would save
- Uses the same price blocks and house load as before; only the choice of blocks changes

## 0.5.1

- Departures: more trips from the same source on one day are no longer crossed out. They are shown as "later that day"; the plan prepares for the first departure of each day. Crossing out is only used when a higher priority source replaces a departure
- The departure time of a calendar trip is shown everywhere; with a buffer, "ready by" is shown next to it (also on the Overview)

## 0.5.0

- New **Add trip** form on the Departures tab: leave at, destination, target battery level, precondition, repeat on weekdays and weeks ahead
  - Creates events in the same format the app reads: "Naar <destination>", the destination as location, and "doel: 80 precondition: ja" as description
  - Trips that are already in the calendar (same title and time) are skipped
- **Test mode by default**: a new option **Allow adding trips to calendar** in the Configuration tab is off by default. While off, the form only shows which events it would add and nothing is written
- Adding a calendar event is the only write the app can do, and only when that option is on, and only to the calendar chosen on the Departures tab. Charger control stays off and separate ("Allow control")
- The Status tab shows whether adding trips is allowed

## 0.4.2

- New option **Refresh interval** in the app's Configuration tab (1 to 60 minutes, default 5)
- The app now reads prices, departures and states and recalculates the plan in the background at that interval, also when nobody has the page open
- Opening the page uses the latest plan instead of calculating it again; after a settings change the plan is recalculated right away
- The Overview shows when the plan was last updated, with a **Refresh now** link
- The Status tab shows the refresh interval and the last refresh

## 0.4.1

- Calendar trips reworked:
  - New choice which events are trips: events with a target in the description (such as "doel: 80"), events with a keyword, or every event with a time. New setups use the target
  - The target in an event ("doel: 80", "target: 90" or "85%") is used for that trip; otherwise the fallback level
  - The start of the event is the departure; the buffer before the event now defaults to 0 minutes
  - "precondition: ja/nee" and the event location are read and shown (not used yet)
  - New card "Trips from your calendar" on the Departures tab with the trips of the next 14 days
- Calendars set up in 0.2.0 keep working with their keyword

## 0.4.0

- New **Savings** tab: per charging session over the last 30 days
  - **Actually paid**: the energy the charger used per hour, times the all-in price of that hour
  - **Charging right away**: the same energy charged from the moment the car was plugged in
  - **With the plan**: the same energy in the cheapest hours while the car was plugged in
  - Totals, and how much your current way of charging saved compared with charging right away
- Charging sessions come from the history of the charger power sensor (Charger tab); plugged-in times from the vehicle's plugged-in sensor (Vehicle tab), when set
- The app now keeps a history of all prices it fetches. EnergyZero, easyEnergy, Tibber and Nord Pool can also look back for missing days
- Reading state history is added to the read-only list

## 0.3.0

- **House load**: the plan now estimates how much current is left for the charger in each block, like a load balancer does
  - Uses the last 14 days of long-term statistics of the grid meter (Grid tab), per hour of the day
  - The charger's own power is subtracted, so earlier charging sessions do not count as house load
  - Room for the charger = main fuse minus typical house load, capped at the charger's maximum current; below 6 A a block is skipped
  - The Overview shows the charging power range, the room for the charger per block (hover) and a summary of the typical house load
  - Can be switched off with "Account for house load" in the planning settings
- Reading long-term statistics is added to the read-only list

## 0.2.0

- New **Departures** tab with four sources for when the car must be ready and how full:
  - **Weekly schedule**: a time and battery level per day, each day on or off
  - **Home Assistant helper**: an `input_datetime` (date and time, or time only) and optionally an `input_number` for the battery level
  - **Calendar**: events with a keyword (default "EV") become a departure, with a buffer before the event; all-day events are skipped
  - **One-off departure**: for a trip that differs from normal; removed automatically after it has passed
- Priority on a day: one-off, then calendar, then helper, then schedule. The earliest day with a departure is planned for
- Overview of the next 7 days, showing which departures were replaced by a higher priority source
- The plan uses the next departure and its battery level; without a departure it uses the cheapest known blocks and the default level
- The earlier "ready by" and target settings are carried over into the weekly schedule
- A partly used price block is placed against the next planned block, so charging runs in one go
- Reading calendar events is added to the read-only list; nothing else can be called

## 0.1.1

- Saving the planning settings now shows clear feedback ("Saving…", then "Saved – plan updated") and scrolls to the updated plan

## 0.1.0

First planning version. **Advice only: nothing is controlled.**

- New **Overview** tab (now the first tab):
  - Price chart for today and tomorrow with the planned charging blocks highlighted, the current time and the "ready by" moment
  - Charging plan: how much energy is needed and in which blocks it is cheapest to charge before the deadline
  - Expected cost of the plan compared with charging right away after plugging in
  - Clear messages when data is missing, tomorrow's prices are not published yet, or there is not enough time
- Planning settings: target battery level (default 80%), ready by (default 07:00) and a charging loss margin (default 10%)
- Charging power follows the charger's phases and maximum current (16 A assumed when not set)
- Amounts are shown in the currency set in Home Assistant
- **Safety:** the app can now only send read-only commands to Home Assistant. Any other command is refused and logged, so nothing in your setup can be changed by the app
- Tabs scroll on small screens

## 0.0.6

- Added the **Prices** tab: detects and tests your dynamic electricity price source
  - Integration actions: EnergyZero, easyEnergy, Tibber and Nord Pool
  - Any sensor that keeps a list of prices in its attributes, such as ENTSO-e, Nord Pool (custom), EPEX Spot, Frank Energie and Zonneplan
  - Hourly and 15-minute prices; Nord Pool prices per MWh are converted to per kWh
  - Costs on top of the price: purchase fee, energy tax and VAT, to show what you really pay
  - **Test** shows the price now, lowest, highest and average today, and whether tomorrow's prices are published
- New options in the app's **Configuration** tab:
  - **Log level**: use debug when reporting a problem
  - **Allow control**: master switch, off by default. While off, the app never changes anything
- The **Status** tab shows whether control is allowed and the log level

## 0.0.5

- Added the **Grid** tab: detects the meter that measures your grid connection
  - Recognises P1 and smart meter readers (DSMR, HomeWizard P1, SlimmeLezer, P1 Monitor, Tibber Pulse)
  - A load balancer that measures the connection (such as the Easee Equalizer) can also be used
  - Meters for a single device (charger, washing machine, heat pump) are skipped
  - Suggests net power, or import and export power, and the current per phase
- Detects existing load balancers, with the choice "built into the charger or not in Home Assistant"
- Main fuse (A) and number of phases can be set

## 0.0.4

- Load balancers (such as the Easee Equalizer), kWh meters and P1 meters are no longer shown as a charger
- Devices that report no data are marked **Offline** and listed last, for both vehicles and chargers
- Charging power can now come from a sensor on another device, such as a separate kWh meter

## 0.0.3

- Added the **Charger** tab: detects EV chargers in Home Assistant
  - Recognises known charger integrations (Easee, Wallbox, Zaptec, go-e, OCPP, Alfen, Peblar and more)
  - Recognises other chargers by a charger-like name plus a power sensor or current setting
  - Vehicles are never shown as a charger, even when they have their own charging current setting
  - Suggests the status, charging power, current setting (A) and start/stop switch; each can be changed
  - Shows when a charger can only be controlled through actions
  - Phases and maximum current can be set
- Nothing is controlled yet: this version only checks what the charger offers

## 0.0.2

- Added the **Vehicle** tab: detects electric and plug-in hybrid vehicles in Home Assistant
  - Recognises known car integrations (Renault, Tesla, BMW, Kia/Hyundai, Volkswagen and more)
  - Recognises other vehicles by their sensors: a battery % sensor plus a range or distance sensor
  - Suggests the battery (SoC), range, charging and plugged-in entities; each can be changed
  - Manual choice of any % sensor when no vehicle is found
- The chosen vehicle is saved and shown with live values
- Optional battery capacity (kWh), needed later for planning
- Connection check moved to the **Status** tab, now also showing the time zone

## 0.0.1

- First version: app skeleton with ingress and a connection check to Home Assistant
