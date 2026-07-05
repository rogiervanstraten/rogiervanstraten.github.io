---
title: Finding affected Terraform projects in a monorepo
description: A GitHub Action that walks module dependencies and changed files to tell CI which Terraform projects actually need to run.
date: 2025-11-15
links:
  - href: https://github.com/rogiervanstraten/terraform-affected-projects
    title: terraform-affected-projects
    subtitle: Source on GitHub
    kind: github
  - href: https://github.com/marketplace/actions/terraform-affected-projects
    title: GitHub Marketplace
    subtitle: Install as an Action
    kind: marketplace
---

There's more than one way to run Terraform across an organization — I'd already tried a few by the time I landed on Benjamin's: one repo, a folder per environment, shared modules underneath, held together by a bash script of `grep` and `find` walking the dependency tree to work out what a change actually touched. Rough, but the instinct was right, and I've leaned into that pattern ever since.

The rough edges show up fast. Past the tenth project in a repo like that, every push ran `plan`/`apply` across all of them. A change to `payments/checkout` has no business touching `payments/refunds`' state, yet there they were, replanning together because nothing told CI otherwise.

I'd reached for Terragrunt before — DRY config, per-environment folders, dependency blocks that track what needs what. It's a lot of machinery, and I only wanted an answer to one narrow question. The trade soured me: another HCL layer wrapped around the Terraform I meant to write, and every time the two drifted, I was debugging the wrapper, not the infrastructure.

So the real question wasn't "what changed" — it was "what did this change actually reach." Benjamin's bash script had the right instinct; I wanted the same answer without a shell script held together by hope, and without bolting another abstraction onto Terraform to get it.

## Diffing files isn't enough

Diff the changed files against the list of projects, and it falls apart fast. Most changes don't land inside a project directory at all. They land in a shared module three levels up, used by projects that never showed up in the diff:

```
.
├── modules
│   └── database
│       └── main.tf          ← the diff shows this file changed
└── payments
    ├── checkout
    │   └── production
    │       └── provider.tf  ← uses modules/database directly
    └── refunds
        ├── module
        │   └── database.tf  ← wraps modules/database
        └── production
            └── provider.tf  ← uses refunds/module, two hops from the change
```

A file-diff check sees `modules/database/main.tf` changed and stops there. Neither `payments/checkout/production` nor `payments/refunds/production` shows up in the diff — nothing inside either project directory moved — so a naive check calls it "nothing changed." Both depend on that module, one directly and one through another module in between, and both need `plan`/`apply` run against it.

## Deciding what counts as a project

So I start with a marker file: any directory containing one — `provider.tf` by default, the conventional home for a `provider` block — counts as a deployable project root. Everything else is scaffolding: modules, shared config, inputs to a project rather than a project itself. It helps that configuring a provider inside a module is already an anti-pattern — modules should stay provider-agnostic and let the caller decide. So `provider.tf` isn't just a convenient marker, it's the file that was always going to mark where Terraform actually applies. I made the marker configurable, since not every repo agrees on `provider.tf` as the signal, but the idea holds — a project is a place, not a guess.

## Walking the graph, not just the folder

This is the part I care about most. It parses every `module` block in the repo and builds a dependency graph, then walks it transitively: project A uses module B, module B uses module C, a change to C marks A affected — even though nothing inside A's own directory moved. A flat "did a file in this folder change" check misses that completely. That's the failure mode that started this whole thing.

## Telling it what changed

I let the changed files come from either direction — handed in directly, or worked out from git:

```yaml
inputs:
  changed-files:
    description: |
      Manually provide a list of changed files (optional, will auto-detect via
      git if not provided)
  base-ref:
    description: Base git reference for diff
  head-ref:
    description: Head git reference for diff
```

Give it a file list, or hand it `base-ref`/`head-ref` and let it diff itself. Either way, the result passes through `files`/`files-ignore` globs (default `**/*.tf`, `**/*.tfvars`, `**/*.hcl`), then resolves upward — a change three directories deep inside a project still counts against that project's root, not whatever module sits above it.

Two flags cover the times "affected" isn't the right question: `all-projects: true` ignores the diff and returns everything, for deploys that run regardless; `resolve-root: true` decides whether a change at the repo root affects everything, or nothing. `ignore-paths` keeps `.git` and `node_modules` out of the walk so they're never mistaken for project candidates.

## What comes out the other end

One JSON array, ready to feed a matrix job:

```json
["payments/checkout/production", "payments/refunds/production"]
```

I kept it deliberately narrow: it never touches Terraform state, never runs `plan` or `apply`. It answers one question — which of these directories does this diff actually reach — and hands the answer to whatever workflow asked. No more replanning the whole org over a one-line change.

If you want to point it at your own layout, the repo and the Marketplace listing are linked below.

Thanks to [Benjamin Vouillaume](https://www.linkedin.com/in/benjaminvouillaume/) for that first bash script, and the monorepo layout it was patched together to serve — the one that made "affected" a question worth answering properly.
