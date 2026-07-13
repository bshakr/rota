require "rails_helper"

RSpec.describe "Api::RotaPositions" do
  let(:group) { create(:group, workos_organization_id: "org_01FLAT") }
  def headers = workos_headers(org_id: group.workos_organization_id)

  def rostered_rota
    rota = create(:rota, :with_roster, group: group, roster_size: 3,
      starts_on: group.today, interval_unit: "day", interval_count: 1)
    ShiftGenerator.new(rota).call
    rota
  end

  describe "PUT /api/rotas/:rota_id/positions" do
    it "sets the roster in the given order" do
      rota = create(:rota, group: group)
      alice = create(:member, group: group, name: "Alice")
      bob = create(:member, group: group, name: "Bob")

      put "/api/rotas/#{rota.id}/positions", params: { member_ids: [ bob.id, alice.id ] }, headers: headers, as: :json

      expect(response).to have_http_status(:ok)
      expect(rota.reload.rota_positions.order(:position).map(&:member_id)).to eq([ bob.id, alice.id ])
      expect(response.parsed_body["rota"]["positions"].map { |p| p["member_id"] }).to eq([ bob.id, alice.id ])
    end

    # The acceptance criterion, asserted end to end: reordering the roster regenerates future shifts
    # but leaves a shift someone already agreed to cover exactly as it stands.
    it "preserves a covered future shift when the roster is reordered" do
      rota = rostered_rota
      order = rota.rota_positions.order(:position).map(&:member_id)
      covered = rota.shifts.future(group.today).first
      cover = create(:member, group: group)
      covered.update!(covering_member_id: cover.id)

      put "/api/rotas/#{rota.id}/positions", params: { member_ids: order.reverse }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(covered.reload.covering_member_id).to eq(cover.id)
      expect(rota.reload.rota_positions.order(:position).map(&:member_id)).to eq(order.reverse)
    end

    it "empties the roster and returns the rota to draft on an empty array" do
      rota = rostered_rota

      put "/api/rotas/#{rota.id}/positions", params: { member_ids: [] }, headers: headers, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["rota"]["draft"]).to be(true)
    end

    it "rejects a member id that is not in the group" do
      rota = create(:rota, group: group)
      stranger = create(:member) # another group entirely

      put "/api/rotas/#{rota.id}/positions", params: { member_ids: [ stranger.id ] }, headers: headers, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(rota.reload.rota_positions).to be_empty
    end

    it "is a bad request when member_ids is missing entirely" do
      rota = create(:rota, group: group)

      put "/api/rotas/#{rota.id}/positions", headers: headers

      expect(response).to have_http_status(:bad_request)
      expect(response.parsed_body["error"]).to eq("parameter_missing")
    end
  end
end
