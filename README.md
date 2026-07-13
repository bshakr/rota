# HouseRota

A rota is an ordered list of people taking turns at a named job on a recurring schedule.
HouseRota keeps the list, works out whose turn it is, and texts them before their shift.
People who can't make it hand the shift to someone else without an admin getting involved.

Design and rationale: [`docs/superpowers/specs/2026-07-13-houserota-design.md`](docs/superpowers/specs/2026-07-13-houserota-design.md).
Read it before changing anything structural — the decisions in it were made on purpose.

## Layout

```
apps/api    Rails 8.1, API-only. All business logic: scheduling, reminders, Twilio.
apps/web    Next.js. Admin UI behind WorkOS AuthKit, plus the member magic-link pages.
docs/       Specs.
```

Rails owns everything that matters. Next.js is a rendering and auth layer.

## Prerequisites

Versions are pinned in [`.tool-versions`](.tool-versions).

- Ruby 3.4.5
- Node 25.6.1
- PostgreSQL 16, running locally

```sh
brew install postgresql@16 && brew services start postgresql@16
```

## Boot the stack

```sh
git clone git@github.com:bshakr/rota.git houserota
cd houserota
cp .env.example .env          # then fill it in
```

Both apps read that single root `.env`. Nothing else needs a copy.

Install gems and create the databases:

```sh
cd apps/api
bin/setup --skip-server       # without the flag, setup boots the server and blocks
```

Then run these two processes side by side:

```sh
bin/rails s                   # API on http://localhost:3000
bin/jobs                      # Solid Queue worker + recurring scheduler
```

`bin/jobs` is not optional in development. Reminders, SMS sends and the daily shift
top-up are all background jobs, so without a worker they queue up and silently never run.

Check it came up:

```sh
curl -i localhost:3000/up     # 200
```

The web app lands in `apps/web` and will run on **port 3001** — the API already owns 3000,
and the API's CORS config expects the browser to call it from `http://localhost:3001`.

## Secrets

Every secret is an environment variable, listed in [`.env.example`](.env.example). There is
deliberately **no `config/credentials.yml.enc`**: an encrypted file is only useful if the
key is shared, and `master.key` is gitignored, so it would have been undecryptable for
everyone but its author. One mechanism, one place to look.

In production, set the same variables plus `SECRET_KEY_BASE`.

## Databases

Each environment runs two Postgres databases:

| Connection | Database (development) | Holds |
| --- | --- | --- |
| `primary` | `houserota_api_development` | The application schema. |
| `queue` | `houserota_api_development_queue` | Solid Queue's internal tables. |

Splitting them is the Rails 8 production default, and we extend it to every environment
so that `db/schema.rb` only ever describes the domain. A Solid Queue upgrade can never
show up as a diff in it.

Override with `DATABASE_URL` and `QUEUE_DATABASE_URL`.

## Tests

```sh
cd apps/api
bundle exec rspec             # RSpec + FactoryBot; no spec may touch the network
bundle exec rubocop           # rubocop-rails-omakase
```

WebMock blocks outbound HTTP in the test environment, so a spec can never send a real
text message. Stub Twilio and WorkOS explicitly.

To prove the queue works end to end, with `bin/jobs` running in another terminal:

```sh
bin/rails runner script/solid_queue_smoke.rb
```

It enqueues a job and waits for a worker to finish it. CI runs the same script.
