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
    end

    it "rejects an unknown placeholder in the template" do
      params = { name: "Bad", message_template: "Hi {{nmae}}", starts_on: group.today.to_s,
                 interval_count: 1, interval_unit: "week" }

      post "/api/rotas", params: params, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["fields"]).to have_key("message_template")
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

    it "rejects an in-progress template with an unknown placeholder, without saving it" do
      rota = rostered_rota
      original = rota.message_template

      post "/api/rotas/#{rota.id}/preview_message", params: { message_template: "Hi {{nmae}}" }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["fields"]).to have_key("message_template")
      expect(rota.reload.message_template).to eq(original)
    end

    it "explains when the group has no member to preview against" do
      rota = create(:rota, group: group) # draft, and the group has no members

      post "/api/rotas/#{rota.id}/preview_message", headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("no_member_to_preview")
    end
  end
end
