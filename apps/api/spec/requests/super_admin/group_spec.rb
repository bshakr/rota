require "rails_helper"

# One house in full: the header the list already shows, plus the three tables an operator needs to
# answer "what is actually going on in here" — who administers it, who is on the rotas, and what
# the rotas are set to do.
RSpec.describe "GET /api/super_admin/groups/:id" do
  let(:operator) { "user_01OPERATOR" }
  let(:group) { create(:group, name: "Alma Road") }

  before { allowlist_super_admins(operator) }

  def headers = workos_headers(sub: operator, org_id: nil)

  def show(id = group.id)
    get "/api/super_admin/groups/#{id}", headers: headers
    response.parsed_body
  end

  it "carries the same header the list row does" do
    running_rota(group)
    text_in(group, at: 1.day.ago)

    expect(show.fetch("group")).to include(
      "id" => group.id, "name" => "Alma Road", "slug" => group.slug, "status" => "live",
      "running_rotas_count" => 1, "texts_last_7_days" => 1
    )
  end

  # The header the group page draws its actions from: the pill, when it was paused, and the note the
  # operator keeps about it. All three are operator-only — see spec/requests/api/house_payloads_spec.rb
  # for the house side of that line.
  it "carries the suspension state and the operator's note" do
    group.update!(suspended_at: Time.utc(2026, 9, 1, 12), notes: "Trial house for the school run")
    running_rota(group)

    expect(show.fetch("group")).to include(
      "status" => "suspended", "notes" => "Trial house for the school run"
    )
    expect(Time.zone.parse(show.fetch("group").fetch("suspended_at"))).to eq(Time.utc(2026, 9, 1, 12))
  end

  it "answers 404 for an id that names no house" do
    show(0)

    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body).to eq("error" => "not_found")
  end

  it "writes nothing" do
    group

    writes = sql_writes_during { get "/api/super_admin/groups/#{group.id}", headers: headers }

    expect(response).to have_http_status(:ok)
    expect(writes).to be_empty
  end

  describe "admins" do
    it "names each one, with the WorkOS role and the id to look them up by" do
      user = create(:user, name: "Ada Admin", email: "ada@example.com", workos_user_id: "user_01ADA")
      membership = create(:group_admin, group: group, user: user, role: "owner")

      expect(show.fetch("admins")).to eq([ {
        "id" => membership.id, "user_id" => user.id, "name" => "Ada Admin",
        "email" => "ada@example.com", "workos_user_id" => "user_01ADA", "role" => "owner"
      } ])
    end

    # WorkOS only sends an email if the JWT template was configured to; without one the row is
    # provisioned with a placeholder at an .invalid domain, and showing that would put an address
    # on screen that looks deliverable and is not.
    it "shows no email at all where the address is the JIT placeholder" do
      user = create(:user, email: User.placeholder_email("user_01NOEMAIL"), workos_user_id: "user_01NOEMAIL")
      create(:group_admin, group: group, user: user)

      expect(show.fetch("admins").first.fetch("email")).to be_nil
    end
  end

  describe "members" do
    it "carries the phone number in full and the rotas the member sits on" do
      member = create(:member, group: group, name: "Alice", phone_e164: "+447400123456")
      rota = create(:rota, group: group, name: "Bins")
      create(:rota_position, rota: rota, member: member, position: 0)

      expect(show.fetch("members")).to eq([ {
        "id" => member.id, "name" => "Alice", "phone_e164" => "+447400123456",
        "status" => "active", "sms_opted_out_at" => nil,
        "rotas" => [ { "id" => rota.id, "name" => "Bins" } ]
      } ])
    end

    it "says which of active, opted out and removed each member is" do
      create(:member, group: group, name: "Active One")
      create(:member, :opted_out, group: group, name: "Bowed Out")
      create(:member, :inactive, group: group, name: "Cleared Out")

      expect(show.fetch("members").map { |member| member.values_at("name", "status") }).to eq([
        [ "Active One", "active" ], [ "Bowed Out", "opted_out" ], [ "Cleared Out", "removed" ]
      ])
    end

    it "never carries an access token" do
      create(:member, group: group)

      expect(show.fetch("members").first.keys).not_to include("access_token")
    end
  end

  describe "rotas" do
    it "says whether each one is running, and what it is set to send" do
      rota = create(:rota, group: group, name: "Bins", reminder_offsets: [ 3, 0 ], send_hour: 8,
        interval_count: 2, interval_unit: "week", starts_on: Date.new(2026, 9, 7))
      create(:rota_position, rota: rota, member: create(:member, group: group), position: 0)
      create(:rota, group: group, name: "Zed draft")

      expect(show.fetch("rotas")).to match([
        {
          "id" => rota.id, "name" => "Bins", "active" => true, "draft" => false, "roster_size" => 1,
          "starts_on" => "2026-09-07", "interval_count" => 2, "interval_unit" => "week",
          "send_hour" => 8, "reminder_offsets" => [ 3, 0 ]
        },
        a_hash_including("name" => "Zed draft", "draft" => true, "roster_size" => 0)
      ])
    end
  end

  describe "the recent delivery log" do
    it "carries the newest texts, redacted, without asking for the whole log" do
      member = create(:member, group: group)
      rota = create(:rota, group: group)
      older = text_in(group, rota: rota, member: member, at: 2.days.ago)
      newer = text_in(group, rota: rota, member: member, at: 1.hour.ago)

      rows = show.fetch("recent_sms_messages")

      expect(rows.map { |row| row.fetch("id") }).to eq([ newer.id, older.id ])
    end

    it "is capped, so a busy house does not ship its whole history with the page" do
      member = create(:member, group: group)
      rota = create(:rota, group: group)
      (SuperAdmin::GroupsController::RECENT_SMS_LIMIT + 3).times { text_in(group, rota: rota, member: member) }

      expect(show.fetch("recent_sms_messages").size).to eq(SuperAdmin::GroupsController::RECENT_SMS_LIMIT)
    end
  end
end
