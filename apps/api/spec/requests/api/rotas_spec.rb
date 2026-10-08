require "rails_helper"

RSpec.describe "Api::Rotas" do
  let(:group) { create(:group, workos_organization_id: "org_01FLAT") }
  def headers = workos_headers(org_id: group.workos_organization_id)

  # A rota with a real roster and a materialised window, the way the API leaves it after create.
  def rostered_rota(**overrides)
    rota = create(:rota, :with_roster, group: group, roster_size: 3,
      starts_on: group.today, interval_unit: "day", interval_count: 1, **overrides)
    ShiftGenerator.new(rota).call
    rota
  end

  describe "GET /api/rotas" do
    it "lists the group's rotas with their draft state" do
      create(:rota, group: group, name: "Bins")                      # no roster => draft
      rostered_rota(name: "Kitchen")

      get "/api/rotas", headers: headers

      expect(response).to have_http_status(:ok)
      by_name = response.parsed_body["rotas"].index_by { |r| r["name"] }
      expect(by_name["Bins"]["draft"]).to be(true)
      expect(by_name["Kitchen"]["draft"]).to be(false)
    end
  end

  describe "GET /api/rotas/:id" do
    it "returns the rota with its ordered roster" do
      rota = rostered_rota
      order = rota.rota_positions.order(:position).map(&:member_id)

      get "/api/rotas/#{rota.id}", headers: headers

      expect(response.parsed_body["rota"]["positions"].map { |p| p["member_id"] }).to eq(order)
    end
  end

  describe "POST /api/rotas" do
    it "creates a draft rota" do
      params = { name: "Recycling", message_template: "Hi {{name}}, {{rota}} on {{date}}.",
                 starts_on: group.today.to_s, interval_count: 1, interval_unit: "week", send_hour: 9, reminder_offsets: [ 1 ] }

      expect { post "/api/rotas", params: params, headers: headers }.to change(group.rotas, :count).by(1)

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["rota"]).to include("name" => "Recycling", "draft" => true)
      # The previous web build's shape still works for one release: one reminder per offset.
      expect(response.parsed_body["rota"]["reminders"]).to match([
        { "id" => kind_of(Integer), "days_before" => 1, "message_template" => "Hi {{name}}, {{rota}} on {{date}}." }
      ])
    end

    it "rejects an unknown placeholder in the template, against the reminder it would become" do
      params = { name: "Bad", message_template: "Hi {{nmae}}", starts_on: group.today.to_s,
                 interval_count: 1, interval_unit: "week", reminder_offsets: [ 3 ] }

      post "/api/rotas", params: params, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["fields"]).to have_key("reminders[0].message_template")
    end

    def new_rota(reminders)
      { name: "Bins", starts_on: group.today.to_s, interval_count: 1, interval_unit: "week", send_hour: 9,
        reminders: reminders }
    end

    it "creates a rota with its reminders, returned furthest-out first" do
      post "/api/rotas", params: new_rota([
        { days_before: -1, message_template: "Thanks {{name}}" },
        { days_before: 3, message_template: "Soon {{name}}" },
        { days_before: 0, message_template: "Today {{name}}" },
        { days_before: 0, message_template: "Also today {{name}}" }
      ]), headers: headers, as: :json

      expect(response).to have_http_status(:created)
      reminders = response.parsed_body["rota"]["reminders"]
      expect(reminders.map { |reminder| reminder.values_at("days_before", "message_template") }).to eq([
        [ 3, "Soon {{name}}" ], [ 0, "Today {{name}}" ], [ 0, "Also today {{name}}" ], [ -1, "Thanks {{name}}" ]
      ])
      expect(reminders.map { |reminder| reminder["id"] }).to eq(Rota.last.reminders.map(&:id))
    end

    it "reports each invalid reminder under its submitted position, and saves nothing" do
      expect {
        post "/api/rotas", params: new_rota([
          { days_before: 3, message_template: "Fine {{name}}" },
          { days_before: -15, message_template: "Hi {{nmae}}" }
        ]), headers: headers, as: :json
      }.not_to change(Rota, :count)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["fields"].keys).to contain_exactly(
        "reminders[1].days_before", "reminders[1].message_template"
      )
    end

    it "refuses more than ten reminders" do
      post "/api/rotas", params: new_rota(Array.new(11) { { days_before: 0, message_template: "Hi" } }),
        headers: headers, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["fields"]).to have_key("reminders")
    end
  end

  describe "PATCH /api/rotas/:id — reminders" do
    let(:rota) { create(:rota, group: group, reminder_days: [ 3, 0 ]) }
    let!(:three_day) { rota.reminders.find { |reminder| reminder.days_before == 3 } }
    let!(:day_of) { rota.reminders.find { |reminder| reminder.days_before == 0 } }

    def patch_rota(params)
      patch "/api/rotas/#{rota.id}", params: params, headers: headers, as: :json
    end

    it "replaces the list: updates by id, creates without one, destroys what is left out" do
      patch_rota(reminders: [
        { id: three_day.id, days_before: 2, message_template: "Two days {{name}}" },
        { days_before: -1, message_template: "Thanks {{name}}" }
      ])

      expect(response).to have_http_status(:ok)
      reminders = response.parsed_body["rota"]["reminders"]
      expect(reminders.first).to eq("id" => three_day.id, "days_before" => 2, "message_template" => "Two days {{name}}")
      expect(reminders.second).to include("days_before" => -1, "message_template" => "Thanks {{name}}")
      expect(RotaReminder.exists?(day_of.id)).to be(false)
    end

    it "leaves the reminders alone when the key is absent" do
      patch_rota(name: "Renamed")

      expect(response).to have_http_status(:ok)
      expect(rota.reminders.reload.map(&:id)).to eq([ three_day.id, day_of.id ])
    end

    it "removes every reminder for an empty list" do
      patch_rota(reminders: [])

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["rota"]["reminders"]).to eq([])
      expect(rota.reminders.reload).to be_empty
    end

    it "refuses a null list rather than reading it as empty" do
      patch_rota(reminders: nil)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["fields"]).to have_key("reminders")
      expect(rota.reminders.reload.map(&:id)).to eq([ three_day.id, day_of.id ])
    end

    # A second admin's save that committed after this request read the list but before it wrote.
    it "replaces the list as it stands once the rota is locked, never merging into a stale read" do
      nine = create(:rota, group: group, reminder_days: (1..9).to_a)
      allow_any_instance_of(Api::RotasController).to receive(:find_rota).and_wrap_original do |original|
        original.call.tap { |found| create(:rota_reminder, rota: Rota.find(found.id), days_before: 20) }
      end
      submitted = nine.reminders.map { |reminder| reminder.slice(:id, :days_before, :message_template) }

      patch "/api/rotas/#{nine.id}", params: { reminders: submitted + [ { days_before: 0, message_template: "New" } ] },
        headers: headers, as: :json

      expect(response).to have_http_status(:ok)
      expect(nine.reminders.reload.map(&:days_before)).to eq([ 9, 8, 7, 6, 5, 4, 3, 2, 1, 0 ])
    end

    it "refuses a reminder id from another house's rota, and changes nothing" do
      foreign = create(:rota).reminders.first

      patch_rota(reminders: [
        { id: day_of.id, days_before: 0, message_template: "Changed" },
        { id: foreign.id, days_before: 1, message_template: "Stolen" }
      ])

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["fields"]).to have_key("reminders[1].id")
      expect(foreign.reload.message_template).not_to eq("Stolen")
      expect(day_of.reload.message_template).not_to eq("Changed")
      expect(rota.reminders.reload.size).to eq(2)
    end

    it "reports errors by submitted position when new, updated and omitted reminders are mixed" do
      patch_rota(reminders: [
        { days_before: 1, message_template: "New {{name}}" },
        { id: day_of.id, days_before: 0, message_template: "Hi {{nmae}}" },
        { days_before: "soon", message_template: "Also new" }
      ])

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["fields"].keys).to contain_exactly(
        "reminders[1].message_template", "reminders[2].days_before"
      )
      expect(rota.reminders.reload.map(&:id)).to eq([ three_day.id, day_of.id ])
    end

    it "maps the previous web build's offsets onto the reminders already at those timings" do
      patch_rota(reminder_offsets: [ 0, 7 ], message_template: "Old form {{name}}")

      expect(response).to have_http_status(:ok)
      reminders = rota.reminders.reload
      expect(reminders.map(&:days_before)).to eq([ 7, 0 ])
      expect(reminders.last.id).to eq(day_of.id)
      expect(reminders.map(&:message_template)).to all(eq("Old form {{name}}"))
      expect(RotaReminder.exists?(three_day.id)).to be(false)
    end

    it "keeps a legacy template-only edit on the existing timings" do
      patch_rota(message_template: "Reworded {{name}}")

      expect(response).to have_http_status(:ok)
      expect(rota.reminders.reload.map { |reminder| [ reminder.id, reminder.message_template ] }).to eq([
        [ three_day.id, "Reworded {{name}}" ], [ day_of.id, "Reworded {{name}}" ]
      ])
    end

    it "changes no reminder when a schedule change is sent without confirm" do
      patch_rota(starts_on: (rota.starts_on + 2).to_s, reminders: [])

      expect(response).to have_http_status(:unprocessable_content)
      expect(rota.reminders.reload.map(&:id)).to eq([ three_day.id, day_of.id ])
    end
  end

  describe "PATCH /api/rotas/:id — a plain edit" do
    it "renames without touching shifts" do
      rota = rostered_rota
      expect {
        patch "/api/rotas/#{rota.id}", params: { name: "Kitchen deep clean" }, headers: headers
      }.not_to change { rota.shifts.count }

      expect(response).to have_http_status(:ok)
      expect(rota.reload.name).to eq("Kitchen deep clean")
    end
  end

  describe "PATCH /api/rotas/:id — a schedule change" do
    # A covered future shift, so the warning has something to name and the mutation has something to
    # drop.
    def rota_with_a_cover
      rota = rostered_rota
      shift = rota.shifts.future(group.today).first
      shift.update!(covering_member_id: create(:member, group: group).id)
      [ rota, shift ]
    end

    it "without confirm, returns the warning and mutates NOTHING" do
      rota, shift = rota_with_a_cover
      before = rota.shifts.order(:due_on).pluck(:id, :due_on, :covering_member_id)

      patch "/api/rotas/#{rota.id}", params: { starts_on: (group.today + 2).to_s }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("confirmation_required")
      expect(response.parsed_body["warning"]["dropped_covers"].map { |c| c["shift_id"] }).to include(shift.id)
      # Nothing moved: not the rota, not a single shift.
      expect(rota.reload.starts_on).to eq(group.today)
      expect(rota.shifts.order(:due_on).pluck(:id, :due_on, :covering_member_id)).to eq(before)
    end

    it "with confirm: true, applies the change and drops the covers" do
      rota, shift = rota_with_a_cover

      patch "/api/rotas/#{rota.id}", params: { starts_on: (group.today + 2).to_s, confirm: true }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(rota.reload.starts_on).to eq(group.today + 2)
      expect(response.parsed_body["regeneration"]["dropped_covers"].map { |c| c["shift_id"] }).to include(shift.id)
      expect { shift.reload }.to raise_error(ActiveRecord::RecordNotFound) # the old-series shift is gone
    end
  end

  describe "DELETE /api/rotas/:id" do
    it "soft-deactivates, preserving shift history" do
      rota = rostered_rota
      shift_count = rota.shifts.count

      expect { delete "/api/rotas/#{rota.id}", headers: headers }.not_to change(Rota, :count)

      expect(response).to have_http_status(:ok)
      expect(rota.reload.active).to be(false)
      expect(rota.shifts.count).to eq(shift_count) # history stands
    end

    # Deactivation is reversible and lossless: the sweep and the daily top-up both scope to
    # Rota.active, so a deactivated rota simply goes quiet — its already-generated shifts are left
    # exactly where they are, and flipping active back on brings the whole thing back untouched.
    it "is reversible via PATCH active: true, with its future shifts intact" do
      rota = rostered_rota
      delete "/api/rotas/#{rota.id}", headers: headers
      shift_ids = rota.shifts.order(:due_on).pluck(:id)

      patch "/api/rotas/#{rota.id}", params: { active: true }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(rota.reload.active).to be(true)
      expect(rota.shifts.order(:due_on).pluck(:id)).to eq(shift_ids)
    end
  end

  describe "POST /api/rotas/:id/preview_message" do
    it "renders the saved template against a real member, magic link included" do
      rota = rostered_rota
      member = rota.members.first

      post "/api/rotas/#{rota.id}/preview_message", params: { member_id: member.id }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["preview"]).to include(member.name).and include("/s/#{member.access_token}")
      expect(response.parsed_body["member"]["id"]).to eq(member.id)
    end

    it "renders an in-progress template so the editor previews what is being typed" do
      rota = rostered_rota

      post "/api/rotas/#{rota.id}/preview_message",
        params: { message_template: "New wording for {{rota}}" }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["preview"]).to include("New wording for #{rota.name}")
    end

    it "previews {{days_until}} as it will read on the day a given reminder goes out" do
      rota = rostered_rota
      template = "{{days_until}}"

      post "/api/rotas/#{rota.id}/preview_message",
        params: { message_template: template, days_before: 2 }, headers: headers
      expect(response.parsed_body["preview"]).to start_with("in 2 days")

      post "/api/rotas/#{rota.id}/preview_message",
        params: { message_template: template, days_before: -1 }, headers: headers
      expect(response.parsed_body["preview"]).to start_with("1 day ago")

      post "/api/rotas/#{rota.id}/preview_message", params: { message_template: template }, headers: headers
      expect(response.parsed_body["preview"]).to start_with("today")
    end

    it "rejects a timing out of range" do
      rota = rostered_rota

      post "/api/rotas/#{rota.id}/preview_message", params: { days_before: -15 }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["fields"]).to have_key("days_before")
    end

    it "rejects an in-progress template with an unknown placeholder, without saving it" do
      rota = rostered_rota
      original = rota.reminders.first.message_template

      post "/api/rotas/#{rota.id}/preview_message", params: { message_template: "Hi {{nmae}}" }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["fields"]).to have_key("message_template")
      expect(rota.reminders.reload.first.message_template).to eq(original)
    end

    it "explains when the group has no member to preview against" do
      rota = create(:rota, group: group) # draft, and the group has no members

      post "/api/rotas/#{rota.id}/preview_message", headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("no_member_to_preview")
    end
  end
end
