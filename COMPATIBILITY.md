# Compatibility

What Smart Charging Planner can do per integration. **This file is generated** from the test fixtures (`tests/fixtures.js`) and the physical test status (`tests/physical.json`) by `node tests/compat.js write`; a test fails when it is out of date. Do not edit it by hand.

## What the columns mean

- **yes**: the app finds and uses it, checked in the automated tests with the entity, option and action names of that integration (taken from its source code). These tests run against a fake Home Assistant; a separate check starts a real Home Assistant Core and the app against it.
- **–**: not available through that integration, or not supported by the app.
- **read only**: the app shows the data and gives advice, but never steers that device.
- **Physical test**: whether it was checked on real hardware. *not yet* means only the automated tests above. Fixture-tested is not the same as physically verified: firmware, cloud delays and car wake-up behaviour can differ.

Detected is not the same as controllable: check the suggested sensors and the control method during setup, and run the manual test in Settings › Diagnostics.

## Chargers

| Charger | Integration | Status read | Start / stop | Current | Phase switching | Physical test |
| --- | --- | --- | --- | --- | --- | --- |
| Easee | `easee` | yes | switch | yes | yes | not yet |
| Zaptec | `zaptec` | yes | buttons | yes | – | not yet |
| Alfen | `alfen_wallbox` | yes | switch | yes | – | not yet |
| Wallbox | `wallbox` | yes | switch | yes | – | not yet |
| go-e (marq24) | `goecharger_api2` | yes | select | yes | yes | not yet |
| go-e (cathiele) | `goecharger` | yes | switch | – | – | not yet |
| Peblar | `peblar` | yes | switch | yes | yes | not yet |
| OCPP | `ocpp` | yes | switch | yes | – | not yet |
| Ohme | `ohme` | yes | select | – | – | not yet |
| Tesla Wall Connector **(read only)** | `tesla_wall_connector` | yes | – | – | – | not yet |

Start / stop: *switch* turns a switch on and off (Easee: the "Charger enabled" switch, never pause/resume), *buttons* presses start and stop buttons, *select* chooses a mode. Every charger is also tested with every home battery (`tests/matrix.test.js`).

## Cars

| Car integration | Integration | Battery level | Plugged in | Charging | AC charge limit | Entity names from | Physical test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tesla (Tesla Fleet) | `tesla_fleet` | yes | yes | yes | read and write | `home-assistant/core: homeassistant/components/tesla_fleet` | not yet |
| Tesla (Teslemetry) | `teslemetry` | yes | yes | yes | read and write | `home-assistant/core: homeassistant/components/teslemetry` | not yet |
| Tesla (Tessie) | `tessie` | yes | yes | yes | read and write | `home-assistant/core: homeassistant/components/tessie` | not yet |
| Renault | `renault` | yes | yes | yes | read and write | `home-assistant/core: homeassistant/components/renault` | not yet |
| Hyundai / Kia (Kia Uvo / Hyundai Bluelink) | `kia_uvo` | yes | yes | yes | read and write | `github.com/Hyundai-Kia-Connect/kia_uvo` | not yet |
| Skoda (MySkoda) | `myskoda` | yes | yes | yes | read and write | `github.com/skodaconnect/homeassistant-myskoda` | not yet |
| Volkswagen ID (WeConnect ID) | `volkswagen_we_connect_id` | yes | yes | yes | read and write | `github.com/mitch-dc/volkswagen_we_connect_id` | not yet |
| Volvo | `volvo` | yes | yes | yes | read only | `home-assistant/core: homeassistant/components/volvo` | not yet |
| Polestar | `polestar_api` | yes | yes | yes | read only | `github.com/pypolestar/polestar_api` | not yet |
| Mercedes-Benz (mbapi2020) | `mbapi2020` | yes | – | yes | read only | `github.com/ReneNulschDE/mbapi2020` | not yet |

The car's own charge limit is only changed when it can be written and "Don't change the car's charge limit" is off.

## Home batteries

| Home battery | Battery level | Steering | Notes | Physical test |
| --- | --- | --- | --- | --- |
| `sigen` | yes | grid charge, discharge, hold | select options, Remote EMS switch, limits in kW | not yet |
| `huawei_solar` | yes | grid charge, discharge, no discharge, hold | services forcible_charge/discharge (W, minutes), max (dis)charging power numbers | not yet |
| `solaredge_modbus_multi` | yes | grid charge, discharge, hold, no discharge | Storage Control Mode "Remote Control" + Command Mode | not yet |
| `victron` | yes | grid charge, no discharge | ESS mode select, max discharge power (sfstar/hass-victron) | not yet |
| `goodwe` | yes | grid charge, discharge | operation mode general / eco_charge / eco_discharge; battery power positive = discharging | not yet |
| `teslemetry` | yes | no discharge | operation mode + backup reserve; no forced charging | not yet |
| `homewizard` | yes | grid charge, hold, no discharge | battery group mode on the P1 meter: zero / to_full / standby / zero_charge_only | not yet |
| `marstek_modbus` | yes | grid charge, discharge, hold | RS485 control + force mode standby/charge/discharge, power in W | not yet |
| `marstek_local_api` | yes | grid charge, discharge | set_passive_mode (negative power = charge) + Auto mode button | not yet |
| `sessy` | yes | hold | power strategy select: idle for hold; setpoint sign not documented, so no charging | not yet |
| `zonneplan_one` **(read only)** | yes | advice only | read only: Zonneplan steers the Nexus itself | not yet |
| `growatt_server` **(read only)** | yes | advice only | read only (time segments in %) | not yet |
| `anker_solix` **(read only)** | yes | advice only | read only (schedules and presets) | not yet |
| `ecoflow_cloud` **(read only)** | yes | advice only | read only | not yet |
| `powerwall` **(read only)** | yes | advice only | local Powerwall: read only | not yet |

Home battery steering needs both "Allow control" and "Allow home battery control", a fresh battery level and the needed stop and limit controls of that model; otherwise it stays advice only.

## Help test on real hardware

Did you use the app with one of these on real hardware? Report it with the issue form **Beta test report** (Issues › New issue). Leave out names, addresses and entity ids. The physical test column is updated from those reports.
