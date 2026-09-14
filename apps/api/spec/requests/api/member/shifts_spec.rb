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

    # `request.authorization`, which is what this path has always read the token with, looks in four
    # places: Authorization and the three proxy spellings a stripping or rewriting proxy can leave it
    # under. The throttle resolves the member before the controller does and the controller now
    # trusts its answer, so the two have to read the same four headers. When the throttle read only
    # HTTP_AUTHORIZATION, a token arriving in one of the other three resolved to nobody, the env said
    # so, and a housemate who authenticated fine yesterday got a 401 (BLO-1698). This is that
    # request.
    it "accepts a token a proxy left in X-HTTP_AUTHORIZATION" do
      get "/api/member/shifts", headers: { "X-HTTP_AUTHORIZATION" => "Bearer #{alice.access_token}" }

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["member"]).to eq("id" => alice.id, "name" => alice.name)
    end

    # The throttle on /api/member/* has to know which member is asking before it can key their
    # bucket, so by the time authentication runs the token has already been resolved once, against
    # the same scope, and left on the Rack env. Every member request used to pay for that lookup
    # twice (BLO-1698). One SELECT that mentions access_token, not two.
    it "resolves the token with a single members lookup" do
      # Outside the block on purpose: creating a member validates its token for uniqueness, which is
      # itself a SELECT mentioning access_token and has nothing to do with what is being counted.
      headers = member_headers(alice)

      selects = sql_selects_during { get "/api/member/shifts", headers: headers }

      expect(response).to have_http_status(:ok)
      expect(selects.grep(/"access_token"/).size).to eq(1)
    end

    # Deactivation is how a member is removed from a house, and it does NOT rotate the token. So the
    # removed housemate's magic link must stop working immediately — otherwise they keep reading the
    # roster and acting on shifts, which is the exact thing removal is meant to end.
    it "refuses a token whose member has since been deactivated" do
      member = create(:member, group: group)
      token = member.access_token
      member.update!(active: false)

      get "/api/member/shifts", headers: { "Authorization" => "Bearer #{token}" }

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
