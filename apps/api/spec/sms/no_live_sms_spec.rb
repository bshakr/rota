require "rails_helper"

# The one spec whose failure means somebody's phone rang.
#
# Two independent things have to hold, and neither relies on the other:
#
#   1. Test runs the *real* Twilio adapter — the specs exercise the real client, the real request
#      shape and the real error handling — and WebMock is what stops the request leaving the
#      machine. Nothing here is mocked away; the network is simply not there.
#   2. Development runs a null adapter that constructs no HTTP client at all, so a developer with
#      real numbers in their database and `bin/jobs` running cannot text anybody, whatever .env says.
RSpec.describe "no live SMS" do
  it "blocks every outbound HTTP request in the test environment" do
    expect(WebMock::Config.instance.allow_net_connect).to be_falsey
  end

  it "raises rather than reaching Twilio when a send is not stubbed" do
    member = create(:member)

    expect { Sms.deliver(to: member.phone_e164, body: "Hi") }
      .to raise_error(WebMock::NetConnectNotAllowedError, /api\.twilio\.com/)
  end

  it "runs the real Twilio adapter under test, so the specs prove the real path" do
    expect(Rails.configuration.x.sms.adapter).to eq("twilio")
    expect(Sms.adapter).to be_a(Sms::TwilioAdapter)
  end

  describe Sms::NullAdapter do
    it "sends nothing over the network" do
      # WebMock would raise if it so much as opened a connection; the send below simply returns.
      delivery = described_class.new.deliver(
        to: "+447700900123",
        body: "Bins tomorrow",
        status_callback: Sms.status_callback_url
      )

      expect(delivery.sid).to match(/\ASM[0-9a-f]{32}\z/)
      expect(delivery.status).to eq("queued")
    end

    it "logs the body instead, which is the whole point of it" do
      allow(Rails.logger).to receive(:info)

      described_class.new.deliver(to: "+447700900123", body: "Bins tomorrow", status_callback: "x")

      expect(Rails.logger).to have_received(:info).with(/Bins tomorrow/)
    end
  end
end
