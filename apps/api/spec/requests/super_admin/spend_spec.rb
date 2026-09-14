require "rails_helper"

# GET /api/super_admin/spend — the endpoint behind the page that prices the product (BLO-1683).
#
# The money arithmetic is spec/queries/super_admin/spend_spec.rb's job. This file is about the
# request: which windows are accepted, what an unknown one is answered with, and that the reply
# really does reach across houses, which is the one thing a tenant-scoped endpoint could never do.
RSpec.describe "Super admin spend" do
  let(:operator) { "user_01OPERATOR" }
  let(:operator_headers) { workos_headers(sub: operator, org_id: nil, role: "admin") }

  before { allowlist_super_admins(operator) }

  # A text, as a `member_login` row: the only kind the check constraints allow without a shift, and
  # nothing here cares what it said.
  def settled_text(group, amount:, sid:)
    create(
      :sms_message,
      kind: "member_login", shift: nil, days_before: nil,
      member: create(:member, group: group),
      status: "delivered", twilio_sid: sid,
      price: amount.to_d, price_unit: "USD", price_fetched_at: Time.current
    )
  end

  it "answers the last thirty days when the caller names no range" do
    get "/api/super_admin/spend", headers: operator_headers

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["range"]).to eq("30d")
    expect(response.parsed_body["months_in_range"]).to eq(0.985626)
    expect(response.parsed_body["currency"]).to eq("USD")
  end

  it "accepts each range it documents, each measured in real months" do
    { "30d" => 0.985626, "90d" => 2.956879, "12m" => 11.991786 }.each do |range, months|
      get "/api/super_admin/spend", params: { range: range }, headers: operator_headers

      expect(response).to have_http_status(:ok), "#{range} was not accepted"
      expect(response.parsed_body["months_in_range"]).to eq(months)
    end
  end

  it "refuses a range it does not know, in the app's error shape" do
    get "/api/super_admin/spend", params: { range: "6m" }, headers: operator_headers

    expect(response).to have_http_status(:bad_request)
    expect(response.parsed_body["error"]).to eq("invalid_range")
    expect(response.parsed_body["allowed"]).to eq(%w[30d 90d 12m])
    expect(response.parsed_body["message"]).to include("6m")
  end

  it "reads across every house, which is the whole point of the surface" do
    first = create(:group, name: "Alma Road")
    second = create(:group, name: "Bell Street")
    settled_text(first, amount: "0.0100", sid: format("SM%032d", 1))
    settled_text(second, amount: "0.5000", sid: format("SM%032d", 2))
    create(:ai_call, group: second, cost_usd: "0.0300".to_d, items_count: 20)

    get "/api/super_admin/spend", headers: operator_headers

    body = response.parsed_body
    expect(body["houses"].map { |house| house["name"] }).to eq([ "Bell Street", "Alma Road" ])
    expect(body["houses_with_spend"]).to eq(2)
    expect(body["totals"]["sms_cost_settled"]).to eq(0.51)
    expect(body["totals"]["claude_cost"]).to eq(0.03)
    expect(body["totals"]["titles_classified"]).to eq(20)
  end

  it "serialises money as JSON numbers rather than strings" do
    settled_text(create(:group), amount: "0.0079", sid: format("SM%032d", 3))

    get "/api/super_admin/spend", headers: operator_headers

    expect(response.body).to include('"sms_cost_settled":0.0079')
  end

  # The allowlist boundary itself is spec/requests/super_admin/authorization_spec.rb's, which walks
  # every route under the namespace and so picked this one up the moment it was added. Repeated
  # here only so a failure on this route is legible in this file.
  it "is not there at all for a house admin who is not the operator" do
    get "/api/super_admin/spend", headers: workos_headers(sub: "user_01ALICE", org_id: "org_01FLAT", role: "admin")

    expect(response).to have_http_status(:not_found)
  end

  it "writes nothing, even to provision the operator" do
    writes = sql_writes_during { get "/api/super_admin/spend", headers: operator_headers }

    expect(writes).to be_empty
  end
end
