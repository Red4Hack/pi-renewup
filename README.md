# pi-renewup

Auto-update for pi and its extensions, Claude Code style.

- Detects updates when pi starts and every 10 min while it stays open (once per 10 min across all pi instances): asks pi's package manager which extensions have a newer version and the npm registry for a newer pi. Nothing is installed by the check.
- Only when something is detected does it run `pi update --all` in the background.
- Right-aligned, just above the editor: dim `Auto-updating…` while updating, green `✔ Update installed · …` when there is something new (`/reload` or restart pi), `✔ Up to date` or `✘ Auto-update failed` for a few seconds otherwise. Background checks stay silent unless an update was detected.
- `/renewup` forces an update right away.
- State lives in `~/.pi/agent/cache/renewup.json`. `PI_OFFLINE=1` disables it.

Install: `pi install git:github.com/red4hack/pi-renewup`

## License

MIT
