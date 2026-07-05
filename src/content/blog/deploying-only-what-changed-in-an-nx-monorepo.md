---
title: Deploying only what changed in an NX monorepo
description: A GitHub Action that uses the Deployments API as per-app deploy state, so nx affected diffs each app against its own last successful deploy.
date: 2026-07-05
---

Two apps, one monorepo. `web` had shipped an hour ago. `api` hadn't gone out in a month. A push to `main` touched both, and the deploy pipeline had one question to answer: what actually needs to redeploy.

The obvious tool for that is `nx affected` — diff against a base SHA, deploy whatever comes back changed. The obvious base SHA is "the last deploy." Except there is no single "last deploy" here. Diff `api` against an hour-old commit and it looks unchanged, correctly. Diff `web` against a month-old commit and everything looks changed, whether it is or not. One base SHA is right for at most one app and wrong for the rest. "Just deploy everything on main" makes the problem disappear by making `affected` pointless.

What each app actually needed was its own base SHA — its own answer to "when did I last ship." That data wasn't missing, it just wasn't anywhere `nx affected` could query it.

## The deploy history already exists

It's sitting in [GitHub Deployments](https://docs.github.com/en/rest/deployments/deployments), one record per deploy, already keyed by environment. Give each app its own environment — `<environment>/<short-name>`, so `staging/web`, `staging/api` — and the per-app history is just... there. No new state to invent, no manifest to keep in sync by hand.

So the action does the obvious thing with it: on a push, walk every app, ask GitHub for the most recent `SUCCESS` deployment in that app's environment, and use that commit as the base for that app alone. Run `nx show projects --affected` against it. Affected apps go in the matrix, the rest get skipped. `web`'s diff starts an hour back; `api`'s starts a month back. Both correct, both cheap, no external database involved.

## Then a feature branch broke it

A `workflow_dispatch` deploy from a feature branch writes a deployment record too — same as any push. Left alone, that record sits in the same history a later push to `main` reads from. Push to `main`, and the action might pick up the feature-branch deploy as `api`'s "last successful," then diff against a commit that never actually landed on `main`. Wrong base, wrong affected list, and nothing about it looks wrong until the diff comes out strange.

The fix is a filter most people wouldn't think to add until they'd been bitten by its absence: only accept deployments whose `ref` matches the ref currently being diffed.

```ts
const node = result.repository.deployments.nodes.find(
  (n) =>
    n.latestStatus?.state === 'SUCCESS' &&
    (ref === undefined || n.ref?.name === ref)
)
```

No prior deploy on that ref — an app's first time shipping — and there's nothing to filter down to, so it falls back to the repo's initial commit. First deploy is affected by definition, which is the only sane default.

## Manual deploys don't need to ask permission

`workflow_dispatch` still exists as its own path, deliberately separate from all of the above. Someone triggering a manual deploy has already decided what ships and where — passing an explicit environment and app list. Running that decision back through `affected` would just be second-guessing a call that's already been made, so it's skipped entirely: the named apps go straight into the matrix and deploy `HEAD`. Push stays automatic and inferred (`main` → `staging`, else → `production`); dispatch stays a deliberate override.

## What this costs

None of this is free, and it's worth being honest about where it can bite:

- **Naming is load-bearing.** Environments have to be `<environment>/<short-name>`, matching each app's `project.json` name exactly. Typo it and the app doesn't error — it just never resolves a base SHA and quietly looks like it "always deploys."
- **It trusts the record, not the deploy.** If a Deployment gets created before the deploy has actually succeeded, the base SHA is lying. The `SUCCESS` check catches the honest cases; the rest is discipline about when you mark success.
- **History has a 100-deployment window.** On a very busy environment, a stale-but-still-relevant deploy could scroll off the end of that query. Unlikely, but not impossible.

A single shared base SHA or a hand-maintained manifest both fail worse and fail more often. This is the cost of the version that actually works.

## Where it lands

What comes out the other end is a JSON matrix a deploy job can consume directly, plus a `has-apps` flag so an empty result skips the build instead of running one for nothing:

```json
[
  { "app": "@acme/web", "environment": "staging", "base_sha": "abc123" },
  { "app": "@acme/api", "environment": "staging", "base_sha": "def456" }
]
```

The action itself never deploys anything. It just answers, per app, "what changed since you last shipped" — and hands that answer to whatever does.
