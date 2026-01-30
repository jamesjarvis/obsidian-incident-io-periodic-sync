# Incident.io Periodic Note Sync - Obsidian Plugin

## Build

```bash
npm install
npm run build
```

## Release Process

### 1. Bump version

Update version in both files (must match):
- `manifest.json` - `"version": "X.Y.Z"`
- `package.json` - `"version": "X.Y.Z"`

### 2. Commit and push

```bash
git add -A
git commit -m "Bump version to X.Y.Z"
git push
```

### 3. Tag and push

```bash
git tag -a X.Y.Z -m "X.Y.Z"
git push origin X.Y.Z
```

### 4. Check workflow completed

```bash
gh run list --repo jamesjarvis/obsidian-incident-io-periodic-sync --limit 1
```

Wait for `completed success` status.

### 5. Publish the release

The workflow creates a draft release. Publish it:

```bash
gh release edit X.Y.Z --repo jamesjarvis/obsidian-incident-io-periodic-sync --draft=false
```

### 6. Verify release

```bash
gh release view X.Y.Z --repo jamesjarvis/obsidian-incident-io-periodic-sync
```

Should show:
- `main.js`
- `manifest.json`
- `styles.css`

## Community Plugin Submission

PR: https://github.com/obsidianmd/obsidian-releases/pull/9892

The ObsidianReviewBot rescans within 6 hours of pushing changes. To trigger sooner, close and reopen the PR.

## ESLint Rules

This plugin must pass the [Obsidian ESLint plugin](https://github.com/obsidianmd/eslint-plugin) checks:

- No `any` types - use typed interfaces
- No `console.log` - use `console.warn`, `console.error`, or `console.debug`
- Promises must be handled - use `void` operator for fire-and-forget
- Use `instanceof TFolder` checks instead of type casts
- Use `Setting().setHeading()` not `containerEl.createEl('h2'/'h3')`
- UI text must use sentence case
