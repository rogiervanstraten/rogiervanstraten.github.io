---
title: Finding affected Terraform projects in a monorepo
description: A GitHub Action that walks module dependencies and changed files to tell CI which Terraform projects actually need to run.
date: 2026-07-05
---

Somewhere past the tenth Terraform project in the same repo, I noticed I was running `plan`/`apply` on everything, every push. A change to `dev/api` has no business touching `prod/billing`'s state, yet there they were, replanning together because nothing told CI otherwise.

I'd reached for Terragrunt before for exactly this — DRY config, per-environment folders, dependency blocks that track what needs what. It solves reusability well. What soured me on it was the trade: it wraps Terraform in another HCL layer to generate the Terraform I meant to write, and every time the two drifted, I was debugging the wrapper, not the infrastructure.

So the real question wasn't "what changed" — it was "what did this change actually reach." I wanted that answer without bolting another abstraction onto Terraform to get it.

## Diffing files isn't enough

The obvious first idea — diff the changed files against the list of projects — falls apart fast. Most changes don't land inside a project directory at all. They land in a shared module three levels up, used by projects that never showed up in the diff. Treat that as "nothing changed" and you ship five projects that are quietly out of date with the module they depend on.

## Deciding what counts as a project

The fix starts with a marker file. Any directory containing one — `provider.tf` by default, since that's the conventional home for a `provider` block — counts as a deployable project root. Everything else is scaffolding: modules, shared config, inputs to a project rather than a project itself. The marker is configurable, because not every repo agrees on `provider.tf` as the signal, but the idea holds — a project is a place, not a guess.

## Walking the graph, not just the folder

This is the part that actually earns its keep. The action parses every `module` block in the repo and builds a dependency graph, then walks it transitively: if project A uses module B, and module B uses module C, a change to C marks A affected — even though nothing inside A's own directory moved. A flat "did a file in this folder change" check would have missed it completely, which is exactly the failure mode that started this whole thing.

## Telling it what changed

Changed files can come from either direction — handed in directly, or worked out from git:

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

Give it a file list, or hand it `base-ref`/`head-ref` and let it run the diff itself. Either way, the result passes through `files`/`files-ignore` globs (defaulting to `**/*.tf`, `**/*.tfvars`, `**/*.hcl`), then gets resolved upward — a change three directories deep inside a project still counts against that project's root, not whatever module happens to sit above it.

Two flags exist for the times "affected" isn't the right question at all: `all-projects: true` ignores the diff and returns everything, for the deploy that has to run regardless; `resolve-root: true` decides whether a change to the repo root itself should count as affecting everything, or nothing. `ignore-paths` keeps `.git` and `node_modules` out of the walk so they're never mistaken for project candidates.

## What comes out the other end

One JSON array, ready to feed a matrix job:

```json
["dev/api", "staging/api", "prod/networking"]
```

The action never touches Terraform state, never runs `plan` or `apply`. It answers one question — which of these directories does this diff actually reach — and hands the answer to whatever workflow asked.

Repo's [here](https://github.com/rogiervanstraten/terraform-affected-projects) if you want to point it at your own layout.

Thanks to [Benjamin Vouillaume](https://www.linkedin.com/in/benjaminvouillaume/) for the monorepo structure this action was built to serve — shared modules, per-environment project directories, the layout that made "affected" a question worth answering in the first place.
