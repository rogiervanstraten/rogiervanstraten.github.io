---
title: Making eleven products agree on what tier-1 means
description: How we built a canonical source of truth for service catalog metadata that validates at Terraform plan time and in CI schema checks, without duplicating the logic and without coupling the two consumers together.
date: 2026-07-15
draft: false
---

We put a service catalog in the middle of eleven products to pull them together. Filled it with tiers, domains, lifecycle stages, service types. Three months later, filtering on `tier` returned `tier-1`, `Tier1`, `critical`, `P1`, and an empty string. Filtering on `domain` returned `banking`, `Banking`, `bank`, `bankin` (a typo nobody caught), and `payments`, which was never a valid domain in the first place.

The catalog had data in every field and was useless for the one thing we built it for: routing an incident to the right team at the right severity.

Eleven products because we grow by acquisition. Each one arrived with its own repos, its own deploy pipeline, and its own spelling of `tier-1`. The fields were freeform strings, and nothing in the path from code to catalog checked any of them, so eleven conventions stayed eleven conventions, now stacked in one table.

Domain-driven design calls the missing piece a ubiquitous language: one set of terms that means the same thing in every repo that uses them. We'd built the table without agreeing the words that go in it.

## Where a flat schema runs out

The obvious fix is a schema: define an enum for each field, validate YAML against it in CI. But domain and area aren't independent. `area: accounting-invoicing` is valid, but only when `domain: accounting`. `area: banking-experience` under `domain: platform` is wrong, and it's wrong in a way a simple enum on the `area` field can't catch because `banking-experience` is a valid value in isolation.

That domain→area mapping is the constraint a flat schema can't express. A list of valid values for each field isn't enough. You need something that knows the mapping and can enforce it, both at plan time in Terraform and at schema-check time in CI.

## One repo, two forms

`catalog-context` is a Git repo that holds the canonical list of allowed values for every catalog field. The ubiquitous language, written down and versioned. It serves two different consumers without coupling them together.

Terraform consumers source it as a module:

```hcl
module "catalog_context" {
  source = "git::ssh://git@github.com/rogiervanstraten/catalog-context.git//module?ref=v1.0.0"

  lifecycle_stage = "production"
  tier            = "tier-1"
  domain          = "banking"
  area            = "banking-experience"
  team            = "payments-platform"
  service_type    = "api"
}
```

Validation happens at `terraform plan`. An invalid tier, an unknown domain, or an area that doesn't belong to its domain: all fail before `apply` is anywhere near the picture. No custom provider, no sentinel policy, no separate validation step: the module just fails the plan.

Schema consumers download the JSON schemas from each GitHub Release:

```bash
gh release download v1.0.0 --repo rogiervanstraten/catalog-context --pattern "*.json"
```

Then they run their existing JSON schema validation tooling against catalog YAML files in CI. Same allowed values, different enforcement point.

## One PR, both formats

Each sub-module under `module/` owns one field: `module/tier/`, `module/domain/`, `module/lifecycle/`, etc. The Terraform validation is a `validation` block on the variable; the JSON schema is a sibling `schema.json` with an `enum` array. The same values exist in both places.

The duplication is the mechanism that makes "canonical" work. Both consumers change in the same PR. There's no second repo to update, no release of the schema file that happens to lag the Terraform change.

The domain→area constraint is expressed in both formats as well. In Terraform, a `validation` block on `var.area` uses `contains(lookup(local.domain_areas, var.domain, []), var.area)` to reject an area that doesn't belong to the chosen domain. In JSON Schema, five `allOf/if-then` blocks enforce the same mapping. If `domain` is `banking`, then `area` must be one of `banking-customer-lifecycle`, `banking-experience`, `banking-foundations`, `banking-lending-partnerships`. Same rule, native expression in each format, both enforced from the same source commit.

## What the module outputs

The root module validates, then passes the values through as outputs representing the properties we consider part of the canonical catalog:

```hcl
output "catalog_properties" {
  value = {
    lifecycle_stage = module.lifecycle.lifecycle_stage
    tier            = module.tier.tier
    service_type    = module.service_type.service_type
    domain          = module.domain.domain
    area            = module.domain.area
    team            = module.team.team
  }
}
```

So after calling the module, you get back validated values you can feed directly into whatever catalog resource your stack uses. The plan either passes with the right values or fails with a useful error message. You don't find out the domain was wrong when someone looks at the catalog six months later.

## What it doesn't do

`catalog-context` only knows about your canonical field definitions. It doesn't know how any particular catalog system structures its schema, what fields are required, or how to map these values into it. That composition is the consuming repo's problem.

It's also not enforced retroactively. Existing catalog entries with bad data don't get rejected when you adopt this module; adoption is per-service as teams update their Terraform. The value builds over time as new services are catalogued correctly and existing ones get cleaned up.

The repo is at [rogiervanstraten/catalog-context](https://github.com/rogiervanstraten/catalog-context).

The shape came from Cloud Posse's [terraform-null-label](https://github.com/cloudposse/terraform-null-label), a module that provisions nothing and exists only to hand a normalized `context` object to whatever calls it. It normalizes where this one rejects. The idea of putting the convention in a module and passing it down came from there, name included.
