require "rails_helper"

# GET /api/member/schedule — the whole upcoming rota for this member's HOUSE, not just their own
# turns. It is the member page's only read. Everything here is one guarantee: a token sees its own
# group's people, rotas and upcoming shifts, and nothing of any other group's.
RSpec.describe "GET /api/member/schedule" do
  let(:group) { create(:group, timezone: "Europe/London") }
  let(:alice) { create(:member, group: group, name: "Alice") }
  let(:bob) { create(:member, group: group, name: "Bob") }
  let(:kitchen) { create(:rota, :with_roster, group: group, name: "Kitchen") }

  def get_schedule(member = alice)
    get "/api/member/schedule", headers: member_headers(member)
  end

  def parsed_shift(id)
    response.parsed_body["shifts"].find { |shift| shift["id"] == id }
  end

  describe "the group's calendar" do
    it "returns the group's own today and timezone, never UTC" do
      # 00:30 UTC on 2 March is still 1 March in New York: a UTC "today" would be a day ahead.
      group.update!(timezone: "America/New_York")
      travel_to Time.utc(2026, 3, 2, 0, 30) do
        get_schedule

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["today"]).to eq("2026-03-01")
        expect(response.parsed_body["timezone"]).to eq("America/New_York")
      end
    end

    it "names the calling member" do
      get_schedule

      expect(response.parsed_body["member"]).to eq("id" => alice.id, "name" => "Alice")
    end
  end

  describe "the people" do
    it "lists every active member of the group including the viewer, ordered by name" do
      create(:member, group: group, name: "Cara")
      create(:member, group: group, name: "Bob")

      get_schedule

      expect(response.parsed_body["members"].map { |m| m["name"] }).to eq(%w[Alice Bob Cara])
    end

    it "marks an opted-out member as not contactable, but still lists them" do
      create(:member, :opted_out, group: group, name: "Quiet")

      get_schedule

      quiet = response.parsed_body["members"].find { |m| m["name"] == "Quiet" }
      expect(quiet).to eq("id" => Member.find_by(name: "Quiet").id, "name" => "Quiet",
        "contactable" => false)
      expect(response.parsed_body["members"].find { |m| m["name"] == "Alice" }["contactable"]).to be(true)
    end

    it "excludes a deactivated member — they are no longer part of the house" do
      create(:member, :inactive, group: group, name: "Gone")

      get_schedule

      expect(response.parsed_body["members"].map { |m| m["name"] }).not_to include("Gone")
    end

    it "never lists a member of another group" do
      create(:member, group: create(:group), name: "Stranger")

      get_schedule

      expect(response.parsed_body["members"].map { |m| m["name"] }).not_to include("Stranger")
    end
  end

  describe "the rotas" do
    it "lists the group's active, rostered rotas ordered by name" do
      create(:rota, :with_roster, group: group, name: "Bins")
      kitchen

      get_schedule

      expect(response.parsed_body["rotas"].map { |r| r["name"] }).to eq(%w[Bins Kitchen])
      expect(response.parsed_body["rotas"].first.keys).to contain_exactly("id", "name")
    end

    it "excludes a draft rota — an empty roster means nothing is scheduled yet" do
      create(:rota, group: group, name: "Draft")
      kitchen

      get_schedule

      expect(response.parsed_body["rotas"].map { |r| r["name"] }).to eq(%w[Kitchen])
    end

    it "excludes an inactive rota" do
      create(:rota, :with_roster, :inactive, group: group, name: "Paused")
      kitchen

      get_schedule

      expect(response.parsed_body["rotas"].map { |r| r["name"] }).to eq(%w[Kitchen])
    end

    it "never lists another group's rota" do
      create(:rota, :with_roster, group: create(:group), name: "Someone else's bins")
      kitchen

      get_schedule

      expect(response.parsed_body["rotas"].map { |r| r["name"] }).to eq(%w[Kitchen])
    end
  end

  describe "the shifts" do
    it "returns every housemate's upcoming shift, not just the viewer's" do
      mine = create(:shift, rota: kitchen, assigned_member: alice, due_on: 3.days.from_now.to_date)
      theirs = create(:shift, rota: kitchen, assigned_member: bob, due_on: 4.days.from_now.to_date)

      get_schedule

      ids = response.parsed_body["shifts"].map { |shift| shift["id"] }
      expect(ids).to include(mine.id, theirs.id)
    end

    it "includes today's shift and excludes yesterday's" do
      today = create(:shift, rota: kitchen, assigned_member: bob, due_on: group.today)
      create(:shift, :past, rota: kitchen, assigned_member: bob)

      get_schedule

      expect(response.parsed_body["shifts"].map { |s| s["id"] }).to eq([ today.id ])
    end

    it "orders by due date, then rota name" do
      bins = create(:rota, :with_roster, group: group, name: "Bins")
      same_day_kitchen = create(:shift, rota: kitchen, assigned_member: alice,
        due_on: 5.days.from_now.to_date)
      same_day_bins = create(:shift, rota: bins, assigned_member: bob, due_on: 5.days.from_now.to_date)
      earlier = create(:shift, rota: kitchen, assigned_member: bob, due_on: 2.days.from_now.to_date)

      get_schedule

      expect(response.parsed_body["shifts"].map { |s| s["id"] })
        .to eq([ earlier.id, same_day_bins.id, same_day_kitchen.id ])
    end

    it "excludes the shifts of a draft or inactive rota" do
      paused = create(:rota, :with_roster, :inactive, group: group, name: "Paused")
      create(:shift, rota: paused, assigned_member: bob, due_on: 3.days.from_now.to_date)

      get_schedule

      expect(response.parsed_body["shifts"]).to be_empty
    end

    it "carries the full member-shift shape, with the rota named inline" do
      shift = create(:shift, rota: kitchen, assigned_member: alice, due_on: 3.days.from_now.to_date)

      get_schedule

      expect(parsed_shift(shift.id)).to eq(
        "id" => shift.id,
        "rota_id" => kitchen.id,
        "rota_name" => "Kitchen",
        "due_on" => shift.due_on.iso8601,
        "covered" => false,
        "assigned_member" => { "id" => alice.id, "name" => "Alice" },
        "covering_member" => nil,
        "responsible_member" => { "id" => alice.id, "name" => "Alice" },
        "can_assign_cover" => true,
        "can_cancel_cover" => false
      )
    end

    it "resolves the cover flags for the CALLER, not for whoever is on the shift" do
      handed_off = create(:shift, rota: kitchen, assigned_member: alice, covering_member: bob,
        due_on: 6.days.from_now.to_date)

      get_schedule(alice)
      as_alice = parsed_shift(handed_off.id)
      get_schedule(bob)
      as_bob = parsed_shift(handed_off.id)

      # Alice is the original assignee of a covered shift: she can take it back, not hand it on again.
      expect(as_alice["can_cancel_cover"]).to be(true)
      expect(as_alice["can_assign_cover"]).to be(false)
      # Bob is currently responsible: he can hand it on, but he is not the original, so he cannot cancel.
      expect(as_bob["can_assign_cover"]).to be(true)
      expect(as_bob["can_cancel_cover"]).to be(false)
    end

    it "offers no hand-off on today's shift, which is already in motion" do
      today = create(:shift, rota: kitchen, assigned_member: alice, due_on: group.today)

      get_schedule

      expect(parsed_shift(today.id)["can_assign_cover"]).to be(false)
    end
  end

  describe "tenancy" do
    it "returns nothing of another group's house" do
      other = create(:group)
      other_rota = create(:rota, :with_roster, group: other, name: "Their kitchen")
      other_member = create(:member, group: other, name: "Stranger")
      create(:shift, rota: other_rota, assigned_member: other_member, due_on: 3.days.from_now.to_date)
      kitchen

      get_schedule

      expect(response.parsed_body["shifts"]).to be_empty
      expect(response.parsed_body["members"].map { |m| m["name"] }).not_to include("Stranger")
      expect(response.parsed_body["rotas"].map { |r| r["name"] }).not_to include("Their kitchen")
    end
  end

  describe "authentication" do
    it "refuses a request with no token" do
      get "/api/member/schedule"

      expect(response).to have_http_status(:unauthorized)
      expect(response.parsed_body).to eq("error" => "unauthorized")
    end

    it "refuses an unknown token" do
      get "/api/member/schedule", headers: { "Authorization" => "Bearer not-a-real-token" }

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a token whose member has since been deactivated" do
      token = alice.access_token
      alice.update!(active: false)

      get "/api/member/schedule", headers: { "Authorization" => "Bearer #{token}" }

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
