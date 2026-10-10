# Web client provenance

This repository was bootstrapped from all 155 tracked files under `ui/` in
[`bdgrz/compliance`](https://github.com/bdgrz/compliance/tree/636f8cf43716a1f579c521a314368901665cb2c0/ui)
at commit `636f8cf43716a1f579c521a314368901665cb2c0`.
The import preserves every source file byte and relative path, with `ui/` becoming
this repository's root. The lockfile, pinned OpenAPI snapshot, generated API client,
unit tests, and assets are part of that unchanged snapshot.

This repository owns the web client. The backend remains in `bdgrz/compliance` and
owns API behavior, authorization, tenant isolation, and the OpenAPI contract.
Installing, checking, and building this client require Node 24 and npm 12.0.1;
they do not require a backend checkout, .NET projects, or a running backend.
The development proxy expects a separately running backend at
`http://127.0.0.1:5080`.

The bootstrap adds repository guidance, ignore rules, licensing, provenance, and
standalone client CI. It does not change client behavior, upgrade dependencies,
regenerate API artifacts, delete the backend copy, or add deployment or mobile work.
