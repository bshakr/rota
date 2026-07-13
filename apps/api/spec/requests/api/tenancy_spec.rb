require "rails_helper"

# THE security test, at the request level. tenant_scoped_spec proves the mechanism on an anonymous
# controller; this proves every real admin endpoint inherits it. Alpha's admin is correctly
# authenticated and reaching for Bravo's things by naming Bravo's ids explicitly — the interesting
# case, because the id is real and the token is valid. Every reach must answer 404, exactly as it
# would for an id that never existed, and Bravo's data must be untouched.
RSpec.describe "Api admin tenancy" do
  let(:alpha) { create(:group, workos_organization_id: "org_01ALPHA", name: "Alpha House") }
  let(:bravo) { create(:group, workos_organization_id: "org_01BRAVO", name: "Bravo House") }
  def as_alpha = workos_headers(org_id: alpha.workos_organization_id, sub: "user_01ALICE")

  # A fully populated Bravo: a member, a rostered rota with a materialised window, and a delivery log.
  let!(:bravo_member) { create(:member, group: bravo, name: "Bravo Bob") }
  let!(:bravo_rota) do
    rota = create(:rota, :with_roster, group: bravo, roster_size: 2,
      starts_on: bravo.today, interval_unit: "day", interval_count: 1)
    ShiftGenerator.new(rota).call
    rota
  end
  let(:bravo_shift) { bravo_rota.shifts.future(bravo.today).first }

  describe "members" do
    it "lists only Alpha's own members" do
      create(:member, group: alpha, name: "Alpha Alice")

      get "/api/members", headers: as_alpha

      expect(response.parsed_body["members"].map { |m| m["name"] }).to eq([ "Alpha Alice" ])
    end

    it "cannot read-through, update, deactivate or rotate a Bravo member" do
      patch "/api/members/#{bravo_member.id}", params: { name: "Owned" }, headers: as_alpha
      expect(response).to have_http_status(:not_found)

      post "/api/members/#{bravo_member.id}/rotate_link", headers: as_alpha
      expect(response).to have_http_status(:not_found)

      delete "/api/members/#{bravo_member.id}", headers: as_alpha
      expect(response).to have_http_status(:not_found)

      expect(bravo_member.reload).to have_attributes(name: "Bravo Bob", active: true)
    end
  end

  describe "rotas" do
    it "cannot read, edit, delete, re-roster, list shifts of, or preview a Bravo rota" do
      get "/api/rotas/#{bravo_rota.id}", headers: as_alpha
      expect(response).to have_http_status(:not_found)

      patch "/api/rotas/#{bravo_rota.id}", params: { name: "Owned" }, headers: as_alpha
      expect(response).to have_http_status(:not_found)

      put "/api/rotas/#{bravo_rota.id}/positions", params: { member_ids: [ bravo_member.id ] }, headers: as_alpha, as: :json
      expect(response).to have_http_status(:not_found)

      get "/api/rotas/#{bravo_rota.id}/shifts", headers: as_alpha
      expect(response).to have_http_status(:not_found)

      post "/api/rotas/#{bravo_rota.id}/preview_message", headers: as_alpha
      expect(response).to have_http_status(:not_found)

      delete "/api/rotas/#{bravo_rota.id}", headers: as_alpha
      expect(response).to have_http_status(:not_found)

      expect(bravo_rota.reload).to have_attributes(name: bravo_rota.name, active: true)
    end
  end

  describe "shifts" do
    it "cannot override a Bravo shift by naming its id" do
      alpha_cover = create(:member, group: alpha)

      patch "/api/shifts/#{bravo_shift.id}", params: { covering_member_id: alpha_cover.id }, headers: as_alpha

      expect(response).to have_http_status(:not_found)
      expect(bravo_shift.reload.covering_member_id).to be_nil
    end
  end

  describe "a cross-tenant id is indistinguishable from one that never existed" do
    it "answers a Bravo rota id exactly as it answers a nonexistent id" do
      get "/api/rotas/#{bravo_rota.id}", headers: as_alpha
      cross_tenant = [ response.status, response.body ]

      get "/api/rotas/0", headers: as_alpha

      expect([ response.status, response.body ]).to eq(cross_tenant)
    end
  end
end
