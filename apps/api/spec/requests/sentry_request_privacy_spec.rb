require "rails_helper"

# The privacy contract, proved on a real request rather than on a hand-built event.
#
# This is the case the whole of docs/sentry-error-logging.md §3 is written about: a member's request
# carries a permanent bearer credential in a header and a phone number in the body, and a 500 on
# that request is the moment Sentry gets handed the entire rack environment. Everything that stops
# the credential leaving with it — the header deny list, bodies switched off, the scrubber — is
# configuration, and configuration is what gets edited by someone who has not read the plan.
RSpec.describe "A member request that raises tells Sentry nothing private" do
  include Sentry::TestHelper

  before { setup_sentry_test }
  after { teardown_sentry_test }

  # The factory's number is a real, dialable GB shape, which is what makes the assertions below
  # meaningful: it is the E.164 pattern the scrubber looks for.
  let(:member) { create(:member) }

  # The one line in this file that is not about privacy: it is what turns a healthy request into the
  # 500 the rest of the spec is about.
  def raise_inside_the_member_path
    allow_any_instance_of(Api::MemberCoversController).to receive(:create)
      .and_raise(RuntimeError, "a bug on the cover path")
  end

  def post_cover
    shift = create(:shift, assigned_member: member, rota: create(:rota, group: member.group))

    post "/api/member/shifts/#{shift.id}/cover",
      params: { covering_member_id: 0, phone: member.phone_e164 },
      headers: member_headers(member)
  end

  it "reports the failure, so this is a spec about a real event and not about silence" do
    raise_inside_the_member_path

    expect { post_cover }.to raise_error(RuntimeError, "a bug on the cover path")

    expect(sentry_events.size).to eq(1)
    expect(sentry_events.last.transaction).to eq("Api::MemberCoversController#create")
  end

  it "carries neither the member's token nor their phone number anywhere in the event" do
    raise_inside_the_member_path
    expect { post_cover }.to raise_error(RuntimeError)

    json = JSON.generate(sentry_events.last.to_json_compatible)

    expect(json).not_to include(member.access_token)
    expect(json).not_to include(member.phone_e164)
  end

  it "keeps the Authorization and Cookie headers out of the request interface" do
    raise_inside_the_member_path
    expect { post_cover }.to raise_error(RuntimeError)

    headers = sentry_events.last.request.headers

    # The deny list redacts the value in place rather than dropping the key, so the assertion is
    # about what the value is, not about whether the header is listed.
    expect(headers.fetch("Authorization", "[Filtered]")).to eq("[Filtered]")
    expect(headers.fetch("Cookie", "[Filtered]")).to eq("[Filtered]")
    expect(headers.values).to all(satisfy { |value| !value.to_s.include?(member.access_token) })
  end

  it "sends no request body at all, which is where the phone number was" do
    raise_inside_the_member_path
    expect { post_cover }.to raise_error(RuntimeError)

    expect(sentry_events.last.request.data).to be_nil
  end

  # The other half of §6.4: an event with no identifying context is an event nobody can act on, so
  # the member path tags the ids that are safe to carry and no others.
  it "tags the group and the member row id, and sets no user" do
    raise_inside_the_member_path
    expect { post_cover }.to raise_error(RuntimeError)

    event = sentry_events.last
    expect(event.tags).to include(surface: "member", group_id: member.group_id, member_id: member.id)
    expect(event.user).to eq({})
  end

  # The operator's front door (BLO-1669), which is the third surface and the only one that reads
  # across every house. An event from it has to name the human who made it, and the WorkOS user id
  # is the only name it may carry. The token below deliberately holds an email claim, because what
  # this proves is that none of it travels with the event.
  describe "a super admin request that raises" do
    let(:operator) { "user_01OPERATOR" }

    before do
      allowlist_super_admins(operator)
      allow_any_instance_of(SuperAdmin::OverviewController).to receive(:show)
        .and_raise(RuntimeError, "a bug on the operator path")
    end

    it "tags the operator surface and names the operator by id, never by email" do
      headers = workos_headers(sub: operator, org_id: nil, email: "operator@example.com")

      expect { get "/api/super_admin/overview", headers: headers }.to raise_error(RuntimeError)

      event = sentry_events.last
      expect(event.tags).to include(surface: "super-admin")
      expect(event.user).to eq({ id: operator })
      expect(JSON.generate(event.to_json_compatible)).not_to include("operator@example.com")
    end
  end
end
