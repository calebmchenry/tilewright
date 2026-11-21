# Browser builds and GitHub Pages

The browser artifact is static HTML, JavaScript and CSS. Building it requires
Node/npm; it needs no Rust, macOS, Tauri runtime or application server. The editor
keeps projects on the user's device using local file selection, downloads and
browser recovery. No accounts, cloud project storage or backend are added.
See the [platform contract](platform-services.md),
[browser lifecycle](browser-lifecycle.md) and [recovery policy](recovery-policy.md).

The [browser acceptance record](browser-validation.md) supplies local production
qualification and the [user guide](browser-guide.md) explains files and recovery.
This does **not** establish a live Pages site: TW-062 owns repository/Pages/domain
setup and live publication. Performance
refinement remains deferred to TW-049/TW-050 under the working baseline.

## Reproduce a browser artifact

From a clean checkout, use the exact Node version in `.nvmrc` (24.22.3), the
checked-in npm lockfile, and an explicit public URL path:

```sh
nvm install
nvm use
npm ci
export TILEWRIGHT_WEB_BASE=/repository-name/
npm run build:web
npm run preview:web
```

Replace `/repository-name/` with the **selected** repository's case-sensitive
name. Open `http://127.0.0.1:4173/repository-name/`. The preview binds only to
loopback and serves only `dist-web/`; Ctrl-C stops it. It is local validation
tooling, never an application server to deploy. It rejects a base different
from the built HTML and returns 404 for missing/out-of-prefix files, with no SPA
fallback. This catches root asset references that a permissive preview can hide.

| Target URL layout                                         | `TILEWRIGHT_WEB_BASE` |
| --------------------------------------------------------- | --------------------- |
| Project site at `https://<owner>.github.io/<repository>/` | `/<repository>/`      |
| User/organization root site                               | `/`                   |
| Custom domain at its root                                 | `/`                   |
| Other deliberate static-host prefix                       | `/chosen/path/`       |

Both leading and trailing slashes are required. Missing values, hostnames,
relative paths, query strings, dot segments and unsupported path characters
fail before building. No owner, repository or domain is inferred or embedded.
Changing the base requires a rebuild; changing a preview URL cannot rewrite
already-built asset URLs. Configure custom domains in Pages settings in TW-062,
not by placing a hostname into the asset base.

`vite.web.config.ts` shares the desktop Vite settings while selecting the explicit
base, `index.html` as the sole entry, no public-directory copying, and a clean
`dist-web/` output. The artifact contains only `index.html` and hashed `assets/`.
Tests, source modules, fixtures, performance harnesses and source maps are not
published. The shared build includes a lazy Tauri adapter chunk; browser startup
does not load or bind it. Pixi also emits browser/worker environment chunks.
There are currently no application-created workers or separate worker entrypoints.

The desktop path is unchanged: `npm run build` writes root-based assets into
`dist/`, and `npm run build:desktop` embeds that directory in Tauri. The browser
base variable has no effect on the desktop build. The separate performance build
still uses `artifacts/performance/dist/` and is never uploaded by Pages CI.

Only public build configuration belongs here. Do not add credentials or secrets
to `VITE_*`, `.env` files consumed by a build, HTML, the public directory or bundled
source: frontend build values are public. The workflow's GitHub token is used
by official actions, not passed to the browser build as application data.

## Validate the production files

```sh
npx playwright install chromium firefox webkit
npm run format:check:web
npm test
TILEWRIGHT_WEB_BASE=/pages-smoke/ npm run test:web
TILEWRIGHT_WEB_BASE=/ npm run test:web
```

Install Python 3.9+ as well as the pinned Node/npm dependencies; the independent
agent consumer uses only Python's standard library. On Linux, use
`npx playwright install --with-deps chromium firefox webkit` for engine libraries.

`test:web` type-checks and rebuilds, then runs Chromium, Firefox and WebKit against the strict static
preview with the same base. Stop any interactive preview before testing: the
test never reuses an existing server. `playwright.web.config.ts` isolates these
production tests from the existing development/harness suite.

The production smoke compares every emitted file with its HTTP bytes and MIME
type, imports all non-entry chunks (including the lazy Tauri and Pixi worker
environment modules), rejects harness/source/missing URLs, and verifies the
real editor's WebGL startup, project open/edit/undo/download round-trip, agent
export and reload at the selected path. The worker environment import verifies
asset/module resolution; it is not evidence of an application worker workload.
Browser startup is separately checked for native IPC/chunk absence and local-only
requests. The required suite also covers a coherent drawing/layers/registry/areas/
selection/transform/undo session, project download/reopen and recovery, malformed
imports, stale reads, unsaved navigation, multiple live tabs, corrupt checkpoints,
storage failures/retry and complete populated-map project and agent round trips.
Real browser File, download, IndexedDB and Web Locks paths are used; no native IPC
mock or editor harness is served. Standard APIs are instrumented only for explicit
failure injection. See [coverage and actual results](browser-validation.md).

All three engine projects are required, with no retries or browser-specific skips.
Playwright is pinned to 1.64.1 because 1.65.x's Firefox chooser interception emits
an erroneous cancel before file selection ([upstream issue](https://github.com/microsoft/playwright/issues/43994)).
Do not remove application cancellation handling to accommodate that tooling bug.
When updating the pin, rerun the full functional suite and refresh the recorded
browser versions. This automation is distinct from Safari or packaged WKWebView.
The existing bundle-size warning remains deferred with TW-049/TW-050.

Local terminal output identifies failing checks. Production traces, screenshots,
actual downloaded projects and evidence attachments are in `test-results-web/`;
the HTML report is in `playwright-report-web/`
(`npx playwright show-report playwright-report-web`). Development tests retain
`test-results/` and `playwright-report/`, so they cannot erase production traces.
A subsequent run of the same suite replaces its report directories; copy them
first when retaining evidence. A focused diagnostic run uses, for example,
`TILEWRIGHT_WEB_BASE=/pages-smoke/ npm run test:web -- --project=firefox`.
That diagnostic subset does not replace the required three-engine release gate.

## Manual workflow and target setup

`.github/workflows/pages.yml` has **only `workflow_dispatch`**, with no push,
pull-request or schedule trigger. Adding this file or pushing commits cannot
publish the app. Official actions are pinned to reviewed release commit hashes;
the source guidance is [Vite's Pages guide](https://vite.dev/guide/static-deploy.html#github-pages)
and [GitHub's custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The workflow accepts a required `base` path and a `deploy` boolean that defaults
to **false**. A validation-only run does not query or change Pages configuration.
On Ubuntu it selects `.nvmrc`, runs `npm ci`, installs all three browser engines and their system
dependencies, checks formatting, builds the shared desktop frontend without
Rust, runs the complete domain/development UI suites, and runs the entire production functional suite at both a
non-root path and the selected final base. Only then does it upload `dist-web/`
as the `github-pages` artifact. It uploads neither the repository nor `dist/`.
The second qualification rebuilds so the uploaded artifact is the exact tested final base.

The build job has only `contents: read`. The dependent deployment job alone has
`pages: write` and `id-token: write`, uses the `github-pages` environment and
reports the URL returned by deployment. One `github-pages` concurrency group
serializes runs; a new run does not cancel an in-progress deployment.

After TW-061 acceptance, TW-062 must deliberately:

1. Select the actual repository, intended URL/domain and deployment branch.
2. In **Settings → Pages → Build and deployment → Source**, select **GitHub
   Actions**. Configure any custom domain/DNS and HTTPS there. This workflow
   sets `configure-pages` enablement to false; it cannot silently create the site.
3. Configure the **github-pages** environment's allowed deployment branches and
   any reviewer rules for the selected target. Configure repository Actions
   permissions to allow the official pinned actions and deployment token scopes.
4. After those requirements are satisfied, set the repository Actions variable
   `PAGES_DEPLOY_ENABLED` to the exact value `true`. It is an explicit release
   readiness switch, not a secret. A requested deployment fails closed without it.
5. In **Actions → Browser Pages → Run workflow**, select the intended ref, enter
   the correct `base`, and leave `deploy` false for the first hosted validation.
6. Inspect the successful build, tests and artifact. Then dispatch with the same
   ref/base and `deploy` true to rebuild, validate and publish. Before publication,
   the deployment job compares the artifact's chosen base with the configured
   Pages `base_path`; mismatches fail with instructions to rebuild.

Do not enable automatic publication as part of preparing this ticket. No live
workflow dispatch, repository setting change, DNS change or publication is
performed by the local build commands.

## Logs, rebuilds and redeploys

GitHub **Actions → Browser Pages → selected run → build/deploy → step** contains
install/build/test/configuration/deployment logs. The run's **Artifacts** area
contains `github-pages` (the Pages action's default one-day retention) and, on
failure, `browser-test-failure` containing available traces/reports for seven
days. A dependency or test failure prevents the Pages upload and deployment.
Use the deployment job/environment URL to check the actual published site;
a local preview or uploaded artifact alone proves no live deployment.

To reproduce locally, check out the recorded commit, use `.nvmrc`, run `npm ci`
and repeat `test:web` with the run's exact base. To redeploy, manually dispatch
the same ref and base with `deploy` true (or re-run its workflow while its
referenced actions/ref remain available). Rebuilding creates a fresh artifact
when the previous one has expired. For a correction or rollback, select the
intended corrected/known-good ref and repeat the same validation/deployment
sequence, respecting environment rules. Changing URL layout or domain also
requires selecting the matching base and rebuilding.

Record the commit, workflow run, selected base, returned live URL and live reload
smoke in TW-062. Keep browser project downloads before changing origin/domain:
IndexedDB recovery belongs to the original browser origin, not to the new site.
