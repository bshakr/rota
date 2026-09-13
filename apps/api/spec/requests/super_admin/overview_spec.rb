require "rails_helper"

# The one endpoint this ticket ships. It exists so the namespace has something to route to and the
# boundary has something to test; the KPIs, attention list and recent houses it will carry are
# BLO-1677's (https://linear.app/bloombase/issue/BLO-1677).
RSpec.describe "GET /api/super_admin/overview" do
  before { allowlist_super_admins("user_01OPERATOR") }

  it "answers an empty payload to an allowlisted operator" do
    get "/api/super_admin/overview", headers: workos_headers(sub: "user_01OPERATOR")

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq({})
  end

  it "writes nothing: reading across every house provisions nobody" do
    writes = sql_writes_during do
      get "/api/super_admin/overview", headers: workos_headers(sub: "user_01OPERATOR")
    end

    expect(response).to have_http_status(:ok)
    expect(writes).to be_empty
  end
end
