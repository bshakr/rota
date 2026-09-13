require "rails_helper"

# POST and DELETE /api/super_admin/groups/:id/suspend — the operator's one lever over a house.
#
# What setting the flag DOES is five refusals spread across the app, and they are tested where they
# happen: spec/requests/suspended_house_spec.rb and the three recurring job specs. What is here is
# the endpoint itself — that it sets and clears the flag, that it is idempotent in both directions,
# and that it says who did it.
RSpec.describe "Super admin suspension" do
  let(:operator) { "user_01OPERATOR" }
  let(:group) { create(:group, name: "Alma Road") }

  before { allowlist_super_admins(operator) }

  def headers = workos_headers(sub: operator, org_id: nil)

  def suspend(id = group.id)
    post "/api/super_admin/groups/#{id}/suspend", headers: headers
    response.parsed_body
  end

  def resume(id = group.id)
    delete "/api/super_admin/groups/#{id}/suspend", headers: headers
    response.parsed_body
  end

  describe "POST" do
    it "pauses the house and says so in the row it answers with" do
      body = suspend

      expect(response).to have_http_status(:ok)
      expect(group.reload.suspended?).to be(true)
      expect(body.fetch("group")).to include("id" => group.id, "status" => "suspended")
      expect(Time.zone.parse(body.fetch("group").fetch("suspended_at"))).to be_within(5.seconds).of(Time.current)
    end

    # A retry, a double-click, or a second operator on the same button. Moving "paused since" would
    # rewrite the one fact anybody asks about a paused house.
    it "is idempotent, and does not move the moment it was paused" do
      travel_to(3.days.ago) { suspend }
      paused_at = group.reload.suspended_at

      suspend

      expect(response).to have_http_status(:ok)
      expect(group.reload.suspended_at).to be_within(1.second).of(paused_at)
    end

    it "answers 404 for an id that names no house" do
      suspend(0)

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to eq("error" => "not_found")
    end

    # The audit trail: there is no row for a super admin, so the log line naming their verified
    # WorkOS `sub` is the whole of it.
    it "names the operator in the log" do
      allow(Rails.logger).to receive(:info).and_call_original

      suspend

      expect(Rails.logger).to have_received(:info)
        .with(/Super admin #{operator} suspended: group #{group.id} \(#{group.slug}\)/)
    end
  end

  describe "DELETE" do
    it "lets the house go again" do
      group.update!(suspended_at: 2.days.ago)

      body = resume

      expect(response).to have_http_status(:ok)
      expect(group.reload.suspended?).to be(false)
      expect(body.fetch("group")).to include("suspended_at" => nil)
      expect(body.fetch("group").fetch("status")).not_to eq("suspended")
    end

    it "is idempotent on a house that was never paused" do
      resume

      expect(response).to have_http_status(:ok)
      expect(group.reload.suspended_at).to be_nil
    end

    it "answers 404 for an id that names no house" do
      resume(0)

      expect(response).to have_http_status(:not_found)
    end

    it "names the operator in the log" do
      group.update!(suspended_at: 2.days.ago)
      allow(Rails.logger).to receive(:info).and_call_original

      resume

      expect(Rails.logger).to have_received(:info).with(/Super admin #{operator} resumed: group #{group.id}/)
    end
  end

  # Both actions answer the same shape PATCH and the list answer, so the page merges one row into
  # what it is already showing rather than learning a shape per action.
  it "answers with the whole row, counts and all" do
    running_rota(group)
    text_in(group, at: 1.day.ago)

    expect(suspend.fetch("group")).to include(
      "id" => group.id, "name" => "Alma Road", "slug" => group.slug,
      "running_rotas_count" => 1, "texts_last_7_days" => 1, "notes" => nil
    )
  end

  # A house admin who is not the operator must not find this button, and must not be able to reach
  # it by guessing the path. The walker in spec/requests/super_admin/authorization_spec.rb covers
  # every route under the namespace; this pins the one that writes.
  it "is refused, and writes nothing, for a caller who is not on the allowlist" do
    house_admin = workos_headers(sub: "user_01ALICE", org_id: group.workos_organization_id, role: "admin")

    post "/api/super_admin/groups/#{group.id}/suspend", headers: house_admin

    expect(response).to have_http_status(:not_found)
    expect(group.reload.suspended_at).to be_nil
  end
end
