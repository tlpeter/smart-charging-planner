# Changelog

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
