require "rails_helper"

# Redaction is structural, and this is the spec that says so.
#
# Every text this product sends carries the recipient's magic link, and that link is a permanent
# login to somebody else's house — not a session, not a password that can be rotated by the person
# who owns it without being told. An operator debugging "why didn't Alice get her text" needs the
# body and never needs the credential inside it.
#
# So the bodies under test here are not hand-written: SendSmsJob composes them, exactly as it does
# in production, and the assertions are a grep of the raw JSON for each member's token and for the
# `/s/` path that carries it. A serializer that ever grows a branch back to the house's own shape
# fails this file, on every endpoint in the namespace at once.
RSpec.describe "Super admin redaction" do
  let(:operator) { "user_01OPERATOR" }
  let(:group) { create(:group, name: "Alma Road") }
  let(:members) { create_list(:member, 3, group: group) }
  let(:rota) { create(:rota, group: group, name: "Bins") }

  before do
    allowlist_super_admins(operator)

    members.each_with_index { |member, index| create(:rota_position, rota: rota, member: member, position: index) }

    # A reminder, a cover notice and a personal link: the three kinds of text there are, each sent
    # by the real job so the body in the database is the body a phone would have received.
    members.each_with_index do |member, index|
      shift = create(:shift, rota: rota, assigned_member: member, due_on: Date.current + index + 1)
      send_now(create(:sms_message, shift: shift, member: member, days_before: 3))
    end

    cover_shift = create(:shift, rota: rota, assigned_member: members.first, due_on: Date.current + 30)
    send_now(create(:sms_message, :cover_notice, shift: cover_shift, member: members.second))
    send_now(SmsMessage.create!(member: members.third, kind: :member_login))
  end

  # A fresh stub per send: `twilio_sid` is unique, so replaying one SID would fail the second
  # message rather than sending it, and an unsent row has no body to redact.
  def send_now(message)
    stub_twilio_send
    SendSmsJob.perform_now(message.id)
    message.reload
  end

  def headers = workos_headers(sub: operator, org_id: nil)

  def super_admin_bodies
    [
      "/api/super_admin/groups",
      "/api/super_admin/groups/#{group.id}",
      "/api/super_admin/groups/#{group.id}/sms_messages"
    ].to_h do |path|
      get path, headers: headers
      expect(response).to have_http_status(:ok)
      [ path, response.body ]
    end
  end

  it "sent texts that really do carry a magic link, or this spec proves nothing" do
    expect(SmsMessage.pluck(:body)).to all(include("/s/"))
    expect(SmsMessage.count).to eq(5)
    expect(SmsMessage.pluck(:status).uniq).to eq([ "sent" ])
  end

  it "never returns a member's access token, on any super admin endpoint" do
    super_admin_bodies.each do |path, body|
      members.each do |member|
        expect(body).not_to include(member.access_token), "#{path} leaked #{member.name}'s access token"
      end
    end
  end

  it "never returns the path a magic link is served at, on any super admin endpoint" do
    super_admin_bodies.each do |path, body|
      expect(body).not_to include("/s/"), "#{path} carried a magic-link path"
    end
  end

  it "replaces the link with a marker, and leaves the rest of the text readable" do
    get "/api/super_admin/groups/#{group.id}/sms_messages", headers: headers

    bodies = response.parsed_body.fetch("sms_messages").map { |row| row.fetch("body") }

    expect(bodies).to all(include("[link]"))
    expect(bodies.count { |body| body.include?("Manage: [link]") }).to eq(4)
    expect(bodies).to include(a_string_including("It's your turn for Bins"))
    expect(bodies).to include(a_string_including("Keep this link private"))
  end

  it "shows every phone number in full, because that is what a delivery failure is diagnosed from" do
    super_admin_bodies.slice(
      "/api/super_admin/groups/#{group.id}",
      "/api/super_admin/groups/#{group.id}/sms_messages"
    ).each do |path, body|
      members.each do |member|
        expect(body).to include(member.phone_e164), "#{path} did not carry #{member.name}'s number"
      end
    end
  end

  # The house's own log is unchanged: the link in it is the house's own link, handing it out is a
  # core admin action, and the redaction above belongs to the operator's serializer alone.
  it "leaves the house's own delivery log exactly as it was" do
    get "/api/sms_messages", headers: workos_headers(org_id: group.workos_organization_id)

    expect(response).to have_http_status(:ok)
    expect(response.body).to include("/s/#{members.first.access_token}")
  end

  # Belt and brace: the pattern matches the URL, and anything that ever gets past it loses its whole
  # line. Neither path can emit a token.
  it "redacts a link that arrives in a shape the URL pattern does not expect" do
    message = SmsMessage.last
    message.update_columns(body: "Bins tomorrow.\nManage: <https://rota.example/s/#{members.first.access_token}>")

    serialized = SuperAdmin::SmsMessageSerializer.one(message)

    expect(serialized.fetch(:body)).to eq("Bins tomorrow.\nManage: [link]")
  end

  # The last pass does not care what shape the credential arrived in. A token with no URL around it
  # is still a permanent login, and this is the case neither pattern above would catch.
  it "redacts a token that appears with no link around it at all" do
    message = SmsMessage.last
    message.update_columns(body: "Alice says her code #{members.first.access_token} stopped working.")

    serialized = SuperAdmin::SmsMessageSerializer.one(message)

    expect(serialized.fetch(:body)).to eq("Alice says her code [link] stopped working.")
  end

  it "redacts a token belonging to another member of the same house" do
    message = SmsMessage.where(member_id: members.first.id).last
    message.update_columns(body: "Forwarded from Bob: #{members.second.access_token}")

    serialized = SuperAdmin::SmsMessageSerializer.one(message)

    expect(serialized.fetch(:body)).to eq("Forwarded from Bob: [link]")
  end

  # A path is not a credential. Blanking a line because it mentioned one would lose the sentence an
  # operator is reading the log for.
  it "leaves a sentence that mentions the path but carries no token" do
    message = SmsMessage.last
    message.update_columns(body: "see https://ourhouse.example/s/ for the rota")

    serialized = SuperAdmin::SmsMessageSerializer.one(message)

    expect(serialized.fetch(:body)).to eq("see https://ourhouse.example/s/ for the rota")
  end
end
