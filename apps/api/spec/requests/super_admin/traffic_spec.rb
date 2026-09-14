require "rails_helper"

# GET /api/super_admin/traffic — the endpoint behind the conversion and usage dashboard (BLO-1681).
#
# The arithmetic is spec/queries/super_admin/traffic_spec.rb's job. This file is about the request:
# which windows are accepted, what an unknown one is answered with, and that the reply really does
# reach across houses, which is the one thing a tenant-scoped endpoint could never do.
RSpec.describe "Super admin traffic" do
  let(:operator) { "user_01OPERATOR" }
  let(:operator_headers) { workos_headers(sub: operator, org_id: nil, role: "admin") }

  before { allowlist_super_admins(operator) }

  # A text, as a `member_login` row: the only kind the check constraints allow without a shift, and
  # nothing here cares what it said.
  def delivered_text(group)
    create(:sms_message,
      kind: "member_login", shift: nil, days_before: nil,
      member: create(:member, group: group), status: "delivered")
  end

  it "answers the last thirty days when the caller names no range" do
    get "/api/super_admin/traffic", headers: operator_headers

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["range"]).to eq("30d")
    expect(response.parsed_body["funnel"].length).to eq(8)
  end

  it "accepts each range the page offers" do
    { "7d" => 7, "30d" => 30, "90d" => 90 }.each do |range, days|
      travel_to(Time.utc(2026, 9, 16, 12, 0)) do
        get "/api/super_admin/traffic", params: { range: range }, headers: operator_headers

        expect(response).to have_http_status(:ok), "#{range} was not accepted"
        expect(response.parsed_body["range"]).to eq(range)
        expect(response.parsed_body["starts_at"]).to eq((Time.current - days.days).iso8601)
      end
    end
  end

  it "refuses a range it does not know, in the app's error shape" do
    get "/api/super_admin/traffic", params: { range: "6m" }, headers: operator_headers

    expect(response).to have_http_status(:bad_request)
    expect(response.parsed_body["error"]).to eq("invalid_range")
    expect(response.parsed_body["allowed"]).to eq(%w[7d 30d 90d])
    expect(response.parsed_body["message"]).to include("6m")
  end

  it "publishes the landing step as a real count, with the note that says where it comes from" do
    create(:analytics_event, name: "landing_view", occurred_at: 1.day.ago)

    get "/api/super_admin/traffic", headers: operator_headers

    landing = response.parsed_body["funnel"].first
    expect(landing["key"]).to eq("landing_views")
    expect(landing["tracked"]).to be(true)
    expect(landing["count"]).to eq(1)
    expect(landing["note"]).to eq(SuperAdmin::Traffic::LANDING_VIEW_NOTE)
  end

  it "publishes where the visits came from, under the funnel" do
    create(:analytics_event, name: "landing_view", occurred_at: 1.day.ago,
                             properties: { "referrer_host" => "reddit.com", "device" => "mobile" })

    get "/api/super_admin/traffic", headers: operator_headers

    visits = response.parsed_body["visits"]
    expect(visits["referrers"]).to eq([ { "host" => "reddit.com", "count" => 1 } ])
    expect(visits["devices"]).to eq([ { "device" => "mobile", "count" => 1 } ])
    # Counted over every matching row rather than summed off the ten above, which is what lets the
    # page say how many visits arrived from another site once there are more than ten hosts.
    expect(visits["referred_count"]).to eq(1)
    # The header is not sent while the domain is DNS-only on Cloudflare, so this is the state in
    # production today. Empty, and the page says why rather than drawing a blank chart.
    expect(visits["countries"]).to eq([])
  end

  it "reads across every house, which is the whole point of the surface" do
    first = create(:group)
    second = create(:group)
    delivered_text(first)
    delivered_text(second)

    get "/api/super_admin/traffic", headers: operator_headers

    body = response.parsed_body
    expect(body["funnel"].find { |step| step["key"] == "made_house" }["count"]).to eq(2)
    expect(body["weeks"].sum { |week| week["texts_sent"] }).to eq(2)
    expect(body["weeks"].sum { |week| week["active_houses"] }).to eq(2)
  end

  # The allowlist boundary itself is spec/requests/super_admin/authorization_spec.rb's, which walks
  # every route under the namespace and so picked this one up the moment it was added. Repeated
  # here only so a failure on this route is legible in this file.
  it "is not there at all for a house admin who is not the operator" do
    get "/api/super_admin/traffic", headers: workos_headers(sub: "user_01ALICE", org_id: "org_01FLAT", role: "admin")

    expect(response).to have_http_status(:not_found)
  end

  it "writes nothing, even to provision the operator" do
    writes = sql_writes_during { get "/api/super_admin/traffic", headers: operator_headers }

    expect(response).to have_http_status(:ok)
    expect(writes).to be_empty
  end
end
