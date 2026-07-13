require "rails_helper"

# Rack::Attack throttles /api/member/* to blunt token enumeration — the one attack that matters
# against a permanent, non-expiring credential — WITHOUT punishing a household that shares one public
# IP. Authenticated members are keyed per member; only unauthenticated (enumeration) traffic is keyed
# per IP. The test env cache is null (so the throttle never interferes with any other spec); here we
# swap in a real store so the limits can actually be reached.
RSpec.describe "Rate limiting the member magic-link path" do
  around do |example|
    original = Rack::Attack.cache.store
    Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new
    example.run
  ensure
    Rack::Attack.cache.store = original
    Rack::Attack.reset!
  end

  it "throttles enumeration — a stream of bad tokens from one IP" do
    30.times do
      get "/api/member/shifts", headers: { "Authorization" => "Bearer bad-#{SecureRandom.hex(4)}" }
      expect(response).to have_http_status(:unauthorized) # allowed through, then refused by auth
    end

    get "/api/member/shifts", headers: { "Authorization" => "Bearer bad-#{SecureRandom.hex(4)}" }

    expect(response).to have_http_status(:too_many_requests)
    expect(response.parsed_body).to eq("error" => "too_many_requests")
  end

  it "does not throttle a household of different members behind one IP" do
    alice = create(:member)
    bob = create(:member, group: alice.group)

    # 40 requests from one IP — well past the 30-request enumeration limit — but split across two real
    # members, each keyed to their own bucket. The shared IP never trips.
    20.times do
      get "/api/member/shifts", headers: member_headers(alice)
      expect(response).to have_http_status(:ok)
    end
    20.times do
      get "/api/member/shifts", headers: member_headers(bob)
      expect(response).to have_http_status(:ok)
    end
  end

  it "still bounds a single member hammering their own token" do
    alice = create(:member)

    60.times { get "/api/member/shifts", headers: member_headers(alice) }
    get "/api/member/shifts", headers: member_headers(alice)

    expect(response).to have_http_status(:too_many_requests)
  end

  it "does not throttle the admin path, which JWT verification already guards" do
    35.times { get "/api/me" }

    # 401 (no token), never 429 — the throttle is scoped to /api/member/* only.
    expect(response).to have_http_status(:unauthorized)
  end
end
