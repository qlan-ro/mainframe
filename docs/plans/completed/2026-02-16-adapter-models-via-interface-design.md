# Adapter-Provided Model Availability Design

**Date:** 2026-02-16
**Status:** Approved

## Problem

Model availability is currently hardcoded in desktop UI code (`ADAPTER_MODELS`) and not represented in the adapter contract. This creates drift risk and duplicates provider capability metadata outside the adapter boundary.

## Decision

Expose model availability through the Adapter interface and surface it via `/api/adapters`.

- Source of truth: adapter implementation metadata (static for now)
- Transport: API-driven (`GET /api/adapters` returns model metadata)
- UI behavior: use API data for adapter/model lists and model labels

## Goals

- Put provider model metadata behind the adapter contract
- Remove desktop hardcoded model list from primary path
- Keep existing model selection flows (settings defaults + per-chat model updates)
- Preserve behavior when an adapter has no models

## Non-Goals

- Runtime model discovery from provider CLIs/APIs
- Cross-session caching or persistence of adapter model metadata
- Multi-provider rollout beyond preserving existing adapters

## Architecture

### Type contract changes

In `@mainframe/types`:

- Add `AdapterModel` type:
  - `id: string`
  - `label: string`
  - `contextWindow?: number`
- Extend `AdapterInfo` with `models: AdapterModel[]`
- Add `listModels(): Promise<AdapterModel[]>` to `Adapter`

### Core changes

- Implement `listModels()` on `ClaudeAdapter` with current static Claude model set
- Update `AdapterRegistry.list()` to include `models` in each `AdapterInfo`
- `/api/adapters` automatically returns models via existing route

### Desktop changes

- Replace primary dependence on `ADAPTER_MODELS` with adapter data loaded from `/api/adapters`
- Add a lightweight adapters store (list, loading, error) shared by settings and composer
- Update model dropdown inputs in:
  - `Settings` provider section
  - Chat composer session controls
- Keep provider labels via adapter data; fallback to known labels when API unavailable
- Update model label/context window helpers to resolve using adapter metadata

## Data flow

1. Desktop boot fetches `/api/adapters`
2. Response includes adapter + model metadata
3. UI renders adapter selector and model selector from fetched data
4. Model changes continue through existing `chat.updateConfig` and provider settings endpoints

## Error handling and fallback

- If adapter fetch fails, existing chat state remains usable
- Adapter/model selectors degrade safely to empty model lists
- If no models are returned for adapter, model dropdown shows no explicit models; chat creation/update omits explicit model and provider default is used

## Testing strategy

### Core

- Route test: `/api/adapters` includes `models` array per adapter
- Registry test coverage through route-level assertions

### Desktop

- Adapter metadata utilities/stores:
  - map adapter ids to labels/options
  - model lookup and context window fallback behavior
- UI tests for provider/composer model options using store-fed adapter metadata

## Risks

- UI regressions if adapter metadata not loaded before render
  - Mitigation: safe empty defaults and existing chat values
- Type breakage across packages due `Adapter` interface extension
  - Mitigation: update all adapter implementations in this repo

## Migration impact

- No database schema changes
- No API path changes
- API response shape for `/api/adapters` is extended (additive)

## Accepted approach rationale

This keeps model metadata where it belongs (provider adapter), removes hardcoded desktop-only knowledge, and minimizes architecture churn by reusing the existing adapters endpoint.
