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

    # Nothing stops a house having two Sams, and `ORDER BY name` on its own cannot tell them apart:
    # Postgres is then free to return the pair in whichever order it happened to read them, so the
    # people list can reshuffle between two identical requests. Ordering by id after name pins it.
    # This is a tie main did not break either; it is broken now (BLO-1698).
    it "keeps two housemates who share a name in the same order on every request" do
      first_sam = create(:member, group: group, name: "Sam")
      second_sam = create(:member, group: group, name: "Sam")
      # An update rewrites the row at the end of the heap, so a scan now reads the two Sams in the
      # opposite order to the one they were created in. That is all it takes for a tie-blind ORDER BY
      # to hand them back the other way round, which is the thing this example is here to catch.
      first_sam.touch

      ids = Array.new(2) do
        get_schedule
        response.parsed_body["members"].map { |m| m["id"] }
      end

      expect(ids.uniq.size).to eq(1)
      expect(ids.first).to eq([ alice.id, first_sam.id, second_sam.id ])
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

    # The payload's people list and its shifts are two different sets, and this is the row where they
    # come apart. A housemate who has left is gone from `members`, because they do not live here any
    # more, but the shift they agreed to cover before they went still names them: somebody has to be
    # shown as responsible for it. Removal (MemberRemoval) drops a leaver's covers on STRICTLY FUTURE
    # shifts only. Today's is already in motion and its reminder has gone out, so this is a state a
    # real house can be in between a removal and the end of the day.
    #
    # The controller attaches these members from the ones it has already loaded, which is why it
    # loads the whole house and not the active list: indexing only the actives would miss this row.
    it "still names a housemate who has since been removed on the shift they were covering" do
      gone = create(:member, group: group, name: "Gone")
      shift = create(:shift, rota: kitchen, assigned_member: alice, covering_member: gone,
        due_on: group.today)
      gone.update!(active: false)

      get_schedule

      expect(parsed_shift(shift.id)).to eq(
        "id" => shift.id,
        "rota_id" => kitchen.id,
        "rota_name" => "Kitchen",
        "due_on" => shift.due_on.iso8601,
        "covered" => true,
        "assigned_member" => { "id" => alice.id, "name" => "Alice" },
        "covering_member" => { "id" => gone.id, "name" => "Gone" },
        "responsible_member" => { "id" => gone.id, "name" => "Gone" },
        "can_assign_cover" => false,
        "can_cancel_cover" => false
      )
      expect(response.parsed_body["members"].map { |m| m["name"] }).not_to include("Gone")
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

  # The house calendar (BLO-1667). Events ride in the shifts payload because the member page draws
  # one chronological feed: "Alfie is in Greece all week" is the reason a shift is being handed off,
  # and a second request for it would arrive after the rows had already been painted.
  describe "the house calendar" do
    let(:connection) { create(:calendar_connection, group: group) }

    # Every example below reads the feed from the same afternoon, so "today" is a fixed date rather
    # than whatever the suite happens to run on. 12:00 UTC is 13:00 in London: the same day either
    # way, so the assertions are about the window and not about a timezone edge.
    def get_schedule_on_september_13(member = alice)
      travel_to(Time.utc(2026, 9, 13, 12, 0)) { get_schedule(member) }
    end

    def event_titles
      response.parsed_body["events"].map { |event| event["title"] }
    end

    it "is an empty list when the house has connected no calendar" do
      get_schedule

      expect(response.parsed_body["events"]).to eq([])
    end

    it "carries the whole member-facing shape, and nothing the admin preview adds" do
      away = create(:calendar_event, calendar_connection: connection, summary: "Alfie in Greece",
        kind: "away", all_day: true, reason: "A trip to Greece, so Alfie is away",
        starts_on: Date.new(2026, 9, 25), ends_on: Date.new(2026, 10, 1))
      CalendarEventMember.create!(calendar_event: away, member: bob)

      get_schedule_on_september_13

      # An exact hash, not `include`: the member payload is a privacy boundary (spec section 13) and
      # `reason`, the model's sentence about a housemate's private trip, must not ride along.
      expect(response.parsed_body["events"]).to eq([ {
        "id" => away.id,
        "title" => "Alfie in Greece",
        "starts_on" => "2026-09-25",
        "ends_on" => "2026-10-01",
        "all_day" => true,
        "start_time" => nil,
        "kind" => "away",
        "member_ids" => [ bob.id ]
      } ])
    end

    it "renders a timed start as the wall clock the house wrote down, in the group's zone" do
      # 18:00 UTC on 1 October is 19:00 in London, which is the time the dinner was put in the
      # calendar as. The member reads their own clock, never the database's.
      create(:calendar_event, calendar_connection: connection, summary: "House dinner at home",
        all_day: false, starts_on: Date.new(2026, 10, 1), ends_on: Date.new(2026, 10, 1),
        starts_at: Time.utc(2026, 10, 1, 18, 0), ends_at: Time.utc(2026, 10, 1, 20, 30))

      get_schedule_on_september_13

      expect(response.parsed_body["events"].first)
        .to include("kind" => "event", "all_day" => false, "start_time" => "19:00")
    end

    it "orders by date and then by the clock, with all-day rows last on a day they share" do
      create(:calendar_event, calendar_connection: connection, summary: "Bin day", all_day: true,
        starts_on: Date.new(2026, 10, 1), ends_on: Date.new(2026, 10, 1))
      create(:calendar_event, calendar_connection: connection, summary: "House dinner at home",
        all_day: false, starts_on: Date.new(2026, 10, 1), ends_on: Date.new(2026, 10, 1),
        starts_at: Time.utc(2026, 10, 1, 18, 0), ends_at: Time.utc(2026, 10, 1, 20, 30))
      create(:calendar_event, calendar_connection: connection, summary: "Alfie in Greece", kind: "away",
        starts_on: Date.new(2026, 9, 25), ends_on: Date.new(2026, 10, 1))
      create(:calendar_event, calendar_connection: connection, summary: "Landlord visit",
        all_day: false, starts_on: Date.new(2026, 10, 1), ends_on: Date.new(2026, 10, 1),
        starts_at: Time.utc(2026, 10, 1, 9, 30), ends_at: Time.utc(2026, 10, 1, 10, 0))

      get_schedule_on_september_13

      # A row with no clock has nothing to sort by, so it settles after the appointments of its day.
      expect(event_titles)
        .to eq([ "Alfie in Greece", "Landlord visit", "House dinner at home", "Bin day" ])
    end

    it "keeps an event that is still running today and drops one that has already finished" do
      create(:calendar_event, calendar_connection: connection, summary: "Deep clean week",
        starts_on: Date.new(2026, 9, 8), ends_on: Date.new(2026, 9, 13))
      create(:calendar_event, calendar_connection: connection, summary: "August bank holiday",
        starts_on: Date.new(2026, 8, 31), ends_on: Date.new(2026, 9, 12))

      get_schedule_on_september_13

      expect(event_titles).to eq([ "Deep clean week" ])
    end

    it "shows an event still waiting on a verdict as a plain event with nobody away" do
      # Pending is not a third kind: until the classifier answers it is stored as an ordinary event
      # with an empty roster, so the feed shows the title and claims nothing about who is away.
      pending_event = create(:calendar_event, calendar_connection: connection, summary: "Sofia to Lisbon",
        classified_at: nil, kind: "event",
        starts_on: Date.new(2026, 9, 20), ends_on: Date.new(2026, 9, 24))

      get_schedule_on_september_13

      expect(response.parsed_body["events"])
        .to eq([ { "id" => pending_event.id, "title" => "Sofia to Lisbon", "starts_on" => "2026-09-20",
                   "ends_on" => "2026-09-24", "all_day" => true, "start_time" => nil,
                   "kind" => "event", "member_ids" => [] } ])
    end

    it "never carries another house's events, even when both houses have a calendar" do
      create(:calendar_event, calendar_connection: connection, summary: "Our bin day",
        starts_on: Date.new(2026, 9, 20), ends_on: Date.new(2026, 9, 20))
      create(:calendar_event, calendar_connection: create(:calendar_connection), summary: "Their bin day",
        starts_on: Date.new(2026, 9, 20), ends_on: Date.new(2026, 9, 20))

      get_schedule_on_september_13

      expect(event_titles).to eq([ "Our bin day" ])
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

  # This is the member page's ONLY read, so what it costs is what the page costs. The action loads
  # the house's rotas and the house's people up front and then attaches them to the shifts from
  # memory; the numbers below are what says it is still doing that and has not quietly gone back to
  # asking Postgres for rows it is already holding (BLO-1698).
  describe "what it costs" do
    it "reads the rotas once and the members twice, however many shifts there are" do
      bins = create(:rota, :with_roster, group: group, name: "Bins")
      12.times do |n|
        create(:shift, rota: n.even? ? kitchen : bins, assigned_member: n.even? ? alice : bob,
          covering_member: n == 3 ? alice : nil, due_on: n.days.from_now.to_date)
      end

      selects = sql_selects_during { get_schedule }

      expect(response).to have_http_status(:ok)
      # One: `visible_rotas`. The shifts query mentions rotas in a JOIN, which is not a second read.
      expect(selects.grep(/FROM "rotas"/).size).to eq(1)
      # Two, and only two: the token resolving to the caller, and the house's people. The shifts'
      # assigned and covering members come out of that second one.
      expect(selects.grep(/FROM "members"/).size).to eq(2)
    end

    it "costs the same for a house with one shift as for a house with a dozen" do
      create(:shift, rota: kitchen, assigned_member: alice, due_on: 1.day.from_now.to_date)
      small = sql_selects_during { get_schedule }.size

      11.times { |n| create(:shift, rota: kitchen, assigned_member: bob, due_on: (n + 2).days.from_now.to_date) }
      big = sql_selects_during { get_schedule }.size

      expect(big).to eq(small)
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
