require "rails_helper"

# Rack::Attack throttles /api/member/* to blunt token enumeration — the one attack that matters
# against a permanent, non-expiring credential. The test env cache is null (so the throttle never
# interferes with any other spec); here we swap in a real store so the limit can actually be reached.
RSpec.describe "Rate limiting the member magic-link path" do
  around do |example|
    original = Rack::Attack.cache.store
    Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new
    example.run
  ensure
    Rack::Attack.cache.store = original
    Rack::Attack.reset!
  end

  it "throttles a caller hammering the path with bad tokens" do
    limit = 30
    headers = { "Authorization" => "Bearer definitely-not-a-real-token" }

    limit.times do
      get "/api/member/shifts", headers: headers
      expect(response).to have_http_status(:unauthorized) # allowed through, then refused by auth
    end

    get "/api/member/shifts", headers: headers

    expect(response).to have_http_status(:too_many_requests)
    expect(response.parsed_body).to eq("error" => "too_many_requests")
  end

  it "does not throttle the admin path, which JWT verification already guards" do
    35.times { get "/api/me" }

    # 401 (no token), never 429 — the throttle is scoped to /api/member/* only.
    expect(response).to have_http_status(:unauthorized)
  end
end
