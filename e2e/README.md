# First journey browser acceptance

The test uses the browser UI for authentication, email
verification, invitations, access grants, program setup, responsibilities, and
suspension. It consumes verification and invitation codes only through the
host's private Unix socket; codes stay in process memory and are entered through
the real forms. It does not call a debug token endpoint or disable TLS checks.

From the web repo, run `npm run e2e:first-journey`. The runner starts
`Compliance.BrowserE2EHost` from the sibling `compliance-core` checkout (or the
in-progress bridge checkout when the canonical project is absent), reads
its loopback API URI and private mailbox path, then starts Vite on
`http://127.0.0.1:5173` with all four API/auth/discovery proxies pointed at that
URI. Set `COMPLIANCE_E2E_HOST_PROJECT` to select another backend host project.
For the in-progress bridge worktree, run with
`COMPLIANCE_E2E_HOST_PROJECT=../compliance-core-browser-e2e-bridge/tools/Compliance.BrowserE2EHost/Compliance.BrowserE2EHost.csproj`.
Install the Chromium browser for the pinned Playwright version once with
`npx playwright install chromium`.

The journey covers one founder, an invited Contributor, and a second invited
Org Admin in separate browser contexts. It checks server-rendered built-in team
paths, program-scoped access, a denied separation-of-duties assignment, and work
reassignment after the founder is suspended. Reassignment is performed through
the existing responsibility assign/revoke UI. Explicit team member assignment
is not covered until the authorized membership ID roster field is available.
The journey does not exercise the formal tenant ownership/administrator
handover policy (BO-D01), firm-staff engagement, or recovery semantics.
