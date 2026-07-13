require "rails_helper"

# The one endpoint this ticket ships, and it exists to prove the path end to end: a bearer token
# goes in, and what comes back is the admin and the group that the *token* named. The domain
# endpoints are BLO-1047's.
RSpec.describe "GET /api/me" do
  it "answers with the admin and the group the token names" do
    get "/api/me", headers: workos_headers(sub: "user_01ALICE", org_id: "org_01FLAT", role: "admin", email: "alice@example.com", name: "Alice")

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq(
      "user" => {
        "id" => User.sole.id,
        "workos_user_id" => "user_01ALICE",
        "email" => "alice@example.com",
        "name" => "Alice"
      },
      "group" => {
        "id" => Group.sole.id,
        "workos_organization_id" => "org_01FLAT",
        "name" => Group.sole.name,
        "timezone" => "UTC"
      },
      "role" => "admin"
    )
  end

  it "answers with the group's real name and timezone once an admin has set them" do
    create(:group, workos_organization_id: "org_01FLAT", name: "Flat 3, Alma Road", timezone: "Europe/London")

    get "/api/me", headers: workos_headers(org_id: "org_01FLAT")

    expect(response.parsed_body["group"]).to include("name" => "Flat 3, Alma Road", "timezone" => "Europe/London")
  end

  it "is refused without a token" do
    get "/api/me"

    expect(response).to have_http_status(:unauthorized)
  end
end
