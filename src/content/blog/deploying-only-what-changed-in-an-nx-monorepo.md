---
title: Deploying only what changed in an NX monorepo
description: A GitHub Action that uses the Deployments API as per-app deploy state, so nx affected diffs each app against its own last successful deploy.
date: 2026-07-05
---

The goal was a clear way to deploy apps in an NX monorepo without ceremony. The usual answer — "run affected and deploy what comes back" — breaks down the moment apps stop shipping in lockstep. This action fixes it with one idea: let GitHub's Deployments API hold the state, and ask it a separate question per app.

## One base SHA is wrong for somebody

`nx affected` needs a base to diff against. In a single-app repo that's easy — diff against the last deploy. In a monorepo there's no single "last deploy." App A shipped this morning. App B hasn't gone out in a month. Diff both against the same SHA and you're wrong for at least one: either B looks unchanged after a month of commits, or A rebuilds for changes it already shipped. "Just deploy everything on main" papers over it, but then affected buys you nothing.

## A base SHA per app, stored as deployments

The per-app deploy history already exists — it just has to live somewhere queryable. [GitHub Deployments](https://docs.github.com/en/rest/deployments/deployments) is that place. Each app deploys into its own environment, `<environment>/<short-name>` — `staging/web`, `staging/api`, and so on.

On a push, the action walks every app and asks GitHub for the most recent `SUCCESS` deployment in that app's environment. That commit becomes the base SHA for that app alone. Then `nx show projects --affected` runs against that base; affected apps go in the matrix, the rest are skipped. No external database, no manifest committed back to the repo — the deploy history is the state, and GitHub already keeps it.

## Filtering by ref, so feature branches don't poison main

A `workflow_dispatch` deploy from a feature branch also writes a deployment record. Left alone, a later push to `main` could pick that up as its "last successful" base and diff against a commit that never landed on main. So results are filtered by ref: a push only accepts deployments whose `ref` matches the current one.

```ts
const node = result.repository.deployments.nodes.find(
  (n) =>
    n.latestStatus?.state === 'SUCCESS' &&
    (ref === undefined || n.ref?.name === ref)
)
```

No prior deploy on the current ref — first time an app ships — falls back to the repo's initial commit, so the app is affected by definition. First deploy always runs.

## Two flows, on purpose

Push is automatic: environment is inferred from the ref (`main` → `staging`, else → `production`), and affected decides what ships. `workflow_dispatch` is the escape hatch — pass an explicit environment and app list, affected is skipped, and the named apps deploy `HEAD`. A manual deploy has already made the decision; re-litigating it through affected would just get in the way.

## The tradeoffs

- **Coupled to naming.** Environments must be `<environment>/<short-name>` and match each app's `project.json` name. Get it wrong and an app silently never resolves a base SHA — hidden as "always deploys" instead of an error.
- **Trusts deployment records.** Create the Deployment before the deploy actually succeeds and the base SHA is a lie. The `SUCCESS` check helps; discipline about marking success does the rest.
- **100-deployment window.** The query looks at the last 100 per environment. On a busy environment a stale-but-relevant deploy could fall off the end. Unlikely, but there.

The alternatives — a single base SHA, or a hand-maintained manifest — have worse failure modes. These are the honest cost of leaning on Deployments as the source of truth.

## Where it lands

The output is a JSON matrix that feeds straight into a deploy job, plus a `has-apps` flag to skip an empty build:

```json
[
  { "app": "@acme/web", "environment": "staging", "base_sha": "abc123" },
  { "app": "@acme/api", "environment": "staging", "base_sha": "def456" }
]
```

The action doesn't deploy anything itself. It answers "what changed, per app, since each app last shipped," and hands that to whatever does.
