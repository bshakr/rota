require "rails_helper"

# The funnel, end to end, in the order a real house walks it: named, rota, housemate, text
# delivered, link opened, calendar connected.
#
# Every example asks the same two questions, because the events are only worth anything if both
# answers hold. Does the step fire the first time it can be true? And does it stay silent the second
# time — so "houses that saved a rota" counts houses and not rotas.
RSpec.describe "the analytics funnel" do
  let(:group) { create(:group, workos_organization_id: "org_01FLAT", name: "Flat 4, Alma Road", timezone: "UTC") }
  def headers = workos_headers(org_id: group.workos_organization_id)

  # Every example reads the rows the request wrote. There is no recorder and no stub: the funnel is
  # a table in this database, so the assertion is the same thing a report would read.
  def events(name) = AnalyticsEvent.named(name)
  def event_names = AnalyticsEvent.pluck(:name)

  describe "house_named" do
    it "fires when /setup confirms the timezone, carrying the campaign that brought the house here" do
      patch "/api/group", params: {
        name: "Flat 4, Alma Road", timezone: "Europe/London",
        first_touch: { utm_source: "reddit", utm_medium: "social", ref: "r-ukhousing" }
      }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(events("house_named").sole).to have_attributes(
        group: group,
        properties: { "utm_source" => "reddit", "utm_medium" => "social", "ref" => "r-ukhousing" }
      )
      expect(group.reload.first_touch).to eq("utm_source" => "reddit", "utm_medium" => "social", "ref" => "r-ukhousing")
    end

    it "fires with no campaign at all for a house that arrived direct" do
      patch "/api/group", params: { name: "Flat 4", timezone: "Europe/London" }, headers: headers

      expect(events("house_named").sole).to have_attributes(group: group, properties: {})
      expect(group.reload.first_touch).to be_nil
    end

    it "stays silent when the house was already named" do
      group.update!(timezone_confirmed_at: 1.day.ago)

      patch "/api/group", params: { name: "Flat 4 renamed", timezone: "Europe/Paris" }, headers: headers

      expect(event_names).to be_empty
    end

    # A house records where it came from once. A later PATCH — a settings save, a replayed request —
    # must never relabel it, or the campaign report becomes a report on whoever edited last.
    it "never overwrites a first touch that is already recorded" do
      group.update!(timezone_confirmed_at: 1.day.ago, first_touch: { "utm_source" => "reddit" })

      patch "/api/group", params: { name: "Flat 4", first_touch: { utm_source: "instagram" } }, headers: headers

      expect(group.reload.first_touch).to eq("utm_source" => "reddit")
    end

    it "refuses to store anything beyond the five recognised keys" do
      patch "/api/group", params: {
        name: "Flat 4", timezone: "Europe/London",
        first_touch: { utm_source: "reddit", gclid: "abc", email: "someone@example.com" }
      }, headers: headers

      expect(group.reload.first_touch).to eq("utm_source" => "reddit")
    end
  end

  describe "first_rota_saved" do
    def create_rota(name)
      post "/api/rotas", params: { name: name, message_template: "Hi {{name}}, {{rota}} on {{date}}.",
                                   starts_on: group.today.iso8601, interval_count: 1,
                                   interval_unit: "week", send_hour: 9 }, headers: headers
    end

    it "fires for the house's first rota and not the second" do
      create_rota("Bins")
      expect(response).to have_http_status(:created)
      expect(events("first_rota_saved").sole).to have_attributes(group: group, properties: {})

      create_rota("Hoovering")

      expect(events("first_rota_saved").count).to eq(1)
    end
  end

  describe "first_member_added" do
    def add_member(name, phone)
      post "/api/members", params: { name: name, phone_e164: phone }, headers: headers
    end

    it "fires for the house's first housemate and not the second" do
      add_member("Eliza", "+447400123003")
      expect(response).to have_http_status(:created)
      expect(event_names).to eq([ "first_member_added" ])

      add_member("Raph", "+447400123004")

      expect(events("first_member_added").count).to eq(1)
    end

    # The event names a house, never a person: the housemate's name and number were just posted, and
    # neither may travel onwards.
    it "carries no name and no phone number" do
      add_member("Eliza", "+447400123003")

      expect(AnalyticsEvent.pluck(:properties).to_json).not_to include("Eliza", "447400123003")
    end
  end

  describe "first_text_delivered" do
    let(:rota) { create(:rota, :with_roster, group: group) }
    let(:shift) { create(:shift, rota: rota) }
    let(:text) { create(:sms_message, :sent, shift: shift, twilio_sid: "SM00000000000000000000000000000001") }

    def deliver(sms, status: "delivered")
      params = { "MessageSid" => sms.twilio_sid, "MessageStatus" => status }
      post twilio_status_webhook_path, params: params,
                                       headers: { "X-Twilio-Signature" => twilio_signature_for(params) }
    end

    it "fires on the first carrier-confirmed delivery to the house" do
      deliver(text)

      expect(response).to have_http_status(:no_content)
      expect(events("first_text_delivered").sole).to have_attributes(group: group, properties: {})
    end

    it "does not fire again for the house's second delivered text" do
      deliver(text)
      second = create(:sms_message, :sent, shift: create(:shift, rota: rota, due_on: 14.days.from_now.to_date),
                                           twilio_sid: "SM00000000000000000000000000000002")

      deliver(second)

      expect(events("first_text_delivered").count).to eq(1)
    end

    # "Sent" is Twilio accepting the message. Only the carrier's receipt says a phone buzzed, and
    # that is the step the funnel counts.
    it "ignores a failed delivery" do
      deliver(text, status: "failed")

      expect(text.reload.status).to eq("failed")
      expect(event_names).to be_empty
    end
  end

  describe "first_member_link_opened" do
    let!(:rota) { create(:rota, :with_roster, group: group) }
    let(:eliza) { create(:member, group: group, name: "Eliza") }

    it "fires the first time a housemate's magic link authenticates, and stamps the member" do
      get "/api/member/schedule", headers: member_headers(eliza)

      expect(response).to have_http_status(:ok)
      expect(events("first_member_link_opened").sole).to have_attributes(
        group: group, properties: { "member_id" => eliza.id }
      )
      expect(eliza.reload.first_opened_at).to be_present
    end

    it "does not fire again when the same housemate comes back" do
      get "/api/member/schedule", headers: member_headers(eliza)
      opened_at = eliza.reload.first_opened_at

      get "/api/member/schedule", headers: member_headers(eliza)

      expect(events("first_member_link_opened").count).to eq(1)
      expect(eliza.reload.first_opened_at).to eq(opened_at)
    end

    # Two housemates opening is the number that matters, so this must be per member, not per house.
    it "fires once per housemate" do
      raph = create(:member, group: group, name: "Raph")

      get "/api/member/schedule", headers: member_headers(eliza)
      get "/api/member/schedule", headers: member_headers(raph)

      expect(events("first_member_link_opened").count).to eq(2)
    end

    # A housemate who opens their link while the house is paused sees the paused notice, not their
    # rota, so they have not turned up in any sense the funnel means. The once-ever event must still
    # be there to claim when the house comes back.
    it "stays silent, and leaves the claim unmade, while the house is paused" do
      group.update!(suspended_at: Time.current)

      get "/api/member/schedule", headers: member_headers(eliza)

      expect(events("first_member_link_opened")).to be_empty
      expect(eliza.reload.first_opened_at).to be_nil
    end

    it "fires the first time the housemate opens after the house is resumed" do
      group.update!(suspended_at: Time.current)
      get "/api/member/schedule", headers: member_headers(eliza)

      group.update!(suspended_at: nil)
      get "/api/member/schedule", headers: member_headers(eliza)

      expect(events("first_member_link_opened").count).to eq(1)
      expect(eliza.reload.first_opened_at).to be_present
    end

    it "stays silent for a token that authenticates as nobody" do
      get "/api/member/schedule", headers: { "Authorization" => "Bearer not-a-real-token" }

      expect(response).to have_http_status(:unauthorized)
      expect(event_names).to be_empty
    end
  end

  describe "calendar_connected" do
    let!(:alfie) { create(:member, group: group, name: "Alfie") }
    let(:url) { "https://calendar.google.com/calendar/ical/park%40gmail.com/private-abc123def456/basic.ics" }
    let(:feed) { file_fixture("ics/google_export.ics").read }

    before do
      stub_claude_for_titles("Alfie in Greece (Song Leader Retreat)" => [ "away", [ alfie.id ], "Alfie, six nights in Greece" ])
      stub_request(:get, url).to_return(status: 200, body: feed)
    end

    it "fires when a house that had no calendar connects one" do
      put "/api/group/calendar", params: { ical_url: url }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(events("calendar_connected").sole).to have_attributes(group: group, properties: {})
    end

    # Re-pasting a link onto a house that already has one is an edit, not a conversion.
    it "stays silent when the house is only changing an existing link" do
      put "/api/group/calendar", params: { ical_url: url }, headers: headers

      put "/api/group/calendar", params: { ical_url: url }, headers: headers

      expect(events("calendar_connected").count).to eq(1)
    end

    # The link is a credential (BLO-1667 spec section 5). It may not leave in a response, a log, or
    # an analytics event.
    it "never carries the calendar link" do
      put "/api/group/calendar", params: { ical_url: url }, headers: headers

      expect(AnalyticsEvent.pluck(:properties).to_json).not_to include("private-abc123def456")
    end
  end
end
