require "rails_helper"

# PATCH /api/super_admin/groups/:id — rename a house, set its timezone, keep a note about it.
#
# Two of the three are things a house admin can already do for themselves; the operator can do them
# because the commonest support conversation is "our reminders come an hour early", and the fix is a
# timezone the house has never confirmed. The third, `notes`, exists only here.
RSpec.describe "PATCH /api/super_admin/groups/:id" do
  let(:operator) { "user_01OPERATOR" }
  let(:group) { create(:group, name: "Alma Road", timezone: "UTC") }

  before { allowlist_super_admins(operator) }

  def headers = workos_headers(sub: operator, org_id: nil)

  def update(params, id = group.id)
    patch "/api/super_admin/groups/#{id}", params: params, headers: headers
    response.parsed_body
  end

  it "renames a house" do
    body = update(name: "Flat 3, Alma Road")

    expect(response).to have_http_status(:ok)
    expect(group.reload.name).to eq("Flat 3, Alma Road")
    expect(body.fetch("group")).to include("name" => "Flat 3, Alma Road")
  end

  # Renaming never touches the slug — it is attr_readonly on the model — so every link the house has
  # handed out, including the household entry page its members were texted, goes on working.
  it "leaves the slug, and therefore every link, alone" do
    expect { update(name: "Something Else") }.not_to change { group.reload.slug }
  end

  describe "the timezone" do
    # The same rule as the house's own PATCH (Api::GroupController): the presence of the param is a
    # human saying "I checked", and a super admin setting it counts as a human confirming it.
    it "sets it and stamps it as confirmed" do
      body = update(timezone: "Europe/London")

      expect(group.reload.timezone).to eq("Europe/London")
      expect(group.timezone_confirmed_at).to be_present
      expect(body.fetch("group")).to include("timezone" => "Europe/London", "timezone_confirmed" => true)
    end

    # "I checked, UTC is right" is exactly the confirmation the NULL was waiting for, so the stamp
    # keys off the param being sent and not off the value moving.
    it "stamps it as confirmed even when the value has not changed" do
      update(timezone: "UTC")

      expect(group.reload.timezone).to eq("UTC")
      expect(group.timezone_confirmed_at).to be_present
    end

    it "leaves an unconfirmed house unconfirmed when the timezone is not part of the request" do
      update(name: "Renamed")

      expect(group.reload.timezone_confirmed_at).to be_nil
    end

    it "refuses a zone nobody has heard of, in the API's own error shape" do
      body = update(timezone: "Mars/Olympus")

      expect(response).to have_http_status(:unprocessable_content)
      expect(body).to include("error" => "validation_failed")
      expect(body.fetch("fields")).to include("timezone" => [ "is not a recognised time zone" ])
      expect(group.reload.timezone).to eq("UTC")
    end
  end

  describe "notes" do
    it "keeps the operator's note" do
      body = update(notes: "Trial house for the school run")

      expect(group.reload.notes).to eq("Trial house for the school run")
      expect(body.fetch("group")).to include("notes" => "Trial house for the school run")
    end

    # A cleared box is no note rather than an empty one, so "has this house got a note" stays one
    # question and not two.
    it "clears back to nothing when the box is emptied" do
      group.update!(notes: "Something")

      update(notes: "")

      expect(group.reload.notes).to be_nil
    end

    # A column with no ceiling is one somebody eventually pastes a log file into, and this one is
    # rendered in full on the group page. Same precedent as Rota#message_template.
    it "refuses a note longer than the model allows, and keeps the old one" do
      group.update!(notes: "Short")

      body = update(notes: "x" * (Group::NOTES_MAX + 1))

      expect(response).to have_http_status(:unprocessable_content)
      expect(body).to include("error" => "validation_failed")
      expect(body.fetch("fields")).to have_key("notes")
      expect(group.reload.notes).to eq("Short")
    end

    it "accepts a note right up to the ceiling" do
      update(notes: "x" * Group::NOTES_MAX)

      expect(response).to have_http_status(:ok)
      expect(group.reload.notes.length).to eq(Group::NOTES_MAX)
    end

    it "leaves an existing note alone when the request does not mention it" do
      group.update!(notes: "Bassem's own")

      update(name: "Renamed")

      expect(group.reload.notes).to eq("Bassem's own")
    end
  end

  it "refuses a name the model rejects, and changes nothing" do
    body = update(name: "")

    expect(response).to have_http_status(:unprocessable_content)
    expect(body).to include("error" => "validation_failed")
    expect(group.reload.name).to eq("Alma Road")
  end

  # Only the three. A PATCH that could reach `slug`, `workos_organization_id` or `suspended_at`
  # would be a way to rename a house's links, point it at another WorkOS organization, or pause it
  # through the endpoint that is not the one with the audit line on it.
  it "ignores anything it was not asked to change" do
    original = group.workos_organization_id

    update(name: "Renamed", slug: "stolen-slug", workos_organization_id: "org_01ELSEWHERE",
      suspended_at: 1.day.ago, timezone_confirmed_at: 1.day.ago)

    expect(group.reload).to have_attributes(
      name: "Renamed", workos_organization_id: original, suspended_at: nil, timezone_confirmed_at: nil
    )
    expect(group.slug).not_to eq("stolen-slug")
  end

  it "answers 404 for an id that names no house" do
    update({ name: "Nobody" }, 0)

    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body).to eq("error" => "not_found")
  end

  # The audit of who renamed a house, or confirmed its timezone, is the log line — there is no row
  # for a super admin to point a foreign key at.
  describe "the line it writes to the log" do
    before { allow(Rails.logger).to receive(:info).and_call_original }

    def logged = Rails.logger

    # A list of field names cannot answer the question anyone actually asks of an audit afterwards,
    # which is what the value used to be.
    it "names the operator, the house, and both transitions" do
      update(name: "Renamed", timezone: "Europe/London")

      expect(logged).to have_received(:info).with(
        Regexp.new(%(Super admin #{operator} updated group #{group.id} \\(#{group.slug}\\): ) +
                   %(name "Alma Road" -> "Renamed"; timezone "UTC" -> "Europe/London" \\(confirmed\\)))
      )
    end

    it "mentions only the fields the request actually carried" do
      update(name: "Renamed")

      expect(logged).to have_received(:info).with(/updated group .*: name "Alma Road" -> "Renamed"\z/)
    end

    # A note is free text about a house and the people in it — "chasing them about the card that
    # keeps declining". The application log is neither the place for that nor covered by the same
    # handling the column is, so the line says only that a note was written.
    it "says a note changed, and never what it says" do
      update(notes: "Chasing them about the card that keeps declining")

      expect(logged).to have_received(:info).with(/updated group .*: notes replaced\z/)
      expect(logged).not_to have_received(:info).with(/declining/)
    end

    it "says so when a note was cleared" do
      group.update!(notes: "Something")

      update(notes: "")

      expect(logged).to have_received(:info).with(/updated group .*: notes cleared\z/)
    end
  end

  # Every row on the list, including the ones the operator cannot change here, so the page merges
  # one shape into what it is already showing rather than learning a second per action.
  it "answers with the whole row the list and the detail page carry" do
    running_rota(group)

    expect(update(name: "Renamed").fetch("group")).to include(
      "id" => group.id, "status" => "live", "suspended_at" => nil, "running_rotas_count" => 1
    )
  end
end
