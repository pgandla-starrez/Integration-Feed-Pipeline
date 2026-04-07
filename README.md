# Integration Feed Pipeline

## Background

A Node.js/TypeScript service that runs scheduled sync jobs to pull data from third-party APIs into the platform database. It integrates with:

- a **Property Management System** to keep property listings up to date — delivered as a large XML feed
- a **Payment Gateway** to ingest transaction records
- a **University Directory** to maintain tenant/student records

Jobs run on independent cron schedules. Raw API responses are staged in **MongoDB** before being written to the primary **PostgreSQL** database. **Redis** is used for caching and deduplication across runs.

## The Problem

Since going live the team has been fighting a recurring set of symptoms with no lasting fix:

- **Duplicate records** appear in the database intermittently, especially after a restart or a blip in an upstream API.
- **Process crashes** occur during high-load periods. Stack traces point to different places each time.
- **Silent data corruption** — business reports occasionally surface wrong pricing tiers or tenant statuses but no error is ever logged.
- **Zero observability** — there is no way to tell from outside the process whether any sync run succeeded, how many records were processed, or when the last successful run completed.
- **Memory growth** — the service's RSS climbs over days until ops restarts it.
- **Impossible to change** — every attempt to modify the fee calculation or tenant classification logic has caused a regression somewhere else.

Your task is to figure out why, and to drive the remediation.

## Repository Structure

```
config.ts          configuration (DB, Redis, MongoDB, external APIs, cron schedules)
db.ts              PostgreSQL connection and query helper
cache.ts           Redis client and cache helpers
mongo.ts           MongoDB client and staging collection helper
syncProperties.ts  property sync job
syncPayments.ts    payment sync job
syncTenants.ts     tenant sync job
index.ts           cron scheduler / entry point
CHALLENGE.md       full challenge brief
```

## Getting Started

### Prerequisites

- Node.js 18+
- TypeScript / ts-node (`npm install -g ts-node typescript`)
- PostgreSQL is not required to complete the review; you will need it only if you choose to run the code

### Install dependencies

```bash
npm install
```

### Run a single sync job (optional)

```bash
npx ts-node -e "import('./syncProperties').then(m => m.syncProperties())"
```

## Evaluation

See [CHALLENGE.md](./CHALLENGE.md) for the full brief, time constraint, and what interviewers are looking for.
