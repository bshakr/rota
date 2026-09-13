require "rails_helper"

# One house's delivery log, read by the operator. The rows are found exactly the way the house's own
# log finds them — SmsMessageFiltering is shared between the two controllers — so this file checks
# that the sharing actually holds, and that the log stays rooted in the one house asked for.
RSpec.describe "GET /api/super_admin/groups/:group_id/sms_messages" do
  let(:operator) { "user_01OPERATOR" }
  let(:group) { create(:group) }
  let(:member) { create(:member, group: group) }
  let(:rota) { create(:rota, group: group, name: "Bins") }

  before { allowlist_super_admins(operator) }

  def headers = workos_headers(sub: operator, org_id: nil)

  def log(params = {})
    get "/api/super_admin/groups/#{group.id}/sms_messages", params: params, headers: headers
    expect(response).to have_http_status(:ok)
    response.parsed_body.fetch("sms_messages")
  end

  it "returns this house's log, newest first, and nobody else's" do
    older = text_in(group, rota: rota, member: member, at: 2.days.ago)
    newer = text_in(group, rota: rota, member: member, at: 1.hour.ago)
    text_in(create(:group))

    expect(log.map { |row| row.fetch("id") }).to eq([ newer.id, older.id ])
  end

  it "carries the carrier status, the shift and the member's number" do
    sent = text_in(group, rota: rota, member: member, body: "Hi! It's your turn.")

    row = log.first

    expect(row).to include("status" => "sent", "twilio_sid" => sent.twilio_sid, "body" => "Hi! It's your turn.")
    expect(row.fetch("shift")).to include("rota_name" => "Bins", "due_on" => sent.shift.due_on.to_s)
    expect(row.fetch("member")).to include("name" => member.name, "phone_e164" => member.phone_e164)
  end

  it "filters by status, the same way the house's own log does" do
    failed = text_in(group, rota: rota, member: member, status: "failed")
    text_in(group, rota: rota, member: member)

    expect(log(status: "failed").map { |row| row.fetch("id") }).to eq([ failed.id ])
  end

  it "filters by kind, including the personal links that have no shift" do
    login = SmsMessage.create!(member: member, kind: :member_login)
    text_in(group, rota: rota, member: member)

    rows = log(kind: "member_login")

    expect(rows.map { |row| row.fetch("id") }).to eq([ login.id ])
    expect(rows.first).to include("shift" => nil)
  end

  it "filters by member and by rota" do
    other_member = create(:member, group: group)
    other_rota = create(:rota, group: group, name: "Recycling")
    mine = text_in(group, rota: rota, member: member)
    theirs = text_in(group, rota: other_rota, member: other_member)

    expect(log(member_id: member.id).map { |row| row.fetch("id") }).to eq([ mine.id ])
    expect(log(rota_id: other_rota.id).map { |row| row.fetch("id") }).to eq([ theirs.id ])
  end

  it "pages the same way, and refuses to be talked into an unbounded query" do
    3.times { text_in(group, rota: rota, member: member) }

    expect(log(limit: 2).size).to eq(2)
    expect(log(limit: 10_000).size).to eq(3)
  end

  it "answers 404 for a house that does not exist" do
    get "/api/super_admin/groups/0/sms_messages", headers: headers

    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body).to eq("error" => "not_found")
  end

  it "writes nothing" do
    text_in(group, rota: rota, member: member)

    writes = sql_writes_during { get "/api/super_admin/groups/#{group.id}/sms_messages", headers: headers }

    expect(response).to have_http_status(:ok)
    expect(writes).to be_empty
  end
end
