---
title: Why our ECS task definitions are jsonnet, not Terraform
description: Splitting resource provisioning from container lifecycle at 800 engineers, and why jsonnet — not CUE, not Dhall — ended up owning the task-definition template.
date: 2026-05-06
---

Every image tag bump was a Terraform PR. A team wanted to add an environment variable, bump CPU on a sidecar, or change a health check path — none of it infrastructure, all of it buried in a `container_definitions` JSON blob wedged into an `aws_ecs_task_definition` resource. Every change went through infra's repo, infra's review, infra's `plan`/`apply`. Infra didn't want to own it. Teams didn't want to wait on it.

The task definition and the resources around it were never the same kind of change. One is "here's the cluster, the IAM role, the networking" — infra's job, changes rarely. The other is "here's what container runs" — the team's job, changes every deploy. Terraform had them zipped together, so a deploy-shaped change kept going through an infra-shaped process.

## Splitting ownership

So I split it. Resource provisioning stayed in Terraform, infra-owned. The task definition moved into each team's own CI/CD — rendered and registered on every deploy, no infra PR involved. Terraform still creates the service and points it at a task-definition family; it just stopped caring what's inside.

That only works if whatever renders the task definition is something a team can own without becoming infra experts.

## It's already JSON

`register-task-definition` takes JSON, full stop. So I didn't want to invent a new shape for the data — I wanted the thing everyone already reads, plus just enough templating to stop 40 teams copy-pasting the same container block and drifting apart: a shared base for logging and sidecars, per-service overrides on top.

Jsonnet is exactly that. Valid JSON is valid jsonnet. `local` for the shared base, `+` to merge overrides, `import` so a team pulls in the org's standard log routing and sidecars instead of hand-copying them:

```jsonnet
local webService = import 'aws/ecs/web-service.libsonnet';
local sidecars = import 'aws/ecs/sidecars.libsonnet';

{
  containerDefinitions: [
    webService.service.build(
      webService.service.new(
        std.extVar('SERVICE_NAME'),
        std.extVar('SERVICE_VERSION'),
        std.extVar('IMAGE_URI'),
        std.extVar('ENVIRONMENT_NAME'),
      )
      + webService.service.withPort(3001)
      + webService.service.withHealthPath('/api/healthcheck')
    ),
  ] + sidecars.sidecars.default(),
}
```

Nobody writes a log-driver config or figures out health-check shapes by hand. `web-service.libsonnet` bakes in the standard logging and health check; `sidecars.sidecars.default()` appends whatever the org standardizes on. A team's file just says "I'm a web service, here's my port." What used to be 40 slightly different hand-rolled configs is one shared base, imported instead of copied — it drifts once, not 40 times.

## Functions over objects

I made every setting a named function — `withPort(port)`, `withMemory(mb)` — chained with `+`, instead of one big object teams merge fields into. A jsonnet-aware editor autocompletes a function signature; it can't autocomplete keys inside a bare object literal. Same output, but one of them tells you what to type next — and most people open this file once a quarter.

## Why not something better

Left to myself, I'd reach for CUE or Dhall. CUE validates schemas before anything applies. Dhall is total and statically typed — deliberately not Turing-complete, so a well-typed program is guaranteed to terminate, no infinite loop possible. Both catch a class of mistakes jsonnet just doesn't.

But the question was never "what's better." It was "what can 800 engineers, most of whom aren't infra people, pick up the day they touch a task definition." Dhall reads as a new language to learn. CUE asks for its own schema vocabulary on top. Jsonnet barely asks anything — you already read JSON, so you already read most of a jsonnet file.

## What that costs

Jsonnet itself doesn't validate anything — no type catching a string where a number belongs, nothing stopping two teams' "shared base" from drifting apart. We cover that with a schema check in CI instead: every change validates against the ECS schema before it ships, so a bad template fails a pipeline step, not a `register-task-definition` call against a live service.

Accessible and imperfect, backed by a schema check, beats correct and unfamiliar.
