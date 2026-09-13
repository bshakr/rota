require "rails_helper"

# "Did anyone actually open their link."
#
# The member path has no sign-in and no session, so a tap on a magic link is the only evidence a
# house's texts reach real people at all — which makes `members.last_seen_at` the one number that
# separates a house whose SMS is delivering from a house whose SMS is delivering into the void.
#
# It is written on a read path used by every housemate at once, minutes after a reminder blast, so
# it follows the admin path's rule exactly: at most one UPDATE an hour per member (see LastSeen).
RSpec.describe "A member's last_seen_at" do
  let(:member) { create(:member) }

  it "is recorded the first time a member opens their link" do
    expect(member.last_seen_at).to be_nil

    get "/api/member/shifts", headers: member_headers(member)

    expect(response).to have_http_status(:ok)
    expect(member.reload.last_seen_at).to be_within(1.second).of(Time.current)
  end

  it "is not written again within the hour" do
    get "/api/member/shifts", headers: member_headers(member)
    first_seen = member.reload.last_seen_at

    travel(59.minutes) { get "/api/member/shifts", headers: member_headers(member) }

    expect(member.reload.last_seen_at).to eq(first_seen)
  end

  it "is written again once the hour has passed" do
    get "/api/member/shifts", headers: member_headers(member)
    first_seen = member.reload.last_seen_at

    travel(61.minutes) { get "/api/member/shifts", headers: member_headers(member) }

    expect(member.reload.last_seen_at).to be > first_seen
  end

  # The same load argument as the admin path, and the reason the touch is throttled rather than
  # unconditional: a cover notice makes a whole house tap their link inside the same minute, and
  # each of them then refreshes. That must not become a write per request.
  it "costs no writes at all on a read within that hour" do
    get "/api/member/shifts", headers: member_headers(member)

    writes = sql_writes_during do
      travel(59.minutes) { get "/api/member/shifts", headers: member_headers(member) }
    end

    expect(response).to have_http_status(:ok)
    expect(writes).to be_empty
  end

  # A page view is not an edit. Stamping updated_at every hour would make it useless for telling
  # when an admin last actually changed a housemate's name or number.
  it "leaves updated_at alone" do
    get "/api/member/shifts", headers: member_headers(member)
    updated_at = member.reload.updated_at

    travel(61.minutes) { get "/api/member/shifts", headers: member_headers(member) }

    expect(member.reload.updated_at).to eq(updated_at)
  end

  # A deactivated member authenticates as nobody (see MemberAuthenticatable), so their token cannot
  # be used to keep a removed housemate looking alive on the super admin dashboards.
  it "is not written for a token that was refused" do
    member.update!(active: false)

    get "/api/member/shifts", headers: member_headers(member)

    expect(response).to have_http_status(:unauthorized)
    expect(member.reload.last_seen_at).to be_nil
  end
end
