require "rails_helper"

# GET /api/member/shifts — the read surface of the member magic-link path. Everything here is about
# one guarantee: a token can see its own member's shifts and the people who could cover them, and
# nothing else. The token arrives as a bearer header; see token_privacy_spec for why that matters.
RSpec.describe "GET /api/member/shifts" do
  let(:group) { create(:group) }
  let(:alice) { create(:member, group: group, name: "Alice") }
  let(:rota) { create(:rota, group: group, name: "Kitchen") }

  def parsed_shift(id)
    response.parsed_body["shifts"].find { |shift| shift["id"] == id }
  end

  it "returns the member's own upcoming shifts, and only theirs" do
    mine = create(:shift, rota: rota, assigned_member: alice, due_on: 3.days.from_now.to_date)
    someone_else = create(:shift, rota: rota, assigned_member: create(:member, group: group),
      due_on: 4.days.from_now.to_date)

    get "/api/member/shifts", headers: member_headers(alice)

    expect(response).to have_http_status(:ok)
    ids = response.parsed_body["shifts"].map { |shift| shift["id"] }
    expect(ids).to include(mine.id)
    expect(ids).not_to include(someone_else.id)
    expect(response.parsed_body["member"]).to eq("id" => alice.id, "name" => "Alice")
  end

  it "does not return past shifts" do
    create(:shift, :past, rota: rota, assigned_member: alice)

    get "/api/member/shifts", headers: member_headers(alice)

    expect(response.parsed_body["shifts"]).to be_empty
  end

  it "returns shifts the member is covering for someone else" do
    covered = create(:shift, rota: rota, assigned_member: create(:member, group: group),
      covering_member: alice, due_on: 5.days.from_now.to_date)

    get "/api/member/shifts", headers: member_headers(alice)

    shift = parsed_shift(covered.id)
    expect(shift).to be_present
    expect(shift["covered"]).to be(true)
    expect(shift["responsible_member"]).to eq("id" => alice.id, "name" => "Alice")
    # Alice is covering, so she may hand it on but she is not the original, so she cannot take it back.
    expect(shift["can_assign_cover"]).to be(true)
    expect(shift["can_cancel_cover"]).to be(false)
  end

  it "still shows a shift the member has handed off, so they can take it back" do
    bob = create(:member, group: group, name: "Bob")
    handed_off = create(:shift, rota: rota, assigned_member: alice, covering_member: bob,
      due_on: 6.days.from_now.to_date)

    get "/api/member/shifts", headers: member_headers(alice)

    shift = parsed_shift(handed_off.id)
    expect(shift).to be_present
    expect(shift["covering_member"]).to eq("id" => bob.id, "name" => "Bob")
    # Alice is the original assignee of a covered shift: she can take it back, but she is not currently
    # responsible, so she cannot hand it on again without cancelling first.
    expect(shift["can_cancel_cover"]).to be(true)
    expect(shift["can_assign_cover"]).to be(false)
  end

  it "marks an uncovered future shift as one the responsible member can hand on" do
    mine = create(:shift, rota: rota, assigned_member: alice, due_on: 3.days.from_now.to_date)

    get "/api/member/shifts", headers: member_headers(alice)

    shift = parsed_shift(mine.id)
    expect(shift["can_assign_cover"]).to be(true)
    expect(shift["can_cancel_cover"]).to be(false)
  end

  it "shows today's shift but does not allow it to be handed on" do
    today = create(:shift, rota: rota, assigned_member: alice, due_on: group.today)

    get "/api/member/shifts", headers: member_headers(alice)

    shift = parsed_shift(today.id)
    expect(shift).to be_present
    expect(shift["can_assign_cover"]).to be(false)
  end

  describe "the coverable members list" do
    it "lists the contactable members of the group, excluding the member themselves" do
      bob = create(:member, group: group, name: "Bob")
      cara = create(:member, group: group, name: "Cara")

      get "/api/member/shifts", headers: member_headers(alice)

      names = response.parsed_body["coverable_members"].map { |member| member["name"] }
      expect(names).to contain_exactly("Bob", "Cara")
      expect(response.parsed_body["coverable_members"]).to include("id" => bob.id, "name" => "Bob")
      expect(response.parsed_body["coverable_members"]).to include("id" => cara.id, "name" => "Cara")
    end

    it "excludes inactive and opted-out members, who cannot be texted a cover notice" do
      create(:member, group: group, name: "Bob")
      create(:member, :inactive, group: group, name: "Idle")
      create(:member, :opted_out, group: group, name: "Quiet")

      get "/api/member/shifts", headers: member_headers(alice)

      names = response.parsed_body["coverable_members"].map { |member| member["name"] }
      expect(names).to contain_exactly("Bob")
    end

    it "never lists a member of another group" do
      create(:member, group: group, name: "Bob")
      create(:member, group: create(:group), name: "Stranger")

      get "/api/member/shifts", headers: member_headers(alice)

      names = response.parsed_body["coverable_members"].map { |member| member["name"] }
      expect(names).to contain_exactly("Bob")
    end
  end

  describe "tenancy" do
    it "cannot see another group's shifts" do
      other_group = create(:group)
      other_member = create(:member, group: other_group)
      other_rota = create(:rota, group: other_group)
      create(:shift, rota: other_rota, assigned_member: other_member, due_on: 3.days.from_now.to_date)

      get "/api/member/shifts", headers: member_headers(alice)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["shifts"]).to be_empty
    end
  end

  describe "authentication" do
    it "refuses a request with no token" do
      get "/api/member/shifts"

      expect(response).to have_http_status(:unauthorized)
      expect(response.parsed_body).to eq("error" => "unauthorized")
    end

    it "refuses an unknown token" do
      get "/api/member/shifts", headers: { "Authorization" => "Bearer not-a-real-token" }

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses an Authorization header that is not a bearer token" do
      get "/api/member/shifts", headers: { "Authorization" => "Basic #{Base64.strict_encode64('a:b')}" }

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses the empty string as a token rather than matching a member" do
      get "/api/member/shifts", headers: { "Authorization" => "Bearer " }

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
