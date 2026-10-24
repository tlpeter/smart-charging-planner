# Contributing

Smart Charging Planner is a Home Assistant public beta. Small fixes, clear bug reports and documented compatibility checks are welcome.

## Reports and proposed changes

- Check existing [issues](https://github.com/tlpeter/smart-charging-planner/issues) first. For a bug, include the app version, integration/firmware versions, steps, expected result and actual result.
- Use synthetic examples. Review the public diagnostics preview before sharing it. Never post tokens, private settings backups or household names, addresses and calendar data.
- Report security problems privately as described in [SECURITY.md](SECURITY.md).
- Discuss substantial changes in an issue first, and propose code/documentation changes against dev. Describe the problem and the resulting behaviour in plain English.

## Implementation and validation

Read [AGENTS.md](AGENTS.md) and [RELEASE.md](RELEASE.md) before changing the app. Preserve existing work, default optional features to off, and include a focused regression check for a repaired failure scenario. Keep documentation and version metadata aligned.

GitHub Actions runs the default validation. Report which checks passed and distinguish fixture tests, Home Assistant Core checks and physical hardware checks. Do not claim untested devices are verified, and do not create unsafe physical conditions for fault injection.

## License and notices

By submitting code or documentation for inclusion, you agree to provide that contribution under the project's [MIT License](LICENSE). Only submit work you have the right to share.

Keep the project license and existing third-party notices with the relevant code and assets. If a contribution introduces third-party material, identify its source and license and include the required notices. No transfer of copyright is requested.
