require "rails_helper"

# The ceiling on how many rows one token can write.
#
# POST /api/sign_ins deduplicates by the token's `jti` behind a unique index, and for a token that
# carries one that is the whole story: a retried callback writes nothing the second time. But
# Postgres lets NULLs repeat in a unique index, and nothing in this repo has confirmed that a real
# AuthKit access token carries a `jti` at all — so if it turns out not to, the deduplication silently
# is not there and a loop writes a row per request. This throttle is the floor under that case, and
# these specs are what say it exists.
#
# The counters are a real per-process MemoryStore in every environment, the test one included
# (config/initializers/rack_attack.rb), so the limit below can actually be reached; what keeps this
# file's burst out of every other spec is spec/support/rack_attack.rb, which empties the store before
# each example. Time is frozen inside the window on purpose:
# Rack::Attack counts in a FIXED 60-second window keyed on `Time.now.to_i / 60`, so a burst that
# straddles a minute boundary starts a fresh counter and the test would fail for the clock's reasons
# rather than the code's.
RSpec.describe "Rate limiting the sign-in collector" do
  around do |example|
    freeze_time { example.run }
  end

  # One token, presented over and over. A real retried callback presents the same token, so this is
  # also the shape the limit must be generous enough not to punish — ten is far more callbacks than
  # one sign-in can honestly mean.
  it "bounds how many times one token can be recorded" do
    headers = workos_headers(sub: "user_01ALICE")

    10.times do
      post "/api/sign_ins", headers: headers
      expect(response).to have_http_status(:no_content)
    end

    post "/api/sign_ins", headers: headers

    expect(response).to have_http_status(:too_many_requests)
    expect(response.parsed_body).to eq("error" => "too_many_requests")
  end

  # Keyed on the token, not the IP. Two houses behind one office or café NAT share an address, and
  # one of them signing in must never lock the other out.
  it "gives each token its own bucket" do
    exhausted = workos_headers(sub: "user_01ALICE")
    11.times { post "/api/sign_ins", headers: exhausted }
    expect(response).to have_http_status(:too_many_requests)

    post "/api/sign_ins", headers: workos_headers(sub: "user_01BOB")

    expect(response).to have_http_status(:no_content)
  end

  it "writes nothing once it is throttled" do
    headers = workos_headers(sub: "user_01ALICE", jti: nil)
    10.times { post "/api/sign_ins", headers: headers }

    expect { post "/api/sign_ins", headers: headers }.not_to change(SignIn, :count)

    expect(response).to have_http_status(:too_many_requests)
  end

  # The throttle matches the normalised path, because `/api/sign_ins.json` and `/api/sign_ins/` both
  # reach the same action — a limit either spelling walks around is not a limit.
  it "cannot be walked around by respelling the path" do
    headers = workos_headers(sub: "user_01ALICE")
    10.times { post "/api/sign_ins", headers: headers }

    post "/api/sign_ins.json", headers: headers

    expect(response).to have_http_status(:too_many_requests)
  end

  # It is scoped to this one route. The rest of the admin API is guarded by JWT verification and has
  # no row-per-request to bound, and a throttle that leaked onto it would 429 an ordinary dashboard.
  it "does not throttle the rest of the admin API" do
    headers = workos_headers(sub: "user_01ALICE")
    11.times { post "/api/sign_ins", headers: headers }
    expect(response).to have_http_status(:too_many_requests)

    get "/api/me", headers: headers

    expect(response).to have_http_status(:ok)
  end
end
