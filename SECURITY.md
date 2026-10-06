# Security

Smart Charging Planner can start and stop your charger, set your car's charge limit and steer your home battery. A security problem can therefore have real consequences.

**Please do not report security problems as a public issue.** Use [Report a vulnerability](https://github.com/tlpeter/smart-charging-planner/security/advisories/new) instead (GitHub's private reporting). You will get an answer within a week.

Examples of what to report:

- a way to make the app send a command to a device other than the chosen charger, car limit or battery
- a way to control anything while "Allow control" is off
- a way to reach the app's API from outside Home Assistant ingress
- the Supervisor token or other secrets showing up in logs, the page or the diagnostics file

Only the latest version is supported.
