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
  end
end
