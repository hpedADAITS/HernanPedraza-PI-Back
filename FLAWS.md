# Backend flaws audit

This document records the main structural and code-quality flaws found in the Node/Express/MongoDB backend. It focuses on maintainability, architectural pressure points, and production risk rather than whether the current test suite passes.

## Executive summary

The backend is reasonably guarded in production, but too much domain behavior still lives in large services, overloaded loaders, and overlapping validation layers. The code mostly works because the invariants are already strong; the risk is that future changes will blur transport boundaries, duplicate rules, or weaken debug and realtime guards.

## Structural flaws

### 1. Validation, transport, and domain rules overlap

Backend validation is split across `schemas/*`, `validators/*`, `dtos/*`, controllers, sockets, and services. That is manageable only if each layer has a clear job. Right now the same rules can be rechecked in multiple places, which makes drift likely.

Keep this split stable:

- HTTP and socket payload parsing stay at the transport boundary.
- Services enforce permission and domain invariants.
- Realtime handlers adapt commands, then defer to services.
- Shared field rules should not be reimplemented in controllers and sockets unless the boundary truly requires it.

### 2. Oversized service modules carry too many workflows

`participants`, `songs`, `events`, and `auth` logic is concentrated in a few large services. These services are not just data access layers; they also hold authorization, compatibility mapping, realtime side effects, and state transitions.

That concentration is the main maintainability risk:

- moderation and attendee-session checks live near participant mutation
- song voting affects queue state and realtime broadcasts
- event creation combines role checks, email confirmation, and persistence
- auth flows mix identity, verification, and token policy

### 3. Realtime and HTTP behavior can diverge too easily

Socket handlers and controllers often implement the same domain actions through different transport shapes. The backend already has the right principle, but it needs to stay explicit: transports adapt input, services decide and mutate.

The key invariant is that client-emitted past-tense events stay rejected as commands, while imperative socket commands with acknowledgments remain the only writable realtime API.

### 4. Documentation and model aggregation are too centralized

The Swagger loader and model barrel both concentrate unrelated concerns in single files. That makes review harder, encourages hidden coupling, and increases the cost of small changes.

Prefer smaller units when touching these areas:

- route/domain-local docs over one giant documentation file
- aggregate-focused model modules over a shared barrel with helpers and connection logic

## Security and domain pressure points

The backend already has important invariants that should stay hard-gated:

- production must provide a strong JWT secret
- `DEBUG_MODE=true` must never be allowed with `NODE_ENV=production`
- debug routes and mock-account creation stay non-production only
- Socket.IO auth is mandatory in production
- event joins validate access before room membership
- attendee-owned actions stay server-enforced through participant-session checks
- socket commands pass `socket.user` into services; raw payload identity is not proof

Domain rules that should remain canonical on the backend:

- `PENDING`, `APPROVED`, and `PLAYING` are the persisted queue states; `QUEUED` is only a legacy display alias
- queue positions are derived from sorted snapshots, not stale stored ordering
- `Song.totalDuration` is canonical; `duration` is only a compatibility alias
- vote auto-rejection, cooldowns, bans, kicks, and self-moderation rejection all remain service-level decisions
- event participant listings continue excluding active rows owned by the event owner

## Code quality flaws

### 1. Error boundaries are still message-driven

Several flows still rely on generic `Error` objects and string matching. That is workable, but it makes transport mapping and client behavior less stable than typed application errors.

### 2. Mixed-language output reduces consistency

English and Spanish messages are mixed in backend responses and errors. That is not a correctness issue, but it makes the API harder to present consistently in the frontend.

## Testing/status flaws

The backend has useful tests and they currently pass, which is good. The remaining risk is structural, not lack of coverage. The most fragile paths are still the ones that combine permissions, queue mutation, and realtime behavior.

Keep these covered before refactoring:

- socket auth and auth-bypass behavior
- event room join authorization
- attendee-owned action authorization
- DJ/admin moderation permissions
- self-moderation rejection
- vote auto-rejection threshold behavior
- queue snapshot ordering and playing position
- debug route production blocking

## Recommended refactor order

1. Consolidate request and socket parsing so each transport has one clear validation boundary.
2. Split oversized service workflows into smaller internal units where authorization, persistence, and side effects are currently mixed.
3. Break up centralized docs and model aggregation only when doing adjacent backend work.
4. Introduce typed service errors where generic errors are currently carrying domain decisions.

## What not to do

- Do not weaken production config or debug guards for convenience.
- Do not trust frontend-provided user or participant identity.
- Do not persist legacy `QUEUED` backend state.
- Do not move socket authorization out of services without preserving service-level checks.
- Do not let socket or HTTP transport code own domain rules.
- Do not widen refactors before pinning current socket, moderation, and queue behavior with focused tests.
