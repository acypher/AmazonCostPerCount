# Release discipline for this extension

- Treat each separately requested functional change as its own release step. Before starting the next change, bump the version, test, and commit the completed change. Do not accumulate multiple features in one uncommitted diff unless the user explicitly requests that.
- Every functional change to the extension must have a new version. Update `package.json`, the root `manifest.json`, the Safari extension's `Resources/manifest.json`, and every `MARKETING_VERSION` in the Safari Xcode project to the same version. Increment the patch number by default; use a different level when the user requests it or compatibility requires it.
- At the start of a task, inspect `git status` and the current version. If prior functional changes are uncommitted, resolve their version and commit boundary before adding another feature. Preserve user work and ask only if the changes cannot be attributed safely.
- Run `npm test` and check the staged diff before committing. One version bump must accompany each functional commit. Do not claim a change is committed until `git log` and `git status` confirm it.
- A direct user instruction not to commit or not to bump a version takes precedence for that task.
