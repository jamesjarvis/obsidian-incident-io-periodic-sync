# Obsidian Incident.io Periodic Sync

Sync on-call status and incidents from incident.io to Obsidian daily notes.

## Features

- On-call schedule status in daily notes
- Active incidents you're leading or assigned to
- Individual incident note files with full details:
  - Summary, overview table, timestamps
  - Roles and custom fields
  - Full timeline with status/severity changes
  - Actions and follow-ups with checkboxes
  - Attachments (GitHub PRs, Datadog dashboards, etc.)
- Auto-sync at configurable intervals (1/5/10/30/60 min)
- Historical backfill support (up to 90 days)
- Wikilinks from daily notes to incident files
- Secure API key storage using Obsidian's SecretStorage API

## Installation

### Manual Installation

1. Download the latest release (`main.js`, `manifest.json`, `styles.css`)
2. Create folder: `.obsidian/plugins/incident-io-sync/`
3. Copy files into the folder
4. Enable the plugin in Obsidian settings

### BRAT (Beta Reviewers Auto-update Tester)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. Add this repository: `jamesjarvis/obsidian-incident-io-periodic-sync`
3. Enable the plugin

## Setup

1. Get your API key from incident.io settings
2. Enter the API key in the plugin settings
3. Enter your user identifier (email substring or name to match your user)
4. Click "Test Connection" to verify

## Daily Note Format

The plugin adds an Incidents section to your daily notes:

```markdown
## Incidents

### On-Call
- On-call for: Primary, Secondary

### Active Incidents
- [[Incidents/INC-123|INC-123: Database outage]]
```

## Incident Note Format

Creates individual files like `Incidents/INC-123.md` with:

- YAML frontmatter (id, reference, status, severity, dates)
- Overview table (status, severity, lead, created, resolved)
- Timestamps (detected, acknowledged, mitigated, resolved)
- Roles and custom fields
- Full timeline of updates
- Actions with completion checkboxes
- Follow-ups with completion status
- Attachments as links

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| API Key | Your incident.io API key | - |
| User Identifier | Email/name substring to match your user | - |
| Section Header | Markdown header for incidents | `## Incidents` |
| Incident Notes Folder | Where to create incident files | Incidents |
| Show On-Call Status | Include on-call status section | true |
| Show Incidents | Include incidents section | true |
| Omit Empty Sections | Hide sections when empty | false |
| Auto-Sync Enabled | Enable background syncing | true |
| Sync Frequency | How often to auto-sync | 5 minutes |
| Historical Sync Days | Sync incidents from past N days | 0 |
| Update Previous Daily Notes | Backfill historical daily notes | false |

## Building from Source

```bash
npm install
npm run build
```

## License

MIT License - see [LICENSE](LICENSE) for details.
