require "rails_helper"

RSpec.describe "Api::Members" do
  let(:group) { create(:group, workos_organization_id: "org_01FLAT") }
  def headers = workos_headers(org_id: group.workos_organization_id)

  describe "GET /api/members" do
    it "lists the group's members by name" do
      create(:member, group: group, name: "Bob")
      create(:member, group: group, name: "Alice")

      get "/api/members", headers: headers

      expect(response).to have_http_status(:ok)
      names = response.parsed_body["members"].map { |m| m["name"] }
      expect(names).to eq(%w[Alice Bob])
    end

    it "carries the magic-link token and the contactable flag" do
      member = create(:member, group: group)

      get "/api/members", headers: headers

      expect(response.parsed_body["members"].first)
        .to include("access_token" => member.access_token, "contactable" => true)
    end
  end

  describe "POST /api/members" do
    it "creates a member and normalises the phone to E.164" do
      expect {
        post "/api/members", params: { name: "Dave", phone_e164: "07400 123999" }, headers: headers
      }.to change(group.members, :count).by(1)

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["member"]).to include("name" => "Dave", "phone_e164" => "+447400123999")
    end

    it "rejects an undialable number with a structured error" do
      post "/api/members", params: { name: "Dave", phone_e164: "12345" }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("validation_failed")
      expect(response.parsed_body["fields"]).to have_key("phone_e164")
    end
  end

  describe "PATCH /api/members/:id" do
    it "updates the member's name" do
      member = create(:member, group: group, name: "Bob")

      patch "/api/members/#{member.id}", params: { name: "Bobby" }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(member.reload.name).to eq("Bobby")
    end
  end

  describe "POST /api/members/:id/rotate_link" do
    it "rotates the access token, voiding the old magic link" do
      member = create(:member, group: group)
      old = member.access_token

      post "/api/members/#{member.id}/rotate_link", headers: headers

      expect(response).to have_http_status(:ok)
      expect(member.reload.access_token).not_to eq(old)
      expect(response.parsed_body["member"]["access_token"]).to eq(member.access_token)
    end
  end

  describe "DELETE /api/members/:id" do
    it "deactivates rather than destroys" do
      member = create(:member, group: group)

      expect { delete "/api/members/#{member.id}", headers: headers }.not_to change(Member, :count)

      expect(response).to have_http_status(:ok)
      expect(member.reload.active).to be(false)
      expect(response.parsed_body["member"]).to include("active" => false)
    end

    # A daily rota with a real roster and its 90-day window materialised — the same window the API
    # generates on create, which the factory alone does not.
    def rostered_rota
      rota = create(:rota, :with_roster, group: group, roster_size: 3,
        starts_on: group.today, interval_unit: "day", interval_count: 1)
      ShiftGenerator.new(rota).call
      rota
    end

    # The acceptance criterion: the response names every future turn that will be redistributed and
    # every cover the member had agreed to that will be undone.
    it "enumerates the future turns that get reassigned to the people who remain" do
      rota = rostered_rota
      leaving = rota.rota_positions.order(:position).first.member

      delete "/api/members/#{leaving.id}", headers: headers

      reassigned = response.parsed_body["reassigned_shifts"]
      expect(reassigned).to be_present
      expect(reassigned).to all(include("rota_id" => rota.id))
      # Every reassigned turn now belongs to somebody still in the house, not the departing member.
      expect(reassigned.map { |s| s["now_assigned_member_id"] }).not_to include(leaving.id)
    end

    it "names the covers the member had agreed to take for other people, and undoes them" do
      rota = rostered_rota
      leaving = create(:member, group: group, name: "Zed")
      # A future shift assigned to someone else, that Zed had agreed to cover.
      shift = rota.shifts.future(group.today).first
      shift.update!(covering_member_id: leaving.id)

      delete "/api/members/#{leaving.id}", headers: headers

      dropped = response.parsed_body["dropped_covers"]
      expect(dropped).to contain_exactly(
        hash_including(
          "shift_id" => shift.id,
          "reverts_to_member_id" => shift.assigned_member_id,
          "reverts_to_member_name" => shift.assigned_member.name
        )
      )
      expect(shift.reload.covering_member_id).to be_nil
    end

    it "preserves a future shift that someone else is covering for the departing member" do
      rota = rostered_rota
      leaving = rota.rota_positions.order(:position).first.member
      # A shift assigned to the leaver, but someone else agreed to cover it — that agreement stands.
      covered = rota.shifts.future(group.today).find { |s| s.assigned_member_id == leaving.id }
      cover = create(:member, group: group)
      covered.update!(covering_member_id: cover.id)

      delete "/api/members/#{leaving.id}", headers: headers

      expect(covered.reload.covering_member_id).to eq(cover.id)
    end
  end
end
