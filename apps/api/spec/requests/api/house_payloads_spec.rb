require "rails_helper"

# `groups.notes` is the operator's private note about a house — "trial house for the school run",
# "suspended for non-payment, emailed 14 Sep" — and `groups.suspended_at` is a decision made about
# the house rather than by it. Neither belongs to the house, and neither may ever be served to it.
#
# That is kept true structurally rather than by care: SuperAdmin::GroupSerializer is a different
# class from the house-facing GroupSerializer, so the house side has nowhere to put these fields even
# by accident. This spec is the proof, and it is written against the payloads rather than the
# serializer so a controller that decided to render the record directly would trip it too.
RSpec.describe "House-facing payloads and the operator's columns" do
  let(:group) do
    create(:group, workos_organization_id: "org_01FLAT", name: "Alma Road",
      notes: "Trial house for the school run", suspended_at: nil)
  end
  let!(:member) { create(:member, group: group, name: "Alice") }

  def admin_headers = workos_headers(sub: "user_01ALICE", org_id: group.workos_organization_id, role: "admin")

  # Checked as substrings of the raw body, not as missing keys, so a field renamed or nested one
  # level down is caught just the same.
  def expect_no_operator_columns
    expect(response).to have_http_status(:ok)
    expect(response.body).not_to include("notes")
    expect(response.body).not_to include("Trial house for the school run")
    expect(response.body).not_to include("suspended")
  end

  it "keeps them out of GET /api/me" do
    get "/api/me", headers: admin_headers

    expect_no_operator_columns
  end

  it "keeps them out of GET /api/group" do
    get "/api/group", headers: admin_headers

    expect_no_operator_columns
    expect(response.parsed_body.fetch("group")).to include("name" => "Alma Road")
  end

  it "keeps them out of what PATCH /api/group answers with" do
    patch "/api/group", params: { name: "Alma Road" }, headers: admin_headers

    expect_no_operator_columns
  end

  # The house's own settings API may not be talked into writing either of them, whatever it is sent.
  it "will not let a house admin set them" do
    patch "/api/group",
      params: { name: "Alma Road", notes: "mine now", suspended_at: nil },
      headers: admin_headers

    expect(group.reload.notes).to eq("Trial house for the school run")
  end

  it "keeps them out of the public household entry page" do
    get "/public/households/#{group.slug}"

    expect_no_operator_columns
  end

  it "keeps them out of the member magic-link payload" do
    get "/api/member/schedule", headers: member_headers(member)

    expect_no_operator_columns
  end

  # And the structural reason all of the above hold: the house's serializer does not have the fields.
  it "is a serializer that cannot carry them, not a controller that remembers not to" do
    expect(GroupSerializer.one(group).keys).not_to include(:notes, :suspended_at)
  end
end
