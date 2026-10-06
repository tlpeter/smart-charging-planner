## What does this change?

<!-- In a few sentences: what and why. Link the issue if there is one (Fixes #123). -->

## Tested with

- [ ] `node tests/brands.test.js`, `node tests/battery.test.js`, `node tests/solar.test.js`, `node tests/forecast.test.js`
- [ ] `node tests/settings.test.js` and `SCP_PROFILE=skoda_wallbox node tests/settings.test.js`
- [ ] Real hardware (which?):

## Safety

- [ ] The app still never changes automations, scripts or helpers, and only sends commands to the chosen charger, car limit or battery
- [ ] Nothing is controlled while "Allow control" is off
