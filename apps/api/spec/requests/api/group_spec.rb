require "rails_helper"

# Group settings — the small screen that carries the timezone, on which every reminder time depends.
RSpec.describe "Api::Group" do
  let(:group) { create(:group, workos_organization_id: "org_01FLAT", name: "Flat 3", timezone: "UTC") }
  def headers = workos_headers(org_id: group.workos_organization_id)

  describe "GET /api/group" do
    it "returns the group's own settings" do
      group.update!(timezone: "Europe/London", timezone_confirmed_at: Time.current)

      get "/api/group", headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["group"]).to include(
        "id" => group.id, "name" => "Flat 3", "timezone" => "Europe/London", "timezone_confirmed" => true
      )
    end

    it "reports a provisional timezone as unconfirmed" do
      get "/api/group", headers: headers

      expect(response.parsed_body["group"]).to include("timezone_confirmed" => false, "timezone_confirmed_at" => nil)
    end

    it "is refused without a token" do
      get "/api/group"

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "PATCH /api/group" do
    it "updates the name" do
      patch "/api/group", params: { name: "Flat 3, Alma Road" }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(group.reload.name).to eq("Flat 3, Alma Road")
    end

    it "sets the timezone and stamps it as confirmed" do
      freeze_time do
        patch "/api/group", params: { timezone: "Europe/London" }, headers: headers

        expect(response).to have_http_status(:ok)
        expect(group.reload.timezone).to eq("Europe/London")
        expect(group.timezone_confirmed_at).to eq(Time.current)
      end
    end

    it "warns that reminder times move when the timezone changes" do
      patch "/api/group", params: { timezone: "Europe/London" }, headers: headers

      expect(response.parsed_body["warning"]).to include("timezone_changed" => true)
    end

    # The whole point of the stamp: a human confirming the guessed UTC is exactly the confirmation the
    # NULL was waiting for, even though nothing about the value changed. And with the value unchanged,
    # nothing moves, so there is no warning.
    it "stamps confirmation even when the timezone value is unchanged, without warning" do
      expect { patch "/api/group", params: { timezone: "UTC" }, headers: headers }
        .to change { group.reload.timezone_confirmed_at }.from(nil)

      expect(response.parsed_body).not_to have_key("warning")
    end

    it "leaves the timezone unconfirmed when only the name is changed" do
      patch "/api/group", params: { name: "Renamed" }, headers: headers

      expect(group.reload.timezone_confirmed_at).to be_nil
    end

    it "rejects an unrecognised timezone with a structured error" do
      patch "/api/group", params: { timezone: "Mars/Olympus_Mons" }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("validation_failed")
      expect(response.parsed_body["fields"]).to have_key("timezone")
      expect(group.reload.timezone).to eq("UTC")
    end
  end
end
