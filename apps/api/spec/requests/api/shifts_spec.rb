require "rails_helper"

RSpec.describe "Api::Shifts" do
  let(:group) { create(:group, workos_organization_id: "org_01FLAT") }
  def headers = workos_headers(org_id: group.workos_organization_id)

  def rostered_rota
    rota = create(:rota, :with_roster, group: group, roster_size: 3,
      starts_on: group.today, interval_unit: "day", interval_count: 1)
    ShiftGenerator.new(rota).call
    rota
  end

  describe "GET /api/rotas/:rota_id/shifts" do
    it "returns upcoming shifts, in date order, with assigned and covering members" do
      rota = rostered_rota
      shift = rota.shifts.future(group.today).first
      cover = create(:member, group: group, name: "Cover")
      shift.update!(covering_member_id: cover.id)

      get "/api/rotas/#{rota.id}/shifts", headers: headers

      expect(response).to have_http_status(:ok)
      body = response.parsed_body["shifts"]
      expect(body.map { |s| s["due_on"] }).to eq(body.map { |s| s["due_on"] }.sort)
      covered = body.find { |s| s["id"] == shift.id }
      expect(covered).to include("covered" => true)
      expect(covered["covering_member"]).to include("name" => "Cover")
      expect(covered["responsible_member"]["id"]).to eq(cover.id)
    end

    it "does not include past shifts" do
      rota = create(:rota, :with_roster, group: group, roster_size: 2,
        starts_on: 10.days.ago.to_date, interval_unit: "day", interval_count: 1)
      ShiftGenerator.new(rota).call

      get "/api/rotas/#{rota.id}/shifts", headers: headers

      due_dates = response.parsed_body["shifts"].map { |s| Date.parse(s["due_on"]) }
      expect(due_dates).to all(be >= group.today)
    end
  end

  # The house-wide read the dashboard makes (BLO-1697). It replaced one request per running rota,
  # so the things worth proving are the boundaries of "the house's running rotas" and that the cost
  # of the call does not move when the house gets busier.
  describe "GET /api/shifts" do
    let(:alice) { create(:member, group: group, name: "Alice") }
    let(:kitchen) { create(:rota, :with_roster, group: group, name: "Kitchen") }

    def shift_ids = response.parsed_body["shifts"].map { |shift| shift["id"] }

    it "returns every upcoming shift of the house, by due date then rota name, with both members" do
      bins = create(:rota, :with_roster, group: group, name: "Bins")
      same_day_kitchen = create(:shift, rota: kitchen, assigned_member: alice, due_on: 5.days.from_now.to_date)
      same_day_bins = create(:shift, rota: bins, assigned_member: alice, due_on: 5.days.from_now.to_date)
      earlier = create(:shift, rota: kitchen, assigned_member: alice, due_on: 2.days.from_now.to_date)
      cover = create(:member, group: group, name: "Cover")
      earlier.update!(covering_member_id: cover.id)

      get "/api/shifts", headers: headers

      expect(response).to have_http_status(:ok)
      expect(shift_ids).to eq([ earlier.id, same_day_bins.id, same_day_kitchen.id ])
      covered = response.parsed_body["shifts"].first
      expect(covered).to include("covered" => true, "rota_id" => kitchen.id)
      expect(covered["covering_member"]).to include("name" => "Cover")
      expect(covered["responsible_member"]["id"]).to eq(cover.id)
    end

    # The name has to travel WITH the shift. Resolving it client-side against a separately fetched
    # rotas list dropped every turn of a rota whose state moved between the two calls.
    it "names the rota each shift belongs to, which is how the dashboard labels a turn" do
      shift = create(:shift, rota: kitchen, assigned_member: alice, due_on: 3.days.from_now.to_date)

      get "/api/shifts", headers: headers

      expect(response.parsed_body["shifts"].first).to include(
        "id" => shift.id, "rota_id" => kitchen.id, "rota_name" => "Kitchen"
      )
    end

    it "answers with an empty list for a house whose rotas are all draft or paused" do
      create(:rota, group: group, name: "Draft")
      create(:rota, :with_roster, :inactive, group: group, name: "Paused")

      get "/api/shifts", headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq({ "shifts" => [] })
    end

    it "never returns another house's shifts" do
      other = create(:group, workos_organization_id: "org_01OTHER")
      other_rota = create(:rota, :with_roster, group: other, name: "Theirs")
      create(:shift, rota: other_rota, assigned_member: create(:member, group: other),
        due_on: 3.days.from_now.to_date)
      mine = create(:shift, rota: kitchen, assigned_member: alice, due_on: 3.days.from_now.to_date)

      get "/api/shifts", headers: headers

      expect(shift_ids).to eq([ mine.id ])
    end

    it "excludes the shifts of an inactive rota and of a draft one" do
      paused = create(:rota, :with_roster, :inactive, group: group, name: "Paused")
      create(:shift, rota: paused, assigned_member: alice, due_on: 3.days.from_now.to_date)
      # No roster at all, so Rota#draft? is true: nothing is scheduled on it yet.
      draft = create(:rota, group: group, name: "Draft")
      create(:shift, rota: draft, assigned_member: alice, due_on: 3.days.from_now.to_date)
      running = create(:shift, rota: kitchen, assigned_member: alice, due_on: 3.days.from_now.to_date)

      get "/api/shifts", headers: headers

      expect(shift_ids).to eq([ running.id ])
    end

    # The window is cut on the GROUP's calendar day, never UTC. 00:30 UTC on 2 March is still
    # 1 March in New York, so a UTC "today" would drop a turn the house can still see coming.
    it "includes today's shift and excludes yesterday's, on the group's own calendar" do
      group.update!(timezone: "America/New_York")
      today = create(:shift, rota: kitchen, assigned_member: alice, due_on: Date.new(2026, 3, 1))
      create(:shift, rota: kitchen, assigned_member: alice, due_on: Date.new(2026, 2, 28))

      travel_to Time.utc(2026, 3, 2, 0, 30) do
        get "/api/shifts", headers: headers
      end

      expect(shift_ids).to eq([ today.id ])
    end

    # The assertion that matters for the ticket: the dashboard used to pay a request AND a query
    # batch per rota. That the count does not MOVE when the house gains rotas and shifts is the
    # actual invariant, so it is asserted first. The ceiling underneath it is the second half of
    # the claim: an invariant count of forty would still be flat and still be wrong, and only an
    # absolute number catches a preload quietly turning into a per-row load that happens to scale
    # with something this example does not vary. Eight at the time of writing (the auth lookups,
    # the running-rota probe with its rosters, the shifts, and one preload each for the two members
    # and the rota); the margin is there so an unrelated authentication query is not a failure.
    it "costs the same eight queries for five rotas as for one" do
      busy_house = ->(names) {
        names.each do |name|
          rota = create(:rota, :with_roster, group: group, name: name)
          3.times { |n| create(:shift, rota: rota, assigned_member: alice, due_on: (n + 1).days.from_now.to_date) }
        end
      }

      busy_house.call(%w[Bins])
      # One warm-up request first: the first authenticated call of an example also provisions the
      # admin's own rows, and those lookups would otherwise be counted into the small run alone.
      get "/api/shifts", headers: headers
      small = sql_selects_during { get "/api/shifts", headers: headers }
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["shifts"].size).to eq(3)

      busy_house.call(%w[Bathroom Hoovering Kitchen Recycling])
      big = sql_selects_during { get "/api/shifts", headers: headers }

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["shifts"].size).to eq(15)
      expect(big.size).to eq(small.size)
      expect(small.size).to be <= 10
    end
  end

  describe "PATCH /api/shifts/:id — admin override" do
    it "sets a cover on a future shift" do
      rota = rostered_rota
      shift = rota.shifts.future(group.today).first
      cover = create(:member, group: group)

      patch "/api/shifts/#{shift.id}", params: { covering_member_id: cover.id }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(shift.reload.covering_member_id).to eq(cover.id)
      expect(response.parsed_body["shift"]["responsible_member"]["id"]).to eq(cover.id)
    end

    it "clears a cover when covering_member_id is null" do
      rota = rostered_rota
      shift = rota.shifts.future(group.today).first
      shift.update!(covering_member_id: create(:member, group: group).id)

      patch "/api/shifts/#{shift.id}", params: { covering_member_id: nil }, headers: headers, as: :json

      expect(response).to have_http_status(:ok)
      expect(shift.reload.covering_member_id).to be_nil
    end

    it "refuses to rewrite a past shift" do
      rota = create(:rota, :with_roster, group: group, roster_size: 2,
        starts_on: 10.days.ago.to_date, interval_unit: "day", interval_count: 1)
      ShiftGenerator.new(rota).call
      past = rota.shifts.where(shifts: { due_on: ...group.today }).first
      cover = create(:member, group: group)

      patch "/api/shifts/#{past.id}", params: { covering_member_id: cover.id }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("shift_in_the_past")
      expect(past.reload.covering_member_id).to be_nil
    end

    it "refuses to hand a shift to a member who has been removed" do
      rota = rostered_rota
      shift = rota.shifts.future(group.today).first
      gone = create(:member, :inactive, group: group)

      patch "/api/shifts/#{shift.id}", params: { covering_member_id: gone.id }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("member_inactive")
    end

    it "refuses a cover equal to the assignee (the model's own rule)" do
      rota = rostered_rota
      shift = rota.shifts.future(group.today).first

      patch "/api/shifts/#{shift.id}", params: { covering_member_id: shift.assigned_member_id }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("validation_failed")
    end

    # The override goes through ShiftCover's rota lock, and re-reads the shift FOR UPDATE inside it —
    # so a regeneration that deletes the shift the instant the override takes the lock is a 404, not a
    # silent UPDATE of zero rows returning 200 for a shift that no longer exists. Simulate the delete
    # at lock-acquisition; without the lock (a plain update!) this returns 200. See ShiftCover and its
    # spec for the real two-thread proof; this asserts the admin path is on the shared lock.
    it "404s when the shift is deleted by a regeneration as the override takes the lock" do
      rota = rostered_rota
      shift = rota.shifts.future(group.today).first
      cover = create(:member, group: group)

      first = true
      allow_any_instance_of(Rota).to receive(:with_lock).and_wrap_original do |original, &block|
        if first
          first = false
          Shift.where(id: shift.id).delete_all
        end
        original.call(&block)
      end

      patch "/api/shifts/#{shift.id}", params: { covering_member_id: cover.id }, headers: headers

      expect(response).to have_http_status(:not_found)
    end
  end
end
